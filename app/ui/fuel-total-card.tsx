"use client";

import { useEffect, useState } from "react";

import { getTargetsForCurrentUser, listMealEntriesForDate } from "@/app/fuel/actions";
import { dailyTotals, type MealEntryRow } from "@/lib/meal-entries";
import { resolveTargetForDate, type TargetRow } from "@/lib/targets";

// Fuel (PRD §0.3): a second, independent read of the same day's entries — LogMealPanel's
// own MealEntriesList already fetches this via listMealEntriesForDate. Lifting that fetch
// into a shared parent would touch two already-tested standalone components
// (tests/component/log-meal-panel.test.tsx, meal-entries-list.test.tsx); one extra read per
// render is the accepted, lower-risk trade instead of restructuring those.
export function FuelTotalCard({
  entryDate,
  refreshToken,
  switchToTargets,
}: {
  entryDate: string;
  refreshToken: number;
  switchToTargets?: () => void;
}) {
  const [entries, setEntries] = useState<MealEntryRow[] | null>(null);
  const [targets, setTargets] = useState<TargetRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMealEntriesForDate(entryDate), getTargetsForCurrentUser()]).then(
      ([entryRows, targetRows]) => {
        if (cancelled) return;
        setEntries(entryRows);
        setTargets(targetRows);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entryDate, refreshToken]);

  if (entries === null || targets === null) return null;

  const totals = dailyTotals(entries);
  const target = resolveTargetForDate(targets, entryDate);

  return (
    <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Total · {entryDate}
      </p>
      {target ? (
        <>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="tabular-nums">
              {totals.calories} / {target.caloriesTarget} kcal
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
            <div
              className="h-full bg-zinc-900 dark:bg-zinc-100"
              style={{
                width: `${Math.min(100, (totals.calories / target.caloriesTarget) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-2 tabular-nums text-zinc-500">
            Protein {totals.proteinG}g / {target.proteinTargetG}g
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 tabular-nums">{totals.calories} kcal logged</p>
          <p className="mt-1 text-zinc-500">
            No target set yet —{" "}
            <button type="button" onClick={() => switchToTargets?.()} className="underline">
              set targets
            </button>
            .
          </p>
        </>
      )}
    </div>
  );
}
