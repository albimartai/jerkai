import WeeklyLedger from "@/app/ui/weekly-ledger";
import { buildWeeklyView } from "@/lib/dashboard/weekly-view";
import { DEMO_DASHBOARD_DATA } from "@/lib/demo/synthetic-data";

// Public demo of the Weekly Ledger (docs/prd/public-demo.md, AC-PD1). Reads
// only the committed synthetic fixture — no auth() call, no DB import,
// mirroring app/privacy/page.tsx's "static content only" precedent rather
// than the auth()-then-redirect pattern every gated page uses. Calls the
// same pure buildWeeklyView the real /weekly page calls (NFR-50) — the
// demo just never reaches fetchDashboardData/lib/db.ts to get there.
export default function DemoWeekly() {
  const view = buildWeeklyView(DEMO_DASHBOARD_DATA);

  return (
    <WeeklyLedger
      rows={view.rows}
      completedWeeks={view.completedWeeks}
      navVariant="demo"
      dailyBasePath="/demo/daily"
    />
  );
}
