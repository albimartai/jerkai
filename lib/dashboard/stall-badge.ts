// Hero stall badge (AC-D4–AC-D7). Input is the 30-day trend line aligned to
// the shared day axis; nulls are gap days and are skipped, never read as
// zero (AC-D13).
//
// The badge is PASSIVE by design (AC-D7): the three labels below are the
// only things it can ever say, and none asserts a cause. Stall diagnosis is
// explicitly out of scope for v1.

export type StallBadge = {
  tone: "good" | "warning" | "neutral";
  label: string;
};

// Trailing streaks are measured over consecutive PRESENT points, so a gap
// day neither breaks a decline nor fabricates a rise.
const DOWN_STREAK_DAYS = 10; // AC-D4: non-increasing for >=10 consecutive days

export function stallBadge(trend: readonly (number | null)[]): StallBadge {
  const present = trend.filter((value): value is number => value !== null);

  // Trailing day-over-day deltas, newest last.
  const deltas: number[] = [];
  for (let i = 1; i < present.length; i++) {
    deltas.push(present[i] - present[i - 1]);
  }

  // AC-D5: any recent rise is a reversal worth flagging — checked before the
  // down-streak so a rise at the tail of a long decline warns immediately.
  let risingStreak = 0;
  for (let i = deltas.length - 1; i >= 0 && deltas[i] > 0; i--) risingStreak++;
  if (risingStreak >= 1) {
    return { tone: "warning", label: "▴ trend rising — check drivers" };
  }

  // AC-D4: non-increasing (falling or flat) for >=10 consecutive days.
  let downStreak = 0;
  for (let i = deltas.length - 1; i >= 0 && deltas[i] <= 0; i--) downStreak++;
  if (downStreak >= DOWN_STREAK_DAYS) {
    const weeks = Math.max(1, Math.floor(downStreak / 7));
    return { tone: "good", label: `▾ trending down ${weeks} wk${weeks === 1 ? "" : "s"}` };
  }

  // AC-D6: neither clearly falling nor rising (including too little history).
  return { tone: "neutral", label: "— trend flat" };
}
