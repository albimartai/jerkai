import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Dashboard from "@/app/ui/dashboard";
import type { DashboardData } from "@/lib/dashboard/data";

// Fixture-based render assertions for the v1.1 noise-reduction outcome
// (NFR-19): the default view's chart count (AC-N13), the demoted Recovery
// strip (AC-N6), the strain strip's trend-primary treatment (AC-N5), the
// readout row's chart-free passivity (AC-N10), lb display units (NFR-16),
// and outlier absorption by the trend lines (AC-N14). Rendered with
// react-dom/server against synthetic fixtures — no browser, CI-friendly.

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

const render = (data: DashboardData) => renderToStaticMarkup(<Dashboard data={data} />);

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
  it("AC-N13: exactly four charts render with the Whoop detail collapsed", () => {
    const markup = render(fixture(40));
    const charts = [...markup.matchAll(/data-chart="([^"]+)"/g)].map((m) => m[1]);
    expect(charts).toEqual(["bodyFat", "weight", "strain", "leanMass"]);
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
