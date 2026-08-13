import { redirect } from "next/navigation";

import { auth } from "@/auth";
import WeeklyLedger from "@/app/ui/weekly-ledger";
import { fetchDashboardData } from "@/lib/dashboard/data";
import { buildWeeklyView } from "@/lib/dashboard/weekly-view";
import { WEEKLY_LEDGER_WINDOW_DAYS } from "@/app/weekly/page";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

// The Weekly Ledger is the default landing page (AC-W8, DL-2026-07-19-a):
// the root URL renders the same view as /weekly. The strip dashboard, the
// prior occupant of "/", moved to /daily — existing bookmarks to "/" still
// resolve, just to the new default surface, rather than 404ing or needing a
// redirect to a URL that no longer exists.
export default async function Home() {
  // proxy.ts already gates this route; re-checking here keeps real
  // biometric data behind a session even if the proxy matcher ever
  // regresses.
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  const data = await fetchDashboardData(WEEKLY_LEDGER_WINDOW_DAYS, Number(session.user.id));
  const view = buildWeeklyView(data);

  return <WeeklyLedger rows={view.rows} completedWeeks={view.completedWeeks} />;
}
