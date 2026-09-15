import { redirect } from "next/navigation";

import { auth } from "@/auth";
import EngineLedger from "@/app/ui/engine-ledger";
import { WEEKLY_LEDGER_WINDOW_DAYS } from "@/app/body/page";
import { fetchDashboardData } from "@/lib/dashboard/data";
import { buildEngineView } from "@/lib/dashboard/engine-view";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function Engine() {
  // proxy.ts already gates this route; re-checking here keeps real
  // biometric data behind a session even if the proxy matcher ever
  // regresses (same defense-in-depth as app/body/page.tsx, app/daily/page.tsx).
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  const data = await fetchDashboardData(WEEKLY_LEDGER_WINDOW_DAYS, Number(session.user.id));
  const view = buildEngineView(data);

  return <EngineLedger rows={view.rows} completedWeeks={view.completedWeeks} />;
}
