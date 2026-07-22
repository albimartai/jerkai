"use client";

import { useMemo, useState } from "react";

import { NavHeader } from "@/app/ui/nav-header";
import type { CalorieDay } from "@/lib/dashboard/calorie-strip";
import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import type { DashboardData } from "@/lib/dashboard/types";
import { isoWeekEnd } from "@/lib/dashboard/iso-week";
import { leanMassChange, recoveryReadout } from "@/lib/dashboard/readouts";
import { rollingAverage } from "@/lib/dashboard/rolling";
import { STRAIN_DOMAIN } from "@/lib/dashboard/strain";
import { buildWeeklyView } from "@/lib/dashboard/weekly-view";

// Direction 1c, v1.1 revision (signal over noise): every metric is a
// horizontal strip stacked on one shared date axis; hovering (or
// touch-dragging) any strip scrubs a crosshair across all of them to the
// same day (AC-D8, AC-N11). One rendering rule everywhere (AC-N1): raw
// daily values are low-emphasis dots and the 7-day rolling line is the
// dominant mark — no strip renders a raw daily line as its primary mark.
// All derivations (trend lines, badge, readout stats) are computed once per
// data load from the raw series (NFR-1, NFR-17), and the whole window's
// data is already client-side, so scrubbing never touches the network
// (NFR-6).

type Series = (number | null)[];

const fmtDay = (key: string) =>
  // The key is a plain calendar day; format it in UTC so no local timezone
  // can shift it (NFR-2).
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const fmt = (value: number, digits = 1) =>
  value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const withUnit = (value: number, unit: string | null, digits = 1) =>
  unit === "%" ? `${fmt(value, digits)}%` : unit ? `${fmt(value, digits)} ${unit}` : fmt(value, digits);

const lastPresent = (series: Series): { index: number; value: number } | null => {
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i];
    if (value !== null) return { index: i, value };
  }
  return null;
};

// --- geometry -------------------------------------------------------------

type Domain = { min: number; max: number };

// Data-driven vertical domain (AC-N7): fitted to the observed range plus a
// config margin so dots never sit on the strip edge — never zero-based, so
// genuine drift stays visually detectable. Fixed-domain strips (strain
// 0–21, recovery 0–100) skip this.
function fitDomain(seriesList: Series[]): Domain {
  const values = seriesList.flat().filter((v): v is number => v !== null);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * DASHBOARD_CONFIG.yDomainMarginFraction;
  return { min: min - pad, max: max + pad };
}

const xPct = (index: number, count: number) => (count <= 1 ? 50 : (index / (count - 1)) * 100);
const yPct = (value: number, domain: Domain) =>
  (1 - (value - domain.min) / (domain.max - domain.min)) * 100;

// Consecutive non-null runs — a gap day breaks the line instead of being
// bridged or read as zero (AC-D13, NFR-8).
function segments(series: Series): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  series.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push({ index, value });
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

