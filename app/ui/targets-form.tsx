"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveTargetAction } from "@/app/settings/targets/actions";
import { initialSaveTargetState } from "@/app/settings/targets/action-state";

// AC-M10: kcal + protein required, carbs/fat optional; effective date defaults today.
// Insert-only on the server — "saving" always means "starting a new effective period."

function todayLocal(): string {
  // Device-local calendar day (NFR-2) — computed client-side only, same reasoning as
  // app/ui/log-meal-form.tsx's todayLocal.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function SubmitButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !ready}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {pending ? "Saving…" : "Save target"}
    </button>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950";

export function TargetsForm() {
  const [state, formAction] = useActionState(saveTargetAction, initialSaveTargetState);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);

  useEffect(() => {
    // Device-local "today" (NFR-2) is only known client-side — unavailable during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEffectiveDate(todayLocal());
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Settings · Targets</h1>

      <form action={formAction} className="space-y-4">
        <label className="block text-sm">
          Effective date
          <input
            type="date"
            name="effectiveDate"
            value={effectiveDate ?? ""}
            onChange={(event) => setEffectiveDate(event.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Calories target
            <input
              type="number"
              inputMode="decimal"
              name="caloriesTarget"
              min={0}
              step="any"
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm">
            Protein target (g)
            <input
              type="number"
              inputMode="decimal"
              name="proteinTargetG"
              min={0}
              step="any"
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm">
            Carbs target (g) <span className="text-zinc-400">(optional)</span>
            <input
              type="number"
              inputMode="decimal"
              name="carbsTargetG"
              min={0}
              step="any"
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm">
            Fat target (g) <span className="text-zinc-400">(optional)</span>
            <input
              type="number"
              inputMode="decimal"
              name="fatTargetG"
              min={0}
              step="any"
              className={`mt-1 ${inputClass}`}
            />
          </label>
        </div>

        {state.status === "error" && state.errors.length > 0 ? (
          <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
            {state.errors.join(", ")}
          </p>
        ) : null}
        {state.status === "success" ? (
          <p aria-live="polite" className="text-sm text-emerald-600 dark:text-emerald-400">
            Saved. Applies from the effective date forward — earlier days are unchanged.
          </p>
        ) : null}

        <SubmitButton ready={effectiveDate !== null} />
      </form>
    </div>
  );
}
