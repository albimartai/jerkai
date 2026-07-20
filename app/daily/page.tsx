import { redirect } from "next/navigation";

import { auth } from "@/auth";
import Dashboard from "@/app/ui/dashboard";
import { fetchDashboardData } from "@/lib/dashboard/data";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

// Fetch the LARGEST window up front: the 30/90 toggle then re-renders
// client-side from data it already holds (AC-D16), and scrubbing never
// makes a network call (NFR-6).
const MAX_WINDOW_DAYS = 90;

// The strip stack's route (AC-W8, DL-2026-07-19-a) — the drill-down surface
// one nav click from the Weekly Ledger, which is now the default landing
// page at "/". `?week=` (a Monday, ISO week key) scopes the visible window
// to contain that week (AC-W6), set by the ledger's row links.
export default async function Daily({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // proxy.ts already gates this route; re-checking here keeps real
  // biometric data behind a session even if the proxy matcher ever
  // regresses.
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  const data = await fetchDashboardData(MAX_WINDOW_DAYS);
  const { week } = await searchParams;

  return <Dashboard data={data} focusWeekStart={week} />;
}
