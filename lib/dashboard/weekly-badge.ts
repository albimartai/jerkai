import type { StallBadge } from "@/lib/dashboard/stall-badge";
import type { WeekRow } from "@/lib/dashboard/ledger";

// Hero stall badge, recomputed from completed Weekly Ledger rows (AC-W10),
// superseding the AC-D4–D6 daily-streak logic as the primary computation.
// This reads the ledger rows' own bodyFat cells rather than recomputing
// anything from the raw trend — the table and the badge share one
// computation (buildWeeklyLedger's epsilon-banded state), so they can never
// disagree (AC-W12). AC-D7 passivity carries over verbatim: none of these
// labels asserts a cause.

// `fallback` is the existing AC-D4–D6 daily-streak stallBadge(), used only
// during cold start (AC-W11) so the badge never disappears before 2
// completed weeks exist.
export function weeklyStallBadge(rows: readonly WeekRow[], fallback: () => StallBadge): StallBadge {
  const completed = rows.filter((row) => !row.inProgress && !row.isGap);
  if (completed.length < 2) return fallback();

  const latest = completed[0]; // newest first (AC-W5)
  const cell = latest.columns.bodyFat;
  if (cell.kind !== "delta") return fallback(); // no computable recent week — don't fabricate a state

  if (cell.state === "good") {
    let weeks = 0;
    for (const row of completed) {
      const c = row.columns.bodyFat;
      if (c.kind === "delta" && c.state === "good") weeks++;
      else break;
    }
    return { tone: "good", label: `▾ trending down ${weeks} wk${weeks === 1 ? "" : "s"}` };
  }
  if (cell.state === "warning") {
    return { tone: "warning", label: "▴ trend rising — check drivers" };
  }
  return { tone: "neutral", label: "— trend flat" };
}
