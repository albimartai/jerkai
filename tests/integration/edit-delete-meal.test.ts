import { neon } from "@neondatabase/serverless";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  deleteMealEntry,
  fetchDailyCalorieTotals,
  fetchMealEntriesForDate,
  saveMealEntry,
  updateMealEntry,
} from "@/lib/meal-entries";
import { fetchTargets, resolveTargetForDate, saveTarget } from "@/lib/targets";

// Edit & Delete Meal (docs/prd/edit-delete-meal.md) over a real, disposable Neon branch —
// same guard-rail pattern as tests/integration/log-meal.test.ts.

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

async function saveOne(overrides: Partial<Parameters<typeof saveMealEntry>[0]> = {}) {
  await saveMealEntry({
    mealType: "lunch",
    entryDate: "2026-07-20",
    description: "chicken salad",
    calories: 612.5,
    proteinG: 40.25,
    carbsG: 30.1,
    fatG: 18.75,
    idempotencyKey: `key-${Math.random()}`,
    ...overrides,
  });
  const [entry] = await fetchMealEntriesForDate(overrides.entryDate ?? "2026-07-20");
  return entry;
}

describe("AC-M21/AC-M23 regression — id is a real number, not a bigint string", () => {
  it("fetchMealEntriesForDate returns a numeric id that strictly-equals a Number()-parsed FormData id", async () => {
    const entry = await saveOne();
    expect(typeof entry.id).toBe("number");
    // deleteMealEntryAction derives deletedId via Number(formData.get("id")) and the UI
    // matches it against entry.id with strict equality — a string id here (the Neon driver's
    // untyped bigint/bigserial behavior) would silently break that match and leave a
    // successfully-deleted row still showing in the list (the bug this test guards against).
    const deletedId = Number(String(entry.id));
    expect(deletedId).toBe(entry.id);
  });
});

describe("AC/NFR-39 — updated_at column", () => {
  it("defaults updated_at to the insert-time value, equal to created_at, for a never-edited row", async () => {
    const entry = await saveOne();
    expect(entry.updatedAt).toBeDefined();
    expect(new Date(entry.updatedAt).getTime()).toBe(new Date(entry.createdAt).getTime());
  });
});

