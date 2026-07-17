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

beforeEach(async () => {
  await sql`delete from biometric_readings`;
});

const bodyFat = (readingDate: string, value: number) =>
  upsertReading({
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

    const data = await fetchDashboardData(3);

    // Axis ends at the latest reading day across every dashboard metric.
    expect(data.axis).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
    expect(data.series.bodyFatPct).toEqual([18.4, null, 18.2]);
    expect(data.series.dayStrain).toEqual([14.2, null, null]);
    expect(data.series.recoveryScore).toEqual([null, null, 72]);
    expect(data.series.hrv).toEqual([null, null, 68]);
  });

  it("NFR-2: only days inside the requested window are returned", async () => {
    await bodyFat("2026-06-01", 19.5);
    await bodyFat("2026-07-15", 18.3);
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(2);

    expect(data.axis).toEqual(["2026-07-15", "2026-07-16"]);
    expect(data.series.bodyFatPct).toEqual([18.3, 18.2]);
  });
});

describe("fetchDashboardData — idempotent read path (NFR-3)", () => {
  it("NFR-3: a re-sent day renders latest-value-wins with no duplicate points", async () => {
    await bodyFat("2026-07-16", 18.5);
    // The scale re-sends the day after a recalibration: same key, new value.
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(1);

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

    const data = await fetchDashboardData(1);

    // 7500, not 15000: the merge replaced sample-for-sample by timestamp.
    expect(data.series.bodyFatPct).toEqual([7500]);
  });
});

describe("fetchDashboardData — empty and partial states (AC-D13, NFR-8)", () => {
  it("AC-D13: days with no data render as null gaps, not zeros", async () => {
    await bodyFat("2026-07-13", 18.6);
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(4);

    expect(data.series.bodyFatPct).toEqual([18.6, null, null, 18.2]);
    expect(data.series.bodyFatPct).not.toContain(0);
    // A metric with no rows at all is all gaps, same length as the axis.
    expect(data.series.leanBodyMass).toEqual([null, null, null, null]);
  });

  it("NFR-8: an empty database yields an empty axis and no error", async () => {
    const data = await fetchDashboardData(30);

    expect(data.latestDay).toBeNull();
    expect(data.axis).toEqual([]);
    expect(data.series.bodyFatPct).toEqual([]);
  });

  it("NFR-2: units are read from the stored rows, never assumed", async () => {
    await whoopMetric("sleep_duration", "2026-07-16", 7.4, "hr");
    await bodyFat("2026-07-16", 18.2);

    const data = await fetchDashboardData(1);

    expect(data.units.sleepDuration).toBe("hr");
    expect(data.units.bodyFatPct).toBe("%");
    // No rows for this metric in the window -> no unit to claim.
    expect(data.units.dayStrain).toBeNull();
  });
});
