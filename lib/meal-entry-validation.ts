import type { MealType } from "@/lib/dashboard/meal-type";

// Server Action boundary validation (AC-M2): every Server Action is a POST reachable to
// anyone who can send the request, form or not — treat FormData as untrusted (Next.js
// Server Actions guide). Rejects bad input outright rather than coercing or rounding it,
// so "exactly as typed" holds all the way to the database.

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export type MealEntryInput = {
  mealType: string | null;
  entryDate: string | null;
  description: string | null;
  calories: string | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
};

export type ValidatedMealEntry = {
  mealType: MealType;
  entryDate: string;
  description: string | null;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function requiredNumber(raw: string | null, field: string, errors: string[]): number | null {
  if (raw === null || raw === "") {
    errors.push(`${field} is required`);
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${field} must be a number`);
    return null;
  }
  if (value < 0) {
    errors.push(`${field} must be zero or greater`);
    return null;
  }
  return value;
}

function optionalNumber(raw: string | null, field: string, errors: string[]): number | null {
  if (raw === null || raw === "") return null;
  return requiredNumber(raw, field, errors);
}

export function validateMealEntryInput(input: MealEntryInput): ValidationResult<ValidatedMealEntry> {
  const errors: string[] = [];

  const mealType =
    input.mealType !== null && MEAL_TYPES.includes(input.mealType as MealType)
      ? (input.mealType as MealType)
      : null;
  if (mealType === null) errors.push("meal type is required");

  const entryDate = input.entryDate !== null && DATE_FORMAT.test(input.entryDate) ? input.entryDate : null;
  if (entryDate === null) errors.push("date is required");

  const calories = requiredNumber(input.calories, "calories", errors);
  const proteinG = optionalNumber(input.proteinG, "protein", errors);
  const carbsG = optionalNumber(input.carbsG, "carbs", errors);
  const fatG = optionalNumber(input.fatG, "fat", errors);

  const description = input.description && input.description.trim() !== "" ? input.description : null;

  if (errors.length > 0 || mealType === null || entryDate === null || calories === null) {
    return { ok: false, errors };
  }

  return { ok: true, value: { mealType, entryDate, description, calories, proteinG, carbsG, fatG } };
}
