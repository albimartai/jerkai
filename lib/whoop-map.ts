import type { WhoopCycle, WhoopRecovery, WhoopSleep, WhoopWorkout } from "@/lib/whoop-api";

// Maps Whoop API v2 records into biometric_readings rows (source = 'whoop')
// and whoop_workouts rows. Pure functions — the sync route does the fetching
// and writing.
//
// Calendar-day convention: Whoop timestamps are UTC instants plus a
// timezone_offset ("+hh:mm"/"-hh:mm"/"Z") captured at recording time, and a
// Whoop "day" is a physiological cycle (sleep -> wake period), not a
// calendar day. reading_date follows the same rule Whoop's own app uses to
// label a day: the USER-LOCAL date you woke up.
//   - Sleep -> local date of sleep.end (the wake morning). Matches the old
//     Apple-Health-era convention, where Health Auto Export's aggregated
//     sleep row carried the wake date.
//   - Recovery -> the wake-day of its own sleep (recovery is scored on
//     waking; the response has no timezone_offset of its own, so the join
//     via sleep_id is what supplies the local day).
//   - Cycle (day strain) -> the wake-day of the recovery that references the
//     cycle. Fallback for recovery-less cycles: local date of cycle.end
//     (usually the evening you fell asleep, same local day the strain
//     accumulated on); cycles with neither are skipped and reported.
//   - Workout -> local date of workout.start.
// Records that can't be dated fail loudly (skipped + reported) rather than
// landing on a guessed day — same discipline as extractReadingDate().
//
// Metric naming decisions (Session 8, stated in the session report):
//   - sleep_duration REUSES the existing metric name and its 'hr' unit: it
//     is the same quantity (time asleep) the Apple-Health era stored, so the
//     timeline stays one continuous series, and the planned Whoop-direct
//     historical backfill overwrites the old rows in place via the
//     (source, metric, reading_date) upsert — no permanent seam. The value
//     is converted from Whoop's stage-sum milliseconds to hours (exact
//     division, documented exception to the store-as-sent unit convention);
//     raw_payload keeps the millisecond fields verbatim.
//   - Whoop-only concepts get NEW metric names (recovery_score, spo2_pct,
//     skin_temp_c, day_strain, sleep_performance_pct, ...) — no Apple-Health
//     era counterpart exists, so there is nothing to stay continuous with.
//   - hrv reuses 'ms' (rMSSD milliseconds, same as the old rows); rhr
//     reuses the metric name so the backfill heals the old HealthKit-merged
//     rows, labeled 'bpm' (the old rows say 'count/min'; the backfill ends
//     the mixed-label window).

export type WhoopReading = {
  source: "whoop";
  metric: string;
  readingDate: string; // yyyy-MM-dd, user-local (see above)
  value: number;
  unit: string | null;
  aggregation: "latest";
  rawPayload: unknown;
};

export type WhoopWorkoutRow = {
  workoutId: string;
  readingDate: string;
  sportName: string | null;
  startTime: string;
  endTime: string | null;
  timezoneOffset: string | null;
  scoreState: string;
  strain: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  kilojoule: number | null;
  rawPayload: unknown;
};

export type MappedWhoopData = {
  readings: WhoopReading[];
  // Records that could not be mapped (missing day, unscorable joins) —
  // reported on the sync run so gaps are visible, but they never block the
  // rest of the batch.
  skipped: string[];
};

const OFFSET_FORMAT = /^([+-])(\d{2}):?(\d{2})$/;

