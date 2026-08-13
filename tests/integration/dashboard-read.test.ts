import { neon } from "@neondatabase/serverless";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fetchDashboardData } from "@/lib/dashboard/data";
import { upsertReading } from "@/lib/readings";

// The dashboard read path over a real, disposable Neon branch: rows are
// seeded through upsertReading (the one production write path) so the tests
// exercise the same tall-shape + idempotent-upsert semantics the ingest and
// Whoop sync produce, then read back through fetchDashboardData.

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Same guard as the other integration files: these tests delete rows between
// cases and must never target the persistent dev/prod branches.
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

// Every row in this file is scoped by user_id (NFR-67) — a single test user, recreated fresh
// every case, backs every pre-existing test that isn't itself exercising multi-user scoping
// (those live in the AC-MU1/AC-MU2/AC-MU3/AC-MU12 block below, which creates its own users).
let testUserId: number;

beforeEach(async () => {
  // user_id has no ON DELETE cascade (OQ-3) — manual_macro_entries/daily_targets are cleared
  // defensively too, since they're shared across the whole test run (fileParallelism: false)
  // and a stray row left by another integration file would otherwise block `delete from users`.
  await sql`delete from biometric_readings`;
  await sql`delete from manual_macro_entries`;
  await sql`delete from daily_targets`;
  await sql`delete from users`;
  const [user] = await sql`insert into users (email) values ('dashboard-read-test@example.com') returning id`;
  testUserId = user.id;
});

const bodyFat = (readingDate: string, value: number) =>
  upsertReading({
    userId: testUserId,
    source: "fitdays",
    metric: "body_fat_pct",
    readingDate,
    value,
    unit: "%",
    aggregation: "latest",
    rawPayload: { date: `${readingDate} 07:30:00 -0500`, qty: value },
  });

const whoopMetric = (metric: string, readingDate: string, value: number, unit: string | null) =>
  upsertReading({
    userId: testUserId,
    source: "whoop",
    metric,
    readingDate,
    value,
    unit,
    aggregation: "latest",
    rawPayload: { seeded: true },
  });

describe("fetchDashboardData — tall-shape join on the shared date key", () => {
  it("AC-D8/NFR-2: metrics from different sources land on the same axis slot for the same day", async () => {
    await bodyFat("2026-07-14", 18.4);
    await bodyFat("2026-07-16", 18.2);
    await whoopMetric("day_strain", "2026-07-14", 14.2, null);
    await whoopMetric("recovery_score", "2026-07-16", 72, "%");
    await whoopMetric("hrv", "2026-07-16", 68, "ms");

    const data = await fetchDashboardData(3, testUserId);

    // Axis ends at the latest reading day across every dashboard metric.
    expect(data.axis).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
    expect(data.series.bodyFatPct).toEqual([18.4, null, 18.2]);
    expect(data.series.dayStrain).toEqual([14.2, null, null]);
    expect(data.series.recoveryScore).toEqual([null, null, 72]);
    expect(data.series.hrv).toEqual([null, null, 68]);
  });

  it("AC-N4: Fitdays weight rows land on the shared axis with their stored unit", async () => {
    await bodyFat("2026-07-15", 18.3);
    await upsertReading({
      userId: testUserId,
      source: "fitdays",
      metric: "weight",
      readingDate: "2026-07-14",
      value: 180.4,
      unit: "lb",
      aggregation: "latest",
      rawPayload: { date: "2026-07-14 07:30:00 -0500", qty: 180.4 },
    });

    const data = await fetchDashboardData(2, testUserId);

    expect(data.axis).toEqual(["2026-07-14", "2026-07-15"]);
    expect(data.series.weight).toEqual([180.4, null]);
    // Unit read from the stored row, never assumed (NFR-16 converts at
    // render time; the read path reports what was stored).
    expect(data.units.weight).toBe("lb");
  });

  it("NFR-2: only days inside the requested window are returned", async () => {
    await bodyFat("2026-06-01", 19.5);
    await bodyFat("2026-07-15", 18.3);
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(2, testUserId);

    expect(data.axis).toEqual(["2026-07-15", "2026-07-16"]);
    expect(data.series.bodyFatPct).toEqual([18.3, 18.2]);
  });
});

