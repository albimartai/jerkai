import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Dashboard from "@/app/ui/dashboard";
import type { DashboardData } from "@/lib/dashboard/data";
import { buildCalorieSeries, type CalorieDay } from "@/lib/dashboard/calorie-strip";
import type { TargetRow } from "@/lib/targets";

// Fixture-based render assertions for the v1.1 noise-reduction outcome
// (NFR-19): the default view's chart count (AC-N13, amended to five by
// DL-pending-2/AC-M14), the demoted Recovery strip (AC-N6), the strain
// strip's trend-primary treatment (AC-N5), the readout row's chart-free
// passivity (AC-N10), lb display units (NFR-16), outlier absorption by the
// trend lines (AC-N14), and the Log Meal slice's calories strip (AC-M6,
// AC-M8). Rendered with react-dom/server against synthetic fixtures — no
// browser, CI-friendly.

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// A synthetic window: every metric present every day, so charts render with
// full series and no gap handling in play unless a test injects one.
function fixture(days: number, overrides: Partial<DashboardData> = {}): DashboardData {
  const axis = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 5, 1 + i));
    return date.toISOString().slice(0, 10);
  });
  const flat = (value: number) => axis.map(() => value as number | null);
  return {
    axis,
    series: {
      bodyFatPct: flat(18.4),
      weight: flat(180),
      leanBodyMass: flat(152),
      dayStrain: flat(12),
      recoveryScore: flat(70),
      hrv: flat(65),
      rhr: flat(52),
      sleepDuration: flat(7.4),
      ...overrides.series,
    },
    units: {
      bodyFatPct: "%",
      weight: "lb",
      leanBodyMass: "lb",
      dayStrain: null,
      recoveryScore: "%",
      hrv: "ms",
      rhr: "bpm",
      sleepDuration: "hr",
      ...overrides.units,
    },
    latestDay: axis[axis.length - 1],
  };
}

// Default calorie fixture: flat 2000 kcal/day, no targets — every bar renders "neutral"
// unless a test overrides it. Built through the real buildCalorieSeries (not a hand-rolled
// stand-in) so these tests exercise the same per-day resolution the strip renders from.
function calorieFixture(axis: readonly string[], dailyCalories?: (number | null)[], targets?: TargetRow[]): CalorieDay[] {
  return buildCalorieSeries(axis, dailyCalories ?? axis.map(() => 2000), targets ?? []);
}

const render = (data: DashboardData, calorieSeries?: CalorieDay[]) =>
  renderToStaticMarkup(<Dashboard data={data} calorieSeries={calorieSeries ?? calorieFixture(data.axis)} />);

