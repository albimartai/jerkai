"use client";

import { useActionState, useEffect, useState } from "react";

import { initialDeleteMealState } from "@/app/log-meal/action-state";
import { deleteMealEntryAction, listMealEntriesForDate } from "@/app/log-meal/actions";
import { headingFor } from "@/lib/meal-entries-list-heading";
import type { MealEntryRow } from "@/lib/meal-entries";

// AC-M16: the viewed day's logged meals, each with Edit and Delete. Reads via
// listMealEntriesForDate (a plain "use server" function called imperatively — there's no
// client fetch/SWR anywhere in this codebase and no route handler for meal data).
// refreshToken bumps whenever a save (new entry or edit) completes elsewhere on the page,
// triggering a re-fetch here.
//
// Date-Scoped Entries List (docs/prd/date-scoped-entries-list.md, NFR-40): entryDate is now
// a controlled prop from LogMealPanel, the page's single date owner — this component no
// longer seeds its own todayLocal() copy.

const MEAL_TYPE_LABEL: Record<MealEntryRow["mealType"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function MealEntriesList({
  entryDate,
  refreshToken,
  onEdit,
  onDeleted,
}: {
  entryDate: string;
  refreshToken: number;
  onEdit: (entry: MealEntryRow) => void;
  onDeleted?: () => void;
}) {
  const [entries, setEntries] = useState<MealEntryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMealEntriesForDate(entryDate).then((rows) => {
      // NFR-42: drop a late-arriving response for a date/refresh combo that's no longer
      // current — a stale-fetch race must never overwrite the currently-selected day's rows.
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [entryDate, refreshToken]);

  if (entries === null) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {headingFor(entryDate)}
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400">Nothing logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <MealEntryListItem
              key={entry.id}
              entry={entry}
              onEdit={() => onEdit(entry)}
              onDeleted={() => {
                setEntries((prev) => prev?.filter((row) => row.id !== entry.id) ?? null);
                onDeleted?.();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MealEntryListItem({
  entry,
  onEdit,
  onDeleted,
}: {
  entry: MealEntryRow;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  // AC-M21/OQ-2: an inline Confirm/Cancel step, not a modal — delete is the one action here
  // that needs an explicit confirm (DL-2026-07-20-b3); edit does not.
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(deleteMealEntryAction, initialDeleteMealState);

  useEffect(() => {
    if (state.status === "success" && state.deletedId === entry.id) {
      onDeleted();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      <div className="min-w-0">
        <p className="font-medium">
          {MEAL_TYPE_LABEL[entry.mealType]} · <span className="tabular-nums">{entry.calories} kcal</span>
        </p>
        {entry.description ? <p className="truncate text-zinc-500">{entry.description}</p> : null}
      </div>

      {confirming ? (
        <form action={formAction} className="flex shrink-0 items-center gap-3">
          <input type="hidden" name="id" value={entry.id} />
          <button type="submit" className="font-medium text-red-600 dark:text-red-400">
            Confirm
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-zinc-500">
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={onEdit} className="text-zinc-600 underline dark:text-zinc-300">
            Edit
          </button>
          <button type="button" onClick={() => setConfirming(true)} className="text-red-600 dark:text-red-400">
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
