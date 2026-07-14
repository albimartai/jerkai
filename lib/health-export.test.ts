import { describe, expect, it } from "vitest";

import {
  extractReadingDate,
  mapHealthExportPayload,
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

  it("accepts a bare date (aggregated sleep_analysis format)", () => {
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

describe("mapHealthExportPayload — source/metric tagging", () => {
  // Every field name currently sent by Health Auto Export that the app maps,
  // with the source/metric pair each must land under. A new mapping added to
  // METRIC_MAP without a row here should fail the count test below.
  const expectedTags: [string, string, string][] = [
    ["weight_body_mass", "fitdays", "weight"],
    ["body_fat_percentage", "fitdays", "body_fat_pct"],
    ["body_mass_index", "fitdays", "bmi"],
    ["lean_body_mass", "fitdays", "lean_body_mass"],
    ["heart_rate_variability", "whoop", "hrv"],
    ["resting_heart_rate", "whoop", "rhr"],
    ["step_count", "apple_health", "step_count"],
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
        rawPayload: POINT,
      },
    ]);
  });

  it("tags sleep_analysis as whoop/sleep_duration using totalSleep", () => {
    const point = { date: "2026-07-09", totalSleep: 7.4, core: 4, rem: 2, deep: 1 };
    const result = mapHealthExportPayload(
      payloadWith([{ name: "sleep_analysis", units: "hr", data: [point] }]),
    );
    expect(result.errors).toEqual([]);
    expect(result.readings).toEqual([
      {
        source: "whoop",
        metric: "sleep_duration",
        readingDate: "2026-07-09",
        value: 7.4,
        unit: "hr",
        rawPayload: point,
      },
    ]);
  });

  it("falls back to `asleep`, then to summing phases, for sleep_analysis", () => {
    const asleepOnly = { date: "2026-07-08", asleep: 6.9 };
    const phasesOnly = { date: "2026-07-09", core: 4, rem: 1.5, deep: 1 };
    const result = mapHealthExportPayload(
      payloadWith([{ name: "sleep_analysis", units: "hr", data: [asleepOnly, phasesOnly] }]),
    );
    expect(result.errors).toEqual([]);
    expect(result.readings.map((r) => r.value)).toEqual([6.9, 6.5]);
  });

  it("covers exactly the currently-mapped metric names (update this test when METRIC_MAP grows)", () => {
    const allMapped = [...expectedTags.map(([name]) => name), "sleep_analysis"];
    const result = mapHealthExportPayload(
      payloadWith(
        allMapped.map((name) => ({
          name,
          data: [name === "sleep_analysis" ? { date: "2026-07-09", totalSleep: 7 } : POINT],
        })),
      ),
    );
    expect(result.readings).toHaveLength(allMapped.length);
    expect(result.ignoredMetrics).toEqual([]);
    expect(result.errors).toEqual([]);
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
          name: "resting_heart_rate",
          data: [
            { date: "2026-07-07 06:00:00 -0500" }, // no qty
            { date: "2026-07-08 06:00:00 -0500", qty: Number.NaN },
            { date: "2026-07-09 06:00:00 -0500", qty: 51 },
          ],
        },
      ]),
    );
    expect(result.errors).toEqual([
      "resting_heart_rate (2026-07-07): data point has no numeric value",
      "resting_heart_rate (2026-07-08): data point has no numeric value",
    ]);
    expect(result.readings.map((r) => r.value)).toEqual([51]);
  });

  it("reports sleep_analysis points with no usable duration fields", () => {
    const result = mapHealthExportPayload(
      payloadWith([{ name: "sleep_analysis", data: [{ date: "2026-07-09", inBed: 8.1 }] }]),
    );
    expect(result.errors).toEqual([
      "sleep_analysis (2026-07-09): data point has no numeric value",
    ]);
    expect(result.readings).toEqual([]);
  });

  it("handles a metric with a missing data array", () => {
    const result = mapHealthExportPayload(payloadWith([{ name: "step_count" }]));
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
