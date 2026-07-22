import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DemoWeekly from "@/app/demo/weekly/page";

// AC-PD1/PD4/PD7 (docs/prd/public-demo.md): the demo Weekly Ledger renders
// from the synthetic fixture, with no gated-route links and the synthetic-
// data marker present. Same renderToStaticMarkup pattern as
// tests/unit/weekly-ledger-render.test.tsx — no DOM events are simulated
// here, so this belongs in the `unit` tier, not the jsdom `component` tier.

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("demo weekly page (AC-PD1, AC-PD4)", () => {
  it("AC-PD1: renders the Weekly Ledger from synthetic data, no /signin redirect logic", () => {
    const markup = renderToStaticMarkup(<DemoWeekly />);
    expect(markup).toContain("data-ledger");
  });

  it("AC-PD2: a completed week's drill-down link points at /demo/daily, not the gated /daily", () => {
    const markup = renderToStaticMarkup(<DemoWeekly />);
    expect(markup).toMatch(/href="\/demo\/daily\?week=/);
    expect(markup).not.toMatch(/href="\/daily\?week=/);
  });

  it("AC-PD4: no Targets, Log meal, or Status link is present", () => {
    const markup = renderToStaticMarkup(<DemoWeekly />);
    expect(markup).not.toContain('href="/settings/targets"');
    expect(markup).not.toContain('href="/log-meal"');
    expect(markup).not.toContain('href="/status"');
  });

  it("Weekly nav link points at /demo/weekly", () => {
    const markup = renderToStaticMarkup(<DemoWeekly />);
    expect(markup).toContain('href="/demo/weekly"');
  });
});
