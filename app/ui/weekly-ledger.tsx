import Link from "next/link";

import { NavHeader } from "@/app/ui/nav-header";
import type { LedgerCell, WeekRow } from "@/lib/dashboard/ledger";

// The Weekly Ledger (AC-W1–W9): one row per ISO week, newest first, five
// metric columns of deltas/states computed from the same smoothed series
// the strip dashboard renders (buildWeeklyView, NFR-21). Plain server
// markup — row drill-down is a real <Link> (AC-W6), no client JS required.

const TONE_CLASSES = {
  good: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  neutral: "text-zinc-600 dark:text-zinc-300",
} as const;

const fmtDay = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// Always one decimal so a small change reads "±0.0", never "−0.0".
function fmtSigned(value: number, unit: string, digits = 1) {
  const magnitude = Math.abs(value).toFixed(digits);
  const sign = Number(magnitude) === 0 ? "±" : value < 0 ? "−" : "+";
  return `${sign}${magnitude}${unit ? ` ${unit}` : ""}`;
}

// AC-W7: sparse cells render as an em-dash with a day-count tooltip, never a
// thin-data delta.
function Cell({ cell, unit, digits = 1 }: { cell: LedgerCell; unit: string; digits?: number }) {
  if (cell.kind === "insufficient") {
    return (
      <span
        className="text-zinc-400 dark:text-zinc-600"
        title={`${cell.daysPresent} of 7 days with data`}
      >
        —
      </span>
    );
  }
  if (cell.kind === "delta") {
    return <span className={TONE_CLASSES[cell.state]}>{fmtSigned(cell.value, unit, digits)}</span>;
  }
  if (cell.kind === "strainLevel") {
    return <span className={TONE_CLASSES.neutral}>{cell.value.toFixed(1)}</span>;
  }
  return (
    <span className={TONE_CLASSES.neutral}>
      {Math.round(cell.avgPct)}% · {cell.redDays} red {cell.redDays === 1 ? "day" : "days"}
    </span>
  );
}

const GRID_COLS = "grid-cols-[1.3fr_repeat(5,minmax(0,1fr))]";

function WeekRowContent({ row }: { row: WeekRow }) {
  const label = row.inProgress
    ? `this week · ${row.daysElapsed} of 7 days`
    : `${fmtDay(row.weekStart)}–${fmtDay(row.weekEnd)}`;

  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-2 px-3 py-3 text-sm tabular-nums ${
        row.inProgress ? "italic text-zinc-500 dark:text-zinc-400" : ""
      }`}
    >
      <span className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <Cell cell={row.columns.bodyFat} unit="pp" />
      <Cell cell={row.columns.weight} unit="lb" />
      <Cell cell={row.columns.strain} unit="" />
      <Cell cell={row.columns.recovery} unit="" />
      <Cell cell={row.columns.leanMass} unit="lb" />
    </div>
  );
}

function WeekRowView({ row }: { row: WeekRow }) {
  if (row.isGap) {
    return (
      <div
        data-week-row="gap"
        className="flex items-center justify-between px-3 py-3 text-sm text-zinc-400 dark:text-zinc-600"
      >
        <span className="text-xs font-medium uppercase tracking-wide">
          {fmtDay(row.weekStart)}–{fmtDay(row.weekEnd)}
        </span>
        <span>no data this week</span>
      </div>
    );
  }

  // In-progress row is deliberately not comparable to completed weeks
  // (AC-W1): no drill-down link, italic/muted styling.
  if (row.inProgress) {
    return (
      <div data-week-row="in-progress">
        <WeekRowContent row={row} />
      </div>
    );
  }

  return (
    <Link
      href={`/daily?week=${row.weekStart}`}
      data-week-row="completed"
      className="block hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <WeekRowContent row={row} />
    </Link>
  );
}

export default function WeeklyLedger({
  rows,
  completedWeeks,
}: {
  rows: WeekRow[];
  completedWeeks: number;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl overflow-x-hidden px-4 pb-10 font-sans">
      <NavHeader active="weekly" />

      {rows.length === 0 ? (
        <p className="py-24 text-center text-2xl text-zinc-500">No readings yet.</p>
      ) : (
        <>
          {completedWeeks < 2 ? (
            <p data-cold-start-note className="px-1 pb-2 text-xs text-zinc-500">
              ledger builds as weeks complete — {completedWeeks} week{completedWeeks === 1 ? "" : "s"}{" "}
              so far
            </p>
          ) : null}
          <div
            data-ledger
            className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
          >
            <div
              className={`grid ${GRID_COLS} gap-2 border-b border-zinc-200 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-800`}
            >
              <span>Week</span>
              <span>Body fat</span>
              <span>Weight</span>
              <span>Strain</span>
              <span>Recovery</span>
              <span>Lean mass</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.weekStart}
                className="border-t border-zinc-200 first:border-t-0 dark:border-zinc-800"
              >
                <WeekRowView row={row} />
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
