// Pulled out of lib/targets.ts (which also holds fetchTargets/saveTarget,
// DB-touching functions) so TargetRow and resolveTargetForDate can be
// imported without dragging lib/db.ts into the importer's module graph —
// the demo route (docs/prd/public-demo.md, NFR-51) needs both without ever
// reaching the database, and a plain re-export from targets.ts wouldn't
// achieve that: TypeScript still resolves the whole file, value imports
// included, to type-check a re-exported symbol.

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
