import { isoWeekEnd, isoWeekStart } from "@/lib/dashboard/iso-week";
import { addDays } from "@/lib/dashboard/series";
import type { LedgerConfig, RecoveryConfig } from "@/lib/dashboard/config";

// Engine (AC-E1-AC-E14): the training driver (Day Strain) and its recovery
// guardrails (Recovery Score, HRV, RHR) at the same weekly, row-per-ISO-week
// cadence Body's Weekly Ledger already established — but computed by a
// wholly separate module that never imports from or modifies
// lib/dashboard/ledger.ts (PRD §0.5, "re-derive, don't un-delete",
// DL-2026-09-13-a3's sibling instruction). Pure functions over daily series
// + config, no DB, no rendering (NFR-170).

export type EngineCell =
  // Fewer than cfg.minDaysPerWeek raw daily readings for this series this
  // week (AC-E3) — or, for a delta column, no prior-week endpoint to
  // compare against (start of history) — so no delta is fabricated from
  // thin data.
  | { kind: "insufficient"; daysPresent: number }
  // Strain, HRV, RHR: end-of-week 7-day-rolling endpoint minus the prior
  // completed week's own endpoint (AC-E5-AC-E7). No `state` field — every
  // delta cell renders in one neutral tone this slice (NFR-175).
  | { kind: "delta"; value: number };

export type EngineRecoveryCell =
  | { kind: "insufficient"; daysPresent: number }
  // Mean Recovery Score over the week's present days, plus a count of that
  // week's present days below cfg.redBelowPct (AC-E8) — a fresh shape, not
  // ledger.ts's deleted recoveryCell (DL-2026-09-13-a3).
  | { kind: "recovery"; avgPct: number; redDays: number };

export type EngineWeekColumns = {
  strain: EngineCell;
  recovery: EngineRecoveryCell;
  hrv: EngineCell;
  rhr: EngineCell;
};

export type EngineWeekRow = {
  weekStart: string; // Monday, ISO date key
  weekEnd: string; // Sunday, ISO date key
  // The current, not-yet-complete week (AC-E4) — never compared to
  // completed weeks as if it were one.
  inProgress: boolean;
  daysElapsed: number; // 1-7 for the in-progress row; always 7 for a completed row
  // AC-E2: a week with no data at all for ANY of the four series collapses
  // to a single gap row instead of four "insufficient data" cells.
  isGap: boolean;
  columns: EngineWeekColumns;
};

