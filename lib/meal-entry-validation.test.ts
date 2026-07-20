import { describe, expect, it } from "vitest";

import { validateMealEntryInput } from "@/lib/meal-entry-validation";

// Server Action boundary validation (Server Actions are an untrusted entry point —
// Next.js Server Actions guide). AC-M2: values persist exactly as typed — this is the
// ceiling (reject bad input) as well as the floor (never coerce/round a valid one).

const valid = {
  mealType: "lunch",
  entryDate: "2026-07-20",
  description: "chicken salad",
  calories: "612.5",
  proteinG: "40.2",
  carbsG: "30",
  fatG: "18",
};

describe("validateMealEntryInput", () => {
  it("AC-M2: parses valid input exactly, no rounding", () => {
    const result = validateMealEntryInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.calories).toBe(612.5);
      expect(result.value.proteinG).toBe(40.2);
      expect(result.value.mealType).toBe("lunch");
      expect(result.value.entryDate).toBe("2026-07-20");
      expect(result.value.description).toBe("chicken salad");
    }
  });

  it("AC-M5: blank description is optional, saves as null", () => {
    const result = validateMealEntryInput({ ...valid, description: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it("protein/carbs/fat are optional, blank saves as null", () => {
    const result = validateMealEntryInput({ ...valid, proteinG: "", carbsG: "", fatG: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.proteinG).toBeNull();
      expect(result.value.carbsG).toBeNull();
      expect(result.value.fatG).toBeNull();
    }
  });

  it("rejects missing calories", () => {
    const result = validateMealEntryInput({ ...valid, calories: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/calories/i);
  });

  it("rejects a non-numeric calories value rather than coercing it", () => {
    const result = validateMealEntryInput({ ...valid, calories: "lots" });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative value for any numeric field", () => {
    expect(validateMealEntryInput({ ...valid, calories: "-100" }).ok).toBe(false);
    expect(validateMealEntryInput({ ...valid, proteinG: "-1" }).ok).toBe(false);
  });

  it("rejects an invalid or missing meal type", () => {
    expect(validateMealEntryInput({ ...valid, mealType: "brunch" }).ok).toBe(false);
    expect(validateMealEntryInput({ ...valid, mealType: null }).ok).toBe(false);
  });

  it("rejects a missing or malformed date", () => {
    expect(validateMealEntryInput({ ...valid, entryDate: null }).ok).toBe(false);
    expect(validateMealEntryInput({ ...valid, entryDate: "07/20/2026" }).ok).toBe(false);
  });
});
