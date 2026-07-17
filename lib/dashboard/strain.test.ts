import { describe, expect, it } from "vitest";

import { DAY_STRAIN_METRIC, STRAIN_DOMAIN, strainFraction } from "@/lib/dashboard/strain";

// Executable spec for the Day Strain strip domain (AC-D11, NFR-4): Whoop's
// fixed 0–21 scale, independent of whatever range the data happens to span.

describe("Day Strain domain", () => {
  it("AC-D11: the domain is fixed at 0–21 regardless of data", () => {
    expect(STRAIN_DOMAIN).toEqual({ min: 0, max: 21 });
  });

  it("AC-D11: maps a strain value onto the fixed scale as a 0–1 fraction", () => {
    expect(strainFraction(0)).toBe(0);
    expect(strainFraction(21)).toBe(1);
    expect(strainFraction(14.2)).toBeCloseTo(14.2 / 21);
  });

  it("AC-D11: out-of-range values clamp to the fixed domain instead of rescaling it", () => {
    expect(strainFraction(-1)).toBe(0);
    expect(strainFraction(25)).toBe(1);
  });

  it("NFR-4: strain is sourced from Whoop's day_strain metric, not the workout log", () => {
    expect(DAY_STRAIN_METRIC).toEqual({ source: "whoop", metric: "day_strain" });
  });
});
