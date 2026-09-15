/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Engine Page
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import EngineLedger from "@/app/ui/engine-ledger";
import type { EngineWeekRow } from "@/lib/dashboard/engine";

// Fixture-based render assertions for the Engine ledger (PRD §1
// app/ui/engine-ledger.tsx bullet), modeled on
// tests/unit/weekly-ledger-render.test.tsx: four-column header text
// (AC-E1), gap-row text (AC-E2), per-column insufficient data (AC-E3),
// in-progress row has no drill-down link (AC-E4), each column's rendered
// text in a single neutral tone (AC-E5-AC-E8, NFR-175), Recovery's red-day
// warning tone only when redDays > 0 (AC-E8), and the completed-row
// drill-down link (AC-E14).

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function completedWeek(
  weekStart: string,
  weekEnd: string,
  overrides: Partial<EngineWeekRow["columns"]> = {},
): EngineWeekRow {
  return {
    weekStart,
    weekEnd,
    inProgress: false,
    daysElapsed: 7,
    isGap: false,
    columns: {
      strain: { kind: "delta", value: 1.2 },
      recovery: { kind: "recovery", avgPct: 62, redDays: 0 },
      hrv: { kind: "delta", value: 3 },
      rhr: { kind: "delta", value: -2 },
      ...overrides,
    },
  };
}

const render = (rows: EngineWeekRow[], completedWeeks: number) =>
  renderToStaticMarkup(<EngineLedger rows={rows} completedWeeks={completedWeeks} />);

describe("EngineLedger — bare case (AC-E1)", () => {
  it("AC-E1 (bare case): header row shows Week, Strain, Recovery, HRV, RHR in that order, one row per week", () => {
    const rows = [completedWeek("2026-07-13", "2026-07-19"), completedWeek("2026-07-06", "2026-07-12")];
    const markup = render(rows, 2);
    const headers = ["Week", "Strain", "Recovery", "HRV", "RHR"];
    const indices = headers.map((h) => markup.indexOf(`>${h}<`));
    for (const index of indices) {
      expect(index).toBeGreaterThan(-1);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
    expect(markup.indexOf("Jul 13")).toBeLessThan(markup.indexOf("Jul 6"));
  });

  it("AC-E1: EngineLedger renders its own NavHeader with the Engine link present", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19")], 2);
    expect(markup).toContain('href="/engine"');
    expect(markup).toContain(">Engine<");
  });

  it("AC-E4: shows the passive cold-start note when fewer than 2 completed weeks exist", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19")], 1);
    expect(markup).toContain("1 week so far");
  });
});

describe("EngineLedger — gap and sparse weeks (AC-E2, AC-E3)", () => {
  it("AC-E2: a week with no data at all collapses to a single gap row, not four insufficient cells", () => {
    const gapRow: EngineWeekRow = {
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
  });

  it("AC-E3: an insufficient Strain cell renders an em-dash with a day-count tooltip, independent of the other columns in the same row", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { strain: { kind: "insufficient", daysPresent: 2 } })],
      2,
    );
    expect(markup).toContain('title="2 of 7 days with data"');
  });
});

describe("EngineLedger — in-progress row and drill-down (AC-E4, AC-E14)", () => {
  it("AC-E4: the in-progress row is labeled with days elapsed, styled distinctly, and not a drill-down link", () => {
    const inProgress: EngineWeekRow = {
      weekStart: "2026-07-20",
      weekEnd: "2026-07-26",
      inProgress: true,
      daysElapsed: 4,
      isGap: false,
      columns: completedWeek("x", "y").columns,
    };
    const markup = render([inProgress, completedWeek("2026-07-13", "2026-07-19")], 2);
    expect(markup).toContain("this week · 4 of 7 days");
    expect(markup).toContain('data-week-row="in-progress"><div');
  });

  it("AC-E14: a completed week row links to /daily scoped to that week's Monday", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19")], 2);
    expect(markup).toContain('href="/daily?week=2026-07-13"');
    expect(markup).toContain('data-week-row="completed"');
  });
});

describe("EngineLedger — column rendering, neutral tone only (AC-E5, AC-E6, AC-E7, NFR-175)", () => {
  it("AC-E5: Strain delta renders a one-decimal signed value with no unit, in a single neutral tone — never colored good/warning", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19", { strain: { kind: "delta", value: 1.2 } })], 2);
    expect(markup).toContain("+1.2");
    expect(markup).not.toContain("text-emerald-700");
    expect(markup).not.toContain("text-amber-700");
  });

  it("AC-E6: HRV delta renders a zero-decimal signed ms value, in a single neutral tone — never colored good/warning", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19", { hrv: { kind: "delta", value: -3 } })], 2);
    expect(markup).toContain("−3 ms");
    expect(markup).not.toContain("text-emerald-700");
    expect(markup).not.toContain("text-amber-700");
  });

  it("AC-E7: RHR delta renders a zero-decimal signed bpm value, in a single neutral tone — never colored good/warning", () => {
    const markup = render([completedWeek("2026-07-13", "2026-07-19", { rhr: { kind: "delta", value: 2 } })], 2);
    expect(markup).toContain("+2 bpm");
    expect(markup).not.toContain("text-emerald-700");
    expect(markup).not.toContain("text-amber-700");
  });
});

describe("EngineLedger — Recovery cell (AC-E8)", () => {
  it("AC-E8: Recovery cell renders '{avgPct}% · {redDays} red days', with the red-day clause in a warning tone when redDays > 0", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { recovery: { kind: "recovery", avgPct: 55, redDays: 2 } })],
      2,
    );
    expect(markup).toContain("55% · 2 red days");
    expect(markup).toContain("text-amber-700");
  });

  it("AC-E8: Recovery's average percentage is always neutral tone, and the red-day clause carries no warning tone when redDays is 0", () => {
    const markup = render(
      [completedWeek("2026-07-13", "2026-07-19", { recovery: { kind: "recovery", avgPct: 70, redDays: 0 } })],
      2,
    );
    expect(markup).toContain("70% · 0 red days");
    expect(markup).not.toContain("text-amber-700");
  });
});
