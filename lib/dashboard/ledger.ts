import { isoWeekEnd, isoWeekStart } from "@/lib/dashboard/iso-week";
import { addDays } from "@/lib/dashboard/series";
import type { LedgerConfig, RecoveryConfig } from "@/lib/dashboard/config";

// Weekly Ledger (NFR-21): pure functions over daily series + config, no DB,
// no rendering. The `/weekly` page and the hero badge (weekly-badge.ts) are
// both thin consumers of buildWeeklyLedger's output, so they can never
// disagree about what a week's body-fat state was (AC-W12).
//
// Read-only, computed at request time (NFR-22): weekly rows are never
// persisted.

export type CellState = "good" | "warning" | "neutral";

export type LedgerCell =
  // Fewer than cfg.minDaysPerWeek raw daily readings for this series this
  // week (AC-W7) — or, for a delta column, no prior-week endpoint to
  // compare against (start of history) — so no delta/level is computed
  // rather than one being fabricated from thin data.
  | { kind: "insufficient"; daysPresent: number }
  // Body fat / weight / lean mass: end-of-week smoothed value minus the
  // prior week's (AC-W2).
  | { kind: "delta"; value: number; state: CellState }
  // Day Strain: the week's average daily strain (0–21, AC-W3 col 3).
  | { kind: "strainLevel"; value: number }
  // Recovery: weekly average % + red-zone day count (AC-W3 col 4).
  | { kind: "recoveryLevel"; avgPct: number; redDays: number };

export type WeekColumns = {
  bodyFat: LedgerCell;
  weight: LedgerCell;
  strain: LedgerCell;
  recovery: LedgerCell;
  leanMass: LedgerCell;
};

export type WeekRow = {
  weekStart: string; // Monday, ISO date key
  weekEnd: string; // Sunday, ISO date key
  // The current, not-yet-complete week (AC-W1) — never compared to
  // completed weeks as if it were one.
  inProgress: boolean;
  daysElapsed: number; // 1–7 for the in-progress row; always 7 for a completed row
  // AC-W7: a week with no data at all for ANY series collapses to a single
  // gap row instead of five "insufficient data" cells.
  isGap: boolean;
  columns: WeekColumns;
};

export type LedgerInput = {
  // Shared day axis, oldest first (see series.ts).
  axis: readonly string[];
  bodyFatRaw: readonly (number | null)[];
  // 30-day rolling body-fat trend (AC-W3 col 1's source series).
  bodyFat30: readonly (number | null)[];
  weightRaw: readonly (number | null)[];
  // 7-day rolling weight (AC-W3 col 2's source series).
  weight7: readonly (number | null)[];
  strainRaw: readonly (number | null)[];
  recoveryRaw: readonly (number | null)[];
  // Already converted to lb (NFR-16), matching the strip dashboard's
  // convention — the ledger never converts units itself.
  leanMassRaw: readonly (number | null)[];
  // 7-day rolling lean mass, lb (AC-W3 col 5's source series).
  leanMass7: readonly (number | null)[];
};

const COMPLETED_DAYS_ELAPSED = 7;

function indicesInWeek(axis: readonly string[], weekStart: string, weekEnd: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < axis.length; i++) {
    if (axis[i] >= weekStart && axis[i] <= weekEnd) indices.push(i);
  }
  return indices;
}

function rawPresentCount(series: readonly (number | null)[], indices: readonly number[]): number {
  return indices.filter((i) => series[i] !== null).length;
}

// Last non-null value of `series` among `indices` (indices assumed
// ascending, i.e. oldest-first within the week) — the smoothed value as of
// the week's last present day (AC-W2).
function lastPresent(series: readonly (number | null)[], indices: readonly number[]): number | null {
  for (let i = indices.length - 1; i >= 0; i--) {
    const value = series[indices[i]];
    if (value !== null) return value;
  }
  return null;
}

function deltaCell(
  axis: readonly string[],
  raw: readonly (number | null)[],
  smoothed: readonly (number | null)[],
  weekIndices: readonly number[],
  priorEndpoint: number | null,
  minDaysPerWeek: number,
  state: (delta: number) => CellState,
): LedgerCell {
  const present = rawPresentCount(raw, weekIndices);
  if (present < minDaysPerWeek || priorEndpoint === null) {
    return { kind: "insufficient", daysPresent: present };
  }
  const endpoint = lastPresent(smoothed, weekIndices);
  if (endpoint === null) return { kind: "insufficient", daysPresent: present };
  return { kind: "delta", value: endpoint - priorEndpoint, state: state(endpoint - priorEndpoint) };
}

const bodyFatState = (epsilon: number) => (delta: number): CellState =>
  delta <= -epsilon ? "good" : delta >= epsilon ? "warning" : "neutral";

const leanMassState = (bandLbPerWeek: number) => (delta: number): CellState =>
  delta < -bandLbPerWeek ? "warning" : "neutral";

function strainCell(
  raw: readonly (number | null)[],
  weekIndices: readonly number[],
  minDaysPerWeek: number,
): LedgerCell {
  const present = weekIndices
    .map((i) => raw[i])
    .filter((value): value is number => value !== null);
  if (present.length < minDaysPerWeek) {
    return { kind: "insufficient", daysPresent: present.length };
  }
  const avg = present.reduce((sum, value) => sum + value, 0) / present.length;
  return { kind: "strainLevel", value: avg };
}

