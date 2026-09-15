import { buildEngineLedger, completedWeekCount, type EngineWeekRow } from "@/lib/dashboard/engine";
import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import type { DashboardData } from "@/lib/dashboard/types";
import { rollingAverage } from "@/lib/dashboard/rolling";

// Thin composition layer over Engine's own pure ledger (PRD §1), modeled on
// lib/dashboard/weekly-view.ts's shape: computes the 7-day-rolling series
// Engine's delta columns need, then hands them to buildEngineLedger along
// with the existing, read-only-reused DASHBOARD_CONFIG.ledger/.recovery
// tunables (NFR-174 — no new config type). No hero badge: Engine has no
// single north-star metric the way Body's stall badge tracks body fat.

export type EngineView = {
  rows: EngineWeekRow[];
  completedWeeks: number;
};

export function buildEngineView(data: DashboardData): EngineView {
  const dayStrain7 = rollingAverage(data.series.dayStrain, 7);
  const hrv7 = rollingAverage(data.series.hrv, 7);
  const rhr7 = rollingAverage(data.series.rhr, 7);

  const rows = buildEngineLedger(
    {
      axis: data.axis,
      dayStrainRaw: data.series.dayStrain,
      dayStrain7,
      recoveryRaw: data.series.recoveryScore,
      hrvRaw: data.series.hrv,
      hrv7,
      rhrRaw: data.series.rhr,
      rhr7,
    },
    DASHBOARD_CONFIG.ledger,
    DASHBOARD_CONFIG.recovery,
  );

  return { rows, completedWeeks: completedWeekCount(rows) };
}
