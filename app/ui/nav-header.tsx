import Link from "next/link";

// Shared header, routes named by resolution (AC-W8): Weekly (`/weekly`,
// default landing) and Daily (`/daily`, the strip-stack drill-down). Status
// behavior is unchanged (AC-D15).

const RESOLUTION_LINKS = [
  { href: "/weekly", label: "Weekly" },
  { href: "/daily", label: "Daily" },
] as const;

export function NavHeader({ active }: { active: "weekly" | "daily" }) {
  return (
    <header className="flex items-center justify-between py-4">
      <span className="text-lg font-semibold tracking-tight">JerkAI</span>
      <nav className="flex items-center gap-1" aria-label="Dashboard resolution">
        {RESOLUTION_LINKS.map((link) => {
          const isActive = active === link.label.toLowerCase();
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`rounded-md px-2 py-1 text-sm ${
                isActive
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        {/* v1.1 header: still Status only beyond resolution nav — the
            "+ Log meal" / "+ Log workout" CTAs ship with their features,
            not before (AC-D14). */}
        <Link
          href="/status"
          className="ml-2 rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Status
        </Link>
      </nav>
    </header>
  );
}
