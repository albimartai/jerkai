import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NavHeader } from "@/app/ui/nav-header";

// NFR-61 (docs/prd/demo-about.md): the About link is added to the `demo` nav
// variant only. Both halves of that requirement — demo gains it, live does
// not — live here rather than in either demo page test, so the symmetric
// claim is asserted in one place against NavHeader directly.

// Forwards every prop, not just href/children: NavHeader sets aria-current on
// the active link, and a shim that dropped it would make the "nothing is
// active" assertions below pass vacuously.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("nav header variants (AC-AB2, NFR-61)", () => {
  it("AC-AB2: the demo variant renders an About link to /demo/about", () => {
    const markup = renderToStaticMarkup(<NavHeader variant="demo" />);
    expect(markup).toContain('href="/demo/about"');
    expect(markup).toContain("About");
  });

  it("AC-AB2/NFR-61: the live variant renders no About link", () => {
    const markup = renderToStaticMarkup(<NavHeader variant="live" />);
    expect(markup).not.toContain("/demo/about");
    expect(markup).not.toContain("About");
  });

  it("NFR-61: the live variant's existing links are unchanged by this slice", () => {
    const markup = renderToStaticMarkup(<NavHeader active="weekly" />);
    for (const href of ["/weekly", "/daily", "/settings/targets", "/log-meal", "/status"]) {
      expect(markup).toContain(`href="${href}"`);
    }
    expect(markup).toContain('aria-current="page"');
  });

  it("AC-AB5: with no active prop, neither resolution link renders as active", () => {
    const markup = renderToStaticMarkup(<NavHeader variant="demo" />);
    expect(markup).not.toContain('aria-current="page"');
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Nav Header Cleanup & Status Page Chrome
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("nav header CTA text and outline (AC-D19, AC-D20)", () => {
  it('AC-D19: the live variant\'s Log Meal link reads exactly "Log Meal", not "+ Log meal"', () => {
    const markup = renderToStaticMarkup(<NavHeader variant="live" />);
    expect(markup).toContain(">Log Meal<");
    expect(markup).not.toContain("+ Log meal");
  });

  it("AC-D20: the live variant's Log Meal and Status links render no border, other classes unchanged", () => {
    const markup = renderToStaticMarkup(<NavHeader variant="live" />);
    expect(markup).not.toContain("border-zinc-200");
    expect(markup).not.toContain("border-zinc-800");
    expect(markup).toContain(
      "rounded-md px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900",
    );
  });
});
