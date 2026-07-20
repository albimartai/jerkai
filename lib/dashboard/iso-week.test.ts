import { describe, expect, it } from "vitest";

import { isoWeekEnd, isoWeekStart } from "@/lib/dashboard/iso-week";

// Executable spec for the Weekly Ledger's week key (AC-W1): ISO weeks
// (Mon–Sun) on the same device-local calendar day keys the rest of the
// dashboard uses. 2026-06-01 is a known Monday.

describe("isoWeekStart / isoWeekEnd (AC-W1)", () => {
  it("a Monday is its own week start, and Sunday six days later is the end", () => {
    expect(isoWeekStart("2026-06-01")).toBe("2026-06-01");
    expect(isoWeekEnd("2026-06-01")).toBe("2026-06-07");
  });

  it("every day of the week maps to the same Monday–Sunday bucket", () => {
    const days = ["2026-06-01", "2026-06-02", "2026-06-04", "2026-06-06", "2026-06-07"];
    for (const day of days) {
      expect(isoWeekStart(day)).toBe("2026-06-01");
      expect(isoWeekEnd(day)).toBe("2026-06-07");
    }
  });

  it("a Sunday belongs to the week that started the preceding Monday, not the next one", () => {
    expect(isoWeekStart("2026-06-07")).toBe("2026-06-01");
  });

  it("the next Monday starts a new week", () => {
    expect(isoWeekStart("2026-06-08")).toBe("2026-06-08");
    expect(isoWeekEnd("2026-06-08")).toBe("2026-06-14");
  });
});
