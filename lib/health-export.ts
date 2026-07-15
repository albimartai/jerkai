// Maps a Health Auto Export "REST API Automation" JSON payload into
// biometric_readings rows. Field names follow the schema published at
// github.com/Lybron/health-auto-export (wiki: API Export — JSON Format).
//
// As of Session 8 this pipe carries FITDAYS DATA ONLY (weight, body fat %,
// BMI, lean body mass). Everything Whoop-related moved to the direct Whoop
// API integration (lib/whoop-*.ts): Whoop never wrote HRV or step count to
// HealthKit at all, and RHR/sleep now come from Whoop's own API — so the
// old heart_rate_variability / resting_heart_rate / sleep_analysis /
// step_count mappings are gone ON PURPOSE. Removing them (rather than
// leaving them dormant) means a stray phone-side re-export can neither
// recreate the deleted apple_health step_count rows nor overwrite
// authoritative Whoop-direct rows with HealthKit-merged values; retired
// metrics now land in ignoredMetrics, visibly.
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
// Storage shapes: single-measurement metrics store their one data point as
// raw_payload verbatim. Cumulative metrics (aggregation: "sum") store
// raw_payload = {points: [...]} with every contributing sample verbatim, and
// value = the sum over the merged samples — see mergeDailyPoints for why
// overwriting is never safe for these. No currently-mapped metric is
// cumulative (step_count, which the machinery was built for in Session 6,
// retired in Session 8) — the machinery stays for the next cumulative pipe.
//
// Unit convention: values and units are stored exactly as sent, never
// converted. Verified against all Production history 2026-07-14:
// weight_body_mass and lean_body_mass arrive uniformly in lb (756 rows each,
// Dec 2023 → today), so no reconciliation is needed; the stored `unit`
// column remains the source of truth should Health Auto Export's unit
// settings ever change.

import type { ReadingSource } from "@/lib/sources";

