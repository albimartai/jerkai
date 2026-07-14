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
// Storage shapes: single-measurement metrics store their one data point as
// raw_payload verbatim. Cumulative metrics (aggregation: "sum", currently
// step_count) store raw_payload = {points: [...]} with every contributing
// sample verbatim, and value = the sum over the merged samples — see
// mergeDailyPoints for why overwriting is never safe for these.
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

// Cumulative metrics (step_count) store every contributing sample; single-
// measurement metrics store the one data point exactly as received.
export type DailyPoints = { points: HealthExportDataPoint[] };

// How a metric's value relates to its data points within one calendar day:
// "latest" — one measurement per day; a re-send replaces the stored value.
// "sum"    — cumulative; the day's value is the sum over all samples, which
//            arrive many-per-day and split across "Since Last Sync" calls,
//            so the upsert must merge samples by timestamp, never overwrite.
export type DailyAggregation = "latest" | "sum";

export type MappedReading = {
  source: ReadingSource;
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

// Device attribution is by metric type, not by HealthKit's per-point source
// string: body composition only comes from the Fitdays scale, HRV/RHR/sleep
// only from Whoop, and step_count is HealthKit's merged cross-device
// aggregate, so it's tagged 'apple_health' rather than either device.
const METRIC_MAP: Record<
  string,
  { source: ReadingSource; metric: string; aggregation?: "sum" }
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
  heart_rate_variability: { source: "whoop", metric: "hrv" },
  resting_heart_rate: { source: "whoop", metric: "rhr" },
  // step_count is cumulative: HealthKit reports it as many interval samples
  // per day (fractional qty from cross-device dedup weighting), and Health
  // Auto Export's "Since Last Sync" automation splits a day's samples across
  // runs. The daily value is therefore a sum over merged samples — a plain
  // per-day overwrite keeps only the last sample (the Session 5 bug that
  // corrupted all backfilled step counts).
  step_count: { source: "apple_health", metric: "step_count", aggregation: "sum" },
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
    const isSleep = name === SLEEP_METRIC_NAME;
    const mapping: (typeof METRIC_MAP)[string] | undefined = isSleep
      ? { source: "whoop", metric: "sleep_duration" }
      : METRIC_MAP[name];

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
      const value = isSleep ? extractSleepDuration(point) : point.qty;
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
