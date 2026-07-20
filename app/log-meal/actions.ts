"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { dailyTotals, fetchMealEntriesForDate, saveMealEntry, type DailyTotals } from "@/lib/meal-entries";
import { validateMealEntryInput } from "@/lib/meal-entry-validation";
import { resolveTargetForDate, fetchTargets, type TargetRow } from "@/lib/targets";

// Server Actions are POST endpoints reachable to anyone who can send the request, not just
// through this form — auth is re-checked here even though the page is already gated
// (Next.js Server Actions guide: render-time gating is not a security boundary).

export type LogMealState = {
  status: "idle" | "success" | "error";
  errors: string[];
  entryDate: string | null;
  totals: DailyTotals | null;
  target: TargetRow | null;
};

export const initialLogMealState: LogMealState = {
  status: "idle",
  errors: [],
  entryDate: null,
  totals: null,
  target: null,
};

export async function logMealAction(
  _prevState: LogMealState,
  formData: FormData,
): Promise<LogMealState> {
  const session = await auth();
  if (!session) {
    return { ...initialLogMealState, status: "error", errors: ["Unauthorized"] };
  }

  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };

  const idempotencyKey = field("idempotencyKey");
  if (!idempotencyKey) {
    return { ...initialLogMealState, status: "error", errors: ["missing idempotency key"] };
  }

  const validated = validateMealEntryInput({
    mealType: field("mealType"),
    entryDate: field("entryDate"),
    description: field("description"),
    calories: field("calories"),
    proteinG: field("proteinG"),
    carbsG: field("carbsG"),
    fatG: field("fatG"),
  });

  if (!validated.ok) {
    return { ...initialLogMealState, status: "error", errors: validated.errors };
  }

  // ON CONFLICT DO NOTHING (NFR-29): a retried/double-tapped submit with the same key
  // affects zero rows here — that is a successful save from the original attempt, not a
  // failure, so the response below is identical either way.
  await saveMealEntry({ ...validated.value, idempotencyKey });

  revalidatePath("/log-meal");
  revalidatePath("/daily");

  const { entryDate } = validated.value;
  const [entries, targets] = await Promise.all([fetchMealEntriesForDate(entryDate), fetchTargets()]);

  return {
    status: "success",
    errors: [],
    entryDate,
    totals: dailyTotals(entries),
    target: resolveTargetForDate(targets, entryDate),
  };
}