// User-local calendar day of a UTC instant, using the record's own
// timezone_offset. Null (never a guess) when either part is missing or
// malformed.
export function localDay(
  instant: string | undefined,
  timezoneOffset: string | undefined,
): string | null {
  if (typeof instant !== "string" || typeof timezoneOffset !== "string") return null;
  const utcMillis = Date.parse(instant);
  if (Number.isNaN(utcMillis)) return null;
  let offsetMinutes = 0;
  if (timezoneOffset !== "Z") {
    const match = timezoneOffset.match(OFFSET_FORMAT);
    if (!match) return null;
    offsetMinutes = (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  }
  return new Date(utcMillis + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Emits one reading per present-and-numeric field — Whoop omits fields it
// didn't measure (e.g. no SpO2 on older hardware), and an absent field is a
// gap, not an error.
function pushFieldReadings(
  readings: WhoopReading[],
  readingDate: string,
  rawPayload: unknown,
  fields: [metric: string, value: unknown, unit: string | null][],
): void {
  for (const [metric, value, unit] of fields) {
    const numeric = numberOrNull(value);
    if (numeric === null) continue;
    readings.push({
      source: "whoop",
      metric,
      readingDate,
      value: numeric,
      unit,
      aggregation: "latest",
      rawPayload,
    });
  }
}

const MILLIS_PER_HOUR = 3_600_000;

export function mapWhoopData(input: {
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
  cycles: WhoopCycle[];
}): MappedWhoopData {
  const readings: WhoopReading[] = [];
  const skipped: string[] = [];

  // Wake-day per sleep id — the join key that dates recoveries and cycles.
  // Includes naps (a recovery normally references the primary sleep, but the
  // lookup shouldn't silently fail if it ever references a nap).
  const wakeDayBySleepId = new Map<string, string>();
  for (const sleep of input.sleeps) {
    const day = localDay(sleep.end, sleep.timezone_offset);
    if (typeof sleep.id === "string" && day) wakeDayBySleepId.set(sleep.id, day);
  }

  // Sleeps: primary (non-nap) scored sleeps only — a nap is not "last
  // night's sleep" and would otherwise overwrite it on the same wake-day.
  // Sorted by end so if two primary sleeps ever share a wake-day, the later
  // one deterministically wins the upsert.
  const primarySleeps = input.sleeps
    .filter((sleep) => sleep.nap !== true)
    .sort((a, b) => ((a.end ?? "") < (b.end ?? "") ? -1 : 1));
  for (const sleep of primarySleeps) {
    if (sleep.score_state !== "SCORED" || !sleep.score) {
      if (sleep.score_state !== "SCORED") skipped.push(`sleep ${sleep.id}: ${sleep.score_state}`);
      continue;
    }
    const day = localDay(sleep.end, sleep.timezone_offset);
    if (!day) {
      skipped.push(`sleep ${sleep.id}: no usable end/timezone_offset`);
      continue;
    }
    const stages = sleep.score.stage_summary;
    const asleepMilli =
      stages &&
      [
        stages.total_light_sleep_time_milli,
        stages.total_slow_wave_sleep_time_milli,
        stages.total_rem_sleep_time_milli,
      ].every((v) => typeof v === "number" && Number.isFinite(v))
        ? stages.total_light_sleep_time_milli! +
          stages.total_slow_wave_sleep_time_milli! +
          stages.total_rem_sleep_time_milli!
        : null;
    pushFieldReadings(readings, day, sleep, [
      ["sleep_duration", asleepMilli === null ? null : asleepMilli / MILLIS_PER_HOUR, "hr"],
      ["sleep_performance_pct", sleep.score.sleep_performance_percentage, "%"],
      ["sleep_efficiency_pct", sleep.score.sleep_efficiency_percentage, "%"],
      ["sleep_consistency_pct", sleep.score.sleep_consistency_percentage, "%"],
      ["respiratory_rate", sleep.score.respiratory_rate, "rpm"],
    ]);
  }

  // Recoveries: the guardrail pipe. Dated by the wake-day of their sleep.
  const recoveryDayByCycleId = new Map<number, string>();
  for (const recovery of input.recoveries) {
    if (recovery.score_state !== "SCORED" || !recovery.score) {
      if (recovery.score_state !== "SCORED") {
        skipped.push(`recovery (cycle ${recovery.cycle_id}): ${recovery.score_state}`);
      }
      continue;
    }
    const day =
      typeof recovery.sleep_id === "string" ? wakeDayBySleepId.get(recovery.sleep_id) : undefined;
    if (!day) {
      skipped.push(`recovery (cycle ${recovery.cycle_id}): sleep ${recovery.sleep_id} not datable`);
      continue;
    }
    if (typeof recovery.cycle_id === "number") recoveryDayByCycleId.set(recovery.cycle_id, day);
    pushFieldReadings(readings, day, recovery, [
      ["recovery_score", recovery.score.recovery_score, "%"],
      ["hrv", recovery.score.hrv_rmssd_milli, "ms"],
      ["rhr", recovery.score.resting_heart_rate, "bpm"],
      ["spo2_pct", recovery.score.spo2_percentage, "%"],
      ["skin_temp_c", recovery.score.skin_temp_celsius, "C"],
    ]);
  }

  // Cycles: day-level Strain (unitless, Whoop's 0-21 scale). kilojoule and
  // heart-rate fields stay available in raw_payload without their own rows.
  for (const cycle of input.cycles) {
    if (cycle.score_state !== "SCORED" || !cycle.score) {
      if (cycle.score_state !== "SCORED") skipped.push(`cycle ${cycle.id}: ${cycle.score_state}`);
      continue;
    }
    const day =
      (typeof cycle.id === "number" ? recoveryDayByCycleId.get(cycle.id) : undefined) ??
      localDay(cycle.end, cycle.timezone_offset);
    if (!day) {
      skipped.push(`cycle ${cycle.id}: no recovery join and no usable end/timezone_offset`);
      continue;
    }
    pushFieldReadings(readings, day, cycle, [["day_strain", cycle.score.strain, null]]);
  }

  return { readings, skipped };
}

// Per-workout data goes to its own table (whoop_workouts, keyed by Whoop's
// workout id) rather than biometric_readings: a day can hold several
// workouts, which the (source, metric, reading_date) one-row-per-day shape
// cannot represent. Stored regardless of score_state so a PENDING_SCORE
// workout lands immediately and its score fills in on a later sync via the
// same-id upsert.
export function mapWhoopWorkouts(workouts: WhoopWorkout[]): {
  workouts: WhoopWorkoutRow[];
  skipped: string[];
} {
  const rows: WhoopWorkoutRow[] = [];
  const skipped: string[] = [];
  for (const workout of workouts) {
    const day = localDay(workout.start, workout.timezone_offset);
    if (typeof workout.id !== "string" || typeof workout.start !== "string" || !day) {
      skipped.push(`workout ${workout.id}: no usable id/start/timezone_offset`);
      continue;
    }
    rows.push({
        workoutId: workout.id,
        readingDate: day,
        sportName: typeof workout.sport_name === "string" ? workout.sport_name : null,
        startTime: workout.start,
        endTime: typeof workout.end === "string" ? workout.end : null,
        timezoneOffset: typeof workout.timezone_offset === "string" ? workout.timezone_offset : null,
        scoreState: typeof workout.score_state === "string" ? workout.score_state : "UNKNOWN",
        strain: numberOrNull(workout.score?.strain),
        averageHeartRate: numberOrNull(workout.score?.average_heart_rate),
        maxHeartRate: numberOrNull(workout.score?.max_heart_rate),
        kilojoule: numberOrNull(workout.score?.kilojoule),
        rawPayload: workout,
    });
  }
  return { workouts: rows, skipped };
}
