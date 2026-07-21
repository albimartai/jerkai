"use server";

import { revalidatePath } from "next/cache";

import {
  initialDeleteMealState,
  initialEditMealState,
  initialLogMealState,
  type DeleteMealState,
  type EditMealState,
  type LogMealState,
} from "@/app/log-meal/action-state";
import { auth } from "@/auth";
import {
  dailyTotals,
  deleteMealEntry,
  fetchMealEntriesForDate,
  saveMealEntry,
  updateMealEntry,
  type MealEntryRow,
} from "@/lib/meal-entries";
import { validateMealEntryInput } from "@/lib/meal-entry-validation";
import { resolveTargetForDate, fetchTargets } from "@/lib/targets";

// Server Actions are POST endpoints reachable to anyone who can send the request, not just
// through this form — auth is re-checked here even though the page is already gated
// (Next.js Server Actions guide: render-time gating is not a security boundary).
//
// This file only exports async functions (Next's "use server" constraint) — state types
// and initial-state constants live in ./action-state instead.

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

// Edit & Delete Meal (docs/prd/edit-delete-meal.md), extending the Log Meal action file
// rather than forking a new surface — same three-layer auth pattern as logMealAction.

export async function updateMealEntryAction(
  _prevState: EditMealState,
  formData: FormData,
): Promise<EditMealState> {
  const session = await auth();
  if (!session) {
    return { ...initialEditMealState, status: "error", errors: ["Unauthorized"] };
  }

  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };

  const idRaw = field("id");
  const id = idRaw !== null ? Number(idRaw) : NaN;
  if (!Number.isInteger(id)) {
    return { ...initialEditMealState, status: "error", errors: ["missing entry id"] };
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
    return { ...initialEditMealState, status: "error", errors: validated.errors };
  }

  // AC-M18: same row, in place (id preserved, never delete-and-re-add). NFR-34: an id
  // that doesn't resolve to a row fails closed rather than silently no-oping as success.
  const result = await updateMealEntry({ id, ...validated.value });
  if (!result.ok) {
    return { ...initialEditMealState, status: "error", errors: ["entry not found"] };
  }

  revalidatePath("/log-meal");
  revalidatePath("/daily");

  // AC-M19: revalidating /daily is sufficient for both the old and new day — it's
  // force-dynamic and re-derives everything from the DB on next render (NFR-35). The
  // totals/target returned here are for the (possibly new) entry date, matching
  // logMealAction's shape for the on-page running total.
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

export async function deleteMealEntryAction(
  _prevState: DeleteMealState,
  formData: FormData,
): Promise<DeleteMealState> {
  const session = await auth();
  if (!session) {
    return { ...initialDeleteMealState, status: "error", errors: ["Unauthorized"] };
  }

  const idRaw = formData.get("id");
  const id = typeof idRaw === "string" ? Number(idRaw) : NaN;
  if (!Number.isInteger(id)) {
    return { ...initialDeleteMealState, status: "error", errors: ["missing entry id"] };
  }

  // AC-M21/NFR-37: hard delete is idempotent — a row that's already gone (e.g. deleted in
  // another tab) is still a successful outcome from the caller's point of view, never an
  // error or a 500.
  await deleteMealEntry(id);

  revalidatePath("/log-meal");
  revalidatePath("/daily");

  return { status: "success", errors: [], deletedId: id };
}

// AC-M16: a small read path for the day's entries list — a plain "use server" function
// called imperatively from the client list component, not routed through useActionState
// (this file has no route-handler equivalent; Server Actions are the only server-touching
// primitive in this codebase for meal data).
export async function listMealEntriesForDate(entryDate: string): Promise<MealEntryRow[]> {
  const session = await auth();
  if (!session) return [];
  return fetchMealEntriesForDate(entryDate);
}
