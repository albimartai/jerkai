import { describe, expect, it } from "vitest";

import { rollingAverage } from "@/lib/dashboard/rolling";

// Executable spec for the dashboard trend lines (AC-D2, AC-D3): trailing
// rolling averages over the shared day axis, where a null slot is a genuine
// source-side gap (AC-D13) that must be skipped, never counted as zero.

describe("rollingAverage", () => {
  it("AC-D2: averages the trailing window once enough history exists", () => {
    const values = [10, 20, 30, 40, 50];
    expect(rollingAverage(values, 3)).toEqual([10, 15, 20, 30, 40]);
  });

  it("AC-D3: with fewer than N days of history, averages over available days only", () => {
    // 7-day window over 3 days of data: every slot still gets a value.
    expect(rollingAverage([12, 18, 24], 7)).toEqual([12, 15, 18]);
  });

  it("AC-D3/AC-D13: skips gap days inside the window instead of counting them as zero", () => {
    // Day 2 is a gap; the 3-day window at day 3 averages the two real values.
    expect(rollingAverage([10, null, 20], 3)).toEqual([10, 10, 15]);
  });

  it("AC-D13: a window with no values at all yields a gap, not a fabricated value", () => {
    expect(rollingAverage([null, null, 10], 2)).toEqual([null, null, 10]);
  });

  it("handles an empty series without erroring (AC-D3)", () => {
    expect(rollingAverage([], 30)).toEqual([]);
  });

  it("rejects a non-positive window loudly", () => {
    expect(() => rollingAverage([1], 0)).toThrow();
  });
});