export type EngineLedgerInput = {
  // Shared day axis, oldest first (see series.ts).
  axis: readonly string[];
  dayStrainRaw: readonly (number | null)[];
  // 7-day rolling Day Strain (the delta basis, AC-E5).
  dayStrain7: readonly (number | null)[];
  // No smoothing — the weekly Recovery average is a direct mean of that
  // week's raw present values, not an endpoint read (AC-E8).
  recoveryRaw: readonly (number | null)[];
  hrvRaw: readonly (number | null)[];
  // 7-day rolling HRV (the delta basis, AC-E6; DL-2026-09-15-a1: plain
  // week-over-week, not baseline-relative).
  hrv7: readonly (number | null)[];
  rhrRaw: readonly (number | null)[];
  // 7-day rolling RHR (the delta basis, AC-E7).
  rhr7: readonly (number | null)[];
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
// the week's last present day (AC-E5-AC-E7).
function lastPresent(series: readonly (number | null)[], indices: readonly number[]): number | null {
  for (let i = indices.length - 1; i >= 0; i--) {
    const value = series[indices[i]];
    if (value !== null) return value;
  }
  return null;
}

function deltaCell(
  raw: readonly (number | null)[],
  smoothed: readonly (number | null)[],
  weekIndices: readonly number[],
  priorEndpoint: number | null,
  minDaysPerWeek: number,
): EngineCell {
  const present = rawPresentCount(raw, weekIndices);
  if (present < minDaysPerWeek || priorEndpoint === null) {
    return { kind: "insufficient", daysPresent: present };
  }
  const endpoint = lastPresent(smoothed, weekIndices);
  if (endpoint === null) return { kind: "insufficient", daysPresent: present };
  return { kind: "delta", value: endpoint - priorEndpoint };
}

// AC-E8: the week's own present-day mean, plus a count of present days
// below redBelowPct — scoped to that week's own present days (however many
// that is, 1-7), not a fixed trailing 7-day window (PRD §0.7).
function recoveryCell(
  raw: readonly (number | null)[],
  weekIndices: readonly number[],
  minDaysPerWeek: number,
  redBelowPct: number,
): EngineRecoveryCell {
  const presentValues = weekIndices
    .map((i) => raw[i])
    .filter((value): value is number => value !== null);
  if (presentValues.length < minDaysPerWeek) {
    return { kind: "insufficient", daysPresent: presentValues.length };
  }
  const avgPct = presentValues.reduce((sum, value) => sum + value, 0) / presentValues.length;
  const redDays = presentValues.filter((value) => value < redBelowPct).length;
  return { kind: "recovery", avgPct, redDays };
}

// AC-E2: a week collapses to a gap row only when all four of
// dayStrainRaw/recoveryRaw/hrvRaw/rhrRaw have zero raw readings that week —
// independently re-derived per DL-2026-09-13-a4's sibling precedent, not
// shared code with ledger.ts's own isEmptyWeek.
function isEmptyWeek(input: EngineLedgerInput, weekIndices: readonly number[]): boolean {
  const seriesList = [input.dayStrainRaw, input.recoveryRaw, input.hrvRaw, input.rhrRaw];
  return seriesList.every((series) => rawPresentCount(series, weekIndices) === 0);
}

// Builds Engine's own weekly ledger (AC-E1-AC-E4, AC-E14's data half): one
// row per ISO week, newest first, capped at cfg.maxCompletedWeeks completed
// weeks plus the in-progress row. Weeks whose Monday falls before the
// fetched axis start are dropped rather than shown with a fabricated
// "insufficient data" read.
export function buildEngineLedger(
  input: EngineLedgerInput,
  cfg: Pick<LedgerConfig, "minDaysPerWeek" | "maxCompletedWeeks">,
  recoveryCfg: Pick<RecoveryConfig, "redBelowPct">,
): EngineWeekRow[] {
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

  // Compute oldest-first so each week's delta can look at the prior week's
  // already-computed endpoint, then reverse for newest-first display.
  const chronological = [...weekStarts].reverse();
  const rows: EngineWeekRow[] = [];
  let priorStrainEndpoint: number | null = null;
  let priorHrvEndpoint: number | null = null;
  let priorRhrEndpoint: number | null = null;

  for (const weekStart of chronological) {
    const weekEnd = isoWeekEnd(weekStart);
    const inProgress = weekStart === currentWeekStart;
    const indices = indicesInWeek(axis, weekStart, inProgress ? latestDay : weekEnd);
    const gap = isEmptyWeek(input, indices);

    const strain = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : deltaCell(input.dayStrainRaw, input.dayStrain7, indices, priorStrainEndpoint, cfg.minDaysPerWeek);
    const recovery = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : recoveryCell(input.recoveryRaw, indices, cfg.minDaysPerWeek, recoveryCfg.redBelowPct);
    const hrv = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : deltaCell(input.hrvRaw, input.hrv7, indices, priorHrvEndpoint, cfg.minDaysPerWeek);
    const rhr = gap
      ? { kind: "insufficient" as const, daysPresent: 0 }
      : deltaCell(input.rhrRaw, input.rhr7, indices, priorRhrEndpoint, cfg.minDaysPerWeek);

    // Only a completed week's endpoint feeds forward as the next week's
    // comparison point — the in-progress week is never a valid prior
    // (AC-E4: its own cell still computes normally, it just never becomes a
    // future week's prior-endpoint).
    if (!inProgress && !gap) {
      const strain7End = lastPresent(input.dayStrain7, indices);
      if (strain7End !== null) priorStrainEndpoint = strain7End;
      const hrv7End = lastPresent(input.hrv7, indices);
      if (hrv7End !== null) priorHrvEndpoint = hrv7End;
      const rhr7End = lastPresent(input.rhr7, indices);
      if (rhr7End !== null) priorRhrEndpoint = rhr7End;
    }

    rows.push({
      weekStart,
      weekEnd,
      inProgress,
      daysElapsed: inProgress ? indices.length || 1 : COMPLETED_DAYS_ELAPSED,
      isGap: gap,
      columns: { strain, recovery, hrv, rhr },
    });
  }

  rows.reverse(); // newest first (AC-E1)

  const inProgressRow = rows[0]?.inProgress ? [rows[0]] : [];
  const completed = rows.filter((row) => !row.inProgress).slice(0, cfg.maxCompletedWeeks);
  return [...inProgressRow, ...completed];
}

// Count of completed weeks in the ledger (cold-start note basis, AC-E4).
export function completedWeekCount(rows: readonly EngineWeekRow[]): number {
  return rows.filter((row) => !row.inProgress).length;
}
