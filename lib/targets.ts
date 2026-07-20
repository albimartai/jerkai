import { getSql } from "@/lib/db";

// Daily targets (AC-M10, DL-pending-3): insert-only, effective-dated. Changing a target
// never updates or deletes an old row — it inserts a new one — so history can never
// recolor: resolveTargetForDate always answers "what was in force on day X" using only
// rows that existed with an effective_date on or before X.
//
// NFR-30: this resolver is the ONE place "which target governs day X" is decided. The Log
// Meal form's running total, the calories strip's per-day coloring, and (later) the
// adherence column and TDEE slices all go through this function — never a duplicated
// lookup.

export type TargetRow = {
  id: number;
  effectiveDate: string; // yyyy-MM-dd, device-local calendar day
  caloriesTarget: number;
  proteinTargetG: number;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  createdAt: string;
};

// Latest target with effectiveDate <= date; ties on effectiveDate (a same-day correction)
// resolve to the highest id, the most recently inserted row. Returns null when no target
// was yet in force (AC-M11).
export function resolveTargetForDate(
  targets: readonly TargetRow[],
  date: string,
): TargetRow | null {
  let best: TargetRow | null = null;
  for (const target of targets) {
    if (target.effectiveDate > date) continue;
    if (
      best === null ||
      target.effectiveDate > best.effectiveDate ||
      (target.effectiveDate === best.effectiveDate && target.id > best.id)
    ) {
      best = target;
    }
  }
  return best;
}

export type NewTarget = {
  effectiveDate: string;
  caloriesTarget: number;
  proteinTargetG: number;
  carbsTargetG: number | null;
  fatTargetG: number | null;
};

export async function saveTarget(target: NewTarget): Promise<void> {
  const sql = getSql();
  await sql`
    insert into daily_targets
      (effective_date, calories_target, protein_target_g, carbs_target_g, fat_target_g)
    values (${target.effectiveDate}, ${target.caloriesTarget}, ${target.proteinTargetG},
            ${target.carbsTargetG}, ${target.fatTargetG})
  `;
}

type TargetDbRow = {
  id: number;
  effective_date: string;
  calories_target: number;
  protein_target_g: number;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  created_at: string;
};

export async function fetchTargets(): Promise<TargetRow[]> {
  const sql = getSql();
  const rows = (await sql`
    select id, to_char(effective_date, 'YYYY-MM-DD') as effective_date,
           calories_target::float8 as calories_target,
           protein_target_g::float8 as protein_target_g,
           carbs_target_g::float8 as carbs_target_g,
           fat_target_g::float8 as fat_target_g,
           created_at
    from daily_targets
    order by effective_date, id
  `) as TargetDbRow[];

  return rows.map((row) => ({
    id: row.id,
    effectiveDate: row.effective_date,
    caloriesTarget: row.calories_target,
    proteinTargetG: row.protein_target_g,
    carbsTargetG: row.carbs_target_g,
    fatTargetG: row.fat_target_g,
    createdAt: row.created_at,
  }));
}