function recoveryCell(
  raw: readonly (number | null)[],
  weekIndices: readonly number[],
  minDaysPerWeek: number,
  redBelowPct: number,
): LedgerCell {
  const present = weekIndices
    .map((i) => raw[i])
    .filter((value): value is number => value !== null);
  if (present.length < minDaysPerWeek) {
    return { kind: "insufficient", daysPresent: present.length };
  }
  const avgPct = present.reduce((sum, value) => sum + value, 0) / present.length;
  const redDays = present.filter((value) => value < redBelowPct).length;
  return { kind: "recoveryLevel", avgPct, redDays };
}

function isEmptyWeek(input: LedgerInput, weekIndices: readonly number[]): boolean {
  const seriesList = [
    input.bodyFatRaw,
    input.weightRaw,
    input.strainRaw,
    input.recoveryRaw,
    input.leanMassRaw,
  ];
  return seriesList.every((series) => rawPresentCount(series, weekIndices) === 0);
}

// Builds the Weekly Ledger (AC-W1–W3, W5, W7, W9): one row per ISO week,
// newest first, capped at cfg.maxCompletedWeeks completed weeks plus the
// in-progress row. Weeks whose Monday falls before the fetched axis start
// are dropped rather than shown with a fabricated "insufficient data" read
// — the axis's own trailing window (not the ledger) decides how much
// history is available.
export function buildWeeklyLedger(
  input: LedgerInput,
  cfg: LedgerConfig,
  recoveryCfg: Pick<RecoveryConfig, "redBelowPct">,
): WeekRow[] {
  const { axis } = input;
  if (axis.length === 0) return [];

  const latestDay = axis[axis.length - 1];
  const currentWeekStart = isoWeekStart(latestDay);
  const axisStart = axis[0];

  // Walk backward one ISO week at a time from the current (possibly
  // in-progress) week until we fall off the front of the axis.
  const weekStarts: string[] = [];
  for (let start = currentWeekStart; start >= axisStart; start = addDays(start, -7)) {
    weekStarts.push(start);
  }

  const bodyFatDelta = bodyFatState(cfg.epsilonPpPerWeek);
  const leanMassDelta = leanMassState(cfg.leanMassBandLbPerWeek);

  // Compute oldest-first so each week's delta can look at the prior week's
  // already-computed endpoint (AC-W2), then reverse for newest-first display.
  const chronological = [...weekStarts].reverse();
  const rows: WeekRow[] = [];
  let priorBodyFatEndpoint: number | null = null;
  let priorWeightEndpoint: number | null = null;
  let priorLeanMassEndpoint: number | null = null;

  for (const weekStart of chronological) {
    const weekEnd = isoWeekEnd(weekStart);
    const inProgress = weekStart === currentWeekStart;
    const indices = indicesInWeek(axis, weekStart, inProgress ? latestDay : weekEnd);
    const gap = isEmptyWeek(input, indices);

    const bodyFat = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : deltaCell(
          axis,
          input.bodyFatRaw,
          input.bodyFat30,
          indices,
          priorBodyFatEndpoint,
          cfg.minDaysPerWeek,
          bodyFatDelta,
        );
    const weight = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : deltaCell(
          axis,
          input.weightRaw,
          input.weight7,
          indices,
          priorWeightEndpoint,
          cfg.minDaysPerWeek,
          () => "neutral", // weight asserts no direction (AC-W4): not a driver/guardrail
        );
    const leanMass = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : deltaCell(
          axis,
          input.leanMassRaw,
          input.leanMass7,
          indices,
          priorLeanMassEndpoint,
          cfg.minDaysPerWeek,
          leanMassDelta,
        );
    const strain = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : strainCell(input.strainRaw, indices, cfg.minDaysPerWeek);
    const recovery = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : recoveryCell(input.recoveryRaw, indices, cfg.minDaysPerWeek, recoveryCfg.redBelowPct);

    // Only a completed week's endpoint feeds forward as the next week's
    // comparison point — the in-progress week is never a valid prior.
    if (!inProgress && !gap) {
      const bf30End = lastPresent(input.bodyFat30, indices);
      if (bf30End !== null) priorBodyFatEndpoint = bf30End;
      const w7End = lastPresent(input.weight7, indices);
      if (w7End !== null) priorWeightEndpoint = w7End;
      const lbm7End = lastPresent(input.leanMass7, indices);
      if (lbm7End !== null) priorLeanMassEndpoint = lbm7End;
    }

    rows.push({
      weekStart,
      weekEnd,
      inProgress,
      daysElapsed: inProgress ? indices.length || 1 : COMPLETED_DAYS_ELAPSED,
      isGap: gap,
      columns: { bodyFat, weight, strain, recovery, leanMass },
    });
  }

  rows.reverse(); // newest first (AC-W5)

  const inProgressRow = rows[0]?.inProgress ? [rows[0]] : [];
  const completed = rows.filter((row) => !row.inProgress).slice(0, cfg.maxCompletedWeeks);
  return [...inProgressRow, ...completed];
}

// Count of completed weeks in the ledger (AC-W9's "N weeks so far").
export function completedWeekCount(rows: readonly WeekRow[]): number {
  return rows.filter((row) => !row.inProgress).length;
}
