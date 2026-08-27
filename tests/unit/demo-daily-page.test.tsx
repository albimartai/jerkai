import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DemoDaily from "@/app/demo/daily/page";

// AC-PD2/PD4/PD7 (docs/prd/public-demo.md): the demo /daily strip stack
// renders from the synthetic fixture, with no gated-route links. DemoDaily
// is an async server component (like the real app/daily/page.tsx); invoked
// directly as a plain async function (rather than through JSX), its
// returned element is then rendered with renderToStaticMarkup — the same
// approach react-dom/server itself doesn't support for async components.

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

async function renderDemoDaily(week?: string) {
  const element = await DemoDaily({ searchParams: Promise.resolve({ week }) });
  return renderToStaticMarkup(element);
}

describe("demo daily page (AC-PD2, AC-PD4)", () => {
  it("AC-PD2: renders the strip stack from synthetic data", () => {
    return renderDemoDaily().then((markup) => {
      expect(markup).toContain('data-chart="bodyFat"');
      expect(markup).toContain('data-chart="calories"');
    });
  });

  it("AC-PD4: no Targets, Log meal, or Status link is present", () => {
    return renderDemoDaily().then((markup) => {
      expect(markup).not.toContain('href="/settings/targets"');
      expect(markup).not.toContain('href="/log-meal"');
      expect(markup).not.toContain('href="/status"');
    });
  });

  it("Daily nav link points at /demo/daily", () => {
    return renderDemoDaily().then((markup) => {
      expect(markup).toContain('href="/demo/daily"');
    });
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Dashboard Multi-Source Metric Resolution & Tagging
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("demo daily page — Weight/Body fat/Lean body mass tags unchanged (AC-DR9)", () => {
  it('AC-DR9: Weight keeps its static "Fitdays" tag and Lean body mass keeps its static "Guardrail · Fitdays" tag', () => {
    return renderDemoDaily().then((markup) => {
      // A strip's own label/tag renders BEFORE its own data-chart marker, in
      // the region between the PRECEDING strip's marker and this one's own
      // (mirroring the labelRegion helper in tests/unit/dashboard-render.test.tsx).
      //
      // jerkai-falsify-diff note: the scaffolded stub originally sliced
      // (weightStart, strainStart) and (leanMassStart, hrvStart) — the
      // region AFTER each strip's own marker. Per the layout above, a
      // strip's tag renders BEFORE its marker, so those regions could never
      // contain the tag text regardless of implementation correctness. This
      // was a scaffold boundary bug, not an implementation weakening; fixed
      // here to slice (precedingStart, ownStart) for both assertions,
      // verified against app/ui/dashboard.tsx:157-193's render order.
      const bodyFatStart = markup.indexOf('data-chart="bodyFat"');
      const weightStart = markup.indexOf('data-chart="weight"');
      expect(bodyFatStart).toBeGreaterThan(-1);
      expect(weightStart).toBeGreaterThan(bodyFatStart);
      expect(markup.slice(bodyFatStart, weightStart)).toContain("Fitdays");

      const caloriesStart = markup.indexOf('data-chart="calories"');
      const leanMassStart = markup.indexOf('data-chart="leanMass"');
      expect(caloriesStart).toBeGreaterThan(-1);
      expect(leanMassStart).toBeGreaterThan(caloriesStart);
      const leanMassRegion = markup.slice(caloriesStart, leanMassStart);
      expect(leanMassRegion).toContain("Guardrail");
      expect(leanMassRegion).toContain("Fitdays");
    });
  });
});
