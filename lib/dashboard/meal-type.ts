// Meal-type chip default by local time of day (AC-M1). Boundaries live in
// DASHBOARD_CONFIG.mealType (NFR-24), not hardcoded here. Callers pass the device-local
// hour — this module has no notion of timezone itself.

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type MealTypeConfig = {
  breakfastBeforeHour: number; // hour < this defaults to breakfast
  lunchBeforeHour: number; // hour < this (and >= breakfastBeforeHour) defaults to lunch
  dinnerBeforeHour: number; // hour < this (and >= lunchBeforeHour) defaults to dinner
  // hour >= dinnerBeforeHour defaults to snack
};

export function defaultMealType(hour: number, cfg: MealTypeConfig): MealType {
  if (hour < cfg.breakfastBeforeHour) return "breakfast";
  if (hour < cfg.lunchBeforeHour) return "lunch";
  if (hour < cfg.dinnerBeforeHour) return "dinner";
  return "snack";
}
