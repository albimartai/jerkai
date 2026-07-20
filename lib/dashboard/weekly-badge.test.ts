import { describe, expect, it } from "vitest";

import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import { buildWeeklyLedger, type LedgerInput } from "@/lib/dashboard/ledger";
import { rollingAverage } from "@/lib/dashboard/rolling";
import { stallBadge } from "@/lib/dashboard/stall-badge";
import { weeklyStallBadge } from "@/lib/dashboard/weekly-badge";
import { addDays } from "@/lib/dashboard/series";

// Executable spec for the hero badge's weekly recomputation (AC-W10–W12).
// The badge is a thin consumer of buildWeeklyLedger's rows — never its own
// math — so a shared fixture asserted against both the table's row state
// and the badge is what makes AC-W12 (they can never disagree) provable.

const cfg = DASHBOARD_CONFIG.ledger;
const recoveryCfg = DASHBOARD_CONFIG.recovery;
const MONDAY = "2026-06-01"; // known Monday

function axisOf(startDay: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(startDay, i));
}

function fixture(bodyFat30: (number | null)[], overrides: Partial<LedgerInput> = {}): LedgerInput {
  const axis = axisOf(MONDAY, bodyFat30.length);
  const flat = (value: number) => axis.map(() => value as number | null);
  return {
    axis,
    bodyFatRaw: overrides.bodyFatRaw ?? flat(18.4),
    bodyFat30,
    weightRaw: overrides.weightRaw ?? flat(180),
    weight7: overrides.weight7 ?? rollingAverage(overrides.weightRaw ?? flat(180), 7),
    strainRaw: overrides.strainRaw ?? flat(12),
    recoveryRaw: overrides.recoveryRaw ?? flat(70),
    leanMassRaw: overrides.leanMassRaw ?? flat(152),
    leanMass7: overrides.leanMass7 ?? rollingAverage(overrides.leanMassRaw ?? flat(152), 7),
  };
}

const fallbackSentinel = { tone: "neutral" as const, label: "— fallback used —" };

describe("weeklyStallBadge — weekly basis (AC-W10)", () => {
  it("2 completed weeks with a declining body-fat trend read 'trending down' good, never the fallback", () => {
    const axis = axisOf(MONDAY, 21); // 3 weeks: 2 completed + in-progress at week 3
    const bodyFat30 = [
      ...axis.slice(0, 7).map(() => 19.0),
      ...axis.slice(7, 14).map(() => 18.6),
      ...axis.slice(14).map(() => 18.6),
    ];
    const rows = buildWeeklyLedger(fixture(bodyFat30), cfg, recoveryCfg);
    const badge = weeklyStallBadge(rows, () => fallbackSentinel);
    expect(badge.tone).toBe("good");
    expect(badge.label).toMatch(/^▾ trending down \d+ wks?$/);
  });

  it("a rising most-recent completed week reads the warning reversal", () => {
    const axis = axisOf(MONDAY, 21);
    const bodyFat30 = [
      ...axis.slice(0, 7).map(() => 18.2),
      ...axis.slice(7, 14).map(() => 18.6),
      ...axis.slice(14).map(() => 18.6),
    ];
    const rows = buildWeeklyLedger(fixture(bodyFat30), cfg, recoveryCfg);
    expect(weeklyStallBadge(rows, () => fallbackSentinel)).toEqual({
      tone: "warning",
      label: "▴ trend rising — check drivers",
    });
  });

  it("a most-recent completed week within the epsilon band reads flat", () => {
    const axis = axisOf(MONDAY, 21);
    const bodyFat30 = [
      ...axis.slice(0, 7).map(() => 18.4),
      ...axis.slice(7, 14).map(() => 18.41),
      ...axis.slice(14).map(() => 18.41),
    ];
    const rows = buildWeeklyLedger(fixture(bodyFat30), cfg, recoveryCfg);
    expect(weeklyStallBadge(rows, () => fallbackSentinel)).toEqual({
      tone: "neutral",
      label: "— trend flat",
    });
  });
});

describe("weeklyStallBadge — cold-start fallback (AC-W11)", () => {
  it("with 0 completed weeks, falls back rather than fabricating a weekly state", () => {
    const rows = buildWeeklyLedger(fixture(axisOf(MONDAY, 4).map(() => 18.4)), cfg, recoveryCfg);
    expect(weeklyStallBadge(rows, () => fallbackSentinel)).toEqual(fallbackSentinel);
  });

  it("with exactly 1 completed week, falls back rather than showing a one-week trend", () => {
    const axis = axisOf(MONDAY, 10); // 1 completed week + 3 in-progress days
    const bodyFat30 = axis.map(() => 18.4);
    const rows = buildWeeklyLedger(fixture(bodyFat30), cfg, recoveryCfg);
    expect(weeklyStallBadge(rows, () => fallbackSentinel)).toEqual(fallbackSentinel);
  });

  it("the fallback is the real AC-D4–D6 daily-streak badge, unchanged", () => {
    const falling = Array.from({ length: 15 }, (_, i) => 20 - i * 0.05);
    const rows = buildWeeklyLedger(fixture(axisOf(MONDAY, 4).map(() => 18.4)), cfg, recoveryCfg);
    expect(weeklyStallBadge(rows, () => stallBadge(falling))).toEqual(stallBadge(falling));
  });
});

describe("weeklyStallBadge — consistency guarantee (AC-W12)", () => {
  it("the badge state can never disagree with the most recent completed ledger row's body-fat state", () => {
    const scenarios: (number | null)[][] = [
      [...Array(7).fill(19.0), ...Array(7).fill(18.6), ...Array(7).fill(18.6)], // down
      [...Array(7).fill(18.2), ...Array(7).fill(18.6), ...Array(7).fill(18.6)], // up
      [...Array(7).fill(18.4), ...Array(7).fill(18.41), ...Array(7).fill(18.41)], // flat
    ];
    for (const bodyFat30 of scenarios) {
      const rows = buildWeeklyLedger(fixture(bodyFat30), cfg, recoveryCfg);
      const badge = weeklyStallBadge(rows, () => fallbackSentinel);
      const mostRecentCompleted = rows.find((r) => !r.inProgress)!;
      const cell = mostRecentCompleted.columns.bodyFat;
      expect(cell.kind).toBe("delta");
      if (cell.kind !== "delta") continue;
      const expectedTone = cell.state === "good" ? "good" : cell.state === "warning" ? "warning" : "neutral";
      expect(badge.tone).toBe(expectedTone);
    }
  });

  it("AC-D7 carries over: every weekly badge label still comes from the fixed passive set", () => {
    const passive = /^(▾ trending down \d+ wks?|▴ trend rising — check drivers|— trend flat|— fallback used —)$/;
    const scenarios: (number | null)[][] = [
      [...Array(7).fill(19.0), ...Array(7).fill(18.6), ...Array(7).fill(18.6)],
      [...Array(7).fill(18.2), ...Array(7).fill(18.6), ...Array(7).fill(18.6)],
    ];
    for (const bodyFat30 of scenarios) {
      const rows = buildWeeklyLedger(fixture(bodyFat30), cfg, recoveryCfg);
      expect(weeklyStallBadge(rows, () => fallbackSentinel).label).toMatch(passive);
    }
  });
});
