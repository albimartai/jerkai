"use client";

import { useState } from "react";

// Fitdays/Apple Health setup modal (Data Page Redesign & Connect, §0.1/§0.4,
// AC-DS13-16): a narrow client leaf owning only the modal's open/close state,
// mirroring app/ui/local-time.tsx's established pattern (NFR-125). Under the
// current single-secret, PRIMARY_USER_EMAIL-attributed ingest architecture
// there is no per-account key to display or confirm server-side (§0.1,
// OQ-3/OQ-4) — this component never reads HEALTH_EXPORT_SHARED_SECRET, and
// "I've set it up" is UI-only: it issues no network request (NFR-123).
export function FitdaysConnect() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Connect
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 dark:bg-zinc-900">
            <h3 className="text-lg font-semibold tracking-tight">Set up Fitdays</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
              <li>Install the Health Auto Export app.</li>
              <li>Add a REST API automation pointed at JerkAI&apos;s ingest endpoint.</li>
              <li>Run the export once.</li>
            </ol>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                I&apos;ve set it up
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
