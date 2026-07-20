import { describe, expect, it } from "vitest";

import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import { buildWeeklyLedger, completedWeekCount, type LedgerInput } from "@/lib/dashboard/ledger";
import { rollingAverage } from "@/lib/dashboard/rolling";
import { addDays } from "@/lib/dashboard/series";

// Executable spec for the Weekly Ledger's pure lib (NFR-21, NFR-26). Builds
// fixtures directly on the already-aligned-series shape buildWeeklyLedger
// consumes — the same shape the strip dashboard's `derived` block computes
// (rollingAverage, lb conversion) so this test never re-derives that math.

const cfg = DASHBOARD_CONFIG.ledger;
const recoveryCfg = DASHBOARD_CONFIG.recovery;

// 2026-06-01 is a known Monday (verified against the JS calendar).
const MONDAY = "2026-06-01";

function axisOf(startDay: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(startDay, i));
}

// A fixture spanning `weeks` full ISO weeks plus `partialDays` days into the
// in-progress week, every series present every day unless overridden.
function fixture(
  weeks: number,
  partialDays: number,
  overrides: Partial<LedgerInput> = {},
): LedgerInput {
  const axis = axisOf(MONDAY, weeks * 7 + partialDays);
  const flat = (value: number) => axis.map(() => value as number | null);
  const bodyFatRaw = overrides.bodyFatRaw ?? flat(18.4);
  const weightRaw = overrides.weightRaw ?? flat(180);
  const leanMassRaw = overrides.leanMassRaw ?? flat(152);
  return {
    axis,
    bodyFatRaw,
    bodyFat30: overrides.bodyFat30 ?? rollingAverage(bodyFatRaw, 30),
    weightRaw,
    weight7: overrides.weight7 ?? rollingAverage(weightRaw, 7),
    strainRaw: overrides.strainRaw ?? flat(12),
    recoveryRaw: overrides.recoveryRaw ?? flat(70),
    leanMassRaw,
    leanMass7: overrides.leanMass7 ?? rollingAverage(leanMassRaw, 7),
  };
}

describe("buildWeeklyLedger — week keys and shape (AC-W1, AC-W5)", () => {
  it("AC-W1: rows use ISO Mon–Sun week keys, newest first", () => {
    const rows = buildWeeklyLedger(fixture(3, 0), cfg, recoveryCfg);
    expect(rows.map((r) => [r.weekStart, r.weekEnd])).toEqual([
      ["2026-06-15", "2026-06-21"],
      ["2026-06-08", "2026-06-14"],
      ["2026-06-01", "2026-06-07"],
    ]);
  });

  it("AC-W1: a partial current week is its own in-progress row, days-elapsed labeled, never marked complete", () => {
    const rows = buildWeeklyLedger(fixture(2, 4), cfg, recoveryCfg);
    expect(rows[0].inProgress).toBe(true);
    expect(rows[0].daysElapsed).toBe(4);
    expect(rows.slice(1).every((r) => !r.inProgress && r.daysElapsed === 7)).toBe(true);
  });

  it("AC-W5: completed weeks are capped at cfg.maxCompletedWeeks, newest first", () => {
    const rows = buildWeeklyLedger(fixture(5, 0), { ...cfg, maxCompletedWeeks: 2 }, recoveryCfg);
    const completed = rows.filter((r) => !r.inProgress);
    expect(completed).toHaveLength(2);
    expect(completed[0].weekStart).toBe("2026-06-22"); // the two newest completed weeks
    expect(completed[1].weekStart).toBe("2026-06-15");
  });
});

describe("buildWeeklyLedger — delta convention (AC-W2)", () => {
  it("AC-W2: a noisy raw series with a flat smoothed trend produces ~0 delta, not a noise-driven one", () => {
    const axis = axisOf(MONDAY, 14);
    // Raw jitters day to day; the (pre-smoothed, as the strip would compute
    // it) input series is flat, exactly the scenario AC-W2 exists to guard.
    const bodyFatRaw = axis.map((_, i) => 18.4 + (i % 2 === 0 ? 0.3 : -0.3));
    const bodyFat30 = axis.map(() => 18.4);
    const rows = buildWeeklyLedger(
      fixture(2, 0, { bodyFatRaw, bodyFat30 }),
      cfg,
      recoveryCfg,
    );
    const [newest] = rows;
    expect(newest.columns.bodyFat).toMatchObject({ kind: "delta", state: "neutral" });
    if (newest.columns.bodyFat.kind === "delta") {
      expect(newest.columns.bodyFat.value).toBeCloseTo(0, 5);
    }
  });

  it("AC-W2/AC-W4: a body-fat drop beyond epsilon reads good; a rise beyond epsilon reads warning", () => {
    const axis = axisOf(MONDAY, 14);
    const bodyFat30 = [...axis.slice(0, 7).map(() => 18.5), ...axis.slice(7).map(() => 18.2)];
    const rows = buildWeeklyLedger(fixture(2, 0, { bodyFat30 }), cfg, recoveryCfg);
    expect(rows[0].columns.bodyFat).toMatchObject({ kind: "delta", state: "good" });

    const risingRows = buildWeeklyLedger(
      fixture(2, 0, { bodyFat30: bodyFat30.slice().reverse() }),
      cfg,
      recoveryCfg,
    );
    expect(risingRows[0].columns.bodyFat).toMatchObject({ kind: "delta", state: "warning" });
  });

  it("the first week in history has no prior week to compare against, so its delta cell is insufficient", () => {
    const rows = buildWeeklyLedger(fixture(1, 0), cfg, recoveryCfg);
    expect(rows[0].columns.bodyFat.kind).toBe("insufficient");
    expect(rows[0].columns.weight.kind).toBe("insufficient");
    expect(rows[0].columns.leanMass.kind).toBe("insufficient");
  });
});

