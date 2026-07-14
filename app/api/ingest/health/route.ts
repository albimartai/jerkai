import { createHash, timingSafeEqual } from "node:crypto";

import { getSql } from "@/lib/db";
import { sendSyncFailureAlert } from "@/lib/alerts";
import {
  mapHealthExportPayload,
  mergeDailyPoints,
  READING_SOURCES,
  type DailyPoints,
  type HealthExportPayload,
  type MappedReading,
  type ReadingSource,
} from "@/lib/health-export";

// Every source gets its own sync_runs lane — including 'apple_health'
// (step_count), which arrives in the same ingest call as the device pipes
// but since Session 5 is logged and alerted on independently.
const SYNC_SOURCES = READING_SOURCES;
type SyncSource = ReadingSource;

type SourceOutcome = {
  status: "success" | "failure" | "partial";
  rowsSynced: number;
  errorMessage: string | null;
};

function isAuthorized(request: Request, secret: string): boolean {
  const provided = request.headers.get("x-api-key") ?? "";
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const providedDigest = createHash("sha256").update(provided).digest();
  const secretDigest = createHash("sha256").update(secret).digest();
  return timingSafeEqual(providedDigest, secretDigest);
}

async function recordRun(
  source: SyncSource,
  startedAt: Date,
  outcome: SourceOutcome,
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into sync_runs (source, started_at, finished_at, status, rows_synced, error_message)
    values (${source}, ${startedAt.toISOString()}, now(), ${outcome.status},
            ${outcome.rowsSynced}, ${outcome.errorMessage})
  `;
}

// A request that never reached the mapping stage (bad secret, malformed body)
// can't be attributed to one source, and no pipe landed — log a failure
// run for every lane so /status and alerting see it either way.
async function recordRejectedRequest(startedAt: Date, reason: string): Promise<void> {
  try {
    await Promise.all(
      SYNC_SOURCES.map((source) =>
        recordRun(source, startedAt, {
          status: "failure",
          rowsSynced: 0,
          errorMessage: reason,
        }),
      ),
    );
  } catch (err) {
    console.error("failed to record rejected ingest request:", err);
  }
  await sendSyncFailureAlert(
    "JerkAI sync failure: ingest request rejected",
    `An ingest request to /api/ingest/health was rejected.\n\nReason: ${reason}\nTime: ${new Date().toISOString()}\n\nSee jerkai.app/status for last-successful-sync state.`,
  );
}

async function upsertReading(reading: MappedReading): Promise<void> {
  const sql = getSql();

  let { value, rawPayload } = reading;
  if (reading.aggregation === "sum") {
    // Cumulative metric: a day's samples split across "Since Last Sync"
    // calls, so overwriting would drop everything from earlier calls (the
    // bug that corrupted the step_count backfill). Merge with the stored
    // samples by timestamp and recompute the day's total. The read-then-
    // write pair is not atomic, but the only client is a single phone
    // sending sequential requests; a lost race re-heals on the next re-send
    // because merging is idempotent.
    const existing = await sql`
      select raw_payload from biometric_readings
      where source = ${reading.source} and metric = ${reading.metric}
        and reading_date = ${reading.readingDate}
    `;
    const merged = mergeDailyPoints(
      existing[0]?.raw_payload,
      (reading.rawPayload as DailyPoints).points,
    );
    value = merged.total;
    rawPayload = { points: merged.points };
  }

  // Idempotent per (source, metric, date): Health Auto Export re-sends the
  // current day on every scheduled run, and the backfill will overlap days.
  await sql`
    insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
    values (${reading.source}, ${reading.metric}, ${reading.readingDate},
            ${value}, ${reading.unit}, ${JSON.stringify(rawPayload)}::jsonb)
    on conflict (source, metric, reading_date)
    do update set value = excluded.value,
                  unit = excluded.unit,
                  raw_payload = excluded.raw_payload,
                  synced_at = now()
  `;
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = new Date();

  const secret = process.env.HEALTH_EXPORT_SHARED_SECRET;
  if (!secret) {
    console.error("ingest rejected: HEALTH_EXPORT_SHARED_SECRET is not set");
    return Response.json({ error: "server is not configured for ingest" }, { status: 500 });
  }

  if (!isAuthorized(request, secret)) {
    await recordRejectedRequest(startedAt, "unauthorized: missing or invalid x-api-key header");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: HealthExportPayload;
  try {
    payload = (await request.json()) as HealthExportPayload;
  } catch {
    await recordRejectedRequest(startedAt, "malformed request: body is not valid JSON");
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const mapped = mapHealthExportPayload(payload);
  if (mapped.readings.length === 0 && mapped.errors.length > 0) {
    const reason = `malformed payload: ${mapped.errors.join("; ")}`;
    await recordRejectedRequest(startedAt, reason);
    return Response.json({ error: reason }, { status: 400 });
  }

  // Land readings one by one so a single bad data point degrades that
  // source's run to 'partial' instead of discarding the whole payload.
  const outcomes = new Map<SyncSource, { synced: number; errors: string[] }>();
  for (const source of SYNC_SOURCES) {
    outcomes.set(source, { synced: 0, errors: [] });
  }
  for (const error of mapped.errors) {
    // Mapping errors carry the metric name; attribute each to its source's
    // lane based on the metric prefix in the message.
    const source: SyncSource = /^step_count/.test(error)
      ? "apple_health"
      : /^(heart_rate_variability|resting_heart_rate|sleep_analysis)/.test(error)
        ? "whoop"
        : "fitdays";
    outcomes.get(source)!.errors.push(error);
  }

  for (const reading of mapped.readings) {
    try {
      await upsertReading(reading);
      outcomes.get(reading.source)!.synced += 1;
    } catch (err) {
      const message = `${reading.metric} (${reading.readingDate}): ${err instanceof Error ? err.message : String(err)}`;
      outcomes.get(reading.source)!.errors.push(message);
    }
  }

  const runResults: Partial<Record<SyncSource, SourceOutcome>> = {};
  for (const source of SYNC_SOURCES) {
    const { synced, errors } = outcomes.get(source)!;
    if (synced === 0 && errors.length === 0) continue; // source absent from this payload
    const outcome: SourceOutcome = {
      status: errors.length === 0 ? "success" : synced > 0 ? "partial" : "failure",
      rowsSynced: synced,
      errorMessage: errors.length > 0 ? errors.join("; ") : null,
    };
    runResults[source] = outcome;
    try {
      await recordRun(source, startedAt, outcome);
    } catch (err) {
      console.error(`failed to record sync_runs row for ${source}:`, err);
    }
  }

  const failedSources = SYNC_SOURCES.filter(
    (source) => runResults[source] && runResults[source]!.status !== "success",
  );
  if (failedSources.length > 0) {
    const detail = failedSources
      .map((source) => `${source}: ${runResults[source]!.status} — ${runResults[source]!.errorMessage}`)
      .join("\n");
    await sendSyncFailureAlert(
      `JerkAI sync ${failedSources.length === SYNC_SOURCES.length ? "failure" : "partial failure"}: ${failedSources.join(", ")}`,
      `An ingest run completed with errors.\n\n${detail}\nTime: ${new Date().toISOString()}\n\nSee jerkai.app/status for last-successful-sync state.`,
    );
  }

  const overall =
    failedSources.length === 0 ? "success" : Object.keys(runResults).length > 0 ? "partial" : "failure";
  return Response.json(
    {
      status: overall,
      sources: runResults,
      ignoredMetrics: mapped.ignoredMetrics,
    },
    { status: overall === "failure" ? 500 : 200 },
  );
}
