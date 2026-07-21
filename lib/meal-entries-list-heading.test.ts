import { describe, expect, it, vi } from "vitest";

// AC-M29: heading reads "Today's meals" only when the shown date equals todayLocal();
// otherwise "Meals · {D}" with D as the ISO YYYY-MM-DD string.

vi.mock("@/app/ui/log-meal-form", () => ({
  todayLocal: () => "2026-07-21",
}));

describe("headingFor", () => {
  it("AC-M29: reads 'Today's meals' when the date equals todayLocal()", async () => {
    const { headingFor } = await import("@/lib/meal-entries-list-heading");
    expect(headingFor("2026-07-21")).toBe("Today's meals");
  });

  it("AC-M29: reads 'Meals · {D}' for any other date", async () => {
    const { headingFor } = await import("@/lib/meal-entries-list-heading");
    expect(headingFor("2026-07-08")).toBe("Meals · 2026-07-08");
  });
});
