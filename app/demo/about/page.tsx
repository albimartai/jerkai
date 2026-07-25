import type { Metadata } from "next";

import { NavHeader } from "@/app/ui/nav-header";

// The demo's About surface (docs/prd/demo-about.md, AC-AB1..AC-AB9).
// Deliberately public and deliberately inert: like its sibling demo routes it
// never calls auth(), imports no DB module, and — unlike them — imports not
// even the synthetic fixture. It is static text with outbound links, so there
// is no state, no client boundary, and no form (a form would be a write
// surface, categorically out per AC-PD4). tests/unit/demo-isolation.test.ts
// roots its import-graph walk here too (NFR-56).
//
// The prose below is product-owner-approved copy (DL-2026-07-25-b) whose
// source of record is held outside this repo — there is no in-repo copy deck
// or markdown file to edit, this component is its only home. Changing the
// wording is a product-owner decision, not a code change; raise it rather
// than rewriting it here.
//
// The demo banner comes from app/demo/layout.tsx and is not repeated here
// (AC-AB4). Only title/description are set below: Next shallow-merges
// per-route metadata over the layout's, so re-declaring `robots` would
// silently take ownership of the allow-index posture locked in NFR-54 —
// inheriting it is the point (AC-AB7).
export const metadata: Metadata = {
  title: "About this demo — JerkAI (synthetic data)",
  description:
    "What JerkAI is, why this demo runs on synthetic data, and why its write features are deliberately absent.",
};

export default function DemoAbout() {
  return (
    <main className="mx-auto w-full max-w-3xl overflow-x-hidden px-4 pb-10 font-sans">
      <NavHeader variant="demo" />

      <article className="flex flex-col gap-6 py-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <header className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            About this demo
          </h1>
          <p>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              JerkAI is a personal health dashboard I designed and built solo.
            </strong>{" "}
            What you&apos;re looking at is a public demo of it, running on made-up data.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            The problem it solves
          </h2>
          <p>
            If you weigh yourself every morning, the number jumps around. A single reading tells you
            almost nothing, so people either ignore the scale or overreact to it. JerkAI treats the
            daily body fat reading as noise and the <em>trend</em> as the signal, then answers the
            next question: when the trend changes, which driver(s) caused it?
          </p>
          <p>Two screens do that work:</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Weekly</strong>: one
              row per week, five columns. How did my weeks go, in one scan.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Daily</strong>: the
              same metrics stacked on a shared timeline. Hover anywhere and every chart snaps to the
              same day, so you can see whether training, calories, or recovery moved together with
              the trend.
            </li>
          </ul>
          <p>
            The raw daily number is always shown next to the trend line, never replaced by it. Raw is
            the record of truth; the trend is just the lens for deciding whether anything actually
            changed.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            What you&apos;re seeing is not real data
          </h2>
          <p>
            Every number on this demo is synthetic, invented to show the product&apos;s behavior,
            including a stretch where the trend stalls and then resumes, and a day with no meal
            logged. No personal health data is here, and the demo is built so that it <em>can&apos;t</em>{" "}
            reach the real database.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            What&apos;s intentionally missing
          </h2>
          <p>
            The real app has features this demo doesn&apos;t: logging meals, setting calorie and
            protein targets, connecting a Whoop account. Those all write data. Leaving them out is
            what makes the demo safe to publish to anyone; this surface is read-only by design. You
            can still see their output here: the calories-vs-target chart renders from logged-meal
            data, gaps and all.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Why I built it
          </h2>
          <p>
            I build digital products, and I wanted an artifact that shows the whole path rather than
            a slide about it: framing the problem, defining the metric tree (one north star, three
            drivers, two guardrails), writing the specs, and shipping the code to production. Every
            feature here started as a written PRD with acceptance criteria, and the tests are named
            after them.
          </p>
          <p>
            The full source, specs, and decision history are public:{" "}
            <a
              href="https://github.com/albimartai/jerkai"
              rel="noopener noreferrer"
              className="font-semibold text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400"
            >
              github.com/albimartai/jerkai
            </a>
          </p>
          <p>
            Questions or want to talk about product work?{" "}
            <a
              href="https://linkedin.com/in/albimart"
              rel="noopener noreferrer"
              className="font-semibold text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400"
            >
              LinkedIn
            </a>
          </p>
        </section>
      </article>
    </main>
  );
}
