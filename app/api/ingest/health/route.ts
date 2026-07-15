import { createHash, timingSafeEqual } from "node:crypto";

import { sendSyncFailureAlert } from "@/lib/alerts";
import {
  HEALTH_EXPORT_SOURCES,
  mapHealthExportPayload,
  type HealthExportPayload,
  type HealthExportSource,
} from "@/lib/health-export";
import { upsertReading } from "@/lib/readings";
import { recordSyncRun, type SyncOutcome } from "@/lib/sync-runs";

// The Health Auto Export pipe — Fitdays-only as of Session 8 (Whoop data
// moved to the direct API integration; see lib/health-export.ts). One
// sync_runs lane per source in HEALTH_EXPORT_SOURCES.

function isAuthorized(request: Request, secret: string): boolean {
  const provided = request.headers.get("x-api-key") ?? "";
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const providedDigest = createHash("sha256").update(provided).digest();
  const secretDigest = createHash("sha256").update(secret).digest();
  return timingSafeEqual(providedDigest, secretDigest);
}

// A request that never reached the mapping stage (bad secret, malformed body)
// can't be attributed to one source, and no pipe landed — log a failure
// run for every lane this route owns so /status and alerting see it either
// way. (Only this route's lanes: a broken phone export must not poison the
// whoop lane, which belongs to /api/whoop/sync.)
async function recordRejectedRequest(startedAt: Date, reason: string): Promise<void> {
  try {
    await Promise.all(
      HEALTH_EXPORT_SOURCES.map((source) =>
        recordSyncRun(source, startedAt, {
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
  const outcomes = new Map<HealthExportSource, { synced: number; errors: string[] }>();
  for (const source of HEALTH_EXPORT_SOURCES) {
    outcomes.set(source, { synced: 0, errors: [] });
  }
  // Every mapped metric is Fitdays', so mapping errors all land on that lane.
  for (const error of mapped.errors) {
    outcomes.get("fitdays")!.errors.push(error);
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

  const runResults: Partial<Record<HealthExportSource, SyncOutcome>> = {};
  for (const source of HEALTH_EXPORT_SOURCES) {
    const { synced, errors } = outcomes.get(source)!;
    if (synced === 0 && errors.length === 0) continue; // source absent from this payload
    const outcome: SyncOutcome = {
      status: errors.length === 0 ? "success" : synced > 0 ? "partial" : "failure",
      rowsSynced: synced,
      errorMessage: errors.length > 0 ? errors.join("; ") : null,
    };
    runResults[source] = outcome;
    try {
      await recordSyncRun(source, startedAt, outcome);
    } catch (err) {
      console.error(`failed to record sync_runs row for ${source}:`, err);
    }
  }

  const failedSources = HEALTH_EXPORT_SOURCES.filter(
    (source) => runResults[source] && runResults[source]!.status !== "success",
  );
  if (failedSources.length > 0) {
    const detail = failedSources
      .map((source) => `${source}: ${runResults[source]!.status} — ${runResults[source]!.errorMessage}`)
      .join("\n");
    await sendSyncFailureAlert(
      `JerkAI sync ${failedSources.length === HEALTH_EXPORT_SOURCES.length ? "failure" : "partial failure"}: ${failedSources.join(", ")}`,
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
