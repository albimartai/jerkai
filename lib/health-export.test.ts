import { describe, expect, it } from "vitest";

import {
  extractReadingDate,
  mapHealthExportPayload,
  mergeDailyPoints,
  type HealthExportDataPoint,
  type HealthExportPayload,
} from "@/lib/health-export";

function payloadWith(
  metrics: { name?: string; units?: string; data?: HealthExportDataPoint[] }[],
): HealthExportPayload {
  return { data: { metrics } };
}

const POINT = { date: "2026-07-09 07:30:00 -0500", qty: 42 };

describe("extractReadingDate — device-local calendar day convention", () => {
  it("keeps the local day for a reading shortly after local midnight", () => {
    // 00:12 local on the 15th is still 05:12 UTC on the 15th here, but the
    // point of the convention is that UTC never enters the picture at all:
    // the local date component is stored verbatim.
    expect(extractReadingDate({ date: "2025-07-15 00:12:00 -0500" })).toBe("2025-07-15");
  });

  it("keeps the local day for an evening reading whose UTC day is the NEXT day", () => {
    // 23:31 -0500 is 04:31 UTC on the 12th — truncating against UTC would
    // mis-bucket this onto 2026-07-12. 1,918 backfilled Production rows sit
    // in this window.
    expect(extractReadingDate({ date: "2026-07-11 23:31:00 -0500" })).toBe("2026-07-11");
  });

  it("accepts both DST offsets Health Auto Export actually sends, and positive offsets", () => {
    expect(extractReadingDate({ date: "2026-01-15 06:00:00 -0600" })).toBe("2026-01-15");
    expect(extractReadingDate({ date: "2026-07-09 07:30:00 +0200" })).toBe("2026-07-09");
  });

  it("accepts a bare date (aggregated daily format)", () => {
    expect(extractReadingDate({ date: "2026-07-09" })).toBe("2026-07-09");
  });

  it("rejects ISO-8601/UTC formats whose leading component is the UTC day", () => {
    // If Health Auto Export ever switched to UTC timestamps, silently slicing
    // the first 10 chars would shift evening readings onto the wrong day —
    // these must fail loudly (ingest error + alert) instead.
    expect(extractReadingDate({ date: "2026-07-12T04:31:00Z" })).toBeNull();
    expect(extractReadingDate({ date: "2026-07-12T04:31:00+00:00" })).toBeNull();
    expect(extractReadingDate({ date: "2026-07-12 04:31:00Z" })).toBeNull();
  });

  it("rejects missing, non-string, and malformed dates", () => {
    expect(extractReadingDate({})).toBeNull();
    expect(extractReadingDate({ date: undefined })).toBeNull();
    expect(extractReadingDate({ date: "not-a-date" })).toBeNull();
    expect(extractReadingDate({ date: "2026-7-9 07:30:00 -0500" })).toBeNull();
  });
});

