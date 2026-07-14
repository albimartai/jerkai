// Maps a Health Auto Export "REST API Automation" JSON payload into
// biometric_readings rows. Field names follow the schema published at
// github.com/Lybron/health-auto-export (wiki: API Export — JSON Format).
//
// Timezone convention (unified schema, decided 2026-07-14): reading_date is
// the DEVICE-LOCAL calendar day. Health Auto Export sends timestamps as
// local time with an explicit UTC offset ("yyyy-MM-dd HH:mm:ss ±HHMM" —
// verified against all 6,848 Production rows: every one carries -0500/-0600,
// i.e. America/Chicago), so the leading date component already IS the local
// day. extractReadingDate() enforces this by accepting only offset-bearing
// (or bare-date) formats and rejecting ISO-8601/UTC "Z" forms, so a future
// format change surfaces as an ingest error + alert instead of silently
// bucketing evening readings onto the next UTC day.
//
// Unit convention: values and units are stored exactly as sent, never
// converted. Verified against all Production history 2026-07-14:
// weight_body_mass and lean_body_mass arrive uniformly in lb (756 rows each,
// Dec 2023 → today), so no reconciliation is needed; the stored `unit`
// column remains the source of truth should Health Auto Export's unit
// settings ever change.

export type HealthExportDataPoint = {
  date?: string; // "yyyy-MM-dd HH:mm:ss Z" (or "yyyy-MM-dd" for aggregated sleep)
  qty?: number;
  [key: string]: unknown;
};

export type HealthExportMetric = {
  name?: string;
  units?: string;
  data?: HealthExportDataPoint[];
};

export type HealthExportPayload = {
  data?: {
    metrics?: HealthExportMetric[];
  };
};

// Every source that can appear in biometric_readings and sync_runs. The
// ingest route logs one sync_runs row per source per run, and /status
// renders one lane per source — keep all three in sync via this list.
export const READING_SOURCES = ["fitdays", "whoop", "apple_health"] as const;

export type ReadingSource = (typeof READING_SOURCES)[number];

export type MappedReading = {
  source: ReadingSource;
  metric: string;
  readingDate: string; // yyyy-MM-dd
  value: number;
  unit: string | null;
  rawPayload: HealthExportDataPoint;
};

export type MappedPayload = {
  readings: MappedReading[];
  ignoredMetrics: string[];
  errors: string[];
};

// Device attribution is by metric type, not by HealthKit's per-point source
// string: body composition only comes from the Fitdays scale, HRV/RHR/sleep
// only from Whoop, and step_count is HealthKit's merged cross-device
// aggregate, so it's tagged 'apple_health' rather than either device.
const METRIC_MAP: Record<string, { source: ReadingSource; metric: string }> = {
  weight_body_mass: { source: "fitdays", metric: "weight" },
  body_fat_percentage: { source: "fitdays", metric: "body_fat_pct" },
  body_mass_index: { source: "fitdays", metric: "bmi" },
  // HealthKit has no muscle-mass identifier — Fitdays' guardrail arrives as
  // lean_body_mass. Resolved 2026-07-14 against real backfilled data: the
  // value equals (1 - body_fat_pct) x weight to within rounding on every
  // spot-checked day, so it is genuinely Lean Body Mass, not Fitdays'
  // separate "Muscle Mass" reading. The stored name is correct.
  lean_body_mass: { source: "fitdays", metric: "lean_body_mass" },
  heart_rate_variability: { source: "whoop", metric: "hrv" },
  resting_heart_rate: { source: "whoop", metric: "rhr" },
  step_count: { source: "apple_health", metric: "step_count" },
};

// Whoop's "sleep performance %" is proprietary and never reaches HealthKit
// (same reason Recovery Score doesn't), so the sleep guardrail stores total
// sleep duration from sleep_analysis instead.
const SLEEP_METRIC_NAME = "sleep_analysis";

// Accepted date shapes, both of which make the leading component the
// device-local calendar day:
//   "yyyy-MM-dd HH:mm:ss ±HHMM"  — Health Auto Export's standard format
//   "yyyy-MM-dd"                 — aggregated sleep_analysis
// Anything else (notably ISO-8601 "yyyy-MM-ddTHH:mm:ssZ", whose leading
// component would be the UTC day) is rejected so it surfaces as an ingest
// error rather than a silently wrong reading_date.
const LOCAL_DAY_FORMAT = /^(\d{4}-\d{2}-\d{2})( \d{2}:\d{2}:\d{2} [+-]\d{4})?$/;

// Truncates a Health Auto Export timestamp to the device-local calendar day
// used as biometric_readings.reading_date — the shared date key all sources
// join on. Exported for direct unit testing.
export function extractReadingDate(point: HealthExportDataPoint): string | null {
  const raw = typeof point.date === "string" ? point.date : null;
  return raw?.match(LOCAL_DAY_FORMAT)?.[1] ?? null;
}

function extractSleepDuration(point: HealthExportDataPoint): number | null {
  // Aggregated sleep_analysis reports durations per phase; totalSleep (or the
  // uncategorized `asleep`) is the whole-night figure. Fall back to summing
  // phases for sources that only send the breakdown.
  for (const key of ["totalSleep", "asleep"]) {
    const value = point[key];
    if (typeof value === "number") return value;
  }
  const phases = ["core", "rem", "deep"]
    .map((key) => point[key])
    .filter((value): value is number => typeof value === "number");
  if (phases.length > 0) return phases.reduce((sum, value) => sum + value, 0);
  return null;
}

export function mapHealthExportPayload(payload: HealthExportPayload): MappedPayload {
  const readings: MappedReading[] = [];
  const ignoredMetrics: string[] = [];
  const errors: string[] = [];

  const metrics = payload.data?.metrics;
  if (!Array.isArray(metrics)) {
    return { readings, ignoredMetrics, errors: ["payload has no data.metrics array"] };
  }

  for (const metric of metrics) {
    const name = metric.name ?? "(unnamed)";
    const points = Array.isArray(metric.data) ? metric.data : [];
    const isSleep = name === SLEEP_METRIC_NAME;
    const mapping = isSleep
      ? ({ source: "whoop", metric: "sleep_duration" } as const)
      : METRIC_MAP[name];

    if (!mapping) {
      ignoredMetrics.push(name);
      continue;
    }

    for (const point of points) {
      const readingDate = extractReadingDate(point);
      if (!readingDate) {
        errors.push(`${name}: data point has no parseable date`);
        continue;
      }
      const value = isSleep ? extractSleepDuration(point) : point.qty;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${name} (${readingDate}): data point has no numeric value`);
        continue;
      }
      readings.push({
        source: mapping.source,
        metric: mapping.metric,
        readingDate,
        value,
        unit: metric.units ?? null,
        rawPayload: point,
      });
    }
  }

  return { readings, ignoredMetrics, errors };
}
