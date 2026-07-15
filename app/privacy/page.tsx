import type { Metadata } from "next";

// Deliberately public: WHOOP's Developer Platform requires a privacy policy
// link, and its OAuth consent flow shows this page to the user before they
// ever sign in. proxy.ts excludes exactly /privacy from the session gate.
// Static content only — never render anything session-derived here.
export const metadata: Metadata = {
  title: "Privacy Policy · JerkAI",
};

export default function PrivacyPolicy() {
  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-16 font-sans">
      <div className="flex w-full max-w-prose flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-zinc-500">JerkAI · Last updated: July 14, 2026</p>
        </div>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          JerkAI is a personal health-tracking application built and used solely by
          Albert Martinez. It is not a commercial product, and there is no public
          sign-up: the private dashboard is accessible only to a single allowlisted
          account.
        </p>
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">What data is collected</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Biometric data from Fitdays (weight, body fat %, BMI, lean body mass) and
            Whoop (Recovery Score, heart rate variability, resting heart rate, sleep,
            and related metrics), pulled via Apple Health and Whoop&apos;s own API.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">How it&apos;s used</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Exclusively to power a private, single-user dashboard for personal health
            tracking. This data is never sold, shared with third parties, or used for
            advertising.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">How it&apos;s stored</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            In a private Postgres database (Neon), accessed only through an
            authenticated, single-account login (magic-link email authentication).
            Access credentials and API secrets are encrypted at rest.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Third-party services</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            This app connects to Whoop&apos;s and Apple&apos;s respective APIs solely
            to import the user&apos;s own health data, subject to those platforms&apos;
            own privacy terms.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Contact</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Questions can be sent to{" "}
            <a
              href="mailto:albert.martinez.90@gmail.com"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              albert.martinez.90@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
