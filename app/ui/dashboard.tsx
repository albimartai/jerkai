"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { DashboardData } from "@/lib/dashboard/data";
import { rollingAverage } from "@/lib/dashboard/rolling";
import { STRAIN_DOMAIN } from "@/lib/dashboard/strain";
import { stallBadge } from "@/lib/dashboard/stall-badge";
import { trendDescriptor } from "@/lib/dashboard/trend-descriptor";

// Direction 1c: every metric is a horizontal strip stacked on one shared
// date axis; hovering (or touch-dragging) any strip scrubs a crosshair
// across all of them to the same day (AC-D8). All derivations (trend lines,
// badge, descriptors) are computed here at render time from the raw series
// (NFR-1), and the whole window's data is already client-side, so scrubbing
// never touches the network (NFR-6).

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

// Data-driven vertical domain with headroom so dots never sit on the strip
// edge. Fixed-domain strips (strain 0–21, recovery 0–100) skip this.
function fitDomain(seriesList: Series[]): Domain {
  const values = seriesList.flat().filter((v): v is number => v !== null);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * 0.12;
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
}: {
  series: Series;
  domain: Domain;
  className: string;
}) {
  return (
    <svg
      className={`absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
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
            strokeWidth="1.5"
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

// --- the dashboard --------------------------------------------------------

const WINDOWS = [30, 90] as const;
type WindowDays = (typeof WINDOWS)[number];

const BADGE_TONE_CLASSES = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
} as const;

export default function Dashboard({ data }: { data: DashboardData }) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [whoopOpen, setWhoopOpen] = useState(false);

  // Trend lines are computed over the FULL fetched history, then cut to the
  // window — so the 7d/30d values at the window's left edge still include
  // the days before it (AC-D3) — while the badge always reads the full
  // 30-day trend regardless of the visible window (AC-D4–D7).
  const derived = useMemo(() => {
    const raw = data.series.bodyFatPct;
    return {
      avg7: rollingAverage(raw, 7),
      avg30: rollingAverage(raw, 30),
      badge: stallBadge(rollingAverage(raw, 30)),
    };
  }, [data]);

  const cutLength = Math.min(windowDays, data.axis.length);
  const cut = <T,>(full: readonly T[]): T[] => full.slice(full.length - cutLength);

  const axis = cut(data.axis);
  const s = {
    raw: cut(data.series.bodyFatPct),
    avg7: cut(derived.avg7),
    avg30: cut(derived.avg30),
    strain: cut(data.series.dayStrain),
    recovery: cut(data.series.recoveryScore),
    lbm: cut(data.series.leanBodyMass),
    hrv: cut(data.series.hrv),
    rhr: cut(data.series.rhr),
    sleep: cut(data.series.sleepDuration),
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
  const orNoReading = (day: string, value: number | null, render: (v: number) => string) =>
    value === null ? `${day} · no reading` : `${day} · ${render(value)}`;

  const bodyFatDomain = fitDomain([s.raw, s.avg7, s.avg30]);
  const recoveryDomain = { min: 0, max: 100 };
  const scrub = setHoverIndex;

  const periodAvg = (series: Series) => {
    const present = series.filter((v): v is number => v !== null);
    return present.length === 0
      ? null
      : present.reduce((sum, v) => sum + v, 0) / present.length;
  };
  const strainAvg = periodAvg(s.strain);
  const latestRecovery = lastPresent(s.recovery);
  const latestLbm = lastPresent(s.lbm);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 font-sans">
      <header className="flex items-center justify-between py-4">
        {/* v1 header: Status only — the "+ Log meal" / "+ Log workout" CTAs
            ship with their features, not before (AC-D14). */}
        <span className="text-lg font-semibold tracking-tight">JerkAI</span>
        <Link
          href="/status"
          className="rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Status
        </Link>
      </header>

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
            {/* Body fat: raw dots + 7d + 30d lines, tallest strip (AC-D2). */}
            <Strip
              label="Body fat"
              heightClass="h-44"
              hoverIndex={hoverIndex}
              axisLength={axis.length}
              readout={readout(
                `${hoverDay} · ${
                  at(s.raw) === null ? "no reading" : `raw ${withUnit(at(s.raw)!, u.bodyFatPct ?? "%")}`
                } · 7d ${at(s.avg7) === null ? "—" : withUnit(at(s.avg7)!, u.bodyFatPct ?? "%")} · 30d ${
                  at(s.avg30) === null ? "—" : withUnit(at(s.avg30)!, u.bodyFatPct ?? "%")
                }`,
                latestRaw ? `raw ${withUnit(latestRaw.value, u.bodyFatPct ?? "%")}` : "no readings",
              )}
              onScrub={scrub}
            >
              <PolyLine series={s.avg30} domain={bodyFatDomain} className="text-violet-500" />
              <PolyLine series={s.avg7} domain={bodyFatDomain} className="text-sky-500" />
              {s.raw.map((value, index) =>
                value === null ? null : (
                  <span
                    key={index}
                    className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400 dark:bg-zinc-500"
                    style={{
                      left: `${xPct(index, axis.length)}%`,
                      top: `${yPct(value, bodyFatDomain)}%`,
                    }}
                  />
                ),
              )}
              <div className="pointer-events-none absolute bottom-1 left-2 z-10 flex gap-3 text-[10px] text-zinc-500">
                <span>
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                  raw
                </span>
                <span>
                  <span className="mr-1 inline-block h-0.5 w-3 -translate-y-0.5 bg-sky-500" />
                  7-day
                </span>
                <span>
                  <span className="mr-1 inline-block h-0.5 w-3 -translate-y-0.5 bg-violet-500" />
                  30-day
                </span>
              </div>
            </Strip>

            {/* Day Strain: fixed 0–21 domain, Whoop cycle strain (AC-D11). */}
            <Strip
              label="Day strain"
              tag="Driver · Whoop"
              heightClass="h-24"
              hoverIndex={hoverIndex}
              axisLength={axis.length}
              readout={readout(
                orNoReading(hoverDay ?? "", at(s.strain), (v) => `${fmt(v)} strain`),
                strainAvg === null ? "no data" : `avg ${fmt(strainAvg)} strain`,
              )}
              onScrub={scrub}
            >
              {s.strain.map((value, index) =>
                value === null ? null : (
                  <span
                    key={index}
                    className="absolute bottom-0 w-[3px] -translate-x-1/2 rounded-t-sm bg-amber-500/80"
                    style={{
                      left: `${xPct(index, axis.length)}%`,
                      height: `${(100 * (value - STRAIN_DOMAIN.min)) / (STRAIN_DOMAIN.max - STRAIN_DOMAIN.min)}%`,
                    }}
                  />
                ),
              )}
            </Strip>

            {/* Recovery Score: zone bands on Whoop's fixed 0–100 scale. */}
            <Strip
              label="Recovery score"
              tag="Guardrail · Whoop"
              heightClass="h-24"
              hoverIndex={hoverIndex}
              axisLength={axis.length}
              readout={readout(
                orNoReading(hoverDay ?? "", at(s.recovery), (v) =>
                  withUnit(v, u.recoveryScore ?? "%", 0),
                ),
                latestRecovery
                  ? `${withUnit(latestRecovery.value, u.recoveryScore ?? "%", 0)} · ${trendDescriptor(s.recovery)}`
                  : "no data",
              )}
              onScrub={scrub}
            >
              <div className="absolute inset-x-0 top-0 h-1/3 bg-emerald-500/10" />
              <div className="absolute inset-x-0 top-1/3 h-1/3 bg-amber-500/10" />
              <div className="absolute inset-x-0 top-2/3 h-1/3 bg-red-500/10" />
              <PolyLine series={s.recovery} domain={recoveryDomain} className="text-emerald-600" />
            </Strip>

            {/* Lean body mass: Fitdays guardrail (AC-D12). */}
            <Strip
              label="Lean body mass"
              tag="Guardrail · Fitdays"
              heightClass="h-24"
              hoverIndex={hoverIndex}
              axisLength={axis.length}
              readout={readout(
                orNoReading(hoverDay ?? "", at(s.lbm), (v) => withUnit(v, u.leanBodyMass)),
                latestLbm
                  ? `${withUnit(latestLbm.value, u.leanBodyMass)} · ${trendDescriptor(s.lbm)}`
                  : "no data",
              )}
              onScrub={scrub}
            >
              <PolyLine series={s.lbm} domain={fitDomain([s.lbm])} className="text-zinc-500" />
            </Strip>

            {/* Collapsible Whoop detail — expanded strips join the shared
                crosshair (AC-D8). */}
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
                <Strip
                  label="HRV (rMSSD)"
                  heightClass="h-20"
                  hoverIndex={hoverIndex}
                  axisLength={axis.length}
                  readout={readout(
                    orNoReading(hoverDay ?? "", at(s.hrv), (v) => withUnit(v, u.hrv, 0)),
                    lastPresent(s.hrv) ? withUnit(lastPresent(s.hrv)!.value, u.hrv, 0) : "no data",
                  )}
                  onScrub={scrub}
                >
                  <PolyLine series={s.hrv} domain={fitDomain([s.hrv])} className="text-zinc-400" />
                </Strip>
                <Strip
                  label="Resting heart rate"
                  heightClass="h-20"
                  hoverIndex={hoverIndex}
                  axisLength={axis.length}
                  readout={readout(
                    orNoReading(hoverDay ?? "", at(s.rhr), (v) => withUnit(v, u.rhr, 0)),
                    lastPresent(s.rhr) ? withUnit(lastPresent(s.rhr)!.value, u.rhr, 0) : "no data",
                  )}
                  onScrub={scrub}
                >
                  <PolyLine series={s.rhr} domain={fitDomain([s.rhr])} className="text-zinc-400" />
                </Strip>
                <Strip
                  label="Sleep duration"
                  heightClass="h-20"
                  hoverIndex={hoverIndex}
                  axisLength={axis.length}
                  readout={readout(
                    orNoReading(hoverDay ?? "", at(s.sleep), (v) => withUnit(v, u.sleepDuration)),
                    lastPresent(s.sleep)
                      ? withUnit(lastPresent(s.sleep)!.value, u.sleepDuration)
                      : "no data",
                  )}
                  onScrub={scrub}
                >
                  <PolyLine
                    series={s.sleep}
                    domain={fitDomain([s.sleep])}
                    className="text-zinc-400"
                  />
                </Strip>
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
