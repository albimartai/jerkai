import { getSql } from "@/lib/db";
import type { ReadingSource } from "@/lib/sources";

// One sync_runs row per pipe run per source — the observability layer behind
// /status and the failure alerting. Shared by the Health Auto Export ingest
// route and the Whoop sync route. Moved out of the ingest route in Session 8
// unchanged.

export type SyncOutcome = {
  status: "success" | "failure" | "partial";
  rowsSynced: number;
  errorMessage: string | null;
};

export async function recordSyncRun(
  source: ReadingSource,
  startedAt: Date,
  outcome: SyncOutcome,
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into sync_runs (source, started_at, finished_at, status, rows_synced, error_message)
    values (${source}, ${startedAt.toISOString()}, now(), ${outcome.status},
            ${outcome.rowsSynced}, ${outcome.errorMessage})
  `;
}
