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

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Multi-User Data Model Retrofit
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
async function createUser(email: string): Promise<number> {
  const [row] = await sql`insert into users (email) values (${email}) returning id`;
  return row.id;
}

describe("AC-MU4 — meal entries scoped per user", () => {
  beforeEach(async () => {
    await sql`delete from users`;
  });

  it("AC-MU4 (bare case): a user with zero entries of their own sees an empty list and an empty calorie total, even when another user has entries on the identical date", async () => {
    const otherUserId = await createUser("other-mu4@example.com");
    const userId = await createUser("me-mu4@example.com");
    await saveMealEntry({
      mealType: "lunch",
      entryDate: "2026-07-20",
      description: "other user's lunch",
      calories: 900,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "mu4-other-key",
      // @ts-expect-error userId does not exist on NewMealEntry yet — this slice adds it (NFR-67).
      userId: otherUserId,
    });

    // @ts-expect-error fetchMealEntriesForDate does not take a userId yet — this slice adds it.
    const myEntries = await fetchMealEntriesForDate("2026-07-20", userId);
    expect(myEntries).toEqual([]);

    // @ts-expect-error fetchDailyCalorieTotals does not take a userId yet — this slice adds it.
    const totals = await fetchDailyCalorieTotals(["2026-07-20"], userId);
    expect(totals).toEqual([null]);
  });

  it("AC-MU4: two users logging on the identical date each see only their own entry", async () => {
    const userA = await createUser("a-mu4@example.com");
    const userB = await createUser("b-mu4@example.com");
    await saveMealEntry({
      mealType: "dinner",
      entryDate: "2026-07-21",
      description: "user A's dinner",
      calories: 700,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "mu4-a-key",
      // @ts-expect-error userId does not exist on NewMealEntry yet — this slice adds it.
      userId: userA,
    });
    await saveMealEntry({
      mealType: "dinner",
      entryDate: "2026-07-21",
      description: "user B's dinner",
      calories: 650,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "mu4-b-key",
      // @ts-expect-error userId does not exist on NewMealEntry yet — this slice adds it.
      userId: userB,
    });

    // @ts-expect-error fetchMealEntriesForDate does not take a userId yet — this slice adds it.
    const aEntries = await fetchMealEntriesForDate("2026-07-21", userA);
    // @ts-expect-error fetchMealEntriesForDate does not take a userId yet — this slice adds it.
    const bEntries = await fetchMealEntriesForDate("2026-07-21", userB);

    expect(aEntries).toHaveLength(1);
    expect(aEntries[0].description).toBe("user A's dinner");
    expect(bEntries).toHaveLength(1);
    expect(bEntries[0].description).toBe("user B's dinner");
  });
});

describe("AC-MU6 — daily targets scoped per user", () => {
  beforeEach(async () => {
    await sql`delete from users`;
  });

  it("AC-MU6 (bare case): a user with zero targets of their own sees an empty list, even when another user has a target", async () => {
    const otherUserId = await createUser("other-mu6@example.com");
    const userId = await createUser("me-mu6@example.com");
    await saveTarget({
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
      // @ts-expect-error userId does not exist on NewTarget yet — this slice adds it (NFR-67).
      userId: otherUserId,
    });

    // @ts-expect-error fetchTargets does not take a userId yet — this slice adds it.
    const myTargets = await fetchTargets(userId);
    expect(myTargets).toEqual([]);
  });

  it("AC-MU6: two users' targets are independent, even with the identical effective date", async () => {
    const userA = await createUser("a-mu6@example.com");
    const userB = await createUser("b-mu6@example.com");
    await saveTarget({
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
      // @ts-expect-error userId does not exist on NewTarget yet — this slice adds it.
      userId: userA,
    });
    await saveTarget({
      effectiveDate: "2026-07-01",
      caloriesTarget: 1800,
      proteinTargetG: 150,
      carbsTargetG: null,
      fatTargetG: null,
      // @ts-expect-error userId does not exist on NewTarget yet — this slice adds it.
      userId: userB,
    });

    // @ts-expect-error fetchTargets does not take a userId yet — this slice adds it.
    const aTargets = await fetchTargets(userA);
    // @ts-expect-error fetchTargets does not take a userId yet — this slice adds it.
    const bTargets = await fetchTargets(userB);

    expect(aTargets).toHaveLength(1);
    expect(aTargets[0].caloriesTarget).toBe(2500);
    expect(bTargets).toHaveLength(1);
    expect(bTargets[0].caloriesTarget).toBe(1800);
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
