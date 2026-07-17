import { describe, expect, it } from "vitest";

import { alignSeries, dayAxis } from "@/lib/dashboard/series";

// Executable spec for the shared date axis (NFR-2, AC-D8) and missing-day
// handling (AC-D13, NFR-8): every strip is aligned onto one day axis, and a
// day without a value is a null gap — never a zero or a fabricated value.

describe("dayAxis", () => {
  it("NFR-2: builds an inclusive run of calendar days ending at the given day", () => {
    expect(dayAxis("2026-07-16", 3)).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
  });

  it("NFR-2: crosses month boundaries without UTC drift", () => {
    expect(dayAxis("2026-07-01", 2)).toEqual(["2026-06-30", "2026-07-01"]);
  });
});

describe("alignSeries", () => {
  it("AC-D8/NFR-2: places each dated value on its axis slot so all strips share one axis", () => {
    const axis = ["2026-07-14", "2026-07-15", "2026-07-16"];
    const values = new Map([
      ["2026-07-14", 18.4],
      ["2026-07-16", 18.2],
    ]);
    expect(alignSeries(axis, values)).toEqual([18.4, null, 18.2]);
  });

  it("AC-D13/NFR-8: a day with no value is a null gap, not a zero", () => {
    const aligned = alignSeries(["2026-07-14", "2026-07-15"], new Map([["2026-07-15", 72]]));
    expect(aligned[0]).toBeNull();
    expect(aligned[0]).not.toBe(0);
  });

  it("AC-D13: values outside the axis window are dropped, not smeared onto other days", () => {
    const aligned = alignSeries(["2026-07-15"], new Map([["2026-07-01", 99]]));
    expect(aligned).toEqual([null]);
  });
});