describe("updateMealEntry — AC-M18 update in place", () => {
  it("updates the same row in place: same id, same idempotency_key, created_at unchanged, updated_at bumped, values exact", async () => {
    const original = await saveOne({ idempotencyKey: "stable-key" });

    const result = await updateMealEntry({
      id: original.id,
      mealType: "dinner",
      entryDate: "2026-07-20",
      description: "steak and rice",
      calories: 800.25,
      proteinG: 55.5,
      carbsG: 60.1,
      fatG: 25.75,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.id).toBe(original.id);
    expect(result.entry.mealType).toBe("dinner");
    expect(result.entry.description).toBe("steak and rice");
    expect(result.entry.calories).toBe(800.25);
    expect(result.entry.proteinG).toBe(55.5);
    expect(result.entry.carbsG).toBe(60.1);
    expect(result.entry.fatG).toBe(25.75);
    expect(new Date(result.entry.createdAt).getTime()).toBe(new Date(original.createdAt).getTime());
    expect(new Date(result.entry.updatedAt).getTime()).toBeGreaterThan(new Date(original.updatedAt).getTime());

    const [idempotencyKey] = await sql`
      select idempotency_key from manual_macro_entries where id = ${original.id}
    `;
    expect(idempotencyKey.idempotency_key).toBe("stable-key");

    const rows = await sql`select count(*)::int as count from manual_macro_entries`;
    expect(rows[0].count).toBe(1);
  });
});

describe("updateMealEntry — AC-M19 date re-attribution", () => {
  it("editing entryDate moves the entry between days; both days recompute against each day's effective target", async () => {
    await saveTarget({
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });
    await saveTarget({
      effectiveDate: "2026-07-18",
      caloriesTarget: 2100,
      proteinTargetG: 170,
      carbsTargetG: null,
      fatTargetG: null,
    });

    const original = await saveOne({ entryDate: "2026-07-10", calories: 700 });

    await updateMealEntry({
      id: original.id,
      mealType: original.mealType,
      entryDate: "2026-07-20",
      description: original.description,
      calories: original.calories,
      proteinG: original.proteinG,
      carbsG: original.carbsG,
      fatG: original.fatG,
    });

    const oldDayEntries = await fetchMealEntriesForDate("2026-07-10");
    const newDayEntries = await fetchMealEntriesForDate("2026-07-20");
    expect(oldDayEntries).toHaveLength(0);
    expect(newDayEntries).toHaveLength(1);

    const totals = await fetchDailyCalorieTotals(["2026-07-10", "2026-07-20"]);
    expect(totals).toEqual([null, 700]);

    const targets = await fetchTargets();
    expect(resolveTargetForDate(targets, "2026-07-10")?.caloriesTarget).toBe(2500);
    expect(resolveTargetForDate(targets, "2026-07-20")?.caloriesTarget).toBe(2100);
  });
});

describe("updateMealEntry — AC-M20 no-op save", () => {
  it("resubmitting identical values leaves updated_at and created_at untouched, and does not create a duplicate", async () => {
    const original = await saveOne();

    const result = await updateMealEntry({
      id: original.id,
      mealType: original.mealType,
      entryDate: original.entryDate,
      description: original.description,
      calories: original.calories,
      proteinG: original.proteinG,
      carbsG: original.carbsG,
      fatG: original.fatG,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Date(result.entry.updatedAt).getTime()).toBe(new Date(original.updatedAt).getTime());
    expect(new Date(result.entry.createdAt).getTime()).toBe(new Date(original.createdAt).getTime());

    const rows = await sql`select count(*)::int as count from manual_macro_entries`;
    expect(rows[0].count).toBe(1);
  });
});

describe("updateMealEntry — NFR-34 fail closed", () => {
  it("updating an unknown id returns not_found, inserts nothing, and does not silently no-op as success", async () => {
    const result = await updateMealEntry({
      id: 999999999,
      mealType: "snack",
      entryDate: "2026-07-20",
      description: null,
      calories: 100,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });

    const rows = await sql`select count(*)::int as count from manual_macro_entries`;
    expect(rows[0].count).toBe(0);
  });
});

describe("deleteMealEntry — AC-M21 confirmed delete", () => {
  it("hard-removes the row", async () => {
    const original = await saveOne();

    const result = await deleteMealEntry(original.id);

    expect(result.deleted).toBe(true);
    const rows = await sql`select count(*)::int as count from manual_macro_entries where id = ${original.id}`;
    expect(rows[0].count).toBe(0);
  });
});

describe("deleteMealEntry — AC-M22 recompute after delete", () => {
  it("deleting a day's only entry reverts fetchDailyCalorieTotals to a null gap, not zero", async () => {
    const entry = await saveOne({ entryDate: "2026-07-20", calories: 500 });

    await deleteMealEntry(entry.id);

    const totals = await fetchDailyCalorieTotals(["2026-07-19", "2026-07-20", "2026-07-21"]);
    expect(totals).toEqual([null, null, null]);
  });

  it("deleting one of several entries on a day recomputes the remaining total correctly", async () => {
    const first = await saveOne({ entryDate: "2026-07-20", calories: 500, idempotencyKey: "e1" });
    await saveOne({ entryDate: "2026-07-20", calories: 300, idempotencyKey: "e2" });

    await deleteMealEntry(first.id);

    const totals = await fetchDailyCalorieTotals(["2026-07-20"]);
    expect(totals).toEqual([300]);
  });
});

describe("deleteMealEntry — NFR-37 idempotency", () => {
  it("delete-then-delete of the same id: the second call returns deleted:false, not an error", async () => {
    const entry = await saveOne();

    const first = await deleteMealEntry(entry.id);
    expect(first.deleted).toBe(true);

    await expect(deleteMealEntry(entry.id)).resolves.toEqual({ deleted: false, entry: null });
  });

  it("edit-then-delete: editing then deleting the same row succeeds cleanly", async () => {
    const entry = await saveOne();

    const edited = await updateMealEntry({
      id: entry.id,
      mealType: entry.mealType,
      entryDate: entry.entryDate,
      description: "updated",
      calories: 900,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
    });
    expect(edited.ok).toBe(true);

    const deleted = await deleteMealEntry(entry.id);
    expect(deleted.deleted).toBe(true);
  });

  it("delete-then-edit: editing an already-deleted id fails closed (not_found), not a crash", async () => {
    const entry = await saveOne();

    await deleteMealEntry(entry.id);

    const result = await updateMealEntry({
      id: entry.id,
      mealType: entry.mealType,
      entryDate: entry.entryDate,
      description: entry.description,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("deleteMealEntry — NFR-34 fail closed on unknown id", () => {
  it("deleting a never-existed id returns deleted:false without throwing", async () => {
    await expect(deleteMealEntry(999999999)).resolves.toEqual({ deleted: false, entry: null });
  });
});
