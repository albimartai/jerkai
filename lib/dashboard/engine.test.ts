/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Engine Page
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { describe, expect, it } from "vitest";

import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import { buildEngineLedger, completedWeekCount, type EngineLedgerInput } from "@/lib/dashboard/engine";
import { rollingAverage } from "@/lib/dashboard/rolling";
import { addDays } from "@/lib/dashboard/series";

// Executable spec for Engine's own pure ledger builder (AC-E1-AC-E8, AC-E14's
// non-render half). Modeled structurally on lib/dashboard/ledger.test.ts's
// fixture/describe-block shape (PRD §0.1) but with its own fresh fixtures —
// this file shares no code or fixture helper with ledger.test.ts (PRD §0.5:
// engine.ts never imports from ledger.ts).

const cfg = {
  minDaysPerWeek: DASHBOARD_CONFIG.ledger.minDaysPerWeek,
  maxCompletedWeeks: DASHBOARD_CONFIG.ledger.maxCompletedWeeks,
};
const recoveryCfg = { redBelowPct: DASHBOARD_CONFIG.recovery.redBelowPct };

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
  overrides: Partial<EngineLedgerInput> = {},
): EngineLedgerInput {
  const axis = axisOf(MONDAY, weeks * 7 + partialDays);
  const flat = (value: number) => axis.map(() => value as number | null);
  const dayStrainRaw = overrides.dayStrainRaw ?? flat(12.0);
  const recoveryRaw = overrides.recoveryRaw ?? flat(60);
  const hrvRaw = overrides.hrvRaw ?? flat(65);
  const rhrRaw = overrides.rhrRaw ?? flat(55);
  return {
    axis,
    dayStrainRaw,
    dayStrain7: overrides.dayStrain7 ?? rollingAverage(dayStrainRaw, 7),
    recoveryRaw,
    hrvRaw,
    hrv7: overrides.hrv7 ?? rollingAverage(hrvRaw, 7),
    rhrRaw,
    rhr7: overrides.rhr7 ?? rollingAverage(rhrRaw, 7),
  };
}

describe("buildEngineLedger — week keys and column shape (AC-E1)", () => {
  it("AC-E1 (bare case): rows use ISO Mon-Sun week keys, newest first, with exactly four columns in order (strain, recovery, hrv, rhr)", () => {
    const rows = buildEngineLedger(fixture(3, 0), cfg, recoveryCfg);
    expect(rows.map((r) => [r.weekStart, r.weekEnd])).toEqual([
      ["2026-06-15", "2026-06-21"],
      ["2026-06-08", "2026-06-14"],
      ["2026-06-01", "2026-06-07"],
    ]);
    for (const row of rows) {
      expect(Object.keys(row.columns)).toEqual(["strain", "recovery", "hrv", "rhr"]);
    }
  });
});

describe("buildEngineLedger — gap-week collapse (AC-E2)", () => {
  it("AC-E2: a week with zero raw readings across all four of Strain/Recovery/HRV/RHR collapses to a single gap row, not four insufficient cells", () => {
    const axis = axisOf(MONDAY, 7);
    const allNull = axis.map(() => null);
    const rows = buildEngineLedger(
      fixture(1, 0, {
        dayStrainRaw: allNull,
        dayStrain7: allNull,
        recoveryRaw: allNull,
        hrvRaw: allNull,
        hrv7: allNull,
        rhrRaw: allNull,
        rhr7: allNull,
      }),
      cfg,
      recoveryCfg,
    );
    expect(rows[0].isGap).toBe(true);
  });

  it("AC-E2 (bare case): a week with data present in at least one of the four series is not a gap row", () => {
    const rows = buildEngineLedger(fixture(1, 0), cfg, recoveryCfg);
    expect(rows[0].isGap).toBe(false);
  });
});

describe("buildEngineLedger — per-column independent insufficient data (AC-E3)", () => {
  it("AC-E3: a week with enough Strain data but fewer than minDaysPerWeek Recovery readings renders a computed Strain cell alongside an insufficient Recovery cell in the same row", () => {
    const axis = axisOf(MONDAY, 14);
    // Week 1 (oldest): Recovery present all 7 days. Week 2 (newest): only 2
    // of 7 days present — below cfg.minDaysPerWeek (4).
    const recoveryRaw = axis.map((_, i) => (i < 7 ? 60 : i < 9 ? 60 : null));
    const rows = buildEngineLedger(fixture(2, 0, { recoveryRaw }), cfg, recoveryCfg);
    const newest = rows[0];
    expect(newest.columns.strain.kind).toBe("delta");
    expect(newest.columns.recovery).toEqual({ kind: "insufficient", daysPresent: 2 });
  });
});

