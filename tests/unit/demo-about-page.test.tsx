import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DemoAbout, { metadata } from "@/app/demo/about/page";

// AC-AB2..AC-AB7 (docs/prd/demo-about.md): the About surface is static text
// with outbound links, so the renderToStaticMarkup pattern used by the other
// demo page tests is sufficient — no DOM event is simulated here, which is
// why this belongs in the `unit` tier and not the jsdom `component` tier
// (NFR-62).
//
// Copy assertions are deliberately headings + one distinctive phrase per
// section, never whole paragraphs (IN-4): a whole-string assertion turns
// every punctuation fix into a test failure, while the heading assertions
// catch the failure that actually matters — a section silently dropped in
// transcription.

// Forwards every prop, not just href/children — NavHeader sets aria-current
// on the active link, and the AC-AB5 assertion below depends on that
// attribute actually surviving into the markup.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const markup = () => renderToStaticMarkup(<DemoAbout />);

describe("demo about page (AC-AB3, AC-AB5, AC-AB6, AC-AB7)", () => {
  it("AC-AB3: renders all four section headings as real heading elements", () => {
    const html = markup();
    for (const heading of [
      "The problem it solves",
      "What you&#x27;re seeing is not real data",
      "What&#x27;s intentionally missing",
      "Why I built it",
    ]) {
      expect(html).toMatch(new RegExp(`<h[1-6][^>]*>${heading}</h[1-6]>`));
    }
  });

  it("AC-AB3: renders the two-screen list as a real list, not flattened prose", () => {
    const html = markup();
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toMatch(/<li[^>]*>[\s\S]*Weekly[\s\S]*<\/li>/);
    expect(html).toMatch(/<li[^>]*>[\s\S]*Daily[\s\S]*<\/li>/);
  });

  it("AC-AB3: carries a distinctive phrase from each of the four sections", () => {
    const html = markup();
    expect(html).toContain("treats the daily body fat reading as noise");
    expect(html).toContain("Every number on this demo is synthetic");
    expect(html).toContain("Those all write data");
    expect(html).toContain("one north star, three drivers, two guardrails");
  });

  it("AC-AB3: names the synthetic data and the deliberate exclusion of the write features", () => {
    const html = markup();
    // The two claims the page exists to make: the data is invented, and the
    // missing write surfaces are a safety property rather than a gap.
    expect(html).toMatch(/can&#x27;t.{0,40}reach the real database/);
    expect(html).toContain("safe to publish");
    expect(html).toContain("read-only by design");
  });

  it("NFR-60: ships the exact GitHub and LinkedIn URLs with no placeholder href", () => {
    const html = markup();
    expect(html).toContain('href="https://github.com/albimartai/jerkai"');
    expect(html).toContain('href="https://linkedin.com/in/albimart"');
    // A dead link on a public portfolio page is worse than no page at all.
    expect(html).not.toMatch(/href="#?"/);
  });

  it("NFR-58: external links carry rel=noopener noreferrer", () => {
    const html = markup();
    const externalLinks = html.match(/<a [^>]*href="https:\/\/[^"]*"[^>]*>/g) ?? [];
    expect(externalLinks).toHaveLength(2);
    for (const link of externalLinks) {
      expect(link).toContain('rel="noopener noreferrer"');
    }
  });

  it("AC-AB2/AC-AB5: renders the demo nav, so About is a stop on the demo and not a dead end", () => {
    const html = markup();
    expect(html).toContain('href="/demo/weekly"');
    expect(html).toContain('href="/demo/daily"');
    // Neither resolution link is active while on About, and no gated or
    // write-adjacent link leaks onto the surface (AC-PD4 still in force).
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('href="/log-meal"');
    expect(html).not.toContain('href="/settings/targets"');
    expect(html).not.toContain('href="/status"');
  });

  it("AC-AB4: adds no second synthetic-data disclaimer (the banner comes from the layout)", () => {
    expect(markup()).not.toContain("not real biometrics");
  });

  it("AC-AB7: exports page-level metadata naming it a demo on synthetic data", () => {
    expect(String(metadata.title)).toMatch(/About/);
    expect(`${metadata.title} ${metadata.description}`).toMatch(/synthetic/i);
    // robots is deliberately NOT redeclared here: Next shallow-merges
    // per-route metadata over the layout's, so the allow-index posture
    // locked in NFR-54 is inherited rather than restated.
    expect(metadata.robots).toBeUndefined();
  });
});