describe("mapHealthExportPayload — source/metric tagging (Fitdays-only pipe)", () => {
  // Every field name currently sent by Health Auto Export that the app maps,
  // with the source/metric pair each must land under. A new mapping added to
  // METRIC_MAP without a row here should fail the count test below.
  const expectedTags: [string, string, string][] = [
    ["weight_body_mass", "fitdays", "weight"],
    ["body_fat_percentage", "fitdays", "body_fat_pct"],
    ["body_mass_index", "fitdays", "bmi"],
    ["lean_body_mass", "fitdays", "lean_body_mass"],
  ];

  it.each(expectedTags)("tags %s as %s/%s", (name, source, metric) => {
    const result = mapHealthExportPayload(
      payloadWith([{ name, units: "unit", data: [POINT] }]),
    );
    expect(result.errors).toEqual([]);
    expect(result.readings).toEqual([
      {
        source,
        metric,
        readingDate: "2026-07-09",
        value: 42,
        unit: "unit",
        aggregation: "latest",
        rawPayload: POINT,
      },
    ]);
  });

  it("covers exactly the currently-mapped metric names (update this test when METRIC_MAP grows)", () => {
    const allMapped = expectedTags.map(([name]) => name);
    const result = mapHealthExportPayload(
      payloadWith(allMapped.map((name) => ({ name, data: [POINT] }))),
    );
    expect(result.readings).toHaveLength(allMapped.length);
    expect(result.ignoredMetrics).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("ignores every retired Whoop-era metric — they must never write rows again", () => {
    // Session 8: HRV/RHR/sleep come from the direct Whoop API and step_count
    // was deleted as unsalvageable. If any of these ever map again, a stray
    // phone re-export could recreate deleted step rows or overwrite
    // authoritative whoop-direct rows with HealthKit-merged values.
    const retired = [
      "heart_rate_variability",
      "resting_heart_rate",
      "step_count",
      "sleep_analysis",
    ];
    const result = mapHealthExportPayload(
      payloadWith(
        retired.map((name) => ({
          name,
          data: [name === "sleep_analysis" ? { date: "2026-07-09", totalSleep: 7 } : POINT],
        })),
      ),
    );
    expect(result.readings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.ignoredMetrics).toEqual(retired);
  });
});

describe("mergeDailyPoints — cross-call accumulation without double-counting", () => {
  // No currently-mapped metric is cumulative (step_count retired in
  // Session 8), but the merge stays — lib/readings.ts still routes any
  // future aggregation:"sum" metric through it.
  const a = { date: "2026-07-09 08:00:00 -0500", qty: 500 };
  const b = { date: "2026-07-09 12:30:00 -0500", qty: 3000 };
  const c = { date: "2026-07-09 22:15:00 -0500", qty: 100 };

  it("accumulates disjoint batches (a day split across Since Last Sync calls)", () => {
    const first = mergeDailyPoints(undefined, [a, b]);
    expect(first.total).toBe(3500);
    const second = mergeDailyPoints({ points: first.points }, [c]);
    expect(second.total).toBe(3600);
    expect(second.points).toEqual([a, b, c]);
  });

  it("is idempotent on a full re-send: same timestamps replace, never add", () => {
    const first = mergeDailyPoints(undefined, [a, b, c]);
    const resend = mergeDailyPoints({ points: first.points }, [a, b, c]);
    expect(resend.total).toBe(3600);
    expect(resend.points).toEqual([a, b, c]);
  });

  it("lets an incoming sample with an existing timestamp win (recomputed re-export)", () => {
    const first = mergeDailyPoints(undefined, [a, b]);
    const updated = mergeDailyPoints({ points: first.points }, [{ ...b, qty: 2500 }]);
    expect(updated.total).toBe(3000);
  });

  it("folds a legacy pre-fix single-point raw_payload into the merge", () => {
    // Pre-fix rows stored one sample object directly; a re-export of the day
    // carries the same timestamp, so the legacy sample is replaced in place.
    const legacy = { date: "2026-07-09 22:15:00 -0500", qty: 12.5, source: "Albi iPhone" };
    const merged = mergeDailyPoints(legacy, [a, b, { ...c }]);
    expect(merged.total).toBe(3600);
    expect(merged.points).toEqual([a, b, c]);
  });

  it("ignores unusable stored payloads and non-numeric stored qty", () => {
    expect(mergeDailyPoints(null, [a]).total).toBe(500);
    expect(mergeDailyPoints("garbage", [a]).total).toBe(500);
    expect(mergeDailyPoints({ points: "nope" }, [a]).total).toBe(500);
    const merged = mergeDailyPoints({ points: [{ date: "2026-07-09 01:00:00 -0500" }] }, [a]);
    expect(merged.total).toBe(500);
    expect(merged.points).toHaveLength(2);
  });
});

describe("mapHealthExportPayload — unmapped metrics", () => {
  it("ignores and reports an unmapped metric without crashing", () => {
    const result = mapHealthExportPayload(
      payloadWith([
        { name: "active_energy", units: "kcal", data: [POINT] },
        { name: "weight_body_mass", units: "lb", data: [POINT] },
      ]),
    );
    expect(result.ignoredMetrics).toEqual(["active_energy"]);
    expect(result.errors).toEqual([]);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0].metric).toBe("weight");
  });

  it("reports an unnamed metric as ignored", () => {
    const result = mapHealthExportPayload(payloadWith([{ units: "kcal", data: [POINT] }]));
    expect(result.ignoredMetrics).toEqual(["(unnamed)"]);
    expect(result.readings).toEqual([]);
  });
});

describe("mapHealthExportPayload — malformed input", () => {
  it("reports a payload with no data.metrics array", () => {
    for (const bad of [{}, { data: {} }, { data: { metrics: "nope" } }] as HealthExportPayload[]) {
      const result = mapHealthExportPayload(bad);
      expect(result.readings).toEqual([]);
      expect(result.errors).toEqual(["payload has no data.metrics array"]);
    }
  });

  it("reports data points with a missing or unparseable date", () => {
    const result = mapHealthExportPayload(
      payloadWith([
        {
          name: "weight_body_mass",
          data: [{ qty: 180 }, { date: "not-a-date", qty: 180 }, POINT],
        },
      ]),
    );
    expect(result.errors).toEqual([
      "weight_body_mass: data point has no parseable date",
      "weight_body_mass: data point has no parseable date",
    ]);
    expect(result.readings).toHaveLength(1);
  });

  it("reports data points with a missing or non-numeric value, keeps good ones", () => {
    const result = mapHealthExportPayload(
      payloadWith([
        {
          name: "body_fat_percentage",
          data: [
            { date: "2026-07-07 06:00:00 -0500" }, // no qty
            { date: "2026-07-08 06:00:00 -0500", qty: Number.NaN },
            { date: "2026-07-09 06:00:00 -0500", qty: 18.3 },
          ],
        },
      ]),
    );
    expect(result.errors).toEqual([
      "body_fat_percentage (2026-07-07): data point has no numeric value",
      "body_fat_percentage (2026-07-08): data point has no numeric value",
    ]);
    expect(result.readings.map((r) => r.value)).toEqual([18.3]);
  });

  it("handles a metric with a missing data array", () => {
    const result = mapHealthExportPayload(payloadWith([{ name: "weight_body_mass" }]));
    expect(result.readings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.ignoredMetrics).toEqual([]);
  });

  it("stores a missing units field as null", () => {
    const result = mapHealthExportPayload(
      payloadWith([{ name: "body_mass_index", data: [POINT] }]),
    );
    expect(result.readings[0].unit).toBeNull();
  });
});
