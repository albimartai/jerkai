import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import type { DashboardData } from "@/lib/dashboard/data";
import { buildWeeklyLedger, completedWeekCount, type WeekRow } from "@/lib/dashboard/ledger";
import { rollingAverage } from "@/lib/dashboard/rolling";
import { stallBadge, type StallBadge } from "@/lib/dashboard/stall-badge";
import { toPounds } from "@/lib/dashboard/units";
import { weeklyStallBadge } from "@/lib/dashboard/weekly-badge";

// The one place the Weekly Ledger and the strip dashboard's hero badge both
// go through (NFR-21): both are thin consumers of this function, over the
// same fetched window, so they can never disagree (AC-W12) — the badge does
// not reimplement any ledger math, it just reads the same rows.

export type WeeklyView = {
  rows: WeekRow[];
  badge: StallBadge;
  completedWeeks: number;
  // Derived series reused by the strip dashboard (NFR-21: one computation,
  // not a fork) — lb-converted (NFR-16) and smoothed.
  bodyFat30: (number | null)[];
  weightLb: (number | null)[];
  weight7: (number | null)[];
  leanMassLb: (number | null)[];
  leanMass7: (number | null)[];
};

export function buildWeeklyView(data: DashboardData): WeeklyView {
  const lb = (series: readonly (number | null)[], unit: string | null) =>
    series.map((v) => (v === null ? null : toPounds(v, unit)));

  const bodyFat30 = rollingAverage(data.series.bodyFatPct, 30);
  const weightLb = lb(data.series.weight, data.units.weight);
  const weight7 = rollingAverage(weightLb, 7);
  const leanMassLb = lb(data.series.leanBodyMass, data.units.leanBodyMass);
  const leanMass7 = rollingAverage(leanMassLb, 7);

  const rows = buildWeeklyLedger(
    {
      axis: data.axis,
      bodyFatRaw: data.series.bodyFatPct,
      bodyFat30,
      weightRaw: weightLb,
      weight7,
      strainRaw: data.series.dayStrain,
      recoveryRaw: data.series.recoveryScore,
      leanMassRaw: leanMassLb,
      leanMass7,
    },
    DASHBOARD_CONFIG.ledger,
    DASHBOARD_CONFIG.recovery,
  );
  const badge = weeklyStallBadge(rows, () => stallBadge(bodyFat30));

  return {
    rows,
    badge,
    completedWeeks: completedWeekCount(rows),
    bodyFat30,
    weightLb,
    weight7,
    leanMassLb,
    leanMass7,
  };
}
