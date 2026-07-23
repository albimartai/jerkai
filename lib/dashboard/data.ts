import { getSql } from "@/lib/db";
import { readingDateKey } from "@/lib/dashboard/date-key";
import { alignSeries, dayAxis } from "@/lib/dashboard/series";
import { DASHBOARD_METRICS, type DashboardData, type DashboardMetricKey } from "@/lib/dashboard/types";

// The dashboard's one read path: every strip's series, aligned onto one
// shared day axis (NFR-2, AC-D8), fetched in a single query so a window
// switch is one round trip (NFR-5). Reads only — trends are derived later
// from these raw values, never written back (NFR-1). Idempotent-upsert
// semantics come for free: (source, metric, reading_date) is unique, so a
// re-sent day is one row carrying its latest value (NFR-3).

// DASHBOARD_METRICS/DashboardMetricKey/DashboardData live in
// lib/dashboard/types.ts (no DB import) and are re-exported here so existing
// importers of this module are unaffected; the demo route (docs/prd/public-demo.md)
// imports them from lib/dashboard/types directly instead, so its module graph
// never resolves this file's getSql import.
export { DASHBOARD_METRICS, type DashboardData, type DashboardMetricKey };

type Row = {
  source: string;
  metric: string;
  reading_date: string;
  value: number;
  unit: string | null;
};

const METRIC_KEYS = Object.keys(DASHBOARD_METRICS) as DashboardMetricKey[];

const keyBySourceMetric = new Map<string, DashboardMetricKey>(
  METRIC_KEYS.map((key) => {
    const { source, metric } = DASHBOARD_METRICS[key];
    return [`${source}/${metric}`, key];
  }),
);

export async function fetchDashboardData(windowDays: number): Promise<DashboardData> {
  const sql = getSql();

  const sources = METRIC_KEYS.map((key) => DASHBOARD_METRICS[key].source);
  const metrics = METRIC_KEYS.map((key) => DASHBOARD_METRICS[key].metric);

  // The axis ends at the newest reading day across the dashboard metrics
  // (not the server clock, which runs in UTC and would disagree with the
  // device-local date key around midnight). One query: the subselect finds
  // that day, the outer filter keeps the trailing window.
  const rows = (await sql`
    with dashboard_rows as (
      select source, metric, reading_date, value, unit
      from biometric_readings
      where (source, metric) in (
        select * from unnest(${sources}::text[], ${metrics}::text[])
      )
    )
    select source, metric,
           to_char(reading_date, 'YYYY-MM-DD') as reading_date,
           value::float8 as value, unit
    from dashboard_rows
    where reading_date > (select max(reading_date) from dashboard_rows)
                         - ${windowDays}::int
    order by reading_date
  `) as Row[];

  const emptySeries = () =>
    Object.fromEntries(METRIC_KEYS.map((key) => [key, [] as (number | null)[]])) as Record<
      DashboardMetricKey,
      (number | null)[]
    >;
  const units = Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as Record<
    DashboardMetricKey,
    string | null
  >;

  if (rows.length === 0) {
    return { axis: [], series: emptySeries(), units, latestDay: null };
  }

  const valuesByDay = new Map<DashboardMetricKey, Map<string, number>>(
    METRIC_KEYS.map((key) => [key, new Map()]),
  );
  let latestDay = "";
  for (const row of rows) {
    const key = keyBySourceMetric.get(`${row.source}/${row.metric}`);
    if (!key) continue; // unreachable given the WHERE clause; keeps types honest
    // Loud shared-date-key check (NFR-2): a non-local-day format here means
    // the convention broke upstream.
    const day = readingDateKey(row.reading_date);
    valuesByDay.get(key)!.set(day, row.value);
    if (day > latestDay) latestDay = day;
    // Rows arrive oldest-first, so the newest row's unit wins.
    units[key] = row.unit;
  }

  const axis = dayAxis(latestDay, windowDays);
  const series = emptySeries();
  for (const key of METRIC_KEYS) {
    series[key] = alignSeries(axis, valuesByDay.get(key)!);
  }

  return { axis, series, units, latestDay };
}