// The markup between one strip chart's opening tag and the next chart (or
// end of string) — coarse but stable, since charts never nest.
function chartBlock(markup: string, id: string): string {
  const start = markup.indexOf(`data-chart="${id}"`);
  expect(start, `chart '${id}' should be in the markup`).toBeGreaterThan(-1);
  const rest = markup.slice(start + 1);
  const next = rest.search(/data-chart="/);
  return next === -1 ? markup.slice(start) : markup.slice(start, start + 1 + next);
}

// Parse "x,y x,y …" polyline points from a data-series svg inside a block.
function seriesLinePoints(block: string, series: string): { x: number; y: number }[] {
  const svgMatch = block.match(
    new RegExp(`data-series="${series}"[\\s\\S]*?points="([^"]+)"`),
  );
  expect(svgMatch, `series '${series}' polyline should exist`).not.toBeNull();
  return svgMatch![1]
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

// The rendered top-position (viewBox %) of the raw dot for a given axis index.
function rawDotTop(block: string, index: number): number {
  const dotMatch = block.match(
    new RegExp(`data-raw-dot="${index}"[^>]*top:([0-9.]+)%`),
  );
  expect(dotMatch, `raw dot for index ${index} should be plotted`).not.toBeNull();
  return Number(dotMatch![1]);
}

describe("dashboard default view (AC-N13, AC-N6, AC-N10)", () => {
  // Re-scoped per NFR-20/AC-M14: the four-chart count was the pre-Log-Meal baseline
  // (v1.1). This test now asserts five, with the calories strip inserted between Day
  // Strain and Lean body mass (OQ-2 default: drivers grouped, DRIVER · MANUAL tag).
  it("AC-M14 (supersedes AC-N13's count): exactly five charts render with the Whoop detail collapsed", () => {
    const markup = render(fixture(40));
    const charts = [...markup.matchAll(/data-chart="([^"]+)"/g)].map((m) => m[1]);
    expect(charts).toEqual(["bodyFat", "weight", "strain", "calories", "leanMass"]);
  });

  it("AC-N13/AC-N10: exactly one readout row renders, directly below the strip stack", () => {
    const markup = render(fixture(40));
    const rows = markup.match(/data-readout-row/g) ?? [];
    expect(rows).toHaveLength(1);
    // Below the last chart, above the Whoop-detail toggle.
    expect(markup.indexOf("data-readout-row")).toBeGreaterThan(
      markup.indexOf('data-chart="leanMass"'),
    );
    expect(markup.indexOf("data-readout-row")).toBeLessThan(markup.indexOf("Whoop detail"));
  });

  it("AC-N6: no Recovery Score strip appears in the main stack; it appears in the readout row", () => {
    const markup = render(fixture(40));
    expect(markup).not.toContain('data-chart="recovery"');
    expect(markup).toContain("Recovery 7d");
  });

  it("AC-N10: readouts are summary statistics, never charts", () => {
    const markup = render(fixture(40));
    const start = markup.indexOf("data-readout-row");
    const block = markup.slice(start, markup.indexOf("Whoop detail"));
    expect(block).not.toContain("<svg");
  });

  it("AC-N8/AC-N9: both guardrail readouts render with their statistics", () => {
    const markup = render(fixture(40));
    expect(markup).toMatch(/Lean mass 30d/);
    expect(markup).toMatch(/Recovery 7d 70% · 0 red days/);
  });
});

describe("strip treatment (AC-N1, AC-N5, NFR-16)", () => {
  it("AC-N5: the strain strip renders faint raw dots plus a 7-day line, not bars", () => {
    const markup = render(fixture(40));
    const block = chartBlock(markup, "strain");
    expect(block).toContain('data-series="avg7"');
    expect(block).toContain('data-raw-dot="0"');
  });

  it("AC-N1/AC-N4: weight and lean mass each render raw dots plus 7d and 30d lines", () => {
    const markup = render(fixture(40));
    for (const id of ["weight", "leanMass"]) {
      const block = chartBlock(markup, id);
      expect(block).toContain('data-series="avg7"');
      expect(block).toContain('data-series="avg30"');
      expect(block).toContain('data-raw-dot="0"');
    }
  });

  it("NFR-16: kg-stored weight displays in lb", () => {
    const data = fixture(40);
    data.series.weight = data.axis.map(() => 80);
    data.units.weight = "kg";
    const markup = render(data);
    // 80 kg ≈ 176.4 lb in the weight strip's summary readout.
    expect(markup).toContain("176.4 lb");
  });
});

describe("expanded Whoop detail (AC-N12, AC-N6)", () => {
  const expanded = () => {
    const data = fixture(40);
    return renderToStaticMarkup(
      <Dashboard data={data} calorieSeries={calorieFixture(data.axis)} initialWhoopOpen />,
    );
  };

  it("AC-N12: HRV, RHR, sleep, and Recovery Score strips all render dots plus a 7-day line", () => {
    const markup = expanded();
    for (const id of ["hrv", "rhr", "sleep", "recovery"]) {
      const block = chartBlock(markup, id);
      expect(block).toContain('data-series="avg7"');
      expect(block).toContain('data-raw-dot="0"');
    }
  });

  it("AC-N6/AC-N13: expanding the detail adds exactly the four Whoop strips", () => {
    const charts = [...expanded().matchAll(/data-chart="([^"]+)"/g)].map((m) => m[1]);
    expect(charts).toEqual([
      "bodyFat",
      "weight",
      "strain",
      "calories",
      "leanMass",
      "hrv",
      "rhr",
      "sleep",
      "recovery",
    ]);
  });
});

describe("calories strip (AC-M6, AC-M8, AC-M11, DL-pending-3)", () => {
  it("AC-M6: the strip is labeled DRIVER · MANUAL and sits directly below Day Strain", () => {
    const markup = render(fixture(40));
    // The tag renders in the Strip shell's label area, just before its own data-chart
    // div — i.e. between the PRECEDING chart's data-chart marker and this one's.
    const strainStart = markup.indexOf('data-chart="strain"');
    const caloriesStart = markup.indexOf('data-chart="calories"');
    const labelRegion = markup.slice(strainStart, caloriesStart);
    expect(labelRegion).toContain("DRIVER");
    expect(labelRegion).toContain("MANUAL");
    expect(strainStart).toBeLessThan(caloriesStart);
    expect(caloriesStart).toBeLessThan(markup.indexOf('data-chart="leanMass"'));
  });

  it("AC-M8: a day with no logged entry renders as a gap, distinct from a genuinely logged day", () => {
    const data = fixture(3);
    const dailyCalories = [null, 200, 2000];
    const markup = render(data, calorieFixture(data.axis, dailyCalories));
    const block = chartBlock(markup, "calories");
    expect(block).toContain('data-bar="0" data-bar-state="gap"');
    expect(block).not.toContain('data-bar="1" data-bar-state="gap"');
    expect(block).not.toContain('data-bar="2" data-bar-state="gap"');
  });

  it("AC-M11: with no target in force, every bar renders neutral, never over/under", () => {
    const data = fixture(5);
    const markup = render(data, calorieFixture(data.axis, undefined, []));
    const block = chartBlock(markup, "calories");
    expect(block).not.toContain('data-bar-state="over"');
    expect(block).not.toContain('data-bar-state="under"');
    expect(block).toContain('data-bar-state="neutral"');
  });

  it("DL-pending-3: days on either side of a target change color against their own day's target, not one target for the whole strip", () => {
    const axis = ["2026-07-14", "2026-07-15", "2026-07-16"];
    const targets: TargetRow[] = [
      {
        id: 1,
        effectiveDate: "2026-07-01",
        caloriesTarget: 2500,
        proteinTargetG: 180,
        carbsTargetG: null,
        fatTargetG: null,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: 2,
        effectiveDate: "2026-07-15",
        caloriesTarget: 2100,
        proteinTargetG: 170,
        carbsTargetG: null,
        fatTargetG: null,
        createdAt: "2026-07-15T00:00:00.000Z",
      },
    ];
    const data = fixture(3);
    data.axis = axis; // fixture() generates its own dates; substitute ones that straddle the target change
    const dailyCalories = [2200, 2200, 2200];
    const markup = render(data, calorieFixture(axis, dailyCalories, targets));
    const block = chartBlock(markup, "calories");
    expect(block).toContain('data-bar="0" data-bar-state="under"'); // 2200 <= 2500 (old target)
    expect(block).toContain('data-bar="1" data-bar-state="over"'); // 2200 > 2100 (new target)
    expect(block).toContain('data-bar="2" data-bar-state="over"');
  });
});

describe("outlier absorption (AC-N14)", () => {
  it("AC-N14: a single-day weight outlier stays plotted as a raw dot while the trend lines absorb it", () => {
    // 30 days exactly, so the default 30-day window cut is the identity and
    // fixture indices equal rendered dot indices.
    const data = fixture(30);
    const outlierIndex = 20;
    data.series.weight = data.axis.map((_, i) => (i === outlierIndex ? 195 : 180));
    const markup = render(data);
    const block = chartBlock(markup, "weight");

    // Baseline vertical position: a flat-region dot far from the outlier.
    const baselineTop = rawDotTop(block, 5);
    const outlierTop = rawDotTop(block, outlierIndex);
    const dotDeviation = Math.abs(outlierTop - baselineTop);
    expect(dotDeviation).toBeGreaterThan(30); // the raw outlier is visually far off baseline

    for (const series of ["avg7", "avg30"]) {
      const points = seriesLinePoints(block, series);
      const maxLineDeviation = Math.max(...points.map((p) => Math.abs(p.y - baselineTop)));
      // "Visibly absorbs": the line's worst excursion is a small fraction of
      // the raw dot's excursion.
      expect(maxLineDeviation).toBeLessThan(dotDeviation * 0.25);
    }
  });
});
