import Link from "next/link";

// Shared header, routes named by resolution (AC-W8): Weekly (`/weekly`,
// default landing) and Daily (`/daily`, the strip-stack drill-down). Status
// behavior is unchanged (AC-D15).

// `variant="demo"` (docs/prd/public-demo.md, AC-PD4) renders on the public
// demo surface: the resolution links point at the demo's own /demo/weekly
// and /demo/daily paths (never the gated real routes), and Targets/
// "+ Log meal"/Status — every write-adjacent or gated link — are omitted
// entirely, not disabled. Default "live" is today's unchanged behavior.
type NavVariant = "live" | "demo";

function resolutionHref(label: "Weekly" | "Daily", variant: NavVariant): string {
  const path = label === "Weekly" ? "weekly" : "daily";
  return variant === "demo" ? `/demo/${path}` : `/${path}`;
}

const RESOLUTION_LABELS = ["Weekly", "Daily"] as const;

// `active` is undefined on pages outside the Weekly/Daily resolution pair (Log Meal,
// Settings → Targets) — neither resolution link highlights there.
export function NavHeader({
  active,
  variant = "live",
}: { active?: "weekly" | "daily"; variant?: NavVariant } = {}) {
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
        {variant === "demo" ? null : (
          <>
            {/* Log Meal ships in this slice (AC-M13) — the CTA returns per AC-D14's own
                terms. "+ Log workout" stays absent (its slice hasn't shipped). */}
            <Link
              href="/settings/targets"
              className="ml-2 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Targets
            </Link>
            <Link
              href="/log-meal"
              className="rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              + Log meal
            </Link>
            <Link
              href="/status"
              className="rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Status
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
