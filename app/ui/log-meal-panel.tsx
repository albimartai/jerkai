"use client";

import { useEffect, useState } from "react";

import { LogMealForm, todayLocal } from "@/app/ui/log-meal-form";
import { MealEntriesList } from "@/app/ui/meal-entries-list";
import type { MealEntryRow } from "@/lib/meal-entries";

// Edit & Delete Meal (docs/prd/edit-delete-meal.md, OQ-1): the day's entries list lives
// directly below the Log Meal form on the same route — this wrapper owns which entry (if
// any) is being edited and coordinates the list refetch after any save.
//
// Date-Scoped Entries List (docs/prd/date-scoped-entries-list.md, AC-M25/NFR-40): this
// panel is also the page's single date owner. The form and list both read `entryDate` as a
// controlled prop instead of each independently seeding `todayLocal()` on mount.
export function LogMealPanel() {
  const [editEntry, setEditEntry] = useState<MealEntryRow | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [entryDate, setEntryDate] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntryDate(todayLocal());
  }, []);

  // AC-M31: the whole panel is null for one mount tick (SSR can't know device-local
  // "today"), then appears as a unit — deliberate, not a regression to fix.
  if (entryDate === null) return null;

  return (
    <div className="space-y-8">
      <LogMealForm
        editEntry={editEntry}
        entryDate={entryDate}
        onDateChange={setEntryDate}
        onEditComplete={() => setEditEntry(null)}
        onMutationSuccess={(savedDate) => {
          // AC-M27/AC-M28, PRD §9 IN-4: batched into one re-render, so the list's fetch
          // effect deps change once per save (NFR-43), whether or not savedDate === entryDate.
          setEntryDate(savedDate);
          setRefreshToken((token) => token + 1);
        }}
      />
      <MealEntriesList
        entryDate={entryDate}
        refreshToken={refreshToken}
        onEdit={setEditEntry}
        onDeleted={() => setRefreshToken((token) => token + 1)}
      />
    </div>
  );
}
