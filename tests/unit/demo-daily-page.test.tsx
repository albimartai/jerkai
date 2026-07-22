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
