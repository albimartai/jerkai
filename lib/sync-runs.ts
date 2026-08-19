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

// userId is nullable: every resolved-attribution call site (the Whoop
// sync per-user loop, the ingest route's pre-auth/malformed-request and
// post-mapping-success paths) always passes a resolved number. The sole
// exception is the pre-existing, DO-NOT-EDIT-headered AC-PUE2 lane in
// app/api/ingest/health/route.ts's resolvePrimaryUserId() failure catch
// block, which has no userId to pass and stays on null (Whoop Multi-Tenancy
// PRD §0/AC-WT11/AC-WT12).
export async function recordSyncRun(
  source: ReadingSource,
  userId: number | null,
  startedAt: Date,
  outcome: SyncOutcome,
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced, error_message)
    values (${source}, ${userId}, ${startedAt.toISOString()}, now(), ${outcome.status},
            ${outcome.rowsSynced}, ${outcome.errorMessage})
  `;
}
