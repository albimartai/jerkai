import { addDays, dayAxis } from "@/lib/dashboard/series";
import type { DashboardData } from "@/lib/dashboard/types";
import type { TargetRow } from "@/lib/target-resolution";

// SYNTHETIC / PUBLIC (docs/prd/public-demo.md, NFR-52). Every value below is
// invented — no real biometric or nutrition reading ever appears here, now or
// in the future. This module is deliberately deterministic (plain arithmetic
// over a day index, no Math.random()/Date.now() at request time) so the demo
// never flaps between requests or deploys. It intentionally imports nothing
// from lib/db.ts or any DB client — see tests/unit/demo-isolation.test.ts,
// the machine-checked guarantee this file's data can never be a real row.
//
// Shape (three-phase body-fat trend, AC-PD3): ~4 weeks of steady decline,
// ~3 weeks of a stall (co-moving with reduced training/day-strain and softer
// recovery), then a resumed decline through the final in-progress week — so
// the hero stall badge computes a real "trending down"/"trend flat" state
// from completed weeks, never the cold-start fallback (needs >= 2 completed
// weeks; this fixture spans ~12).

const LATEST_DAY = "2026-07-16"; // a Thursday, so the in-progress week reads as "N of 7 days elapsed"
const WINDOW_DAYS = 90;

export const DEMO_AXIS: string[] = dayAxis(LATEST_DAY, WINDOW_DAYS);

// Phase boundaries, in day-index terms (0 = oldest day in DEMO_AXIS). The
// stall phase must be at least as long as the 30-day rolling window
// (rolling.ts) or the trailing average never fully flattens — it just
// smooths through a short stall without ever reading as neutral.
const STALL_START = 25; // ~day 25: decline gives way to a stall
const STALL_END = 60; // ~day 60: stall gives way to a resumed decline

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Deterministic day-to-day wobble — small and bounded, standing in for
// ordinary measurement noise. A pure function of the index only.
function wobble(i: number, amplitude: number): number {
  return amplitude * Math.sin(i * 0.9) + amplitude * 0.5 * Math.sin(i * 2.3 + 1);
}

function bodyFatPct(i: number): number {
  let trend: number;
  if (i < STALL_START) {
    trend = 23.0 - 0.05 * i; // steady decline
  } else if (i < STALL_END) {
    trend = 23.0 - 0.05 * STALL_START; // flat through the stall
  } else {
    const stallValue = 23.0 - 0.05 * STALL_START;
    trend = stallValue - 0.05 * (i - STALL_END); // decline resumes
  }
  return round1(trend + wobble(i, 0.18));
}

function weightLb(i: number): number {
  // Loosely co-moves with body fat, larger absolute scale, same three phases.
  let trend: number;
  if (i < STALL_START) {
    trend = 182 - 0.15 * i;
  } else if (i < STALL_END) {
    trend = 182 - 0.15 * STALL_START;
  } else {
    const stallValue = 182 - 0.15 * STALL_START;
    trend = stallValue - 0.13 * (i - STALL_END);
  }
  return round1(trend + wobble(i, 0.4));
}

function leanBodyMassLb(i: number): number {
  // A cut's whole point: lean mass held roughly flat while fat drops.
  return round1(151.5 + wobble(i, 0.3));
}

function dayStrain(i: number): number {
  // Training load drops during the stall (co-movement, AC-PD3) and recovers
  // once the decline resumes. A weekly rest-day dip is layered on top.
  const base = i < STALL_START ? 13.5 : i < STALL_END ? 8.0 : 14.5;
  const restDayDip = i % 7 === 6 ? -4 : i % 7 === 0 ? -2 : 0;
  const value = base + restDayDip + wobble(i, 1.2);
  return Math.min(21, Math.max(0, round1(value)));
}

function recoveryScorePct(i: number): number {
  // Softer recovery during the stall — a plausible co-factor, never asserted
  // as cause (the badge itself stays passive; this is just realistic data).
  const base = i < STALL_START ? 68 : i < STALL_END ? 54 : 70;
  return Math.round(Math.min(99, Math.max(1, base + wobble(i, 6))));
}

function hrvMs(i: number): number {
  return Math.round(62 + wobble(i, 5));
}

function rhrBpm(i: number): number {
  return Math.round(52 + wobble(i, 2));
}

function sleepDurationHr(i: number): number {
  return round1(7.2 + wobble(i, 0.4));
}

function buildSeries<T>(fn: (i: number) => T): T[] {
  return DEMO_AXIS.map((_, i) => fn(i));
}

export const DEMO_DASHBOARD_DATA: DashboardData = {
  axis: DEMO_AXIS,
  series: {
    bodyFatPct: buildSeries(bodyFatPct),
    weight: buildSeries(weightLb),
    leanBodyMass: buildSeries(leanBodyMassLb),
    dayStrain: buildSeries(dayStrain),
    recoveryScore: buildSeries(recoveryScorePct),
    hrv: buildSeries(hrvMs),
    rhr: buildSeries(rhrBpm),
    sleepDuration: buildSeries(sleepDurationHr),
  },
  units: {
    bodyFatPct: "%",
    weight: "lb",
    leanBodyMass: "lb",
    dayStrain: null,
    recoveryScore: "%",
    hrv: "ms",
    rhr: "bpm",
    sleepDuration: "hr",
  },
  latestDay: LATEST_DAY,
};

// One target in force for the whole window (effective before the axis
// starts), so every day resolves against it via the real resolveTargetForDate
// — except the one gap day below, which has no logged calories at all.
export const DEMO_TARGETS: TargetRow[] = [
  {
    id: 1,
    effectiveDate: addDays(DEMO_AXIS[0], -30),
    caloriesTarget: 2100,
    proteinTargetG: 165,
    carbsTargetG: 220,
    fatTargetG: 70,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

// One day with no logged meal (AC-PD3's gap day, calorieBarState "gap") —
// deliberately placed inside the stall phase.
const GAP_DAY_INDEX = 40;

function dailyCalories(i: number): number | null {
  if (i === GAP_DAY_INDEX) return null;
  const value = 2100 + 150 * Math.sin(i * 0.5) + 50 * Math.sin(i * 1.3 + 2);
  return Math.round(value);
}

export const DEMO_DAILY_CALORIES: (number | null)[] = buildSeries(dailyCalories);
