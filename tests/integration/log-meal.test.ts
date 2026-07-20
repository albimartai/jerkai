import { neon } from "@neondatabase/serverless";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fetchDailyCalorieTotals, fetchMealEntriesForDate, saveMealEntry } from "@/lib/meal-entries";
import { fetchTargets, resolveTargetForDate, saveTarget } from "@/lib/targets";

// The Log Meal write path over a real, disposable Neon branch (docs/prd/log-meal.md) —
// same guard-rail pattern as tests/integration/dashboard-read.test.ts.

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CI_DATABASE = "jerkai_ci_test";
const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset");

beforeAll(() => {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Integration tests need a disposable Neon branch — see scripts/ci/neon-branch.mjs.",
    );
  }
  if (!new URL(DATABASE_URL).pathname.includes(CI_DATABASE)) {
    throw new Error(
      `refusing to run: DATABASE_URL does not point at the '${CI_DATABASE}' database. ` +
        "These tests delete rows between cases and must never target the persistent dev/prod branches.",
    );
  }
});

beforeEach(async () => {
  await sql`delete from manual_macro_entries`;
  await sql`delete from daily_targets`;
});

describe("saveMealEntry — AC-M2 exact-as-typed persistence", () => {
  it("persists calories and macros exactly as typed, no rounding or derivation", async () => {
    await saveMealEntry({
      mealType: "lunch",
      entryDate: "2026-07-20",
      description: "chicken salad",
      calories: 612.5,
      proteinG: 40.25,
      carbsG: 30.1,
      fatG: 18.75,
      idempotencyKey: "key-1",
    });

    const entries = await fetchMealEntriesForDate("2026-07-20");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      mealType: "lunch",
      entryDate: "2026-07-20",
      description: "chicken salad",
      calories: 612.5,
      proteinG: 40.25,
      carbsG: 30.1,
      fatG: 18.75,
    });
  });

  it("AC-M5: a blank description persists as null", async () => {
    await saveMealEntry({
      mealType: "snack",
      entryDate: "2026-07-20",
      description: null,
      calories: 150,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "key-2",
    });
    const entries = await fetchMealEntriesForDate("2026-07-20");
    expect(entries[0].description).toBeNull();
    expect(entries[0].proteinG).toBeNull();
  });
});

describe("NFR-29 — idempotent double-submit protection", () => {
  it("the same idempotency key submitted twice persists exactly one row, and the conflicting call succeeds silently (not an error)", async () => {
    const entry = {
      mealType: "breakfast" as const,
      entryDate: "2026-07-20",
      description: "oatmeal",
      calories: 350,
      proteinG: 12,
      carbsG: 50,
      fatG: 8,
      idempotencyKey: "retry-key",
    };
    await saveMealEntry(entry);
    // The second call is the retry/double-tap — must resolve without throwing, i.e. read
    // as success rather than surfacing an error to the caller.
    await expect(saveMealEntry(entry)).resolves.toBeUndefined();

    const entries = await fetchMealEntriesForDate("2026-07-20");
    expect(entries).toHaveLength(1);
  });

  it("two deliberate identical-value entries with different keys both persist", async () => {
    const base = {
      mealType: "snack" as const,
      entryDate: "2026-07-20",
      description: "almonds",
      calories: 160,
      proteinG: 6,
      carbsG: 6,
      fatG: 14,
    };
    await saveMealEntry({ ...base, idempotencyKey: "a" });
    await saveMealEntry({ ...base, idempotencyKey: "b" });

    const entries = await fetchMealEntriesForDate("2026-07-20");
    expect(entries).toHaveLength(2);
  });
});

describe("AC-M8 — fetchDailyCalorieTotals: gap vs. a genuinely low logged day", () => {
  it("a day with no entries is a null gap; a day with a low logged total is its real sum, not zero", async () => {
    await saveMealEntry({
      mealType: "snack",
      entryDate: "2026-07-15",
      description: null,
      calories: 45,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "low-day",
    });

    const axis = ["2026-07-14", "2026-07-15", "2026-07-16"];
    const totals = await fetchDailyCalorieTotals(axis);
    expect(totals).toEqual([null, 45, null]);
  });
});

describe("AC-M4/AC-M10 — backdated entries evaluated against the historical target", () => {
  it("a backdated entry's day resolves against the target that was in force then, not the current one", async () => {
    await saveTarget({
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });
    await saveTarget({
      effectiveDate: "2026-07-15",
      caloriesTarget: 2100,
      proteinTargetG: 170,
      carbsTargetG: null,
      fatTargetG: null,
    });

    const targets = await fetchTargets();

    // DL-pending-3 boundary: the day before the change keeps the old target.
    expect(resolveTargetForDate(targets, "2026-07-14")?.caloriesTarget).toBe(2500);
    // The day of/after the change gets the new one.
    expect(resolveTargetForDate(targets, "2026-07-15")?.caloriesTarget).toBe(2100);
    expect(resolveTargetForDate(targets, "2026-07-20")?.caloriesTarget).toBe(2100);
  });

  it("adding a later target never recolors an earlier day's resolved target (history never recolors)", async () => {
    await saveTarget({
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });
    const before = resolveTargetForDate(await fetchTargets(), "2026-07-10")?.caloriesTarget;

    await saveTarget({
      effectiveDate: "2026-08-01",
      caloriesTarget: 1900,
      proteinTargetG: 160,
      carbsTargetG: null,
      fatTargetG: null,
    });
    const after = resolveTargetForDate(await fetchTargets(), "2026-07-10")?.caloriesTarget;

    expect(before).toBe(2500);
    expect(after).toBe(2500);
  });
});
