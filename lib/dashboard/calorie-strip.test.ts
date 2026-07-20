import { describe, expect, it } from "vitest";

import { buildCalorieSeries, calorieBarState } from "@/lib/dashboard/calorie-strip";
import type { TargetRow } from "@/lib/targets";

// Bar coloring for the Calories-vs-target strip (DL-pending-2, AC-M6, AC-M8, AC-M11).

describe("calorieBarState", () => {
  it("AC-M8: no logged entry is a gap, distinct from a genuinely low logged day", () => {
    expect(calorieBarState(null, 2300)).toBe("gap");
    expect(calorieBarState(200, 2300)).not.toBe("gap");
  });

  it("AC-M11: no target in force is neutral, regardless of what was logged", () => {
    expect(calorieBarState(2000, null)).toBe("neutral");
    expect(calorieBarState(0, null)).toBe("neutral");
  });

  it("AC-M6: at or under target is under, above target is over", () => {
    expect(calorieBarState(2000, 2300)).toBe("under");
    expect(calorieBarState(2300, 2300)).toBe("under");
    expect(calorieBarState(2400, 2300)).toBe("over");
  });
});

describe("buildCalorieSeries (NFR-30: per-day target resolution, DL-pending-3)", () => {
  const targets: TargetRow[] = [
    {
      id: 1,
      effectiveDate: "2026-07-01",
      caloriesTarget: 2500,
      proteinTargetG: 180,
      carbsTargetG: null,
      fatTargetG: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: 2,
      effectiveDate: "2026-07-15",
      caloriesTarget: 2100,
      proteinTargetG: 170,
      carbsTargetG: null,
      fatTargetG: null,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ];

  it("resolves each day against the target that was in force THAT day, not one target for the whole axis", () => {
    const axis = ["2026-07-14", "2026-07-15", "2026-07-16"];
    // Same actual value on both sides of the boundary — only the target differs.
    const dailyCalories = [2200, 2200, 2200];
    const series = buildCalorieSeries(axis, dailyCalories, targets);

    expect(series[0].target).toBe(2500); // day before the change: old target
    expect(series[0].state).toBe("under"); // 2200 <= 2500

    expect(series[1].target).toBe(2100); // day of the change: new target
    expect(series[1].state).toBe("over"); // 2200 > 2100

    expect(series[2].target).toBe(2100);
    expect(series[2].state).toBe("over");
  });

  it("AC-M8: a day with no logged calories renders as a gap even when a target is in force", () => {
    const axis = ["2026-07-15"];
    const series = buildCalorieSeries(axis, [null], targets);
    expect(series[0].actual).toBeNull();
    expect(series[0].state).toBe("gap");
  });

  it("AC-M11: a day before any target existed renders neutral", () => {
    const axis = ["2026-06-01"];
    const series = buildCalorieSeries(axis, [1800], targets);
    expect(series[0].target).toBeNull();
    expect(series[0].state).toBe("neutral");
  });
});
