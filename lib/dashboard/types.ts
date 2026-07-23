import { DAY_STRAIN_METRIC } from "@/lib/dashboard/strain";

// Pulled out of lib/dashboard/data.ts (which also holds fetchDashboardData,
// a DB-touching function) so these types/config can be imported without
// dragging lib/db.ts into the importer's module graph — the demo route
// (docs/prd/public-demo.md, NFR-51) needs DashboardData's shape without
// ever reaching the database, and a plain re-export from data.ts wouldn't
// achieve that: TypeScript still resolves the whole file, value imports
// included, to type-check a re-exported symbol.

// The (source, metric) pairs the v1 dashboard renders. Day Strain is pinned
// to the Whoop cycle metric, never the workout log (NFR-4).
export const DASHBOARD_METRICS = {
  bodyFatPct: { source: "fitdays", metric: "body_fat_pct" },
  // v1.1: weight promoted to a main-stack strip (AC-N4, DL-2026-07-18-b) —
  // already ingested via the Fitdays pipe, so this is a read-path add only
  // (NFR-15).
  weight: { source: "fitdays", metric: "weight" },
  leanBodyMass: { source: "fitdays", metric: "lean_body_mass" },
  dayStrain: DAY_STRAIN_METRIC,
  recoveryScore: { source: "whoop", metric: "recovery_score" },
  hrv: { source: "whoop", metric: "hrv" },
  rhr: { source: "whoop", metric: "rhr" },
  sleepDuration: { source: "whoop", metric: "sleep_duration" },
} as const;

export type DashboardMetricKey = keyof typeof DASHBOARD_METRICS;

export type DashboardData = {
  // Shared day axis, oldest first; empty when no dashboard metric has rows.
  axis: string[];
  // Per metric: one slot per axis day; null = genuine gap (AC-D13, NFR-8).
  series: Record<DashboardMetricKey, (number | null)[]>;
  // Unit as stored on the newest row in the window — read, never assumed.
  units: Record<DashboardMetricKey, string | null>;
  latestDay: string | null;
};
