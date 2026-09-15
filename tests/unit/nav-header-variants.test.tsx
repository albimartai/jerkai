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

  it("AC-M39/NFR-61: the live variant shows exactly Body, Daily, Fuel, Connect in order, with no separate Targets or Log Meal link", () => {
    const markup = renderToStaticMarkup(<NavHeader active="body" />);
    // "/status" -> "/data" -> "/connect" (Data Page Redesign & Connect, PRD
    // §1; Rename /data Page to /connect, PRD §1); "/settings/targets" +
    // "/log-meal" -> merged into "/fuel" (Fuel, PRD §1): this is an
    // ordinary, non-stub test (carries no DO-NOT-EDIT header), so its href
    // list gets an ordinary update, not a PRD-authorized stub exception.
    const hrefs = ["/body", "/daily", "/fuel", "/connect"];
    const indices = hrefs.map((href) => markup.indexOf(`href="${href}"`));
    for (const index of indices) {
      expect(index).toBeGreaterThan(-1);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
    expect(markup).not.toContain('href="/settings/targets"');
    expect(markup).not.toContain('href="/log-meal"');
    expect(markup).not.toContain(">Targets<");
    expect(markup).not.toContain(">Log Meal<");
    expect(markup).toContain('aria-current="page"');
  });

  it("AC-AB5: with no active prop, neither resolution link renders as active", () => {
    const markup = renderToStaticMarkup(<NavHeader variant="demo" />);
    expect(markup).not.toContain('aria-current="page"');
  });
});

// AC-D19/AC-D20 block retired in full (Fuel, PRD §0.2/§1): both asserted the
// standalone "Log Meal" nav link's exact text/border styling. That link no
// longer exists once Fuel replaces it with one "Fuel" link (AC-M39 above) —
// there is no element left for either assertion to describe.

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
describe("nav header active highlight — Connect, Fuel (AC-DS18, AC-M49, AC-DS20/AC-M40)", () => {
  // NavHeader's `active` prop is typed "weekly" | "daily" today; PRD §0.8
  // widens it to this exact union — casting to it here (rather than
  // `@ts-expect-error`) stays valid both before and after that widening ships,
  // so this stub never needs a build-time edit to its own type-check status.
  // Fuel (PRD §1) narrows+adds: "logmeal"/"targets" drop out, "fuel" replaces
  // them — the two merged routes share one highlight case now (AC-M49).
  type ProspectiveActive = "body" | "daily" | "connect" | "fuel";
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
    for (const href of ["/body", "/daily", "/fuel"]) {
      const link = linkMarkup(markup, href);
      expect(link).not.toBeNull();
      expect(link).not.toContain(ACTIVE_CLASSES);
    }
  });

  // AC-DS19 ("logmeal" highlight) and AC-DS21 ("targets" highlight) retired
  // in full (Fuel, PRD §0.2/§1) — replaced by one new case, AC-M49, since
  // both old nav targets are now the single /fuel link.
  it('AC-M49: active="fuel" highlights the Fuel link and no other link', () => {
    const markup = renderToStaticMarkup(
      <NavHeader active={"fuel" as ProspectiveActive} />,
    );
    const fuelLink = linkMarkup(markup, "/fuel");
    expect(fuelLink).not.toBeNull();
    expect(fuelLink).toContain(ACTIVE_CLASSES);
    for (const href of ["/body", "/daily", "/connect"]) {
      const link = linkMarkup(markup, href);
      expect(link).not.toBeNull();
      expect(link).not.toContain(ACTIVE_CLASSES);
    }
  });

  it('AC-DS20/AC-M40 (regression, cross-page isolation): active="body" or active="daily" leaves Connect and Fuel in their non-active treatment, and Body/Daily\'s own existing active behavior is unchanged', () => {
    for (const active of ["body", "daily"] as const) {
      const markup = renderToStaticMarkup(<NavHeader active={active} />);
      for (const href of ["/connect", "/fuel"]) {
        const link = linkMarkup(markup, href);
        expect(link).not.toBeNull();
        expect(link).not.toContain(ACTIVE_CLASSES);
      }
      const activeHref = active === "body" ? "/body" : "/daily";
      const activeLink = linkMarkup(markup, activeHref);
      expect(activeLink).not.toBeNull();
      expect(activeLink).toContain(ACTIVE_CLASSES);
    }
  });
});
