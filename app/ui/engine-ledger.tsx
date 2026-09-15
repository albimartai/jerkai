import Link from "next/link";

import { NavHeader } from "@/app/ui/nav-header";
import type { EngineCell, EngineRecoveryCell, EngineWeekRow } from "@/lib/dashboard/engine";

// The Engine ledger (AC-E1-AC-E14): one row per ISO week, newest first, four
// metric columns of deltas/averages computed by Engine's own module
// (lib/dashboard/engine.ts). Modeled closely on app/ui/weekly-ledger.tsx's
// structure, but Strain/HRV/RHR carry no color-coded good/warning state — a
// single neutral tone only (NFR-175); Recovery's red-day-count clause is the
// only color signal. Plain server markup — row drill-down is a real <Link>
// (AC-E14), no client JS required.

const fmtDay = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// Always a fixed number of digits so a small change reads "±0.0"/"±0 ms",
// never "−0.0"/"−0 ms".
function fmtSigned(value: number, unit: string, digits: number) {
  const magnitude = Math.abs(value).toFixed(digits);
  const sign = Number(magnitude) === 0 ? "±" : value < 0 ? "−" : "+";
  return `${sign}${magnitude}${unit ? ` ${unit}` : ""}`;
}

// AC-E3: sparse cells render as an em-dash with a day-count tooltip, never a
// thin-data delta. NFR-175: delta cells carry no color-coded good/warning
// state — a single neutral tone only.
function Cell({ cell, unit, digits }: { cell: EngineCell; unit: string; digits: number }) {
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
  return (
    <span className="text-zinc-600 dark:text-zinc-300">{fmtSigned(cell.value, unit, digits)}</span>
  );
}

// AC-E8: the mean Recovery Score over the week's present days, plus a count
// of that week's present days below the red-zone threshold. The red-day
// clause renders in a warning tone when redDays > 0; the average percentage
// is always neutral tone otherwise.
function RecoveryCellView({ cell }: { cell: EngineRecoveryCell }) {
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
  const dayWord = cell.redDays === 1 ? "day" : "days";
  const text = `${Math.round(cell.avgPct)}% · ${cell.redDays} red ${dayWord}`;
  const className =
    cell.redDays > 0
      ? "text-amber-700 dark:text-amber-400"
      : "text-zinc-600 dark:text-zinc-300";
  return <span className={className}>{text}</span>;
}

const GRID_COLS = "grid-cols-[1.1fr_repeat(4,minmax(0,1fr))]";

function WeekRowContent({ row }: { row: EngineWeekRow }) {
  const label = row.inProgress
    ? `this week · ${row.daysElapsed} of 7 days`
    : `${fmtDay(row.weekStart)}–${fmtDay(row.weekEnd)}`;

  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-2 px-3 py-3 text-sm tabular-nums ${
        row.inProgress ? "italic text-zinc-500 dark:text-zinc-400" : ""
      }`}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <Cell cell={row.columns.strain} unit="" digits={1} />
      <RecoveryCellView cell={row.columns.recovery} />
      <Cell cell={row.columns.hrv} unit="ms" digits={0} />
      <Cell cell={row.columns.rhr} unit="bpm" digits={0} />
    </div>
  );
}

function WeekRowView({ row }: { row: EngineWeekRow }) {
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
  // (AC-E4): no drill-down link, italic/muted styling.
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

export default function EngineLedger({
  rows,
  completedWeeks,
}: {
  rows: EngineWeekRow[];
  completedWeeks: number;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl overflow-x-hidden px-4 pb-10 font-sans">
      <NavHeader active="engine" />

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
              <span>Strain</span>
              <span>Recovery</span>
              <span>HRV</span>
              <span>RHR</span>
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
