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
//
// bodyFatPct/weight/leanBodyMass carry a `sources` candidate list rather than
// a single `source`: each user runs exactly one active smart-scale source at
// a time (fitdays or withings), resolved once per user and applied uniformly
// across all three (never independently per metric) — see
// lib/dashboard/data.ts#fetchDashboardData and DashboardData#resolvedScaleSource,
// below. Every other entry has exactly one candidate source and keeps the
// single-`source` shape.
export const DASHBOARD_METRICS = {
  bodyFatPct: { sources: ["fitdays", "withings"], metric: "body_fat_pct" },
  // v1.1: weight promoted to a main-stack strip (AC-N4, DL-2026-07-18-b) —
  // already ingested via the Fitdays pipe, so this is a read-path add only
  // (NFR-15).
  weight: { sources: ["fitdays", "withings"], metric: "weight" },
  leanBodyMass: { sources: ["fitdays", "withings"], metric: "lean_body_mass" },
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
  // Which smart-scale source weight/bodyFatPct/leanBodyMass are currently
  // resolved to for this user — one shared value, never per-metric (NFR-110).
  // null when the user has zero rows in either candidate source (never
  // connected a scale) — the same state a disconnected user is in today.
  resolvedScaleSource: "fitdays" | "withings" | null;
};
