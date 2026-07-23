import { getSql } from "@/lib/db";
import { resolveTargetForDate, type TargetRow } from "@/lib/target-resolution";

// TargetRow/resolveTargetForDate live in lib/target-resolution.ts (no DB
// import) and are re-exported here so existing importers of this module are
// unaffected; lib/dashboard/calorie-strip.ts and the demo route import them
// from lib/target-resolution directly, so their module graphs never resolve
// this file's getSql import.
export { resolveTargetForDate, type TargetRow };

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