export type HealthExportDataPoint = {
  date?: string; // "yyyy-MM-dd HH:mm:ss Z" (or bare "yyyy-MM-dd")
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

// The sync_runs lanes this pipe can produce — every source that appears as a
// value in METRIC_MAP. Rejected requests (bad secret, malformed body) log a
// failure row for each of these, and only these: the whoop lane belongs to
// the Whoop sync route now, and a broken phone export must not poison it.
export const HEALTH_EXPORT_SOURCES = ["fitdays"] as const satisfies readonly ReadingSource[];

export type HealthExportSource = (typeof HEALTH_EXPORT_SOURCES)[number];

// Cumulative metrics store every contributing sample; single-measurement
// metrics store the one data point exactly as received.
export type DailyPoints = { points: HealthExportDataPoint[] };

// How a metric's value relates to its data points within one calendar day:
// "latest" — one measurement per day; a re-send replaces the stored value.
// "sum"    — cumulative; the day's value is the sum over all samples, which
//            arrive many-per-day and split across "Since Last Sync" calls,
//            so the upsert must merge samples by timestamp, never overwrite.
export type DailyAggregation = "latest" | "sum";

export type MappedReading = {
  source: HealthExportSource;
  metric: string;
  readingDate: string; // yyyy-MM-dd
  value: number;
  unit: string | null;
  aggregation: DailyAggregation;
  rawPayload: HealthExportDataPoint | DailyPoints;
};

export type MappedPayload = {
  readings: MappedReading[];
  ignoredMetrics: string[];
  errors: string[];
};

// Body composition comes only from the Fitdays scale — the sole remaining
// Apple Health data. See the header for why the Whoop-era mappings are gone.
const METRIC_MAP: Record<
  string,
  { source: HealthExportSource; metric: string; aggregation?: "sum" }
> = {
  weight_body_mass: { source: "fitdays", metric: "weight" },
  body_fat_percentage: { source: "fitdays", metric: "body_fat_pct" },
  body_mass_index: { source: "fitdays", metric: "bmi" },
  // HealthKit has no muscle-mass identifier — Fitdays' guardrail arrives as
  // lean_body_mass. Resolved 2026-07-14 against real backfilled data: the
  // value equals (1 - body_fat_pct) x weight to within rounding on every
  // spot-checked day, so it is genuinely Lean Body Mass, not Fitdays'
  // separate "Muscle Mass" reading. The stored name is correct.
  lean_body_mass: { source: "fitdays", metric: "lean_body_mass" },
};

// Accepted date shapes, both of which make the leading component the
// device-local calendar day:
//   "yyyy-MM-dd HH:mm:ss ±HHMM"  — Health Auto Export's standard format
//   "yyyy-MM-dd"                 — aggregated daily rows
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

// Coerces a stored raw_payload into its list of samples: the current
// {points: [...]} shape, or a legacy pre-fix single point (kept in the merge
// so no raw data is discarded — it is a genuine HealthKit sample, so a
// re-export of the same day re-sends its timestamp and replaces it).
function storedPoints(raw: unknown): HealthExportDataPoint[] {
  if (raw === null || typeof raw !== "object") return [];
  if ("points" in raw && Array.isArray((raw as DailyPoints).points)) {
    return (raw as DailyPoints).points.filter(
      (point): point is HealthExportDataPoint =>
        point !== null && typeof point === "object" && typeof point.date === "string",
    );
  }
  const legacy = raw as HealthExportDataPoint;
  return typeof legacy.date === "string" ? [legacy] : [];
}

// Merges already-stored samples with an incoming batch for one (source,
// metric, day), keyed on each sample's own timestamp — the property that
// makes the ingest safe under every delivery mode Health Auto Export has:
// a full re-send (backfill, retry) replaces sample-for-sample instead of
// double-counting, and an incremental "Since Last Sync" batch adds only the
// timestamps it newly carries. Incoming samples win ties, so a re-export
// with recomputed values updates in place. Returns the merged sample list
// (sorted, stored back verbatim) and the day's total.
export function mergeDailyPoints(
  storedRawPayload: unknown,
  incoming: HealthExportDataPoint[],
): { points: HealthExportDataPoint[]; total: number } {
  const byTimestamp = new Map<string, HealthExportDataPoint>();
  for (const point of [...storedPoints(storedRawPayload), ...incoming]) {
    if (typeof point.date === "string") byTimestamp.set(point.date, point);
  }
  const points = [...byTimestamp.values()].sort((a, b) =>
    (a.date as string) < (b.date as string) ? -1 : 1,
  );
  const total = points.reduce(
    (sum, point) =>
      sum + (typeof point.qty === "number" && Number.isFinite(point.qty) ? point.qty : 0),
    0,
  );
  return { points, total };
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
    const mapping = METRIC_MAP[name];

    if (!mapping) {
      ignoredMetrics.push(name);
      continue;
    }

    // For cumulative metrics, valid same-day points are grouped and emitted
    // as one reading per day below; per-point validation (and its error
    // reporting) is identical for both aggregation kinds.
    const daysInPayload = new Map<string, HealthExportDataPoint[]>();

    for (const point of points) {
      const readingDate = extractReadingDate(point);
      if (!readingDate) {
        errors.push(`${name}: data point has no parseable date`);
        continue;
      }
      const value = point.qty;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${name} (${readingDate}): data point has no numeric value`);
        continue;
      }
      if (mapping.aggregation === "sum") {
        const day = daysInPayload.get(readingDate) ?? [];
        day.push(point);
        daysInPayload.set(readingDate, day);
        continue;
      }
      readings.push({
        source: mapping.source,
        metric: mapping.metric,
        readingDate,
        value,
        unit: metric.units ?? null,
        aggregation: "latest",
        rawPayload: point,
      });
    }

    for (const [readingDate, dayPoints] of daysInPayload) {
      readings.push({
        source: mapping.source,
        metric: mapping.metric,
        readingDate,
        // The sum of just this payload's points; the upsert merges them with
        // any already-stored samples for the day and recomputes the total.
        value: dayPoints.reduce((sum, point) => sum + (point.qty as number), 0),
        unit: metric.units ?? null,
        aggregation: "sum",
        rawPayload: { points: dayPoints },
      });
    }
  }

  return { readings, ignoredMetrics, errors };
}
