import { describe, expect, it } from "vitest";

import type { WhoopCycle, WhoopRecovery, WhoopSleep, WhoopWorkout } from "@/lib/whoop-api";
import { localDay, mapWhoopData, mapWhoopWorkouts } from "@/lib/whoop-map";

// Fixtures mirror the documented v2 shapes (developer.whoop.com/api), with
// Chicago offsets like the real account. The real-response verification
// against a live authenticated call happens post-OAuth-connect — these pin
// the mapping logic against the documented contract.

const SLEEP: WhoopSleep = {
  id: "sleep-1",
  nap: false,
  start: "2026-07-09T04:10:00.000Z", // 23:10 on the 8th, Chicago
  end: "2026-07-09T11:30:00.000Z", // 06:30 on the 9th, Chicago — wake day = 07-09
  timezone_offset: "-05:00",
  score_state: "SCORED",
  score: {
    stage_summary: {
      total_in_bed_time_milli: 26_400_000,
      total_awake_time_milli: 1_800_000,
      total_light_sleep_time_milli: 12_600_000, // 3.5h
      total_slow_wave_sleep_time_milli: 5_400_000, // 1.5h
      total_rem_sleep_time_milli: 7_200_000, // 2h
    },
    respiratory_rate: 14.8,
    sleep_performance_percentage: 88,
    sleep_consistency_percentage: 71,
    sleep_efficiency_percentage: 93.2,
  },
};

const RECOVERY: WhoopRecovery = {
  cycle_id: 93845,
  sleep_id: "sleep-1",
  score_state: "SCORED",
  score: {
    user_calibrating: false,
    recovery_score: 44,
    resting_heart_rate: 64,
    hrv_rmssd_milli: 31.813562,
    spo2_percentage: 95.6875,
    skin_temp_celsius: 33.7,
  },
};

const CYCLE: WhoopCycle = {
  id: 93845,
  start: "2026-07-09T04:10:00.000Z",
  end: "2026-07-10T03:55:00.000Z",
  timezone_offset: "-05:00",
  score_state: "SCORED",
  score: { strain: 13.52, kilojoule: 8200, average_heart_rate: 68, max_heart_rate: 154 },
};

describe("localDay — user-local calendar day from UTC instant + offset", () => {
  it("shifts a UTC instant into the record's own timezone", () => {
    // 03:55 UTC on the 10th is 22:55 on the 9th in Chicago (CDT).
    expect(localDay("2026-07-10T03:55:00.000Z", "-05:00")).toBe("2026-07-09");
    expect(localDay("2026-07-10T03:55:00.000Z", "Z")).toBe("2026-07-10");
    expect(localDay("2026-07-09T23:30:00.000Z", "+02:00")).toBe("2026-07-10");
  });

  it("accepts an offset without a colon", () => {
    expect(localDay("2026-07-10T03:55:00.000Z", "-0500")).toBe("2026-07-09");
  });

  it("returns null instead of guessing when either part is missing or malformed", () => {
    expect(localDay(undefined, "-05:00")).toBeNull();
    expect(localDay("2026-07-10T03:55:00.000Z", undefined)).toBeNull();
    expect(localDay("not-a-date", "-05:00")).toBeNull();
    expect(localDay("2026-07-10T03:55:00.000Z", "central")).toBeNull();
  });
});

describe("mapWhoopData — recovery", () => {
  it("lands all five recovery fields on the wake-day of the joined sleep", () => {
    const { readings, skipped } = mapWhoopData({
      recoveries: [RECOVERY],
      sleeps: [SLEEP],
      cycles: [],
    });
    expect(skipped).toEqual([]);
    const byMetric = Object.fromEntries(
      readings.map((r) => [r.metric, [r.readingDate, r.value, r.unit]]),
    );
    expect(byMetric.recovery_score).toEqual(["2026-07-09", 44, "%"]);
    expect(byMetric.hrv).toEqual(["2026-07-09", 31.813562, "ms"]);
    expect(byMetric.rhr).toEqual(["2026-07-09", 64, "bpm"]);
    expect(byMetric.spo2_pct).toEqual(["2026-07-09", 95.6875, "%"]);
    expect(byMetric.skin_temp_c).toEqual(["2026-07-09", 33.7, "C"]);
    // Full raw record preserved on every row, per the established pattern.
    for (const reading of readings.filter((r) => r.metric === "recovery_score")) {
      expect(reading.rawPayload).toBe(RECOVERY);
    }
  });

  it("omits absent optional fields (e.g. no SpO2 on older hardware) without erroring", () => {
    const noSpo2: WhoopRecovery = {
      ...RECOVERY,
      score: { recovery_score: 60, resting_heart_rate: 58, hrv_rmssd_milli: 45 },
    };
    const { readings, skipped } = mapWhoopData({
      recoveries: [noSpo2],
      sleeps: [SLEEP],
      cycles: [],
    });
    expect(skipped).toEqual([]);
    const recoveryMetrics = readings
      .filter((r) => r.rawPayload === noSpo2)
      .map((r) => r.metric)
      .sort();
    expect(recoveryMetrics).toEqual(["hrv", "recovery_score", "rhr"]);
  });

  it("skips (and reports) unscored recoveries and recoveries whose sleep is unknown", () => {
    const pending: WhoopRecovery = { ...RECOVERY, score_state: "PENDING_SCORE", score: undefined };
    const orphan: WhoopRecovery = { ...RECOVERY, sleep_id: "missing-sleep" };
    const { readings, skipped } = mapWhoopData({
      recoveries: [pending, orphan],
      sleeps: [SLEEP],
      cycles: [],
    });
    // No recovery metrics landed (the readings that did land are SLEEP's own).
    expect(readings.filter((r) => r.metric === "recovery_score")).toEqual([]);
    expect(skipped).toEqual([
      "recovery (cycle 93845): PENDING_SCORE",
      "recovery (cycle 93845): sleep missing-sleep not datable",
    ]);
  });
});

