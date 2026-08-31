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
    // "/status" -> "/data" -> "/connect" (Data Page Redesign & Connect, PRD
    // §1; Rename /data Page to /connect, PRD §1): this is an ordinary,
    // non-stub test (carries no DO-NOT-EDIT header), so its href list gets
    // an ordinary update, not a PRD-authorized stub exception.
    for (const href of ["/weekly", "/daily", "/settings/targets", "/log-meal", "/connect"]) {
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
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation,
 * except the exact value edits and name grooms this file's own PRD-cited
 * slice enumerates.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("nav header CTA text and outline (AC-D19, AC-D20)", () => {
  it('AC-D19: the live variant\'s Log Meal link reads exactly "Log Meal", not "+ Log meal"', () => {
    const markup = renderToStaticMarkup(<NavHeader variant="live" />);
    expect(markup).toContain(">Log Meal<");
    expect(markup).not.toContain("+ Log meal");
  });

  it("AC-D20: the live variant's Log Meal and Connect links render no border, other classes unchanged", () => {
    const markup = renderToStaticMarkup(<NavHeader variant="live" />);
    expect(markup).not.toContain("border-zinc-200");
    expect(markup).not.toContain("border-zinc-800");
    expect(markup).toContain(
      "rounded-md px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900",
    );
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation,
 * except the exact value edits and name grooms this file's own PRD-cited
 * slice enumerates.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("nav header active highlight — Connect, Log Meal, Targets (AC-DS18, AC-DS19, AC-DS20, AC-DS21)", () => {
  // NavHeader's `active` prop is typed "weekly" | "daily" today; PRD §0.8
  // widens it to this exact union — casting to it here (rather than
  // `@ts-expect-error`) stays valid both before and after that widening ships,
  // so this stub never needs a build-time edit to its own type-check status.
  type ProspectiveActive = "weekly" | "daily" | "connect" | "logmeal" | "targets";
  const ACTIVE_CLASSES = "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";

  function linkMarkup(markup: string, href: string): string | null {
    const escaped = href.replace(/\//g, "\\/");
    return markup.match(new RegExp(`<a[^>]*href="${escaped}"[^>]*>`))?.[0] ?? null;
  }

  it('AC-DS18: active="connect" highlights the Connect link (bg-zinc-900 text-white / dark:bg-zinc-100 dark:text-zinc-900) and no other link', () => {
    const markup = renderToStaticMarkup(
      <NavHeader active={"connect" as ProspectiveActive} />,
    );
    expect(markup).toContain(">Connect<");
    const dataLink = linkMarkup(markup, "/connect");
    expect(dataLink).not.toBeNull();
    expect(dataLink).toContain(ACTIVE_CLASSES);
    for (const href of ["/weekly", "/daily", "/settings/targets", "/log-meal"]) {
      const link = linkMarkup(markup, href);
      expect(link).not.toBeNull();
      expect(link).not.toContain(ACTIVE_CLASSES);
    }
  });

  it('AC-DS19: active="logmeal" highlights the Log Meal link and no other link', () => {
    const markup = renderToStaticMarkup(
      <NavHeader active={"logmeal" as ProspectiveActive} />,
    );
    const logMealLink = linkMarkup(markup, "/log-meal");
    expect(logMealLink).not.toBeNull();
    expect(logMealLink).toContain(ACTIVE_CLASSES);
    for (const href of ["/weekly", "/daily", "/settings/targets", "/connect"]) {
      const link = linkMarkup(markup, href);
      expect(link).not.toBeNull();
      expect(link).not.toContain(ACTIVE_CLASSES);
    }
  });

  it('AC-DS20 (regression, cross-page isolation): active="weekly" or active="daily" leaves Connect, Log Meal, and Targets in their non-active treatment, and Weekly/Daily\'s own existing active behavior is unchanged', () => {
    for (const active of ["weekly", "daily"] as const) {
      const markup = renderToStaticMarkup(<NavHeader active={active} />);
      for (const href of ["/connect", "/log-meal", "/settings/targets"]) {
        const link = linkMarkup(markup, href);
        expect(link).not.toBeNull();
        expect(link).not.toContain(ACTIVE_CLASSES);
      }
      const activeHref = active === "weekly" ? "/weekly" : "/daily";
      const activeLink = linkMarkup(markup, activeHref);
      expect(activeLink).not.toBeNull();
      expect(activeLink).toContain(ACTIVE_CLASSES);
    }
  });

  it('AC-DS21: active="targets" highlights the Targets link and no other link', () => {
    const markup = renderToStaticMarkup(
      <NavHeader active={"targets" as ProspectiveActive} />,
    );
    const targetsLink = linkMarkup(markup, "/settings/targets");
    expect(targetsLink).not.toBeNull();
    expect(targetsLink).toContain(ACTIVE_CLASSES);
    for (const href of ["/weekly", "/daily", "/connect", "/log-meal"]) {
      const link = linkMarkup(markup, href);
      expect(link).not.toBeNull();
      expect(link).not.toContain(ACTIVE_CLASSES);
    }
  });
});
