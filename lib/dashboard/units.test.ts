import { describe, expect, it } from "vitest";

import { toPounds } from "@/lib/dashboard/units";

// Executable spec for the display-unit convention (NFR-16): weight and lean
// body mass display in lb everywhere on the dashboard, converting at
// read/render time from whatever unit the row was stored with (README:
// units stored as-sent, never rewritten).

describe("toPounds", () => {
  it("NFR-16: lb-stored values pass through unchanged", () => {
    expect(toPounds(180.4, "lb")).toBe(180.4);
  });

  it("NFR-16: kg-stored values convert to lb at render time", () => {
    expect(toPounds(80, "kg")).toBeCloseTo(176.37, 2);
  });

  it("NFR-16: an unknown or missing unit passes through rather than fabricating a conversion", () => {
    // All real history is lb (README); a null/unknown unit means the row is
    // already in the display unit or something upstream broke — either way,
    // inventing a conversion would falsify the raw value.
    expect(toPounds(150, null)).toBe(150);
    expect(toPounds(150, "stone")).toBe(150);
  });
});
