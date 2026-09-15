"use client";

import { useState } from "react";

import { FuelTargetsPanel } from "@/app/ui/fuel-targets-panel";
import { LogMealPanel } from "@/app/ui/log-meal-panel";

type View = "log" | "targets";

// AC-M38: LogMealPanel is mounted for the lifetime of FuelPanel and merely hidden via the
// native `hidden` attribute when the Targets view is active — never key'd or conditionally
// unmounted — so its own entryDate/refreshToken state survives a round-trip toggle
// (PRD §1: "never unmounted/remounted... a remount would reset entryDate/refreshToken").
// FuelTargetsPanel mounts lazily on the first visit to the Targets view (so a session that
// never opens Targets never fires its getTargetsForCurrentUser reads), then stays mounted
// the same way. NFR-167: toggling the already-mounted view changes no props, so neither
// panel's own fetch effects re-run — the toggle itself is a pure client-side state flip.
export function FuelPanel() {
  const [view, setView] = useState<View>("log");
  const [targetsVisited, setTargetsVisited] = useState(false);

  const showTargets = () => {
    setTargetsVisited(true);
    setView("targets");
  };

  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="View" className="flex gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={view === "log"}
          onClick={() => setView("log")}
          className={`rounded-full border px-3 py-1 text-sm ${
            view === "log"
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
          }`}
        >
          Log meal
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === "targets"}
          onClick={showTargets}
          className={`rounded-full border px-3 py-1 text-sm ${
            view === "targets"
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
          }`}
        >
          Targets
        </button>
      </div>

      <div hidden={view !== "log"}>
        <LogMealPanel switchToTargets={showTargets} />
      </div>
      {targetsVisited ? (
        <div hidden={view !== "targets"}>
          <FuelTargetsPanel />
        </div>
      ) : null}
    </div>
  );
}