describe("fetchDashboardData — idempotent read path (NFR-3)", () => {
  it("NFR-3: a re-sent day renders latest-value-wins with no duplicate points", async () => {
    await bodyFat("2026-07-16", 18.5);
    // The scale re-sends the day after a recalibration: same key, new value.
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(1, testUserId);

    expect(data.axis).toEqual(["2026-07-16"]);
    // One slot, one value — the latest. A duplicate point would surface as
    // either a second axis day or a wrong value here.
    expect(data.series.bodyFatPct).toEqual([18.2]);
  });

  it("README convention: a cumulative-metric full re-send merges sample-for-sample without double-counting", async () => {
    const points = [
      { date: "2026-07-16 08:00:00 -0500", qty: 3000 },
      { date: "2026-07-16 12:00:00 -0500", qty: 4500 },
    ];
    const send = () =>
      upsertReading({
        userId: testUserId,
        source: "fitdays",
        metric: "body_fat_pct", // stand-in metric: the merge machinery is metric-agnostic
        readingDate: "2026-07-16",
        value: 7500,
        unit: "count",
        aggregation: "sum",
        rawPayload: { points },
      });
    await send();
    await send(); // full re-send of the identical day

    const data = await fetchDashboardData(1, testUserId);

    // 7500, not 15000: the merge replaced sample-for-sample by timestamp.
    expect(data.series.bodyFatPct).toEqual([7500]);
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

const bodyFatFor = (userId: number, readingDate: string, value: number) =>
  upsertReading({
    userId,
    source: "fitdays",
    metric: "body_fat_pct",
    readingDate,
    value,
    unit: "%",
    aggregation: "latest",
    rawPayload: { date: `${readingDate} 07:30:00 -0500`, qty: value },
  });

describe("fetchDashboardData — per-user scoping (AC-MU1/AC-MU2/AC-MU3/AC-MU12)", () => {
  it("AC-MU1: a user with zero readings of their own sees an empty axis, even when another user has readings", async () => {
    const otherUserId = await createUser("other-mu1@example.com");
    const userId = await createUser("me-mu1@example.com");
    await bodyFatFor(otherUserId, "2026-07-14", 18.4);

    const data = await fetchDashboardData(7, userId);

    expect(data.axis).toEqual([]);
    expect(data.latestDay).toBeNull();
  });

  it("AC-MU2: two users each with a reading for the identical (source, metric, date) triple coexist independently", async () => {
    const userA = await createUser("a-mu2@example.com");
    const userB = await createUser("b-mu2@example.com");
    await bodyFatFor(userA, "2026-07-16", 18.2);
    await bodyFatFor(userB, "2026-07-16", 22.7);

    const dataA = await fetchDashboardData(1, userA);
    const dataB = await fetchDashboardData(1, userB);

    expect(dataA.series.bodyFatPct).toEqual([18.2]);
    expect(dataB.series.bodyFatPct).toEqual([22.7]);
  });

  it("AC-MU3: a user's axis end date is derived only from their own rows, never a more recent reading from another user", async () => {
    const userA = await createUser("a-mu3@example.com");
    const userB = await createUser("b-mu3@example.com");
    await bodyFatFor(userA, "2026-07-10", 18.0);
    await bodyFatFor(userB, "2026-07-20", 22.0); // more recent, but belongs to userB

    const dataA = await fetchDashboardData(3, userA);

    expect(dataA.latestDay).toBe("2026-07-10");
    expect(dataA.axis).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
  });

  it("AC-MU12: migration continuity — a user's pre-existing rows are still returned once scoped onto their own user_id", async () => {
    const userId = await createUser("albert-mu12@example.com");
    await bodyFatFor(userId, "2026-07-14", 18.4);
    await bodyFatFor(userId, "2026-07-16", 18.2);

    const data = await fetchDashboardData(3, userId);

    expect(data.axis).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
    expect(data.series.bodyFatPct).toEqual([18.4, null, 18.2]);
  });
});

describe("fetchDashboardData — empty and partial states (AC-D13, NFR-8)", () => {
  it("AC-D13: days with no data render as null gaps, not zeros", async () => {
    await bodyFat("2026-07-13", 18.6);
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(4, testUserId);

    expect(data.series.bodyFatPct).toEqual([18.6, null, null, 18.2]);
    expect(data.series.bodyFatPct).not.toContain(0);
    // A metric with no rows at all is all gaps, same length as the axis.
    expect(data.series.leanBodyMass).toEqual([null, null, null, null]);
  });

  it("NFR-8: an empty database yields an empty axis and no error", async () => {
    const data = await fetchDashboardData(30, testUserId);

    expect(data.latestDay).toBeNull();
    expect(data.axis).toEqual([]);
    expect(data.series.bodyFatPct).toEqual([]);
  });

  it("NFR-2: units are read from the stored rows, never assumed", async () => {
    await whoopMetric("sleep_duration", "2026-07-16", 7.4, "hr");
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(1, testUserId);

    expect(data.units.sleepDuration).toBe("hr");
    expect(data.units.bodyFatPct).toBe("%");
    // No rows for this metric in the window -> no unit to claim.
    expect(data.units.dayStrain).toBeNull();
  });
});
