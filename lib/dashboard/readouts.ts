import type { LeanMassConfig, RecoveryConfig } from "@/lib/dashboard/config";

// Guardrail readout statistics (AC-N8, AC-N9): summary numbers for the
// readout row below the strip stack — never charts, never causal (AC-N10).
// These supersede the v1 guardrail-strip trend descriptors (AC-D12).
//
// Inputs are series already aligned to the shared day axis (null = genuine
// gap, AC-D13) and, for lean mass, already converted to lb (NFR-16) and
// 7-day smoothed — the same derived series the strip renders, computed once
// per window load (NFR-17).

export type LeanMassReadout = {
  // Change in lb over the measured span, latest minus earlier.
  deltaLb: number;
  // Actual days between the two endpoint readings — cfg.windowDays when
  // enough history exists, shorter when it doesn't (AC-N8).
  spanDays: number;
  // Passive direction against the config band: "down" is the warning state.
  state: "holding" | "down" | "up";
};

// 30-day (config) change over the smoothed lean-mass series: latest present
// value minus the present value at ~windowDays before it. When history is
// shorter than the window, the earliest present value is the start point and
// spanDays reports the real span (AC-N8). Gap days are skipped — endpoints
// always land on present days (AC-N2, AC-D13).
export function leanMassChange(
  avg7lb: readonly (number | null)[],
  cfg: LeanMassConfig,
): LeanMassReadout | null {
  let end = -1;
  for (let i = avg7lb.length - 1; i >= 0; i--) {
    if (avg7lb[i] !== null) {
      end = i;
      break;
    }
  }
  if (end <= 0) return null;

  // Walk forward from the window boundary to the first present day.
  let start = -1;
  for (let i = Math.max(0, end - cfg.windowDays); i < end; i++) {
    if (avg7lb[i] !== null) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const deltaLb = avg7lb[end]! - avg7lb[start]!;
  const state = deltaLb < -cfg.bandLb ? "down" : deltaLb > cfg.bandLb ? "up" : "holding";
  return { deltaLb, spanDays: end - start, state };
}

export type RecoveryReadout = {
  // Mean Recovery Score over the present days in the trailing window.
  avgPct: number;
  // Days in the window with a score below the config red-zone boundary;
  // gap days are neither red nor counted (AC-D13).
  redDays: number;
};

// 7-day (config) recovery summary (AC-N9): trailing-window average plus the
// red-zone day count, thresholds from config (NFR-16).
export function recoveryReadout(
  series: readonly (number | null)[],
  cfg: RecoveryConfig,
): RecoveryReadout | null {
  const window = series.slice(Math.max(0, series.length - cfg.windowDays));
  const present = window.filter((value): value is number => value !== null);
  if (present.length === 0) return null;

  return {
    avgPct: present.reduce((sum, value) => sum + value, 0) / present.length,
    redDays: present.filter((value) => value < cfg.redBelowPct).length,
  };
}
