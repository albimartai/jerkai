// Plain type and initial-state constant for the Settings/Targets Server Action
// (app/settings/targets/actions.ts). Kept in a separate, non-"use server" module because a
// "use server" file may only export async functions — a React Server Functions constraint
// enforced at the module boundary, not just a style preference (Next.js use-server directive
// docs: "all functions in the file are executed on the server"). Exporting a plain object
// like initialSaveTargetState alongside the action breaks at runtime with "A 'use server'
// file can only export async functions, found object."

export type SaveTargetState = {
  status: "idle" | "success" | "error";
  errors: string[];
};

export const initialSaveTargetState: SaveTargetState = { status: "idle", errors: [] };
