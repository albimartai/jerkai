import type { Metadata } from "next";

// Deliberately public (docs/prd/public-demo.md, AC-PD1): proxy.ts excludes
// /demo from the session gate. Static banner only — never render anything
// session-derived here (same convention as app/privacy/page.tsx). Neither
// this layout nor its pages ever call auth() or import a DB-touching
// module; see tests/unit/demo-isolation.test.ts for the machine-checked
// guarantee.
//
// Crawl posture (NFR-54, decision locked DL-2026-07-22-c): allow-index. This
// is JerkAI's only public search surface (the real app is gated), so
// indexing is the point — the on-surface banner below plus this
// title/description carry the synthetic-data context into the search
// snippet itself. Reversible later via a one-line change to `robots` if
// ever wanted.
export const metadata: Metadata = {
  title: "JerkAI — Live Demo (synthetic data)",
  description:
    "Public demo of JerkAI, a personal health dashboard, rendered over synthetic data — a portfolio artifact, not a real user's biometrics.",
  robots: { index: true, follow: true },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div
        data-demo-banner
        className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        Demo — synthetic data, not real biometrics
      </div>
      {children}
    </div>
  );
}
