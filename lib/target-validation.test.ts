import { describe, expect, it } from "vitest";

import { validateTargetInput } from "@/lib/target-validation";

// AC-M10: kcal + protein required, carbs/fat optional. Same boundary discipline as meal
// entry validation — reject bad input, never coerce a valid one.

const valid = {
  effectiveDate: "2026-07-20",
  caloriesTarget: "2300",
  proteinTargetG: "180",
  carbsTargetG: "220",
  fatTargetG: "70",
};

describe("validateTargetInput", () => {
  it("AC-M10: parses valid input exactly", () => {
    const result = validateTargetInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.caloriesTarget).toBe(2300);
      expect(result.value.proteinTargetG).toBe(180);
      expect(result.value.carbsTargetG).toBe(220);
      expect(result.value.fatTargetG).toBe(70);
    }
  });

  it("carbs/fat are optional, blank saves as null", () => {
    const result = validateTargetInput({ ...valid, carbsTargetG: "", fatTargetG: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.carbsTargetG).toBeNull();
      expect(result.value.fatTargetG).toBeNull();
    }
  });

  it("rejects missing calories or protein targets", () => {
    expect(validateTargetInput({ ...valid, caloriesTarget: "" }).ok).toBe(false);
    expect(validateTargetInput({ ...valid, proteinTargetG: "" }).ok).toBe(false);
  });

  it("rejects a negative or non-numeric value", () => {
    expect(validateTargetInput({ ...valid, caloriesTarget: "-1" }).ok).toBe(false);
    expect(validateTargetInput({ ...valid, proteinTargetG: "lots" }).ok).toBe(false);
  });

  it("rejects a missing or malformed effective date", () => {
    expect(validateTargetInput({ ...valid, effectiveDate: null }).ok).toBe(false);
    expect(validateTargetInput({ ...valid, effectiveDate: "07/20/2026" }).ok).toBe(false);
  });
});
