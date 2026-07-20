"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { logMealAction, initialLogMealState } from "@/app/log-meal/actions";
import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import { defaultMealType, type MealType } from "@/lib/dashboard/meal-type";

// Model 2b (docs/prd/log-meal.md): a structured form, no macro estimation — the user types
// what they looked up, JerkAI stores it exactly (AC-M2).

const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

// Device-local calendar day (NFR-2) — must run on the client only. Vercel's server clock
// is UTC, so computing "today" or the meal-type default during server render would
// misclassify evenings against the device's actual local time.
function todayLocal(): string {
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
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950";

export function LogMealForm() {
  const [state, formAction] = useActionState(logMealAction, initialLogMealState);

  // Client-only defaults (AC-M1): null until the mount effect runs, so server render and
  // first client render agree (no hydration mismatch) before local time is known.
  const [mealType, setMealType] = useState<MealType | null>(null);
  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  useEffect(() => {
    // Reading the browser clock/locale (NFR-2, device-local time) — unavailable during
    // SSR, so this can't be derived at render time; a mount effect is the correct place.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMealType(defaultMealType(new Date().getHours(), DASHBOARD_CONFIG.mealType));
    setEntryDate(todayLocal());
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  // A fresh key after every successful save (NFR-29): a duplicate submit of the SAME save
  // is protected by reusing the key across retries, but the next entry is a new save and
  // must not collide with the one just recorded.
  useEffect(() => {
    if (state.status === "success") {
      // Drawing a fresh idempotency key in response to the action's result, not state
      // derived from props/render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [state]);

  const ready = mealType !== null && entryDate !== null && idempotencyKey !== null;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">Log meal</h1>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey ?? ""} />

        <div className="flex gap-2" role="group" aria-label="Meal type">
          {MEAL_TYPES.map(({ value, label }) => (
            <label
              key={value}
              className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                mealType === value
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="mealType"
                value={value}
                checked={mealType === value}
                onChange={() => setMealType(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>

        <label className="block text-sm">
          Date
          <input
            type="date"
            name="entryDate"
            value={entryDate ?? ""}
            onChange={(event) => setEntryDate(event.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>

        <label className="block text-sm">
          Description <span className="text-zinc-400">(optional)</span>
          <input type="text" name="description" className={`mt-1 ${inputClass}`} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Calories
            <input
              type="number"
              inputMode="decimal"
              name="calories"
              min={0}
              step="any"
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm">
            Protein (g) <span className="text-zinc-400">(optional)</span>
            <input
              type="number"
              inputMode="decimal"
              name="proteinG"
              min={0}
              step="any"
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm">
            Carbs (g) <span className="text-zinc-400">(optional)</span>
            <input
              type="number"
              inputMode="decimal"
              name="carbsG"
              min={0}
              step="any"
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block text-sm">
            Fat (g) <span className="text-zinc-400">(optional)</span>
            <input
              type="number"
              inputMode="decimal"
              name="fatG"
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

        <SubmitButton ready={ready} />
      </form>

      {state.status === "success" && state.totals ? (
        <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Total · {state.entryDate}
          </p>
          {state.target ? (
            <>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="tabular-nums">
                  {state.totals.calories} / {state.target.caloriesTarget} kcal
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full bg-zinc-900 dark:bg-zinc-100"
                  style={{
                    width: `${Math.min(100, (state.totals.calories / state.target.caloriesTarget) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-2 tabular-nums text-zinc-500">
                Protein {state.totals.proteinG}g / {state.target.proteinTargetG}g
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 tabular-nums">{state.totals.calories} kcal logged</p>
              <p className="mt-1 text-zinc-500">
                No target set yet —{" "}
                <a href="/settings/targets" className="underline">
                  set targets
                </a>
                .
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
