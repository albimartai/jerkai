import Link from "next/link";

// Shared header. `active` spans all five live-variant links (Body, Engine,
// Fuel, Daily, Connect) — originally just the Body/Daily resolution pair
// (AC-W8), widened additively as Connect, Fuel, and now Engine each joined
// the same highlight mechanism. Connect behavior is unchanged (AC-D15).

// `variant="demo"` (docs/prd/public-demo.md, AC-PD4) renders on the public
// demo surface: the resolution links point at the demo's own /demo/body
// and /demo/daily paths (never the gated real routes), and every
// write-adjacent or gated link — Engine included (AC-E13) — is omitted
// entirely, not disabled. Default "live" is today's unchanged behavior.
type NavVariant = "live" | "demo";

function resolutionHref(label: "Body" | "Daily", variant: NavVariant): string {
  const path = label === "Body" ? "body" : "daily";
  return variant === "demo" ? `/demo/${path}` : `/${path}`;
}

// Demo-only: the demo variant's own Body/Daily pair, rendered via its own
// map so the live variant's five-item restructure below (AC-E10) never
// touches what /demo/body and /demo/daily already emit (§0.6 landmine).
const RESOLUTION_LABELS = ["Body", "Daily"] as const;

type LiveActive = "body" | "engine" | "fuel" | "daily" | "connect";

// The five live-variant links, in nav order (AC-E10: Body, Engine, Fuel,
// Daily, Connect) — one ordered list rendered by a single .map(), so a
// future sixth item is one list entry rather than a new hardcoded branch.
// `ariaCurrent: true` marks Body/Daily's pre-existing aria-current="page"
// behavior; Engine/Fuel/Connect carry none, matching Fuel/Connect's
// existing precedent (AC-D18's DO NOT EDIT test asserts /connect renders
// with zero aria-current="page" anywhere).
const LIVE_NAV_ITEMS: ReadonlyArray<{ label: string; href: string; active: LiveActive; ariaCurrent: boolean }> = [
  { label: "Body", href: "/body", active: "body", ariaCurrent: true },
  { label: "Engine", href: "/engine", active: "engine", ariaCurrent: false },
  { label: "Fuel", href: "/fuel", active: "fuel", ariaCurrent: false },
  { label: "Daily", href: "/daily", active: "daily", ariaCurrent: true },
  { label: "Connect", href: "/connect", active: "connect", ariaCurrent: false },
];

export function NavHeader({
  active,
  variant = "live",
}: {
  active?: "body" | "daily" | "connect" | "fuel" | "engine";
  variant?: NavVariant;
} = {}) {
  return (
    <header className="flex items-center justify-between py-4">
      <span className="text-lg font-semibold tracking-tight">JerkAI</span>
      <nav className="flex items-center gap-1" aria-label="Dashboard resolution">
        {variant === "demo" ? (
          <>
            {RESOLUTION_LABELS.map((label) => {
              const isActive = active === label.toLowerCase();
              return (
                <Link
                  key={label}
                  href={resolutionHref(label, variant)}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-md px-2 py-1 text-sm ${
                    isActive
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
            {/* About (docs/prd/demo-about.md, AC-AB2, NFR-61) is demo-only: it
                explains the synthetic data and the deliberately absent write
                surfaces to a cold visitor, which the authenticated app has no
                reader for. It carries no active state. */}
            <Link
              href="/demo/about"
              className="ml-2 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              About
            </Link>
          </>
        ) : (
          LIVE_NAV_ITEMS.map((item) => {
            const isActive = active === item.active;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={item.ariaCurrent && isActive ? "page" : undefined}
                className={`ml-2 rounded-md px-3 py-1 text-sm first:ml-0 ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })
        )}
      </nav>
    </header>
  );
}
