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

// Every write in this file is scoped by user_id (NFR-67) — a single test user, recreated
// fresh every case, backs every pre-existing test that isn't itself exercising multi-user
// scoping (those live in the AC-MU4/AC-MU6 blocks below, which create their own users).
let testUserId: number;

beforeEach(async () => {
  // user_id has no ON DELETE cascade (OQ-3) — biometric_readings is cleared defensively too,
  // since it's shared across the whole test run (fileParallelism: false) and a stray row left
  // by another integration file would otherwise block `delete from users` with an FK violation.
  await sql`delete from biometric_readings`;
  await sql`delete from manual_macro_entries`;
  await sql`delete from daily_targets`;
  // Whoop Multi-Tenancy: whoop_tokens/whoop_workouts/sync_runs also reference
  // users now (no ON DELETE cascade, same OQ-3 reasoning) — cleared
  // defensively too, even though this file never writes to them itself.
  await sql`delete from whoop_workouts`;
  await sql`delete from sync_runs`;
  await sql`delete from whoop_tokens`;
  await sql`delete from users`;
  const [user] = await sql`insert into users (email) values ('log-meal-test@example.com') returning id`;
  testUserId = user.id;
});

describe("saveMealEntry — AC-M2 exact-as-typed persistence", () => {
  it("persists calories and macros exactly as typed, no rounding or derivation", async () => {
    await saveMealEntry({
      userId: testUserId,
      mealType: "lunch",
      entryDate: "2026-07-20",
      description: "chicken salad",
      calories: 612.5,
      proteinG: 40.25,
      carbsG: 30.1,
      fatG: 18.75,
      idempotencyKey: "key-1",
    });

    const entries = await fetchMealEntriesForDate("2026-07-20", testUserId);
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
      userId: testUserId,
      mealType: "snack",
      entryDate: "2026-07-20",
      description: null,
      calories: 150,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "key-2",
    });
    const entries = await fetchMealEntriesForDate("2026-07-20", testUserId);
    expect(entries[0].description).toBeNull();
    expect(entries[0].proteinG).toBeNull();
  });
});

describe("NFR-29 — idempotent double-submit protection", () => {
  it("the same idempotency key submitted twice persists exactly one row, and the conflicting call succeeds silently (not an error)", async () => {
    const entry = {
      userId: testUserId,
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

    const entries = await fetchMealEntriesForDate("2026-07-20", testUserId);
    expect(entries).toHaveLength(1);
  });

  it("two deliberate identical-value entries with different keys both persist", async () => {
    const base = {
      userId: testUserId,
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

    const entries = await fetchMealEntriesForDate("2026-07-20", testUserId);
    expect(entries).toHaveLength(2);
  });
});

describe("AC-M8 — fetchDailyCalorieTotals: gap vs. a genuinely low logged day", () => {
  it("a day with no entries is a null gap; a day with a low logged total is its real sum, not zero", async () => {
    await saveMealEntry({
      userId: testUserId,
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
    const totals = await fetchDailyCalorieTotals(axis, testUserId);
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
  it("AC-MU4 (bare case): a user with zero entries of their own sees an empty list and an empty calorie total, even when another user has entries on the identical date", async () => {
    const otherUserId = await createUser("other-mu4@example.com");
    const userId = await createUser("me-mu4@example.com");
    await saveMealEntry({
      userId: otherUserId,
      mealType: "lunch",
      entryDate: "2026-07-20",
      description: "other user's lunch",
      calories: 900,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "mu4-other-key",
    });

    const myEntries = await fetchMealEntriesForDate("2026-07-20", userId);
    expect(myEntries).toEqual([]);

    const totals = await fetchDailyCalorieTotals(["2026-07-20"], userId);
    expect(totals).toEqual([null]);
  });

  it("AC-MU4: two users logging on the identical date each see only their own entry", async () => {
    const userA = await createUser("a-mu4@example.com");
    const userB = await createUser("b-mu4@example.com");
    await saveMealEntry({
      userId: userA,
      mealType: "dinner",
      entryDate: "2026-07-21",
      description: "user A's dinner",
      calories: 700,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "mu4-a-key",
    });
    await saveMealEntry({
      userId: userB,
      mealType: "dinner",
      entryDate: "2026-07-21",
      description: "user B's dinner",
      calories: 650,
      proteinG: null,
      carbsG: null,
      fatG: null,
      idempotencyKey: "mu4-b-key",
    });

    const aEntries = await fetchMealEntriesForDate("2026-07-21", userA);
    const bEntries = await fetchMealEntriesForDate("2026-07-21", userB);

    expect(aEntries).toHaveLength(1);
    expect(aEntries[0].description).toBe("user A's dinner");
    expect(bEntries).toHaveLength(1);
    expect(bEntries[0].description).toBe("user B's dinner");
  });
});

describe("AC-MU6 — daily targets scoped per user", () => {
  it("AC-MU6 (bare case): a user with zero targets of their own sees an empty list, even when another user has a target", async () => {
    const otherUserId = await createUser("other-mu6@example.com");
    const userId = await createUser("me-mu6@example.com");
    await saveTarget({
      userId: otherUserId,
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });

    const myTargets = await fetchTargets(userId);
    expect(myTargets).toEqual([]);
  });

  it("AC-MU6: two users' targets are independent, even with the identical effective date", async () => {
    const userA = await createUser("a-mu6@example.com");
    const userB = await createUser("b-mu6@example.com");
    await saveTarget({
      userId: userA,
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });
    await saveTarget({
      userId: userB,
      effectiveDate: "2026-07-01",
      caloriesTarget: 1800,
      proteinTargetG: 150,
      carbsTargetG: null,
      fatTargetG: null,
    });

    const aTargets = await fetchTargets(userA);
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
      userId: testUserId,
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });
    await saveTarget({
      userId: testUserId,
      effectiveDate: "2026-07-15",
      caloriesTarget: 2100,
      proteinTargetG: 170,
      carbsTargetG: null,
      fatTargetG: null,
    });

    const targets = await fetchTargets(testUserId);

    // DL-pending-3 boundary: the day before the change keeps the old target.
    expect(resolveTargetForDate(targets, "2026-07-14")?.caloriesTarget).toBe(2500);
    // The day of/after the change gets the new one.
    expect(resolveTargetForDate(targets, "2026-07-15")?.caloriesTarget).toBe(2100);
    expect(resolveTargetForDate(targets, "2026-07-20")?.caloriesTarget).toBe(2100);
  });

  it("adding a later target never recolors an earlier day's resolved target (history never recolors)", async () => {
    await saveTarget({
      userId: testUserId,
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
    });
    const before = resolveTargetForDate(await fetchTargets(testUserId), "2026-07-10")?.caloriesTarget;

    await saveTarget({
      userId: testUserId,
      effectiveDate: "2026-08-01",
      caloriesTarget: 1900,
      proteinTargetG: 160,
      carbsTargetG: null,
      fatTargetG: null,
    });
    const after = resolveTargetForDate(await fetchTargets(testUserId), "2026-07-10")?.caloriesTarget;

    expect(before).toBe(2500);
    expect(after).toBe(2500);
  });
});