describe("buildEngineLedger — in-progress week computes normally, excluded only from becoming a future prior-endpoint (AC-E4)", () => {
  it("AC-E4: the in-progress week's own cells compute normally against the last completed week's endpoint once enough elapsed data exists", () => {
    const rows = buildEngineLedger(fixture(2, 4), cfg, recoveryCfg);
    const [newest] = rows;
    expect(newest.inProgress).toBe(true);
    expect(newest.daysElapsed).toBe(4);
    expect(newest.columns.strain.kind).toBe("delta");
    expect(newest.columns.hrv.kind).toBe("delta");
    expect(newest.columns.rhr.kind).toBe("delta");
  });

  it("AC-E4: with fewer than 2 completed weeks, buildEngineLedger returns the available rows without erroring", () => {
    const rows = buildEngineLedger(fixture(1, 3), cfg, recoveryCfg);
    expect(() => buildEngineLedger(fixture(1, 3), cfg, recoveryCfg)).not.toThrow();
    expect(completedWeekCount(rows)).toBe(1);
    expect(rows.some((r) => r.inProgress)).toBe(true);
  });

  it("AC-E4: with an empty axis, buildEngineLedger returns no rows and never errors", () => {
    expect(buildEngineLedger({ ...fixture(0, 0), axis: [] }, cfg, recoveryCfg)).toEqual([]);
  });
});

describe("buildEngineLedger — Strain delta (AC-E5)", () => {
  it("AC-E5: a week's Strain delta is the difference between this week's 7-day-rolling endpoint and the prior completed week's endpoint", () => {
    const axis = axisOf(MONDAY, 14);
    const dayStrain7 = [...axis.slice(0, 7).map(() => 10.0), ...axis.slice(7).map(() => 11.2)];
    const rows = buildEngineLedger(fixture(2, 0, { dayStrain7 }), cfg, recoveryCfg);
    const newest = rows[0];
    expect(newest.columns.strain).toMatchObject({ kind: "delta" });
    if (newest.columns.strain.kind === "delta") {
      expect(newest.columns.strain.value).toBeCloseTo(1.2, 5);
    }
  });

  it("AC-E5: the first week in history has no prior week to compare against, so its Strain cell is insufficient", () => {
    const rows = buildEngineLedger(fixture(1, 0), cfg, recoveryCfg);
    expect(rows[rows.length - 1].columns.strain.kind).toBe("insufficient");
  });
});

describe("buildEngineLedger — HRV delta (AC-E6)", () => {
  it("AC-E6: a week's HRV delta is the difference between this week's 7-day-rolling endpoint and the prior completed week's endpoint", () => {
    const axis = axisOf(MONDAY, 14);
    const hrv7 = [...axis.slice(0, 7).map(() => 60), ...axis.slice(7).map(() => 63)];
    const rows = buildEngineLedger(fixture(2, 0, { hrv7 }), cfg, recoveryCfg);
    const newest = rows[0];
    expect(newest.columns.hrv).toMatchObject({ kind: "delta" });
    if (newest.columns.hrv.kind === "delta") {
      expect(newest.columns.hrv.value).toBeCloseTo(3, 5);
    }
  });

  it("AC-E6: HRV ships as a plain week-over-week delta (DL-2026-09-15-a1) — a flat two-week HRV series produces a ~0 delta with no baseline input", () => {
    const rows = buildEngineLedger(fixture(2, 0), cfg, recoveryCfg);
    const newest = rows[0];
    if (newest.columns.hrv.kind !== "delta") throw new Error("expected a computed HRV delta cell");
    expect(newest.columns.hrv.value).toBeCloseTo(0, 5);
  });
});

describe("buildEngineLedger — RHR delta (AC-E7)", () => {
  it("AC-E7: a week's RHR delta is the difference between this week's 7-day-rolling endpoint and the prior completed week's endpoint", () => {
    const axis = axisOf(MONDAY, 14);
    const rhr7 = [...axis.slice(0, 7).map(() => 55), ...axis.slice(7).map(() => 53)];
    const rows = buildEngineLedger(fixture(2, 0, { rhr7 }), cfg, recoveryCfg);
    const newest = rows[0];
    expect(newest.columns.rhr).toMatchObject({ kind: "delta" });
    if (newest.columns.rhr.kind === "delta") {
      expect(newest.columns.rhr.value).toBeCloseTo(-2, 5);
    }
  });
});

describe("buildEngineLedger — Recovery avg + red-day count (AC-E8)", () => {
  it("AC-E8: a completed week's Recovery cell reports the mean Recovery Score over the week's present days and a count of days below redBelowPct", () => {
    const axis = axisOf(MONDAY, 14);
    const recoveryRaw = [...axis.slice(0, 7).map(() => 70), 20, 20, 50, 50, 50, 50, 50];
    const rows = buildEngineLedger(fixture(2, 0, { recoveryRaw }), cfg, recoveryCfg);
    const newest = rows[0];
    expect(newest.columns.recovery.kind).toBe("recovery");
    if (newest.columns.recovery.kind === "recovery") {
      expect(newest.columns.recovery.redDays).toBe(2); // only the two 20s are below redBelowPct (34)
      expect(newest.columns.recovery.avgPct).toBeCloseTo(
        (20 + 20 + 50 + 50 + 50 + 50 + 50) / 7,
        5,
      );
    }
  });

  it("AC-E8: a week with fewer than minDaysPerWeek raw Recovery readings renders insufficient data rather than a thin-data average", () => {
    const axis = axisOf(MONDAY, 7);
    const recoveryRaw = axis.map((_, i) => (i < 2 ? 60 : null));
    const rows = buildEngineLedger(fixture(1, 0, { recoveryRaw }), cfg, recoveryCfg);
    expect(rows[0].columns.recovery).toEqual({ kind: "insufficient", daysPresent: 2 });
  });
});