function PolyLine({
  series,
  domain,
  className,
  seriesId,
  strokeWidth = 1.5,
}: {
  series: Series;
  domain: Domain;
  className: string;
  seriesId: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={`absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      data-series={seriesId}
      aria-hidden
    >
      {segments(series).map((run) =>
        run.length === 1 ? (
          // An isolated reading between gaps still shows as a mark.
          <circle
            key={run[0].index}
            cx={xPct(run[0].index, series.length)}
            cy={yPct(run[0].value, domain)}
            r="1.2"
            className="fill-current"
          />
        ) : (
          <polyline
            key={run[0].index}
            points={run
              .map((p) => `${xPct(p.index, series.length)},${yPct(p.value, domain)}`)
              .join(" ")}
            fill="none"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
            className="stroke-current"
          />
        ),
      )}
    </svg>
  );
}

// --- strips ---------------------------------------------------------------

type StripShellProps = {
  label: string;
  tag?: string;
  heightClass: string;
  hoverIndex: number | null;
  axisLength: number;
  readout: string;
  onScrub: (index: number | null) => void;
  children: React.ReactNode;
};

// Shared chrome for every strip: label, overlay readout (AC-D9/AC-D10),
// crosshair (AC-D8), and the pointer math that maps a cursor/touch position
// to an axis index. touch-pan-y keeps vertical page scroll working on a
// phone while a horizontal drag scrubs (AC-D17).
function Strip({
  label,
  tag,
  heightClass,
  hoverIndex,
  axisLength,
  readout,
  onScrub,
  children,
}: StripShellProps) {
  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || axisLength <= 0) return; // not laid out yet — nothing to map
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onScrub(Math.round(fraction * (axisLength - 1)));
  };
  return (
    <div className="border-t border-zinc-200 first:border-t-0 dark:border-zinc-800">
      <div
        className={`relative ${heightClass} touch-pan-y`}
        onPointerMove={scrub}
        onPointerDown={scrub}
      >
        <div className="pointer-events-none absolute left-2 top-1 z-10 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
          {tag ? <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-600">{tag}</span> : null}
        </div>
        <div className="pointer-events-none absolute right-2 top-1 z-10 text-right text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300">
          {readout}
        </div>
        {children}
        {hoverIndex !== null && axisLength > 0 ? (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-zinc-400/70 dark:bg-zinc-500/70"
            style={{ left: `${xPct(hoverIndex, axisLength)}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

// Recovery zone bands (top = green, bottom = red) on Whoop's 0–100 scale.
function ZoneBands() {
  return (
    <>
      <div className="absolute inset-x-0 top-0 h-1/3 bg-emerald-500/10" />
      <div className="absolute inset-x-0 top-1/3 h-1/3 bg-amber-500/10" />
      <div className="absolute inset-x-0 top-2/3 h-1/3 bg-red-500/10" />
    </>
  );
}

type MetricStripProps = {
  // Stable id for the chart region (also the hook for fixture render tests).
  id: string;
  label: string;
  tag?: string;
  heightClass: string;
  raw: Series;
  avg7: Series;
  avg30?: Series;
  // Fixed domain (strain 0–21, recovery 0–100); omitted = fitted (AC-N7).
  domain?: Domain;
  // Tailwind text-* color for the dominant 7-day line.
  lineClass?: string;
  zones?: boolean;
  legend?: boolean;
  hoverIndex: number | null;
  axisLength: number;
  readout: string;
  onScrub: (index: number | null) => void;
};

// THE strip renderer (NFR-14): every chart on the dashboard — main stack
// and Whoop detail — goes through this one component, parameterized by
// series, domain, and emphasis. One rendering rule (AC-N1): faint raw dots,
// dominant 7-day line, optional lighter 30-day line.
function MetricStrip({
  id,
  label,
  tag,
  heightClass,
  raw,
  avg7,
  avg30,
  domain,
  lineClass = "text-sky-500",
  zones = false,
  legend = false,
  hoverIndex,
  axisLength,
  readout,
  onScrub,
}: MetricStripProps) {
  const d = domain ?? fitDomain(avg30 ? [raw, avg7, avg30] : [raw, avg7]);
  return (
    <Strip
      label={label}
      tag={tag}
      heightClass={heightClass}
      hoverIndex={hoverIndex}
      axisLength={axisLength}
      readout={readout}
      onScrub={onScrub}
    >
      <div data-chart={id} className="absolute inset-0">
        {zones ? <ZoneBands /> : null}
        {avg30 ? (
          <PolyLine
            series={avg30}
            domain={d}
            seriesId="avg30"
            strokeWidth={1.25}
            className="text-violet-500"
          />
        ) : null}
        <PolyLine series={avg7} domain={d} seriesId="avg7" strokeWidth={2} className={lineClass} />
        {raw.map((value, index) =>
          value === null ? null : (
            <span
              key={index}
              data-raw-dot={index}
              className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400/70 dark:bg-zinc-500/70"
              style={{
                left: `${xPct(index, axisLength)}%`,
                top: `${yPct(value, d)}%`,
              }}
            />
          ),
        )}
        {legend ? (
          <div className="pointer-events-none absolute bottom-1 left-2 z-10 flex gap-3 text-[10px] text-zinc-500">
            <span>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-zinc-400/70 dark:bg-zinc-500/70" />
              raw
            </span>
            <span>
              <span className={`mr-1 inline-block h-0.5 w-3 -translate-y-0.5 bg-current ${lineClass}`} />
              7-day
            </span>
            <span>
              <span className="mr-1 inline-block h-0.5 w-3 -translate-y-0.5 bg-violet-500" />
              30-day
            </span>
          </div>
        ) : null}
      </div>
    </Strip>
  );
}

// Bar colors for the calories strip (DL-pending-2, AC-M6, AC-M11): over/under target,
// neutral when no target is in force, and a gap (no bar at all) when nothing was logged
// (AC-M8) — a gap must never read as a zero-height "under" bar.
const CALORIE_BAR_CLASSES = {
  over: "bg-amber-500/70",
  under: "bg-emerald-500/70",
  neutral: "bg-zinc-400/50 dark:bg-zinc-500/50",
} as const;

// The calories strip (DL-pending-2): daily bars, not the dots+trend-line treatment every
// other strip uses — logged intake is a discrete daily behavior where the daily value
// itself is the decision-relevant mark, not a smoothed trend. Reuses the Strip shell for
// chrome/crosshair/scrub (NFR-31); the bar rendering is its own, not a MetricStrip variant.
function CalorieBarStrip({
  days,
  hoverIndex,
  axisLength,
  readout,
  onScrub,
}: {
  days: CalorieDay[];
  hoverIndex: number | null;
  axisLength: number;
  readout: string;
  onScrub: (index: number | null) => void;
}) {
  const barWidthPct = axisLength > 0 ? 100 / axisLength : 0;
  return (
    <Strip
      label="Calories"
      tag="DRIVER · MANUAL"
      heightClass="h-24"
      hoverIndex={hoverIndex}
      axisLength={axisLength}
      readout={readout}
      onScrub={onScrub}
    >
      <div data-chart="calories" className="absolute inset-0">
        {days.map((day, index) => {
          // A gap (no entry logged, AC-M8) renders as a bare tick at the axis, never a
          // colored bar — visually distinct from a genuinely low logged day, which still
          // gets a colored (if short) bar.
          if (day.state === "gap") {
            return (
              <div
                key={index}
                data-bar={index}
                data-bar-state={day.state}
                className="absolute bottom-0 bg-zinc-300 dark:bg-zinc-700"
                style={{ left: `${index * barWidthPct}%`, width: `${barWidthPct}%`, height: "2px" }}
              />
            );
          }
          return (
            <div
              key={index}
              data-bar={index}
              data-bar-state={day.state}
              className={`absolute bottom-0 ${CALORIE_BAR_CLASSES[day.state]}`}
              style={{
                left: `${index * barWidthPct}%`,
                width: `${barWidthPct}%`,
                // Height scales to the day's own target when one is in force (so a bar
                // twice its target reads visibly "over"); a flat reference height when
                // there's no target to scale against (AC-M11, neutral).
                height:
                  day.target && day.target > 0
                    ? `${Math.min(100, ((day.actual ?? 0) / day.target) * 100)}%`
                    : "50%",
              }}
            />
          );
        })}
      </div>
    </Strip>
  );
}

// --- the dashboard --------------------------------------------------------

const WINDOWS = [30, 90] as const;
type WindowDays = (typeof WINDOWS)[number];

const BADGE_TONE_CLASSES = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
} as const;

const READOUT_TONE_CLASSES = {
  good: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  neutral: "text-zinc-600 dark:text-zinc-300",
} as const;

// Always one decimal so a small change reads "±0.0 lb", never "−0 lb".
const signedLb = (delta: number) => {
  const magnitude = Math.abs(delta).toFixed(1);
  const sign = magnitude === "0.0" ? "±" : delta < 0 ? "−" : "+";
  return `${sign}${magnitude} lb`;
};

export default function Dashboard({
  data,
  calorieSeries,
  initialWhoopOpen = false,
  focusWeekStart,
  navVariant = "live",
}: {
  data: DashboardData;
  // The calories strip's data (AC-M6), one entry per data.axis day — already resolved
  // per-day against its own effective target (NFR-30, DL-pending-3) by
  // lib/meal-entries.ts#fetchCalorieSeries. Not part of DashboardData: it comes from a
  // different table (manual_macro_entries/daily_targets, not biometric_readings) via a
  // sibling read path.
  calorieSeries: CalorieDay[];
  // Collapsed by default (AC-N13); overridable so fixture render tests can
  // assert the expanded Whoop-detail treatment (AC-N12) without a browser.
  initialWhoopOpen?: boolean;
  // Drill-down from a Weekly Ledger row (AC-W6): a Monday ISO week key.
  // When set, the visible window is positioned to contain that week instead
  // of trailing at the latest day.
  focusWeekStart?: string;
  // "demo" (docs/prd/public-demo.md, AC-PD4) hides Targets/Log meal/Status
  // from the shared header and points Weekly/Daily at /demo/*. Default "live"
  // is today's unchanged behavior.
  navVariant?: "live" | "demo";
}) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [whoopOpen, setWhoopOpen] = useState(initialWhoopOpen);

  // Everything derived is computed ONCE per data load (NFR-17), over the
  // FULL fetched history, then cut to the window — so the 7d/30d values at
  // the window's left edge still include the days before it (AC-D3, AC-N2),
  // the badge always reads the full 30-day trend regardless of the visible
  // window (AC-D4–D7), and the readout stats don't change with the window
  // toggle. Weight and lean mass are converted to display lb here, at
  // render time — stored rows are untouched (NFR-16).
  const derived = useMemo(() => {
    const bf = data.series.bodyFatPct;
    // Weekly Ledger view (AC-W10): the hero badge below is computed from
    // completed ledger weeks, not recomputed here — this reuses the exact
    // same lb-converted/smoothed series and rows the Weekly Ledger page
    // renders, so the two can never disagree (AC-W12, NFR-21).
    const weekly = buildWeeklyView(data);
    return {
      bf7: rollingAverage(bf, 7),
      bf30: weekly.bodyFat30,
      badge: weekly.badge,
      weightLb: weekly.weightLb,
      weight7: weekly.weight7,
      weight30: rollingAverage(weekly.weightLb, 30),
      strain7: rollingAverage(data.series.dayStrain, 7),
      lbmLb: weekly.leanMassLb,
      lbm7: weekly.leanMass7,
      lbm30: rollingAverage(weekly.leanMassLb, 30),
      recovery7: rollingAverage(data.series.recoveryScore, 7),
      hrv7: rollingAverage(data.series.hrv, 7),
      rhr7: rollingAverage(data.series.rhr, 7),
      sleep7: rollingAverage(data.series.sleepDuration, 7),
      // Guardrail readout stats (AC-N8, AC-N9), thresholds from config
      // (NFR-16). Lean mass reads the smoothed lb series.
      leanMass: leanMassChange(weekly.leanMass7, DASHBOARD_CONFIG.leanMass),
      recovery: recoveryReadout(data.series.recoveryScore, DASHBOARD_CONFIG.recovery),
    };
  }, [data]);

  // Default: trail at the latest day. With a drill-down focus week (AC-W6),
  // anchor a few days past that week's end instead, so the window is
  // positioned to contain it rather than always hugging the newest data.
  const focusWeekEnd = focusWeekStart ? isoWeekEnd(focusWeekStart) : null;
  const focusIndex = focusWeekEnd ? data.axis.indexOf(focusWeekEnd) : -1;
  const cutEnd = focusIndex === -1 ? data.axis.length - 1 : Math.min(data.axis.length - 1, focusIndex + 3);
  const cutStart = Math.max(0, cutEnd - windowDays + 1);
  const cut = <T,>(full: readonly T[]): T[] => full.slice(cutStart, cutEnd + 1);

  const axis = cut(data.axis);
  const s = {
    raw: cut(data.series.bodyFatPct),
    avg7: cut(derived.bf7),
    avg30: cut(derived.bf30),
    weight: cut(derived.weightLb),
    weight7: cut(derived.weight7),
    weight30: cut(derived.weight30),
    strain: cut(data.series.dayStrain),
    strain7: cut(derived.strain7),
    calories: cut(calorieSeries),
    recovery: cut(data.series.recoveryScore),
    recovery7: cut(derived.recovery7),
    lbm: cut(derived.lbmLb),
    lbm7: cut(derived.lbm7),
    lbm30: cut(derived.lbm30),
    hrv: cut(data.series.hrv),
    hrv7: cut(derived.hrv7),
    rhr: cut(data.series.rhr),
    rhr7: cut(derived.rhr7),
    sleep: cut(data.series.sleepDuration),
    sleep7: cut(derived.sleep7),
  };

  const u = data.units;
  const latestRaw = lastPresent(s.raw);
  const heroAvg7 = lastPresent(s.avg7);
  const heroAvg30 = lastPresent(s.avg30);

  const at = (series: Series) => (hoverIndex === null ? null : (series[hoverIndex] ?? null));
  const hoverDay = hoverIndex === null ? null : fmtDay(axis[hoverIndex]);

  // Per-strip readout: hovered date's values, or the default summary when
  // the cursor is away (AC-D9, AC-D10).
  const readout = (hovered: string, summary: string) => (hoverDay === null ? summary : hovered);
  const num = (value: number | null, digits = 1) => (value === null ? "—" : fmt(value, digits));
  // Hover line for a dots+trend strip: raw (or "no reading") then trends
  // (e.g. "Jul 12 · 14.2 · 7d 12.8", AC-N5/AC-D9).
  const hoverLine = (raw: string | null, ...trends: string[]) =>
    [`${hoverDay}`, raw ?? "no reading", ...trends].join(" · ");

  // e.g. "Jul 12 · 2,140 kcal · target 2,300 · −160" (AC-M6).
  const calorieLine = (day: CalorieDay | undefined) => {
    if (!day || day.actual === null) return "no entry";
    const actual = `${fmt(day.actual, 0)} kcal`;
    if (day.target === null) return actual;
    const delta = day.actual - day.target;
    const sign = delta === 0 ? "±" : delta > 0 ? "+" : "−";
    return `${actual} · target ${fmt(day.target, 0)} · ${sign}${fmt(Math.abs(delta), 0)}`;
  };

  const scrub = setHoverIndex;

  const latestWeight = lastPresent(s.weight);
  const latestStrain7 = lastPresent(s.strain7);
  const latestCalorieDay = [...s.calories].reverse().find((day) => day.actual !== null);
  const latestRecovery = lastPresent(s.recovery);
  const latestLbm = lastPresent(s.lbm);
  const latestHrv = lastPresent(s.hrv);
  const latestRhr = lastPresent(s.rhr);
  const latestSleep = lastPresent(s.sleep);

  const common = { hoverIndex, axisLength: axis.length, onScrub: scrub };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 font-sans">
      <NavHeader active="daily" variant={navVariant} />

      {data.axis.length === 0 ? (
        <p className="py-24 text-center text-2xl text-zinc-500">No readings yet.</p>
      ) : (
        <>
          <section className="py-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Body fat · today, raw
            </p>
            {/* Raw + 7d + 30d shown together; the raw reading is never
                hidden or replaced by a trend (AC-D1, NFR-1). */}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-5xl font-semibold tabular-nums tracking-tight">
                {latestRaw ? withUnit(latestRaw.value, u.bodyFatPct ?? "%") : "—"}
              </span>
              <span className="text-sm tabular-nums text-zinc-500">
                7-day {heroAvg7 ? withUnit(heroAvg7.value, u.bodyFatPct ?? "%") : "—"}
              </span>
              <span className="text-sm tabular-nums text-zinc-500">
                30-day {heroAvg30 ? withUnit(heroAvg30.value, u.bodyFatPct ?? "%") : "—"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONE_CLASSES[derived.badge.tone]}`}
              >
                {derived.badge.label}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span>
                {latestRaw ? `measured ${fmtDay(axis[latestRaw.index])} · ` : ""}
                last {windowDays} days · hover any strip to scrub
              </span>
              <span className="flex gap-1" role="group" aria-label="Data window">
                {WINDOWS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={windowDays === days}
                    onClick={() => setWindowDays(days)}
                    className={`rounded-md px-2 py-0.5 ${
                      windowDays === days
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </span>
            </div>
          </section>

          <section
            className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
            onPointerLeave={() => setHoverIndex(null)}
          >
            {/* Body fat: raw dots + 7d + 30d lines, tallest strip — v1
                treatment unchanged (AC-N3, AC-D1/D2). */}
            <MetricStrip
              id="bodyFat"
              label="Body fat"
              heightClass="h-44"
              raw={s.raw}
              avg7={s.avg7}
              avg30={s.avg30}
              legend
              readout={readout(
                hoverLine(
                  at(s.raw) === null ? null : `raw ${withUnit(at(s.raw)!, u.bodyFatPct ?? "%")}`,
                  `7d ${at(s.avg7) === null ? "—" : withUnit(at(s.avg7)!, u.bodyFatPct ?? "%")}`,
                  `30d ${at(s.avg30) === null ? "—" : withUnit(at(s.avg30)!, u.bodyFatPct ?? "%")}`,
                ),
                latestRaw ? `raw ${withUnit(latestRaw.value, u.bodyFatPct ?? "%")}` : "no readings",
              )}
              {...common}
            />

            {/* Weight: new in v1.1 (AC-N4, DL-2026-07-18-b) — directly below
                body fat, display lb (NFR-16). */}
            <MetricStrip
              id="weight"
              label="Weight"
              tag="Fitdays"
              heightClass="h-28"
              raw={s.weight}
              avg7={s.weight7}
              avg30={s.weight30}
              readout={readout(
                hoverLine(
                  at(s.weight) === null ? null : `raw ${withUnit(at(s.weight)!, "lb")}`,
                  `7d ${num(at(s.weight7))}`,
                  `30d ${num(at(s.weight30))}`,
                ),
                latestWeight ? `raw ${withUnit(latestWeight.value, "lb")}` : "no data",
              )}
              {...common}
            />

            {/* Day Strain: fixed 0–21 domain (AC-D11 source clause), faint
                daily dots + dominant 7-day line (AC-N5). */}
            <MetricStrip
              id="strain"
              label="Day strain"
              tag="Driver · Whoop"
              heightClass="h-24"
              raw={s.strain}
              avg7={s.strain7}
              domain={STRAIN_DOMAIN}
              lineClass="text-amber-500"
              readout={readout(
                hoverLine(at(s.strain) === null ? null : fmt(at(s.strain)!), `7d ${num(at(s.strain7))}`),
                latestStrain7 ? `7d ${fmt(latestStrain7.value)} strain` : "no data",
              )}
              {...common}
            />

            {/* Calories vs target (AC-M6, Log Meal slice): daily bars, not
                dots+trend (DL-pending-2) — directly below Day Strain, drivers
                grouped (OQ-2 default). */}
            <CalorieBarStrip
              days={s.calories}
              readout={readout(
                `${hoverDay} · ${calorieLine(hoverIndex === null ? undefined : s.calories[hoverIndex])}`,
                calorieLine(latestCalorieDay),
              )}
              {...common}
            />

            {/* Lean body mass: guardrail, display lb, fitted (non-zero-based)
                domain so genuine drift stays visible (AC-N7, NFR-16). */}
            <MetricStrip
              id="leanMass"
              label="Lean body mass"
              tag="Guardrail · Fitdays"
              heightClass="h-24"
              raw={s.lbm}
              avg7={s.lbm7}
              avg30={s.lbm30}
              readout={readout(
                hoverLine(
                  at(s.lbm) === null ? null : `raw ${withUnit(at(s.lbm)!, "lb")}`,
                  `7d ${num(at(s.lbm7))}`,
                  `30d ${num(at(s.lbm30))}`,
                ),
                latestLbm ? withUnit(latestLbm.value, "lb") : "no data",
              )}
              {...common}
            />

            {/* Guardrail readout row (AC-N8–N10): summary statistics only —
                never a chart, no hover response, no causal language. Stats
                come precomputed from the derived block (NFR-17). */}
            <div
              data-readout-row
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-zinc-200 px-2 py-2 text-[11px] tabular-nums dark:border-zinc-800"
            >
              <span
                className={
                  READOUT_TONE_CLASSES[
                    derived.leanMass === null
                      ? "neutral"
                      : derived.leanMass.state === "down"
                        ? "warning"
                        : derived.leanMass.state === "up"
                          ? "good"
                          : "neutral"
                  ]
                }
              >
                {derived.leanMass === null
                  ? "Lean mass — no data"
                  : `Lean mass ${derived.leanMass.spanDays}d ${signedLb(derived.leanMass.deltaLb)} · ${
                      derived.leanMass.state === "down" ? "down" : derived.leanMass.state === "up" ? "up" : "holding"
                    }`}
              </span>
              <span className={READOUT_TONE_CLASSES.neutral}>
                {derived.recovery === null
                  ? "Recovery — no data"
                  : `Recovery 7d ${fmt(derived.recovery.avgPct, 0)}% · ${derived.recovery.redDays} red ${
                      derived.recovery.redDays === 1 ? "day" : "days"
                    }`}
              </span>
            </div>

            {/* Collapsible Whoop detail — expanded strips join the shared
                crosshair (AC-D8, AC-N11) and follow the same rendering rule
                (AC-N12). Recovery Score lives here now, not in the main
                stack (AC-N6). */}
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setWhoopOpen((open) => !open)}
                aria-expanded={whoopOpen}
                className="flex w-full items-center gap-2 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span aria-hidden>{whoopOpen ? "▾" : "▸"}</span>
                Whoop detail
              </button>
            </div>
            {whoopOpen ? (
              <>
                <MetricStrip
                  id="hrv"
                  label="HRV (rMSSD)"
                  heightClass="h-20"
                  raw={s.hrv}
                  avg7={s.hrv7}
                  lineClass="text-zinc-400"
                  readout={readout(
                    hoverLine(
                      at(s.hrv) === null ? null : withUnit(at(s.hrv)!, u.hrv, 0),
                      `7d ${num(at(s.hrv7), 0)}`,
                    ),
                    latestHrv ? withUnit(latestHrv.value, u.hrv, 0) : "no data",
                  )}
                  {...common}
                />
                <MetricStrip
                  id="rhr"
                  label="Resting heart rate"
                  heightClass="h-20"
                  raw={s.rhr}
                  avg7={s.rhr7}
                  lineClass="text-zinc-400"
                  readout={readout(
                    hoverLine(
                      at(s.rhr) === null ? null : withUnit(at(s.rhr)!, u.rhr, 0),
                      `7d ${num(at(s.rhr7), 0)}`,
                    ),
                    latestRhr ? withUnit(latestRhr.value, u.rhr, 0) : "no data",
                  )}
                  {...common}
                />
                <MetricStrip
                  id="sleep"
                  label="Sleep duration"
                  heightClass="h-20"
                  raw={s.sleep}
                  avg7={s.sleep7}
                  lineClass="text-zinc-400"
                  readout={readout(
                    hoverLine(
                      at(s.sleep) === null ? null : withUnit(at(s.sleep)!, u.sleepDuration),
                      `7d ${num(at(s.sleep7))}`,
                    ),
                    latestSleep ? withUnit(latestSleep.value, u.sleepDuration) : "no data",
                  )}
                  {...common}
                />
                <MetricStrip
                  id="recovery"
                  label="Recovery score"
                  tag="Guardrail · Whoop"
                  heightClass="h-20"
                  raw={s.recovery}
                  avg7={s.recovery7}
                  domain={{ min: 0, max: 100 }}
                  lineClass="text-emerald-600"
                  zones
                  readout={readout(
                    hoverLine(
                      at(s.recovery) === null
                        ? null
                        : withUnit(at(s.recovery)!, u.recoveryScore ?? "%", 0),
                      `7d ${num(at(s.recovery7), 0)}`,
                    ),
                    latestRecovery
                      ? withUnit(latestRecovery.value, u.recoveryScore ?? "%", 0)
                      : "no data",
                  )}
                  {...common}
                />
              </>
            ) : null}
          </section>

          <p className="mt-3 flex justify-between text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
            <span>{fmtDay(axis[0])}</span>
            <span>{fmtDay(axis[axis.length - 1])}</span>
          </p>
        </>
      )}
    </main>
  );
}
