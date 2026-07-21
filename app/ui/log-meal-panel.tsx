"use client";

import { useState } from "react";

import { LogMealForm } from "@/app/ui/log-meal-form";
import { MealEntriesList } from "@/app/ui/meal-entries-list";
import type { MealEntryRow } from "@/lib/meal-entries";

// Edit & Delete Meal (docs/prd/edit-delete-meal.md, OQ-1): the day's entries list lives
// directly below the Log Meal form on the same route — this wrapper owns which entry (if
// any) is being edited and coordinates the list refetch after any save.
export function LogMealPanel() {
  const [editEntry, setEditEntry] = useState<MealEntryRow | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="space-y-8">
      <LogMealForm
        editEntry={editEntry}
        onEditComplete={() => setEditEntry(null)}
        onMutationSuccess={() => setRefreshToken((token) => token + 1)}
      />
      <MealEntriesList
        refreshToken={refreshToken}
        onEdit={setEditEntry}
        onDeleted={() => setRefreshToken((token) => token + 1)}
      />
    </div>
  );
}
