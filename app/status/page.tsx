import { getSql } from "@/lib/db";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

const SYNC_SOURCES = ["fitdays", "whoop"] as const;

type SyncSummaryRow = {
  source: string;
  last_success: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
};

export default async function Status() {
  const sql = getSql();
  const rows = (await sql`
    select source,
           to_char(max(coalesce(finished_at, started_at)) filter (where status = 'success')
                   at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"') as last_success,
           to_char(max(coalesce(finished_at, started_at))
                   at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"') as last_run_at,
           (array_agg(status order by started_at desc))[1] as last_run_status
    from sync_runs
    group by source
  `) as SyncSummaryRow[];

  const bySource = new Map(rows.map((row) => [row.source, row]));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 font-sans">
      <h1 className="text-lg text-zinc-500">Sync status</h1>
      {SYNC_SOURCES.map((source) => {
        const row = bySource.get(source);
        return (
          <div key={source} className="text-center">
            <p className="text-2xl font-semibold tracking-tight capitalize">{source}</p>
            <p className="text-sm text-zinc-500">
              Last successful sync: {row?.last_success ?? "never"}
            </p>
            {row && row.last_run_status !== "success" ? (
              <p className="text-sm text-red-500">
                Last run: {row.last_run_status} at {row.last_run_at}
              </p>
            ) : null}
          </div>
        );
      })}
    </main>
  );
}
