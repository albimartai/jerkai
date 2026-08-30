import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { NavHeader } from "@/app/ui/nav-header";
import { LocalTime } from "@/app/ui/local-time";
import { FitdaysConnect } from "@/app/ui/fitdays-connect";
import { hasWhoopTokens } from "@/lib/whoop-oauth";
import { hasWithingsTokens } from "@/lib/withings-oauth";
import { resolvePrimaryUserId } from "@/lib/primary-user";
import { CATEGORIES, SOURCE_METADATA, type DataSource } from "@/app/data/source-metadata";

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

type SyncSummary = {
  last_success: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
};

// A "Connected" tag reflects primary-user identity, not sync activity (§0.5):
// the account resolvePrimaryUserId() currently attributes Fitdays ingest to.
// Fails closed — every non-single-match outcome (unset PRIMARY_USER_EMAIL,
// zero or multiple matching users) reads "not connected" rather than 500ing
// the page (AC-DS12, NFR-122).
async function isFitdaysConnected(userId: number): Promise<boolean> {
  try {
    return (await resolvePrimaryUserId()) === userId;
  } catch {
    return false;
  }
}

const CONNECT_CLASSES =
  "inline-block rounded-md bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900";

function SourceCard({
  displayName,
  method,
  connected,
  syncRow,
  connectAction,
}: {
  displayName: string;
  method: string;
  connected: boolean;
  syncRow: SyncSummary | undefined;
  connectAction: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-lg font-semibold tracking-tight">{displayName}</p>
          <p className="text-sm text-zinc-500">{method}</p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-sm ${
            connected
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      {/* Sync-history rendering is decoupled from the Connected/Not-connected tag
          (NFR-121) — computed solely from sync_runs, exactly as this page's
          predecessor computed it, unconditionally, never gated on `connected`. */}
      <p className="mt-2 text-sm text-zinc-500">
        Last successful sync:{" "}
        {syncRow?.last_success ? <LocalTime iso={syncRow.last_success} /> : "never"}
      </p>
      {syncRow && syncRow.last_run_status !== "success" ? (
        <p className="text-sm text-red-500">
          Last run: {syncRow.last_run_status} at <LocalTime iso={syncRow.last_run_at!} />
        </p>
      ) : null}
      {!connected ? <div className="mt-3">{connectAction}</div> : null}
    </div>
  );
}

export default async function Data() {
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
  const bySource = new Map<string, SyncSummary>(
    rows.map((row) => [
      row.source,
      {
        ...row,
        last_success: row.last_success ? row.last_success.toISOString() : null,
        last_run_at: row.last_run_at ? row.last_run_at.toISOString() : null,
      },
    ]),
  );

  // Each existence check is a direct, read-only query — never a call that
  // refreshes or re-persists a token (NFR-120): merely viewing this page must
  // not rotate a stored Whoop/Withings refresh token.
  const [whoopConnected, withingsConnected, fitdaysConnected] = await Promise.all([
    hasWhoopTokens(userId),
    hasWithingsTokens(userId),
    isFitdaysConnected(userId),
  ]);

  const connected: Record<DataSource, boolean> = {
    whoop: whoopConnected,
    withings: withingsConnected,
    fitdays: fitdaysConnected,
  };

  // Connect actions are plain <a href> anchors for the OAuth sources, never
  // Next's <Link> (NFR-124) — a viewport-triggered prefetch must never hit
  // /api/whoop/connect or /api/withings/connect before an actual click, since
  // each sets a fresh CSRF-state cookie as a side effect of merely loading.
  // Fitdays' Connect action opens a client-side modal instead (AC-DS10).
  const connectAction: Record<DataSource, ReactNode> = {
    whoop: (
      <a href="/api/whoop/connect" className={CONNECT_CLASSES}>
        Connect
      </a>
    ),
    withings: (
      <a href="/api/withings/connect" className={CONNECT_CLASSES}>
        Connect
      </a>
    ),
    fitdays: <FitdaysConnect />,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 font-sans">
      <NavHeader active="data" />
      <div className="flex flex-col gap-8">
        {CATEGORIES.map(({ name, sources }) => (
          <section key={name}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {name}
            </h2>
            <div className="mt-3 flex flex-col gap-4">
              {sources.map((source) => {
                const meta = SOURCE_METADATA[source];
                return (
                  <SourceCard
                    key={source}
                    displayName={meta.displayName}
                    method={meta.method}
                    connected={connected[source]}
                    syncRow={bySource.get(source)}
                    connectAction={connectAction[source]}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
