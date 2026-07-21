import type { DailyTotals } from "@/lib/meal-entries";
import type { TargetRow } from "@/lib/targets";

// Plain types and initial-state constants for the Log Meal Server Actions
// (app/log-meal/actions.ts). Kept in a separate, non-"use server" module because a
// "use server" file may only export async functions — a React Server Functions
// constraint enforced at the module boundary, not just a style preference (Next.js
// use-server directive docs: "all functions in the file are executed on the server").
// Exporting a plain object like initialLogMealState alongside the actions breaks at
// runtime with "A 'use server' file can only export async functions, found object."

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

export type EditMealState = LogMealState;

export const initialEditMealState: EditMealState = {
  status: "idle",
  errors: [],
  entryDate: null,
  totals: null,
  target: null,
};

export type DeleteMealState = {
  status: "idle" | "success" | "error";
  errors: string[];
  deletedId: number | null;
};

export const initialDeleteMealState: DeleteMealState = {
  status: "idle",
  errors: [],
  deletedId: null,
};
