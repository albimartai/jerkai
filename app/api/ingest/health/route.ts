import { createHash, timingSafeEqual } from "node:crypto";

import { getSql } from "@/lib/db";
import { sendSyncFailureAlert } from "@/lib/alerts";
import {
  mapHealthExportPayload,
  type HealthExportPayload,
  type MappedReading,
} from "@/lib/health-export";

// The two device pipes tracked in sync_runs. step_count ('apple_health')
// arrives in the same ingest call, so its observability rides along: any run
// logged here also landed whatever steps the payload contained.
const SYNC_SOURCES = ["fitdays", "whoop"] as const;
type SyncSource = (typeof SYNC_SOURCES)[number];

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
// can't be attributed to one device, and neither pipe landed — log a failure
// run for both so /status and alerting see it either way.
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
  // Idempotent per (source, metric, date): Health Auto Export re-sends the
  // current day on every scheduled run, and the backfill will overlap days.
  await sql`
    insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
    values (${reading.source}, ${reading.metric}, ${reading.readingDate},
            ${reading.value}, ${reading.unit}, ${JSON.stringify(reading.rawPayload)}::jsonb)
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
  let appleHealthRows = 0;
  for (const source of SYNC_SOURCES) {
    outcomes.set(source, { synced: 0, errors: [] });
  }
  for (const error of mapped.errors) {
    // Mapping errors carry the metric name; attribute sleep/hrv/rhr to whoop,
    // body composition to fitdays, based on the metric prefix in the message.
    // step_count has no sync_runs lane of its own and rides with whoop.
    const source: SyncSource =
      /^(heart_rate_variability|resting_heart_rate|sleep_analysis|step_count)/.test(error)
        ? "whoop"
        : "fitdays";
    outcomes.get(source)!.errors.push(error);
  }

  for (const reading of mapped.readings) {
    try {
      await upsertReading(reading);
      if (reading.source === "apple_health") {
        appleHealthRows += 1;
      } else {
        outcomes.get(reading.source)!.synced += 1;
      }
    } catch (err) {
      const message = `${reading.metric} (${reading.readingDate}): ${err instanceof Error ? err.message : String(err)}`;
      if (reading.source === "apple_health") {
        // No apple_health lane in sync_runs — surface via whichever run exists.
        outcomes.get("whoop")!.errors.push(`step_count: ${message}`);
      } else {
        outcomes.get(reading.source)!.errors.push(message);
      }
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
      appleHealthRows,
      ignoredMetrics: mapped.ignoredMetrics,
    },
    { status: overall === "failure" ? 500 : 200 },
  );
}
