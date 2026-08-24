import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { NavHeader } from "@/app/ui/nav-header";
import { LocalTime } from "@/app/ui/local-time";
import { ACTIVE_SYNC_SOURCES } from "@/lib/sources";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

// The Neon driver parses timestamptz columns into Date objects, not strings
// (OID 1184) — this is the raw shape the query actually returns.
type SyncSummaryRow = {
  source: string;
  last_success: Date | null;
  last_run_at: Date | null;
  last_run_status: string | null;
};

export default async function Status() {
  // proxy.ts already gates this route; re-checking here keeps sync state
  // behind a session even if the proxy matcher ever regresses.
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  const sql = getSql();
  const userId = Number(session.user.id);
  const rows = (await sql`
    select source,
           max(coalesce(finished_at, started_at)) filter (where status = 'success') as last_success,
           max(coalesce(finished_at, started_at)) as last_run_at,
           (array_agg(status order by started_at desc))[1] as last_run_status
    from sync_runs
    where user_id = ${userId}
    group by source
  `) as SyncSummaryRow[];

  // Convert to ISO strings here (NFR-88's own example) rather than passing
  // Date objects across the server/client boundary as an untyped prop.
  const bySource = new Map(
    rows.map((row) => [
      row.source,
      {
        ...row,
        last_success: row.last_success ? row.last_success.toISOString() : null,
        last_run_at: row.last_run_at ? row.last_run_at.toISOString() : null,
      },
    ]),
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 font-sans">
      <NavHeader />
      <div className="flex flex-col items-center justify-center gap-6">
        <h1 className="text-lg text-zinc-500">Sync status</h1>
        {/* One lane per LIVE pipe (see lib/sources.ts) — retired sources like
            apple_health keep their historical sync_runs rows but no longer
            render a permanently-stale lane here. */}
        {ACTIVE_SYNC_SOURCES.map((source) => {
          const row = bySource.get(source);
          return (
            <div key={source} className="text-center">
              <p className="text-2xl font-semibold tracking-tight capitalize">
                {source.replaceAll("_", " ")}
              </p>
              <p className="text-sm text-zinc-500">
                Last successful sync:{" "}
                {row?.last_success ? <LocalTime iso={row.last_success} /> : "never"}
              </p>
              {row && row.last_run_status !== "success" ? (
                <p className="text-sm text-red-500">
                  Last run: {row.last_run_status} at <LocalTime iso={row.last_run_at!} />
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
