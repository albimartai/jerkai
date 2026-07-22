import { describe, expect, it } from "vitest";

import { buildCalorieSeries } from "@/lib/dashboard/calorie-strip";
import { buildWeeklyView } from "@/lib/dashboard/weekly-view";
import {
  DEMO_DAILY_CALORIES,
  DEMO_DASHBOARD_DATA,
  DEMO_TARGETS,
} from "@/lib/demo/synthetic-data";

// AC-PD3/NFR-52/IN-4: the synthetic fixture must demonstrate the product's
// core value on sight — a non-fallback hero badge state, at least one
// no-entry gap day on the calories strip, and a shape matching the real
// DashboardData/TargetRow types (checked at compile time via the import
// itself; these tests check the runtime content).

describe("demo synthetic data (AC-PD3, NFR-52)", () => {
  it("NFR-52: covers a >= 90-day window with a fully populated series for every metric", () => {
    const { axis, series, units } = DEMO_DASHBOARD_DATA;
    expect(axis.length).toBeGreaterThanOrEqual(90);
    for (const key of Object.keys(series) as (keyof typeof series)[]) {
      expect(series[key]).toHaveLength(axis.length);
      expect(series[key].every((v) => v !== null)).toBe(true);
      expect(units[key] !== undefined).toBe(true);
    }
  });

  it("AC-PD3/IN-4: yields at least 4 completed weeks, past the 2-week cold-start threshold", () => {
    const view = buildWeeklyView(DEMO_DASHBOARD_DATA);
    expect(view.completedWeeks).toBeGreaterThanOrEqual(4);
  });

  it("AC-PD3: the hero badge computes a real state, not the cold-start fallback", () => {
    const view = buildWeeklyView(DEMO_DASHBOARD_DATA);
    // The cold-start fallback only ever produces the AC-D4–D6 daily-streak
    // labels; the Weekly Ledger-derived states are exactly these three.
    expect(["▾", "▴", "—"].some((glyph) => view.badge.label.startsWith(glyph))).toBe(true);
  });

  it("AC-PD3: the body-fat trend stalls then resumes across completed weeks (not monotonic)", () => {
    const view = buildWeeklyView(DEMO_DASHBOARD_DATA);
    const deltas = view.rows
      .filter((row) => !row.inProgress && row.columns.bodyFat.kind === "delta")
      .map((row) => (row.columns.bodyFat as { kind: "delta"; value: number }).value);
    // A stall week's delta reads ~0 (neutral); a declining week's delta is
    // clearly negative. Demonstrating both states means it isn't a flat
    // monotonic decline the whole way through.
    expect(deltas.some((d) => d <= -0.05)).toBe(true);
    expect(deltas.some((d) => Math.abs(d) < 0.05)).toBe(true);
  });

  it("AC-PD3: day strain co-moves with the stall (lower during the stall phase)", () => {
    const { series } = DEMO_DASHBOARD_DATA;
    const avg = (values: (number | null)[]) =>
      values.reduce((sum: number, v) => sum + (v ?? 0), 0) / values.length;
    const stallAvg = avg(series.dayStrain.slice(25, 60));
    const declineAvg = avg(series.dayStrain.slice(60, 89));
    expect(stallAvg).toBeLessThan(declineAvg);
  });

  it("AC-PD3: at least one day has no logged meal, rendering as a gap (not a zero)", () => {
    const calorieSeries = buildCalorieSeries(DEMO_DASHBOARD_DATA.axis, DEMO_DAILY_CALORIES, DEMO_TARGETS);
    expect(calorieSeries.some((day) => day.state === "gap")).toBe(true);
  });

  it("NFR-52: the daily calorie series is fully aligned to the axis length", () => {
    expect(DEMO_DAILY_CALORIES).toHaveLength(DEMO_DASHBOARD_DATA.axis.length);
  });
});
