import { getSql } from "@/lib/db";
import { buildCalorieSeries, type CalorieDay } from "@/lib/dashboard/calorie-strip";
import { alignSeries } from "@/lib/dashboard/series";
import type { MealType } from "@/lib/dashboard/meal-type";
import type { TargetRow } from "@/lib/targets";

// The Log Meal write path (docs/prd/log-meal.md). Insert-only: manual_macro_entries is
// never updated or deleted here (AC-M7 — edit/delete is a separate fast-follow slice).
// Values persist exactly as typed (NFR-28) — this module never rounds or derives a macro
// the user didn't enter.

export type MealEntryRow = {
  id: number;
  mealType: MealType;
  entryDate: string;
  description: string | null;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  createdAt: string;
};

export type NewMealEntry = {
  mealType: MealType;
  entryDate: string;
  description: string | null;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  // Client-generated, unique per submit attempt (NFR-29): a retried/double-tapped submit
  // reuses the same key, so the unique constraint turns the retry into a no-op instead of a
  // duplicate row. A fresh key is drawn only after a successful save.
  idempotencyKey: string;
};

// Idempotent per idempotencyKey (NFR-29): a conflicting insert affects zero rows rather
// than erroring or duplicating — callers must treat that exactly like a fresh insert, the
// row is already saved from the original attempt.
export async function saveMealEntry(entry: NewMealEntry): Promise<void> {
  const sql = getSql();
  await sql`
    insert into manual_macro_entries
      (meal_type, entry_date, description, calories, protein_g, carbs_g, fat_g, idempotency_key)
    values (${entry.mealType}, ${entry.entryDate}, ${entry.description}, ${entry.calories},
            ${entry.proteinG}, ${entry.carbsG}, ${entry.fatG}, ${entry.idempotencyKey})
    on conflict (idempotency_key) do nothing
  `;
}

type MealEntryDbRow = {
  id: number;
  meal_type: MealType;
  entry_date: string;
  description: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
};

const toMealEntryRow = (row: MealEntryDbRow): MealEntryRow => ({
  id: row.id,
  mealType: row.meal_type,
  entryDate: row.entry_date,
  description: row.description,
  calories: row.calories,
  proteinG: row.protein_g,
  carbsG: row.carbs_g,
  fatG: row.fat_g,
  createdAt: row.created_at,
});

export async function fetchMealEntriesForDate(entryDate: string): Promise<MealEntryRow[]> {
  const sql = getSql();
  const rows = (await sql`
    select id, meal_type, to_char(entry_date, 'YYYY-MM-DD') as entry_date, description,
           calories::float8 as calories, protein_g::float8 as protein_g,
           carbs_g::float8 as carbs_g, fat_g::float8 as fat_g, created_at
    from manual_macro_entries
    where entry_date = ${entryDate}
    order by created_at
  `) as MealEntryDbRow[];
  return rows.map(toMealEntryRow);
}

export type DailyTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entryCount: number;
};

// Pure aggregation (AC-M3's running daily total) — no DB, unit-testable on its own.
export function dailyTotals(entries: readonly MealEntryRow[]): DailyTotals {
  return entries.reduce<DailyTotals>(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      proteinG: acc.proteinG + (entry.proteinG ?? 0),
      carbsG: acc.carbsG + (entry.carbsG ?? 0),
      fatG: acc.fatG + (entry.fatG ?? 0),
      entryCount: acc.entryCount + 1,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, entryCount: 0 },
  );
}

// Daily calorie sums for the strip's axis (AC-M6). A day with zero entries is a null gap
// (AC-M8), never a zero — same gap convention as lib/dashboard/series.ts's alignSeries.
export async function fetchDailyCalorieTotals(axis: readonly string[]): Promise<(number | null)[]> {
  if (axis.length === 0) return [];
  const sql = getSql();
  const rows = (await sql`
    select to_char(entry_date, 'YYYY-MM-DD') as entry_date, sum(calories)::float8 as total
    from manual_macro_entries
    where entry_date >= ${axis[0]} and entry_date <= ${axis[axis.length - 1]}
    group by entry_date
  `) as { entry_date: string; total: number }[];

  const byDay = new Map(rows.map((row) => [row.entry_date, row.total]));
  return alignSeries(axis, byDay);
}

// The calories strip's one read function: per-axis-day actual + resolved target + bar
// state (NFR-30 — resolveTargetForDate, via buildCalorieSeries, is the only place "which
// target governs day X" is decided; this never reimplements that logic).
export async function fetchCalorieSeries(
  axis: readonly string[],
  targets: readonly TargetRow[],
): Promise<CalorieDay[]> {
  const dailyCalories = await fetchDailyCalorieTotals(axis);
  return buildCalorieSeries(axis, dailyCalories, targets);
}
