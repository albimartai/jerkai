/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Smart-Scale Integration
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { describe, expect, it } from "vitest";

import type { WithingsMeasureGroup } from "@/lib/withings-api";
import { localDay, mapWithingsData } from "@/lib/withings-map";

// Fixture shapes below follow this planning session's own research (§0/§1,
// NFR-104): measure type 1 = weight, 5 = fat-free mass ("lean_body_mass"),
// 6 = fat ratio ("body_fat_pct"); a measuregrp's `date` is a Unix instant and
// values are scaled by `value * 10^unit`, per the documented getmeas
// contract. OQ-5's default (also unverified against live docs) is that
// getmeas supplies ONE timezone value per response body, not per measuregrp
// — so mapWithingsData takes a single shared timezone, unlike
// lib/whoop-map.ts#mapWhoopData's per-record timezone_offset. The build
// agent re-confirms all of this against developer.withings.com before
// finalizing lib/withings-api.ts/lib/withings-map.ts (NFR-104); this stub
// asserts the PRD's stated contract, not an independently-verified one.

const WEIGHT_TYPE = 1;
const FAT_FREE_MASS_TYPE = 5;
const FAT_RATIO_TYPE = 6;
// An arbitrary OTHER measure type — not asserted to be any particular real
// Withings biomarker, only used to prove mapWithingsData never emits a
// metric for a type outside {1, 5, 6} (AC-WS16).
const OTHER_TYPE = 88;

const CHICAGO_TZ = "America/Chicago";

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

// Same instant lib/whoop-map.test.ts uses for its own local-day fixture:
// 2026-07-10T03:55:00Z is 22:55 on 2026-07-09 in Chicago (CDT, UTC-5).
const GROUP_DATE = epochSeconds("2026-07-10T03:55:00.000Z");

const MEASURE_GROUP: WithingsMeasureGroup = {
  grpid: 1001,
  date: GROUP_DATE,
  measures: [
    { type: WEIGHT_TYPE, value: 850, unit: -1 }, // 85.0 kg
    { type: FAT_FREE_MASS_TYPE, value: 650, unit: -1 }, // 65.0 kg
    { type: FAT_RATIO_TYPE, value: 235, unit: -1 }, // 23.5 %
  ],
};

describe("localDay — device-local calendar day from a Withings measuregrp instant (AC-WS17, NFR-107, OQ-5)", () => {
  it("AC-WS17: resolves the user-local day from a shared body-level IANA timezone, not the server's UTC day", () => {
    expect(localDay(GROUP_DATE, CHICAGO_TZ)).toBe("2026-07-09");
  });

  it("NFR-107: returns null instead of guessing when the timezone is missing or malformed", () => {
    expect(localDay(GROUP_DATE, undefined)).toBeNull();
    expect(localDay(GROUP_DATE, "")).toBeNull();
    expect(localDay(GROUP_DATE, "not-a-real-zone")).toBeNull();
  });

  it("NFR-107: returns null for a missing or non-finite epoch instead of guessing", () => {
    expect(localDay(undefined as unknown as number, CHICAGO_TZ)).toBeNull();
    expect(localDay(Number.NaN, CHICAGO_TZ)).toBeNull();
  });
});

describe("mapWithingsData — units stored unconverted (AC-WS15, NFR-102)", () => {
  it("AC-WS15: stores weight and lean_body_mass in kg exactly as Withings sent them, never converted to lb at ingest", () => {
    const { readings } = mapWithingsData({ measureGroups: [MEASURE_GROUP], timezone: CHICAGO_TZ });
    const weight = readings.find((r) => r.metric === "weight");
    const leanMass = readings.find((r) => r.metric === "lean_body_mass");
    expect(weight).toMatchObject({ value: 85, unit: "kg" });
    expect(leanMass).toMatchObject({ value: 65, unit: "kg" });
  });

  it("maps body_fat_pct from the Fat Ratio measure type (6) as a unitless percentage", () => {
    const { readings } = mapWithingsData({ measureGroups: [MEASURE_GROUP], timezone: CHICAGO_TZ });
    const bodyFat = readings.find((r) => r.metric === "body_fat_pct");
    expect(bodyFat).toMatchObject({ value: 23.5, unit: "%" });
  });

  it("AC-WS17: dates every mapped reading to the shared device-local day", () => {
    const { readings } = mapWithingsData({ measureGroups: [MEASURE_GROUP], timezone: CHICAGO_TZ });
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.every((r) => r.readingDate === "2026-07-09")).toBe(true);
  });

  it("every mapped reading is tagged source='withings'", () => {
    const { readings } = mapWithingsData({ measureGroups: [MEASURE_GROUP], timezone: CHICAGO_TZ });
    expect(readings.every((r) => r.source === "withings")).toBe(true);
  });
});

describe("mapWithingsData — BMI and out-of-scope biomarkers are never mapped (AC-WS16, DL-2026-08-26-a3)", () => {
  it("AC-WS16: never emits a bmi reading, even when other Withings measure types are present in the group", () => {
    const withExtraType: WithingsMeasureGroup = {
      ...MEASURE_GROUP,
      measures: [...MEASURE_GROUP.measures, { type: OTHER_TYPE, value: 240, unit: -1 }],
    };
    const { readings } = mapWithingsData({ measureGroups: [withExtraType], timezone: CHICAGO_TZ });
    expect(readings.find((r) => r.metric === "bmi")).toBeUndefined();
    expect(readings.map((r) => r.metric).sort()).toEqual(
      ["body_fat_pct", "lean_body_mass", "weight"].sort(),
    );
  });

  it("AC-WS16: maps only weight/lean_body_mass/body_fat_pct — no other Withings biomarker is ever emitted", () => {
    const { readings } = mapWithingsData({ measureGroups: [MEASURE_GROUP], timezone: CHICAGO_TZ });
    expect(readings.map((r) => r.metric).sort()).toEqual(
      ["body_fat_pct", "lean_body_mass", "weight"].sort(),
    );
  });
});

describe("mapWithingsData — undatable group is skipped, never guessed (NFR-107)", () => {
  it("skips (and reports) a measure group when the shared timezone is missing, rather than defaulting to UTC", () => {
    const { readings, skipped } = mapWithingsData({
      measureGroups: [MEASURE_GROUP],
      timezone: undefined,
    });
    expect(readings).toEqual([]);
    expect(skipped.length).toBeGreaterThan(0);
  });
});
