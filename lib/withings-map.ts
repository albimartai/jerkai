import type { WithingsMeasureGroup } from "@/lib/withings-api";

// Maps Withings measure.getmeas records into biometric_readings rows
// (source = 'withings'). Pure functions — the sync route does the fetching
// and writing.
//
// NFR-104 — live-verified 2026-08-27 against a real getmeas response from a
// real connected account (standalone diagnostic script, not committed to
// this branch):
//   - Measure types: 1 = weight (kg), 5 = fat-free mass ("lean_body_mass",
//     kg), 6 = fat ratio ("body_fat_pct", %). No other type is ever mapped
//     (AC-WS16) — Withings has no native BMI type, and no other biomarker
//     has a dashboard consumer today (§0). Confirmed against a real
//     measuregrp containing all three types together.
//   - A measuregrp's raw numeric value is scaled by `value * 10^unit`.
//     Confirmed (e.g. value 70306762, unit -6 -> 70.306762 kg).
//   - CORRECTED (was wrong): `timezone` is NOT only a single body-level
//     field. A real response carried a per-group `timezone` field
//     (WithingsMeasureGroup#timezone) in addition to the body-level one —
//     they matched in the one sample observed, but are not guaranteed to
//     in general (e.g. a reading synced while traveling, in a different
//     zone than the account's registered one). The original assumption
//     here (OQ-5's default: one shared body-level value, applied uniformly)
//     was live-falsified, not confirmed — mapWithingsData now prefers each
//     group's own timezone and falls back to the shared body-level value
//     only when a group lacks its own.
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
  // Groups that could not be dated (no usable timezone, per-group or shared)
  // — reported on the sync run so gaps are visible, never guessed (NFR-107).
  skipped: string[];
};

// User-local calendar day of a Unix epoch instant, given an IANA timezone —
// the caller resolves which one to pass (a measuregrp's own, or the shared
// body-level fallback, see mapWithingsData) — never a guess: null when
// either input is missing or malformed.
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
  // Shared response-body-level timezone — used only as a fallback for a
  // group that lacks its own `timezone` field (see the loop below).
  timezone: string | undefined;
}): MappedWithingsData {
  const readings: WithingsReading[] = [];
  const skipped: string[] = [];

  for (const group of input.measureGroups) {
    // Prefer this group's own timezone (confirmed to exist live) over the
    // shared body-level fallback — a group's own reading time is the more
    // specific, more correct signal when the two would ever disagree. Falls
    // back to the shared value whenever the group's own is unusable (absent
    // or malformed) rather than skipping outright, since the shared value
    // is still real API data, not a guess — only skip when neither resolves.
    const groupTimezone = typeof group.timezone === "string" ? group.timezone : undefined;
    const day = localDay(group.date, groupTimezone) ?? localDay(group.date, input.timezone);
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
