import Link from "next/link";

// Shared header, routes named by resolution (AC-W8): Weekly (`/weekly`,
// default landing) and Daily (`/daily`, the strip-stack drill-down). Connect
// behavior is unchanged (AC-D15).

// `variant="demo"` (docs/prd/public-demo.md, AC-PD4) renders on the public
// demo surface: the resolution links point at the demo's own /demo/weekly
// and /demo/daily paths (never the gated real routes), and Targets/
// "+ Log meal"/Connect — every write-adjacent or gated link — are omitted
// entirely, not disabled. Default "live" is today's unchanged behavior.
type NavVariant = "live" | "demo";

function resolutionHref(label: "Weekly" | "Daily", variant: NavVariant): string {
  const path = label === "Weekly" ? "weekly" : "daily";
  return variant === "demo" ? `/demo/${path}` : `/${path}`;
}

const RESOLUTION_LABELS = ["Weekly", "Daily"] as const;

// `active` widens additively (Data Page Redesign & Connect, §0.8) from the original
// Weekly/Daily resolution pair to all five live-variant links — Connect, Log Meal, and
// Targets now participate in the identical highlight mechanism Weekly/Daily already used,
// with no new color or font (NFR-129/NFR-130). `undefined` still highlights nothing.
export function NavHeader({
  active,
  variant = "live",
}: {
  active?: "weekly" | "daily" | "connect" | "logmeal" | "targets";
  variant?: NavVariant;
} = {}) {
  return (
    <header className="flex items-center justify-between py-4">
      <span className="text-lg font-semibold tracking-tight">JerkAI</span>
      <nav className="flex items-center gap-1" aria-label="Dashboard resolution">
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
        {variant === "demo" ? (
          // About (docs/prd/demo-about.md, AC-AB2, NFR-61) is demo-only: it
          // explains the synthetic data and the deliberately absent write
          // surfaces to a cold visitor, which the authenticated app has no
          // reader for. It carries no active state — `active` is typed to the
          // Weekly/Daily resolution pair, and widening it would change the
          // shared live path too.
          <Link
            href="/demo/about"
            className="ml-2 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            About
          </Link>
        ) : (
          <>
            {/* Log Meal ships in this slice (AC-M13) — the CTA returns per AC-D14's own
                terms. "+ Log workout" stays absent (its slice hasn't shipped). Targets,
                Log Meal, and Connect (renamed from Data) each carry the same active-highlight
                ternary Weekly/Daily already use (AC-DS18/AC-DS19/AC-DS21, §0.8) — the
                zinc/emerald-consistent bg-zinc-900/dark:bg-zinc-100 formula, never a new
                color. No aria-current here (unlike Weekly/Daily, pre-existing): AC-D18's
                DO NOT EDIT test asserts /connect renders with zero aria-current="page"
                anywhere, and the PRD's own AC-DS18/19/21 text specifies only the visual
                treatment, not an aria-current claim. */}
            <Link
              href="/settings/targets"
              className={`ml-2 rounded-md px-2 py-1 text-sm ${
                active === "targets"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              Targets
            </Link>
            <Link
              href="/log-meal"
              className={`rounded-md px-3 py-1 text-sm ${
                active === "logmeal"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              Log Meal
            </Link>
            <Link
              href="/connect"
              className={`rounded-md px-3 py-1 text-sm ${
                active === "connect"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              Connect
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
