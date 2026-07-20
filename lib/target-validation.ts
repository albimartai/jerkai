// Server Action boundary validation for Settings → Targets (AC-M10): kcal + protein
// required, carbs/fat optional, same reject-don't-coerce discipline as meal entries
// (lib/meal-entry-validation.ts).

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export type TargetInput = {
  effectiveDate: string | null;
  caloriesTarget: string | null;
  proteinTargetG: string | null;
  carbsTargetG: string | null;
  fatTargetG: string | null;
};

export type ValidatedTarget = {
  effectiveDate: string;
  caloriesTarget: number;
  proteinTargetG: number;
  carbsTargetG: number | null;
  fatTargetG: number | null;
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

export function validateTargetInput(input: TargetInput): ValidationResult<ValidatedTarget> {
  const errors: string[] = [];

  const effectiveDate =
    input.effectiveDate !== null && DATE_FORMAT.test(input.effectiveDate) ? input.effectiveDate : null;
  if (effectiveDate === null) errors.push("effective date is required");

  const caloriesTarget = requiredNumber(input.caloriesTarget, "calories target", errors);
  const proteinTargetG = requiredNumber(input.proteinTargetG, "protein target", errors);
  const carbsTargetG = optionalNumber(input.carbsTargetG, "carbs target", errors);
  const fatTargetG = optionalNumber(input.fatTargetG, "fat target", errors);

  if (errors.length > 0 || effectiveDate === null || caloriesTarget === null || proteinTargetG === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { effectiveDate, caloriesTarget, proteinTargetG, carbsTargetG, fatTargetG },
  };
}
