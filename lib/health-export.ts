// Maps a Health Auto Export "REST API Automation" JSON payload into
// biometric_readings rows. Field names follow the schema published at
// github.com/Lybron/health-auto-export (wiki: API Export — JSON Format).
//
// Values and units are stored exactly as sent — unit/timezone normalization
// is deliberately deferred to the unified-schema step (Build Sequencing 3).

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

export type ReadingSource = "fitdays" | "whoop" | "apple_health";

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
  // HealthKit has no muscle-mass identifier — Fitdays' muscle-mass guardrail
  // arrives as lean_body_mass, and is stored under that name until a real
  // export confirms whether the value matches Fitdays' "Muscle Mass" or its
  // "Lean Body Mass" reading. See PRD → Validation Plan item 3.
  lean_body_mass: { source: "fitdays", metric: "lean_body_mass" },
  heart_rate_variability: { source: "whoop", metric: "hrv" },
  resting_heart_rate: { source: "whoop", metric: "rhr" },
  step_count: { source: "apple_health", metric: "step_count" },
};

// Whoop's "sleep performance %" is proprietary and never reaches HealthKit
// (same reason Recovery Score doesn't), so the sleep guardrail stores total
// sleep duration from sleep_analysis instead.
const SLEEP_METRIC_NAME = "sleep_analysis";

function extractReadingDate(point: HealthExportDataPoint): string | null {
  const raw = typeof point.date === "string" ? point.date : null;
  const day = raw?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
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
