// Bar coloring for the Calories-vs-target strip (DL-pending-2): daily bars colored
// over/under target, not raw-dots-plus-trend-line — logged intake is a discrete daily
// behavior where the daily value is the decision-relevant mark.

import { resolveTargetForDate, type TargetRow } from "@/lib/target-resolution";

export type CalorieBarState = "over" | "under" | "neutral" | "gap";

// `actual` null = no entry logged that day (AC-M8: a gap, never a zero). `target` null =
// no target in force that day (AC-M11: neutral/uncolored, regardless of what was logged).
export function calorieBarState(actual: number | null, target: number | null): CalorieBarState {
  if (actual === null) return "gap";
  if (target === null) return "neutral";
  return actual > target ? "over" : "under";
}

export type CalorieDay = {
  day: string;
  actual: number | null;
  target: number | null;
  state: CalorieBarState;
};

// Every axis day is resolved against ITS OWN effective target (NFR-30), never one target
// for the whole series — after a cut/maintenance target change, days on either side of the
// boundary must color against different targets (DL-pending-3). A single-target
// implementation is a defect, not a simplification.
export function buildCalorieSeries(
  axis: readonly string[],
  dailyCalories: readonly (number | null)[],
  targets: readonly TargetRow[],
): CalorieDay[] {
  return axis.map((day, index) => {
    const actual = dailyCalories[index] ?? null;
    const target = resolveTargetForDate(targets, day)?.caloriesTarget ?? null;
    return { day, actual, target, state: calorieBarState(actual, target) };
  });
}