describe("mapWhoopData — sleep", () => {
  it("reuses the sleep_duration metric in hours (stage sum), plus the Whoop-only metrics", () => {
    const { readings } = mapWhoopData({ recoveries: [], sleeps: [SLEEP], cycles: [] });
    const byMetric = Object.fromEntries(
      readings.map((r) => [r.metric, [r.readingDate, r.value, r.unit]]),
    );
    // 3.5h light + 1.5h SWS + 2h REM = 7h asleep — awake/in-bed time excluded,
    // matching what the Apple-Health era stored under this metric name.
    expect(byMetric.sleep_duration).toEqual(["2026-07-09", 7, "hr"]);
    expect(byMetric.sleep_performance_pct).toEqual(["2026-07-09", 88, "%"]);
    expect(byMetric.sleep_efficiency_pct).toEqual(["2026-07-09", 93.2, "%"]);
    expect(byMetric.sleep_consistency_pct).toEqual(["2026-07-09", 71, "%"]);
    expect(byMetric.respiratory_rate).toEqual(["2026-07-09", 14.8, "rpm"]);
  });

  it("excludes naps from sleep metrics while keeping them available for recovery joins", () => {
    const nap: WhoopSleep = {
      ...SLEEP,
      id: "nap-1",
      nap: true,
      end: "2026-07-09T20:00:00.000Z",
    };
    const napRecovery: WhoopRecovery = { ...RECOVERY, sleep_id: "nap-1" };
    const { readings, skipped } = mapWhoopData({
      recoveries: [napRecovery],
      sleeps: [nap],
      cycles: [],
    });
    // No sleep_* rows from the nap, but the recovery still dates through it.
    expect(readings.filter((r) => r.metric.startsWith("sleep_"))).toEqual([]);
    expect(readings.find((r) => r.metric === "recovery_score")?.readingDate).toBe("2026-07-09");
    expect(skipped).toEqual([]);
  });

  it("skips a sleep with no usable end/timezone_offset instead of guessing a day", () => {
    const undatable: WhoopSleep = { ...SLEEP, id: "sleep-2", timezone_offset: undefined };
    const { readings, skipped } = mapWhoopData({
      recoveries: [],
      sleeps: [undatable],
      cycles: [],
    });
    expect(readings).toEqual([]);
    expect(skipped).toEqual(["sleep sleep-2: no usable end/timezone_offset"]);
  });

  it("omits sleep_duration (but keeps the score metrics) when stage summary is incomplete", () => {
    const noStages: WhoopSleep = {
      ...SLEEP,
      score: { ...SLEEP.score, stage_summary: { total_light_sleep_time_milli: 12_600_000 } },
    };
    const { readings } = mapWhoopData({ recoveries: [], sleeps: [noStages], cycles: [] });
    expect(readings.find((r) => r.metric === "sleep_duration")).toBeUndefined();
    expect(readings.find((r) => r.metric === "sleep_performance_pct")).toBeDefined();
  });

  it("lets the later of two same-wake-day primary sleeps win deterministically", () => {
    const early: WhoopSleep = {
      ...SLEEP,
      id: "early",
      end: "2026-07-09T08:00:00.000Z",
      score: { ...SLEEP.score, sleep_performance_percentage: 50 },
    };
    const late: WhoopSleep = { ...SLEEP, id: "late" };
    const { readings } = mapWhoopData({
      recoveries: [],
      sleeps: [late, early],
      cycles: [],
    });
    const perf = readings.filter((r) => r.metric === "sleep_performance_pct");
    // Both emit, sorted so the later sleep's row is last — the upsert makes
    // last-write-wins.
    expect(perf.map((r) => r.value)).toEqual([50, 88]);
  });
});

