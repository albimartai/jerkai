"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { saveTarget } from "@/lib/targets";
import { validateTargetInput } from "@/lib/target-validation";

import type { SaveTargetState } from "@/app/settings/targets/action-state";

export async function saveTargetAction(
  _prevState: SaveTargetState,
  formData: FormData,
): Promise<SaveTargetState> {
  const session = await auth();
  if (!session) {
    return { status: "error", errors: ["Unauthorized"] };
  }

  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };

  const validated = validateTargetInput({
    effectiveDate: field("effectiveDate"),
    caloriesTarget: field("caloriesTarget"),
    proteinTargetG: field("proteinTargetG"),
    carbsTargetG: field("carbsTargetG"),
    fatTargetG: field("fatTargetG"),
  });

  if (!validated.ok) {
    return { status: "error", errors: validated.errors };
  }

  // Insert-only (DL-pending-3): this never updates an existing row, so a day's history
  // before the new effective date can never recolor.
  await saveTarget(validated.value);

  revalidatePath("/settings/targets");
  revalidatePath("/log-meal");
  revalidatePath("/daily");

  return { status: "success", errors: [] };
}
