import { describe, expect, it } from "vitest";

import { dailyTotals, type MealEntryRow } from "@/lib/meal-entries";

// Pure aggregation over a day's entries — no DB (AC-M3's running daily total).

const entry = (overrides: Partial<MealEntryRow>): MealEntryRow => ({
  id: 1,
  mealType: "breakfast",
  entryDate: "2026-07-20",
  description: null,
  calories: 500,
  proteinG: 30,
  carbsG: 40,
  fatG: 15,
  createdAt: "2026-07-20T12:00:00.000Z",
  ...overrides,
});

describe("dailyTotals", () => {
  it("sums calories and macros exactly as stored, no rounding", () => {
    const entries = [
      entry({ id: 1, calories: 512.5, proteinG: 30.2, carbsG: 40.1, fatG: 15.3 }),
      entry({ id: 2, calories: 210, proteinG: 12, carbsG: 20, fatG: 5 }),
    ];
    const totals = dailyTotals(entries);
    expect(totals.calories).toBe(722.5);
    expect(totals.proteinG).toBeCloseTo(42.2);
    expect(totals.carbsG).toBeCloseTo(60.1);
    expect(totals.fatG).toBeCloseTo(20.3);
    expect(totals.entryCount).toBe(2);
  });

  it("treats a missing optional macro as no contribution, not an error", () => {
    const entries = [entry({ calories: 300, proteinG: null, carbsG: null, fatG: null })];
    const totals = dailyTotals(entries);
    expect(totals.calories).toBe(300);
    expect(totals.proteinG).toBe(0);
  });

  it("an empty day totals to zero across the board", () => {
    const totals = dailyTotals([]);
    expect(totals).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, entryCount: 0 });
  });
});
