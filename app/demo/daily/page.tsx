import Dashboard from "@/app/ui/dashboard";
import { buildCalorieSeries } from "@/lib/dashboard/calorie-strip";
import {
  DEMO_DAILY_CALORIES,
  DEMO_DASHBOARD_DATA,
  DEMO_TARGETS,
} from "@/lib/demo/synthetic-data";

// Public demo of the /daily strip stack (docs/prd/public-demo.md, AC-PD2).
// Reads only the committed synthetic fixture — no auth() call, no DB import
// (see tests/unit/demo-isolation.test.ts). Calls the same pure
// buildCalorieSeries the real /daily page calls (NFR-50) — the demo just
// never reaches fetchCalorieSeries/fetchTargets/lib/db.ts to get there.
// `Dashboard` is a "use client" component; this server page builds the
// fixture-derived props and passes them across that boundary exactly as the
// real app/daily/page.tsx already does — DashboardData/CalorieDay[] are
// plain serializable types, so nothing new crosses here.
export default async function DemoDaily({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const calorieSeries = buildCalorieSeries(
    DEMO_DASHBOARD_DATA.axis,
    DEMO_DAILY_CALORIES,
    DEMO_TARGETS,
  );

  return (
    <Dashboard
      data={DEMO_DASHBOARD_DATA}
      calorieSeries={calorieSeries}
      focusWeekStart={week}
      navVariant="demo"
    />
  );
}