describe("buildWeeklyLedger — lean mass weekly band (AC-W3, AC-W4)", () => {
  it("a lean-mass drop beyond the weekly band reads warning; within it reads neutral", () => {
    const axis = axisOf(MONDAY, 14);
    const droppingLbm = [...axis.slice(0, 7).map(() => 152.0), ...axis.slice(7).map(() => 151.5)];
    const rows = buildWeeklyLedger(fixture(2, 0, { leanMass7: droppingLbm }), cfg, recoveryCfg);
    expect(rows[0].columns.leanMass).toMatchObject({ kind: "delta", state: "warning" });

    const holdingLbm = [...axis.slice(0, 7).map(() => 152.0), ...axis.slice(7).map(() => 151.95)];
    const holdingRows = buildWeeklyLedger(fixture(2, 0, { leanMass7: holdingLbm }), cfg, recoveryCfg);
    expect(holdingRows[0].columns.leanMass).toMatchObject({ kind: "delta", state: "neutral" });
  });
});

describe("buildWeeklyLedger — strain and recovery levels (AC-W3)", () => {
  it("strain reports the week's average daily strain, not a delta", () => {
    const axis = axisOf(MONDAY, 7);
    const strainRaw = [10, 12, 14, 16, 18, 8, 6];
    const rows = buildWeeklyLedger(fixture(1, 0, { strainRaw }), cfg, recoveryCfg);
    expect(rows[0].columns.strain).toMatchObject({
      kind: "strainLevel",
      value: strainRaw.reduce((a, b) => a + b, 0) / 7,
    });
    void axis;
  });

  it("recovery reports the weekly average and red-zone day count from config", () => {
    const recoveryRaw = [60, 70, 33, 20, 90, 70, 50]; // 2 below 34 (config redBelowPct)
    const rows = buildWeeklyLedger(fixture(1, 0, { recoveryRaw }), cfg, recoveryCfg);
    expect(rows[0].columns.recovery).toMatchObject({ kind: "recoveryLevel", redDays: 2 });
  });
});

describe("buildWeeklyLedger — sparse and empty weeks (AC-W7)", () => {
  it("a week with fewer than minDaysPerWeek raw readings for a series renders insufficient data for that column", () => {
    const axis = axisOf(MONDAY, 7);
    const bodyFatRaw = axis.map((_, i) => (i < 2 ? 18.4 : null)); // only 2 of 7 days
    const rows = buildWeeklyLedger(fixture(1, 0, { bodyFatRaw }), cfg, recoveryCfg);
    expect(rows[0].columns.bodyFat).toEqual({ kind: "insufficient", daysPresent: 2 });
  });

  it("a week with zero data across every series collapses to a single gap row, not five insufficient cells", () => {
    const axis = axisOf(MONDAY, 14);
    const allNull = axis.map(() => null);
    const rows = buildWeeklyLedger(
      fixture(2, 0, {
        bodyFatRaw: axis.map((_, i) => (i < 7 ? null : 18.4)),
        bodyFat30: axis.map((_, i) => (i < 7 ? null : 18.4)),
        weightRaw: axis.map((_, i) => (i < 7 ? null : 180)),
        weight7: axis.map((_, i) => (i < 7 ? null : 180)),
        leanMassRaw: axis.map((_, i) => (i < 7 ? null : 152)),
        leanMass7: axis.map((_, i) => (i < 7 ? null : 152)),
        strainRaw: axis.map((_, i) => (i < 7 ? null : 12)),
        recoveryRaw: axis.map((_, i) => (i < 7 ? null : 70)),
      }),
      cfg,
      recoveryCfg,
    );
    const oldest = rows[rows.length - 1];
    expect(oldest.isGap).toBe(true);
    void allNull;
  });
});

describe("buildWeeklyLedger — cold start (AC-W9)", () => {
  it("with fewer than 2 completed weeks, returns the available rows without erroring", () => {
    const rows = buildWeeklyLedger(fixture(1, 3), cfg, recoveryCfg);
    expect(() => buildWeeklyLedger(fixture(1, 3), cfg, recoveryCfg)).not.toThrow();
    expect(completedWeekCount(rows)).toBe(1);
    expect(rows.some((r) => r.inProgress)).toBe(true);
  });

  it("with an empty axis, returns no rows and never errors", () => {
    expect(buildWeeklyLedger(fixture(0, 0), cfg, recoveryCfg)).toEqual(
      buildWeeklyLedger({ ...fixture(0, 0), axis: [] }, cfg, recoveryCfg),
    );
    expect(buildWeeklyLedger({ ...fixture(0, 0), axis: [] }, cfg, recoveryCfg)).toEqual([]);
  });
});
