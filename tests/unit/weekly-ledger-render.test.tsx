import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import WeeklyLedger from "@/app/ui/weekly-ledger";
import type { WeekRow } from "@/lib/dashboard/ledger";

// Fixture-based render assertions for the Weekly Ledger (NFR-26): week keys
// and the in-progress row's distinctness (AC-W1), sparse/gap-week handling
// (AC-W7), drill-down links (AC-W6), and the cold-start note (AC-W9).
// Rendered with react-dom/server against synthetic fixtures, same pattern
// as tests/unit/dashboard-render.test.tsx.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const okDelta = (value: number, state: "good" | "warning" | "neutral" = "neutral"): WeekRow["columns"]["bodyFat"] => ({
  kind: "delta",
  value,
  state,
});

function completedWeek(weekStart: string, weekEnd: string, overrides: Partial<WeekRow["columns"]> = {}): WeekRow {
  return {
    weekStart,
    weekEnd,
    inProgress: false,
    daysElapsed: 7,
    isGap: false,
    columns: {
      bodyFat: okDelta(-0.2, "good"),
      weight: okDelta(-0.5),
      strain: { kind: "strainLevel", value: 12.4 },
      recovery: { kind: "recoveryLevel", avgPct: 68, redDays: 1 },
      leanMass: okDelta(-0.05, "neutral"),
      ...overrides,
    },
  };
}

const insufficient = (daysPresent: number): WeekRow["columns"]["bodyFat"] => ({
  kind: "insufficient",
  daysPresent,
});

const render = (rows: WeekRow[], completedWeeks: number) =>
  renderToStaticMarkup(<WeeklyLedger rows={rows} completedWeeks={completedWeeks} />);

describe("WeeklyLedger — empty state", () => {
  it("renders a passive empty message with no rows", () => {
    const markup = render([], 0);
    expect(markup).toContain("No readings yet.");
    expect(markup).not.toContain("data-ledger");
  });
});

describe("WeeklyLedger — week rows (AC-W1, AC-W5)", () => {
  it("renders one row per week, in the order given (newest first from the caller)", () => {
    const rows = [
      completedWeek("2026-07-13", "2026-07-19"),
      completedWeek("2026-07-06", "2026-07-12"),
    ];
    const markup = render(rows, 2);
    expect(markup.indexOf("Jul 13")).toBeLessThan(markup.indexOf("Jul 6"));
  });

  it("AC-W1: the in-progress row is labeled with days elapsed, styled distinctly, and not a drill-down link", () => {
    const inProgress: WeekRow = {
      weekStart: "2026-07-20",
      weekEnd: "2026-07-26",
      inProgress: true,
      daysElapsed: 4,
      isGap: false,
      columns: completedWeek("x", "y").columns,
    };
    const markup = render([inProgress, completedWeek("2026-07-13", "2026-07-19")], 2);
    expect(markup).toContain("this week · 4 of 7 days");
    // In-progress row renders as a plain div immediately wrapping its
    // content, not an <a href="/daily..."> drill-down link.
    expect(markup).toContain('data-week-row="in-progress"><div');
  });
});

describe("WeeklyLedger — drill-down (AC-W6)", () => {
  it("a completed week row links to /daily scoped to that week", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19")], 2);
    expect(markup).toContain('href="/daily?week=2026-07-13"');
    expect(markup).toContain('data-week-row="completed"');
  });
});

describe("WeeklyLedger — column states (AC-W3, AC-W4)", () => {
  it("renders signed deltas with pp/lb units and directional tone classes", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { bodyFat: okDelta(-0.3, "good") })],
      2,
    );
    expect(markup).toContain("−0.3 pp");
    expect(markup).toContain("text-emerald-700");
  });

  it("a rising body-fat week renders the warning tone", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { bodyFat: okDelta(0.3, "warning") })],
      2,
    );
    expect(markup).toContain("+0.3 pp");
    expect(markup).toContain("text-amber-700");
  });

  it("strain renders a level, not a delta", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { strain: { kind: "strainLevel", value: 14.55 } })],
      2,
    );
    expect(markup).toContain("14.6"); // one decimal
  });

  it("recovery renders the weekly average and red-day count", () => {
    const markup = render(
      [
        completedWeek("2026-07-13", "2026-07-19", {
          recovery: { kind: "recoveryLevel", avgPct: 68, redDays: 2 },
        }),
      ],
      2,
    );
    expect(markup).toContain("68% · 2 red days");
  });
});

describe("WeeklyLedger — sparse and gap weeks (AC-W7)", () => {
  it("an insufficient-data cell renders an em-dash with a day-count tooltip, no fabricated delta", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { bodyFat: insufficient(2) })],
      2,
    );
    expect(markup).toContain('title="2 of 7 days with data"');
  });

  it("a week with no data at all collapses to a single gap row, not five insufficient cells", () => {
    const gapRow: WeekRow = {
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      inProgress: false,
      daysElapsed: 7,
      isGap: true,
      columns: completedWeek("x", "y").columns,
    };
    const markup = render([completedWeek("2026-07-13", "2026-07-19"), gapRow], 2);
    expect(markup).toContain('data-week-row="gap"');
    expect(markup).toContain("no data this week");
    const gapStart = markup.indexOf('data-week-row="gap"');
    const gapBlock = markup.slice(gapStart);
    expect(gapBlock).not.toContain('title="'); // no per-column insufficient cells rendered
  });
});

describe("WeeklyLedger — cold start (AC-W9)", () => {
  it("shows the passive cold-start note when fewer than 2 completed weeks exist", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19")], 1);
    expect(markup).toContain("ledger builds as weeks complete — 1 week so far");
  });

  it("hides the cold-start note once at least 2 completed weeks exist", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19"), completedWeek("2026-07-06", "2026-07-12")],
      2,
    );
    expect(markup).not.toContain("ledger builds as weeks complete");
  });
});
