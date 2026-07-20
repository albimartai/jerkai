import { redirect } from "next/navigation";

import { auth } from "@/auth";
import WeeklyLedger from "@/app/ui/weekly-ledger";
import { fetchDashboardData } from "@/lib/dashboard/data";
import { buildWeeklyView } from "@/lib/dashboard/weekly-view";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

// Reuses the strip dashboard's 90-day read path rather than a new query
// shape (NFR-25): ≈ 13 completed weeks (AC-W5) plus the in-progress week.
export const WEEKLY_LEDGER_WINDOW_DAYS = 90;

export default async function Weekly() {
  // proxy.ts already gates this route; re-checking here keeps real
  // biometric data behind a session even if the proxy matcher ever
  // regresses (same defense-in-depth as app/daily/page.tsx and
  // app/status/page.tsx).
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  const data = await fetchDashboardData(WEEKLY_LEDGER_WINDOW_DAYS);
  const view = buildWeeklyView(data);

  return <WeeklyLedger rows={view.rows} completedWeeks={view.completedWeeks} />;
}
