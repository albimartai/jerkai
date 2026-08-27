import type { WithingsMeasureGroup } from "@/lib/withings-api";

// Maps Withings measure.getmeas records into biometric_readings rows
// (source = 'withings'). Pure functions — the sync route does the fetching
// and writing.
//
// NFR-104 — OPEN RISK, not yet live-verified: the shapes below come from
// search against Withings' own API surface and third-party client
// implementations (developer.withings.com itself is JS-rendered and was not
// independently fetchable this session), NOT from a live OAuth exchange or
// a live getmeas call against a real connected account. As of this commit,
// no live token exchange or getmeas call has been performed — the Preview
// test this branch went through stopped at Withings' consent screen,
// before any code path here ever ran. Re-confirm all of the below (or file
// it as an explicit open risk in the PR) on the first real connect:
//   - Measure types: 1 = weight (kg), 5 = fat-free mass ("lean_body_mass",
//     kg), 6 = fat ratio ("body_fat_pct", %). No other type is ever mapped
//     (AC-WS16) — Withings has no native BMI type, and no other biomarker
//     has a dashboard consumer today (§0).
//   - A measuregrp's raw numeric value is scaled by `value * 10^unit`.
//   - `timezone` is a SINGLE field on the response body, not per-measuregrp
//     (unlike Whoop's per-record timezone_offset) — per a third-party-
//     documented example response ("timezone":"Europe/Dublin" alongside
//     measuregrps), not our own live call — so it is applied uniformly to
//     every measuregrp passed in.
//
// Units are stored exactly as Withings sends them (kg), never converted at
// ingest (§0/NFR-102, AC-WS15) — lib/dashboard/units.ts#toPounds already
// exists for the read-time kg->lb conversion and is not touched by this
// slice.

const WEIGHT_TYPE = 1;
const FAT_FREE_MASS_TYPE = 5;
const FAT_RATIO_TYPE = 6;

export type WithingsReading = {
  source: "withings";
  metric: string;
  readingDate: string; // yyyy-MM-dd, device-local (see localDay)
  value: number;
  unit: string | null;
  aggregation: "latest";
  rawPayload: unknown;
};

export type MappedWithingsData = {
  readings: WithingsReading[];
  // Groups that could not be dated (missing/malformed shared timezone) —
  // reported on the sync run so gaps are visible, never guessed (NFR-107).
  skipped: string[];
};

// User-local calendar day of a Unix epoch instant, using a shared IANA
// timezone (the whole response's single `timezone` field, OQ-5) — never a
// guess: null when either input is missing or malformed.
export function localDay(epochSeconds: number, timezone: string | undefined): string | null {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  if (typeof timezone !== "string" || timezone.length === 0) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // en-CA formats as yyyy-MM-dd directly.
    const formatted = formatter.format(new Date(epochSeconds * 1000));
    return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
  } catch {
    // Intl throws RangeError on an unrecognized IANA zone name.
    return null;
  }
}

function scaledValue(measure: { value: number; unit: number }): number {
  return measure.value * 10 ** measure.unit;
}

export function mapWithingsData(input: {
  measureGroups: WithingsMeasureGroup[];
  timezone: string | undefined;
}): MappedWithingsData {
  const readings: WithingsReading[] = [];
  const skipped: string[] = [];

  for (const group of input.measureGroups) {
    const day = localDay(group.date, input.timezone);
    if (!day) {
      skipped.push(`measuregrp ${group.grpid}: no usable shared timezone`);
      continue;
    }
    for (const measure of group.measures) {
      const metric =
        measure.type === WEIGHT_TYPE
          ? "weight"
          : measure.type === FAT_FREE_MASS_TYPE
            ? "lean_body_mass"
            : measure.type === FAT_RATIO_TYPE
              ? "body_fat_pct"
              : null;
      if (!metric) continue; // out-of-scope measure type (AC-WS16) — never mapped
      readings.push({
        source: "withings",
        metric,
        readingDate: day,
        value: scaledValue(measure),
        unit: metric === "body_fat_pct" ? "%" : "kg",
        aggregation: "latest",
        rawPayload: group,
      });
    }
  }

  return { readings, skipped };
}
