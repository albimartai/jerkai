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

// bodyFatPct/weight/leanBodyMass resolve their active source per user
// (weight/body_fat_pct/lean_body_mass in biometric_readings) — see
// resolveScaleSource, below. Everything else keeps its one fixed source.
//
// Each user runs exactly one active smart-scale source at a time: the
// candidate with the most recent reading_date across weight/body_fat_pct/
// lean_body_mass combined wins; a tie resolves to 'fitdays' (NFR-112). null
// means the user has zero rows in either candidate source for these three
// metrics — never connected a scale.
async function resolveScaleSource(
  sql: ReturnType<typeof getSql>,
  userId: number,
): Promise<"fitdays" | "withings" | null> {
  const rows = (await sql`
    select source, to_char(max(reading_date), 'YYYY-MM-DD') as max_date
    from biometric_readings
    where user_id = ${userId}
      and source in ('fitdays', 'withings')
      and metric in ('weight', 'body_fat_pct', 'lean_body_mass')
    group by source
  `) as { source: string; max_date: string }[];

  const maxDateBySource = new Map(rows.map((row) => [row.source, row.max_date]));
  const fitdaysMax = maxDateBySource.get("fitdays") ?? null;
  const withingsMax = maxDateBySource.get("withings") ?? null;
  if (fitdaysMax === null && withingsMax === null) return null;
  if (withingsMax === null) return "fitdays";
  if (fitdaysMax === null) return "withings";
  return withingsMax > fitdaysMax ? "withings" : "fitdays";
}

export async function fetchDashboardData(windowDays: number, userId: number): Promise<DashboardData> {
  const sql = getSql();

  // Resolved first, in its own isolated query, before the main query's
  // params are built — never widen the main CTE's own (source, metric)
  // filter to accept both candidate sources for one key. Doing so would let
  // a stale or leftover row in the non-active source leak into the axis-end
  // computation and the series (the same cross-contamination NFR-68 already
  // had to close once for cross-*user* rows, one level down: cross-*source*-
  // within-one-user). Resolving first and then building the same single-
  // concrete-(source, metric)-pair-per-key parameter list the query already
  // expects closes this by construction — the query never sees the
  // non-resolved source's rows at all (NFR-111).
  const resolvedScaleSource = await resolveScaleSource(sql, userId);

  const sources: string[] = [];
  const metrics: string[] = [];
  const keyBySourceMetric = new Map<string, DashboardMetricKey>();
  for (const key of METRIC_KEYS) {
    const entry = DASHBOARD_METRICS[key];
    if ("sources" in entry) {
      if (resolvedScaleSource === null) continue; // no data in either candidate source
      sources.push(resolvedScaleSource);
      metrics.push(entry.metric);
      keyBySourceMetric.set(`${resolvedScaleSource}/${entry.metric}`, key);
    } else {
      sources.push(entry.source);
      metrics.push(entry.metric);
      keyBySourceMetric.set(`${entry.source}/${entry.metric}`, key);
    }
  }

  // The axis ends at the newest reading day across the dashboard metrics
  // (not the server clock, which runs in UTC and would disagree with the
  // device-local date key around midnight). One query: the subselect finds
  // that day, the outer filter keeps the trailing window. The CTE itself is
  // scoped by user_id (NFR-68) — scoping only the outer select would still
  // let another user's more recent reading shift this user's axis end date,
  // because the axis-end subquery reads from this same CTE.
  const rows = (await sql`
    with dashboard_rows as (
      select source, metric, reading_date, value, unit
      from biometric_readings
      where user_id = ${userId}
        and (source, metric) in (
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
    return { axis: [], series: emptySeries(), units, latestDay: null, resolvedScaleSource };
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

  return { axis, series, units, latestDay, resolvedScaleSource };
}
