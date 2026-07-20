import { describe, expect, it } from "vitest";

import { stallBadge } from "@/lib/dashboard/stall-badge";

// Executable spec for stallBadge() itself: the daily-streak trend logic
// (originally AC-D4–AC-D7). As of the Weekly Ledger slice, this logic is no
// longer the badge's primary computation — weeklyStallBadge() (see
// weekly-badge.ts) is, deriving from completed ledger weeks per AC-W10. This
// function now survives solely as the AC-W11 cold-start fallback (<2
// completed weeks), so these cases are re-scoped to cover that fallback path
// rather than dropped (NFR-20); weekly-badge.test.ts asserts the fallback is
// wired to this exact function, unchanged. Input is the 30-day trend line on
// the shared day axis (nulls = gap days, skipped).

// A strictly falling trend of `days` points ending at the series tail.
const falling = (days: number) => Array.from({ length: days }, (_, i) => 20 - i * 0.05);

describe("stallBadge", () => {
  it("AC-D4: non-increasing for >=10 consecutive days reads 'trending down N wks' in the good tone", () => {
    // 15 points = 14 trailing non-increasing deltas (2 weeks).
    const badge = stallBadge(falling(15));
    expect(badge).toEqual({ tone: "good", label: "▾ trending down 2 wks" });
  });

  it("AC-D4: a plateau counts as non-increasing (flat days keep the streak alive)", () => {
    // 6 falling deltas then 5 flat ones: 11 non-increasing days total.
    const series = [...falling(7), ...Array.from({ length: 5 }, () => falling(7)[6])];
    expect(stallBadge(series).tone).toBe("good");
  });

  it("AC-D4: at exactly 10 non-increasing days the label floors to whole weeks, minimum 1", () => {
    // 11 points = 10 trailing deltas -> "1 wk", singular.
    expect(stallBadge(falling(11))).toEqual({ tone: "good", label: "▾ trending down 1 wk" });
  });

  it("AC-D5: a 1-day rise after a decline reads 'trend rising — check drivers' in the warning tone", () => {
    const badge = stallBadge([...falling(20), 20]);
    expect(badge).toEqual({ tone: "warning", label: "▴ trend rising — check drivers" });
  });

  it("AC-D5: a 2-day rise still reads as the rising reversal", () => {
    expect(stallBadge([...falling(20), 20, 20.1]).tone).toBe("warning");
  });

  it("AC-D6: neither clearly falling nor rising reads 'trend flat' in the neutral tone", () => {
    // Only 5 non-increasing days at the tail: not enough for AC-D4, no rise.
    const badge = stallBadge([18, 18.2, ...falling(5)]);
    expect(badge).toEqual({ tone: "neutral", label: "— trend flat" });
  });

  it("AC-D6: too little history for any trend reads flat", () => {
    expect(stallBadge([]).tone).toBe("neutral");
    expect(stallBadge([18.4]).tone).toBe("neutral");
    expect(stallBadge([null, null]).tone).toBe("neutral");
  });

  it("AC-D13: gap days are skipped, not treated as zero readings", () => {
    // Gaps inside a long decline must not break the streak or fake a rise.
    const series = [20, 19.9, null, 19.8, 19.7, 19.6, null, 19.5, 19.4, 19.3, 19.2, 19.1, 19.0];
    expect(stallBadge(series).tone).toBe("good");
  });

  it("AC-D7: the badge is passive — every possible label comes from the fixed passive set", () => {
    const passive = /^(▾ trending down \d+ wks?|▴ trend rising — check drivers|— trend flat)$/;
    const inputs = [falling(15), [...falling(20), 20], [18, 18.2], [], [17, 17, 17, 17]];
    for (const input of inputs) {
      expect(stallBadge(input).label).toMatch(passive);
    }
  });
});
