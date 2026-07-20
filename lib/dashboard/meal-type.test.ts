import { describe, expect, it } from "vitest";

import { defaultMealType, type MealTypeConfig } from "@/lib/dashboard/meal-type";

// AC-M1 / OQ-1: meal-type chip default by local time of day. Boundaries live in config
// (NFR-24), not hardcoded — this test exercises the boundary hours themselves.

const cfg: MealTypeConfig = {
  breakfastBeforeHour: 11,
  lunchBeforeHour: 16,
  dinnerBeforeHour: 21,
};

describe("defaultMealType (AC-M1, OQ-1)", () => {
  it("before 11:00 defaults to breakfast", () => {
    expect(defaultMealType(0, cfg)).toBe("breakfast");
    expect(defaultMealType(10, cfg)).toBe("breakfast");
  });

  it("11:00-15:59 defaults to lunch", () => {
    expect(defaultMealType(11, cfg)).toBe("lunch");
    expect(defaultMealType(15, cfg)).toBe("lunch");
  });

  it("16:00-20:59 defaults to dinner", () => {
    expect(defaultMealType(16, cfg)).toBe("dinner");
    expect(defaultMealType(20, cfg)).toBe("dinner");
  });

  it("21:00 and later defaults to snack", () => {
    expect(defaultMealType(21, cfg)).toBe("snack");
    expect(defaultMealType(23, cfg)).toBe("snack");
  });
});