describe("mapWhoopData — cycle (day strain)", () => {
  it("dates day_strain by the wake-day of the recovery that references the cycle", () => {
    const { readings, skipped } = mapWhoopData({
      recoveries: [RECOVERY],
      sleeps: [SLEEP],
      cycles: [CYCLE],
    });
    expect(skipped).toEqual([]);
    const strain = readings.find((r) => r.metric === "day_strain");
    expect(strain).toMatchObject({ readingDate: "2026-07-09", value: 13.52, unit: null });
  });

  it("falls back to the cycle's own local end date when no recovery references it", () => {
    const { readings, skipped } = mapWhoopData({
      recoveries: [],
      sleeps: [],
      cycles: [CYCLE],
    });
    expect(skipped).toEqual([]);
    // end 03:55Z on the 10th = 22:55 on the 9th, Chicago.
    expect(readings.find((r) => r.metric === "day_strain")?.readingDate).toBe("2026-07-09");
  });

  it("skips an in-progress cycle (no end) with no recovery, and unscored cycles", () => {
    const inProgress: WhoopCycle = { ...CYCLE, id: 99, end: undefined };
    const pending: WhoopCycle = { ...CYCLE, id: 100, score_state: "PENDING_SCORE", score: undefined };
    const { readings, skipped } = mapWhoopData({
      recoveries: [],
      sleeps: [],
      cycles: [inProgress, pending],
    });
    expect(readings).toEqual([]);
    expect(skipped).toEqual([
      "cycle 99: no recovery join and no usable end/timezone_offset",
      "cycle 100: PENDING_SCORE",
    ]);
  });
});

describe("mapWhoopWorkouts — per-workout rows for whoop_workouts", () => {
  const WORKOUT: WhoopWorkout = {
    id: "workout-1",
    sport_name: "weightlifting",
    start: "2026-07-09T22:30:00.000Z", // 17:30 Chicago — local day 07-09
    end: "2026-07-09T23:45:00.000Z",
    timezone_offset: "-05:00",
    score_state: "SCORED",
    score: { strain: 8.1, average_heart_rate: 121, max_heart_rate: 162, kilojoule: 1450 },
  };

  it("maps a scored workout with its local start day and score fields", () => {
    const { workouts, skipped } = mapWhoopWorkouts([WORKOUT]);
    expect(skipped).toEqual([]);
    expect(workouts).toEqual([
      {
        workoutId: "workout-1",
        readingDate: "2026-07-09",
        sportName: "weightlifting",
        startTime: "2026-07-09T22:30:00.000Z",
        endTime: "2026-07-09T23:45:00.000Z",
        timezoneOffset: "-05:00",
        scoreState: "SCORED",
        strain: 8.1,
        averageHeartRate: 121,
        maxHeartRate: 162,
        kilojoule: 1450,
        rawPayload: WORKOUT,
      },
    ]);
  });

  it("keeps an unscored workout (null score fields) so a later re-sync can fill it in", () => {
    const pending: WhoopWorkout = {
      ...WORKOUT,
      id: "workout-2",
      score_state: "PENDING_SCORE",
      score: undefined,
    };
    const { workouts, skipped } = mapWhoopWorkouts([pending]);
    expect(skipped).toEqual([]);
    expect(workouts[0]).toMatchObject({
      workoutId: "workout-2",
      scoreState: "PENDING_SCORE",
      strain: null,
      averageHeartRate: null,
    });
  });

  it("keeps two same-day workouts as separate rows (the reason this is not biometric_readings)", () => {
    const second: WhoopWorkout = { ...WORKOUT, id: "workout-2", start: "2026-07-09T13:00:00.000Z" };
    const { workouts } = mapWhoopWorkouts([WORKOUT, second]);
    expect(workouts.map((w) => [w.workoutId, w.readingDate])).toEqual([
      ["workout-1", "2026-07-09"],
      ["workout-2", "2026-07-09"],
    ]);
  });

  it("skips (and reports) a workout it cannot date or identify", () => {
    const noStart: WhoopWorkout = { ...WORKOUT, id: "workout-3", start: undefined };
    const { workouts, skipped } = mapWhoopWorkouts([noStart]);
    expect(workouts).toEqual([]);
    expect(skipped).toEqual(["workout workout-3: no usable id/start/timezone_offset"]);
  });
});
