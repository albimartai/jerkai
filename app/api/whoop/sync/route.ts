import { createHash, timingSafeEqual } from "node:crypto";

import { sendSyncFailureAlert } from "@/lib/alerts";
import { getSql } from "@/lib/db";
import { upsertReading } from "@/lib/readings";
import { recordSyncRun, type SyncOutcome } from "@/lib/sync-runs";
import {
  fetchCollection,
  fetchSleepById,
  whoopCollections,
  WhoopApiError,
  type WhoopCycle,
  type WhoopRecovery,
  type WhoopSleep,
  type WhoopWorkout,
} from "@/lib/whoop-api";
import { mapWhoopData, mapWhoopWorkouts, type WhoopWorkoutRow } from "@/lib/whoop-map";
import { getFreshAccessToken, listConnectedUsers } from "@/lib/whoop-oauth";

// The Whoop pull pipe. Whoop's API has no push equivalent of Health Auto
// Export, so a Vercel Cron job (vercel.json) invokes this route daily.
// Secured with Vercel's recommended CRON_SECRET pattern: Vercel sends the
// project env var's value as `Authorization: Bearer <CRON_SECRET>` on every
// cron invocation, and the route fails closed when the header or the env var
// is missing. The route is excluded from proxy.ts's session gate — cron
// invocations carry no session cookie and do not follow redirects, so the
// Auth.js 307-to-/signin would silently kill every run.
//
// Whoop Multi-Tenancy (§0/NFR-77/NFR-79/NFR-80): loops once per row in
// whoop_tokens via listConnectedUsers() — that table is the sole source of
// truth for "which users, and which user owns this pull." PRIMARY_USER_EMAIL/
// resolvePrimaryUserId() is retired from this path entirely; a connected
// user's failure (token refresh, Whoop API call, a bad record) is recorded
// and alerted independently and never blocks or misattributes another
// connected user's sync in the same run.
//
// Default window: the last 7 days, re-upserted in full — idempotent, so a
// missed or doubled cron run (both explicitly possible per Vercel's docs)
// self-heals, and late re-scores inside the window update in place. The
// window is overridable (?start=YYYY-MM-DD&end=YYYY-MM-DD) with the same
// bearer auth, which is how the historical backfill runs: chunked date
// ranges (~90 days each, to stay inside function-duration and Whoop
// rate limits), safe to re-run over any overlapping range. Applied uniformly
// to every connected user in the run.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_WINDOW_DAYS = 7;
const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("whoop sync rejected: CRON_SECRET is not set");
    return false;
  }
  const provided = request.headers.get("authorization") ?? "";
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest(),
  );
}

// ?start/?end land as whole UTC days; wide-of-the-mark is fine because every
// record is dated by its own timestamps, not by the query window.
function resolveWindow(params: URLSearchParams): { start: string; end: string } | null {
  const startParam = params.get("start");
  const endParam = params.get("end");
  if ((startParam && !DAY_PARAM.test(startParam)) || (endParam && !DAY_PARAM.test(endParam))) {
    return null;
  }
  const end = endParam
    ? new Date(`${endParam}T23:59:59.999Z`)
    : new Date();
  const start = startParam
    ? new Date(`${startParam}T00:00:00.000Z`)
    : new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 3_600_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

type WhoopPull = {
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
  cycles: WhoopCycle[];
  workouts: WhoopWorkout[];
};

async function pullAll(accessToken: string, window: { start: string; end: string }): Promise<WhoopPull> {
  // Sequential rather than parallel — keeps a chunked backfill run
  // comfortably inside Whoop's 100 req/min limit.
  const recoveries = await fetchCollection<WhoopRecovery>(
    whoopCollections.recovery,
    accessToken,
    window,
  );
  const sleeps = await fetchCollection<WhoopSleep>(whoopCollections.sleep, accessToken, window);
  const cycles = await fetchCollection<WhoopCycle>(whoopCollections.cycle, accessToken, window);
  const workouts = await fetchCollection<WhoopWorkout>(
    whoopCollections.workout,
    accessToken,
    window,
  );

  // A recovery's wake-day comes from its sleep record; fetch any referenced
  // sleep that fell outside the window (e.g. re-scored days later).
  const knownSleepIds = new Set(sleeps.map((sleep) => sleep.id));
  const missingSleepIds = [
    ...new Set(
      recoveries
        .map((recovery) => recovery.sleep_id)
        .filter((id): id is string => typeof id === "string" && !knownSleepIds.has(id)),
    ),
  ];
  for (const sleepId of missingSleepIds) {
    const sleep = await fetchSleepById(sleepId, accessToken);
    if (sleep) sleeps.push(sleep);
  }

  return { recoveries, sleeps, cycles, workouts };
}

async function upsertWorkout(userId: number, row: WhoopWorkoutRow): Promise<void> {
  const sql = getSql();
  await sql`
    insert into whoop_workouts (id, user_id, reading_date, sport_name, start_time, end_time,
                                timezone_offset, score_state, strain, average_heart_rate,
                                max_heart_rate, kilojoule, raw_payload)
    values (${row.workoutId}, ${userId}, ${row.readingDate}, ${row.sportName}, ${row.startTime},
            ${row.endTime}, ${row.timezoneOffset}, ${row.scoreState}, ${row.strain},
            ${row.averageHeartRate}, ${row.maxHeartRate}, ${row.kilojoule},
            ${JSON.stringify(row.rawPayload)}::jsonb)
    on conflict (id)
    do update set user_id = excluded.user_id,
                  reading_date = excluded.reading_date,
                  sport_name = excluded.sport_name,
                  start_time = excluded.start_time,
                  end_time = excluded.end_time,
                  timezone_offset = excluded.timezone_offset,
                  score_state = excluded.score_state,
                  strain = excluded.strain,
                  average_heart_rate = excluded.average_heart_rate,
                  max_heart_rate = excluded.max_heart_rate,
                  kilojoule = excluded.kilojoule,
                  raw_payload = excluded.raw_payload,
                  synced_at = now()
  `;
}

type UserSyncResult = {
  userId: number;
  email: string;
  status: SyncOutcome["status"];
  rowsSynced: number;
  counts: { recoveries: number; sleeps: number; cycles: number; workouts: number };
  skipped: string[];
  errors: string[];
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A run that dies before any row lands for this user (refresh failure, API
// outage) is a whole-lane failure for that user only: one sync_runs failure
// row + one alert naming them, never affecting any other connected user's
// outcome in the same run (AC-WT3, NFR-79).
async function userSyncFailed(
  userId: number,
  email: string,
  startedAt: Date,
  reason: string,
): Promise<UserSyncResult> {
  try {
    await recordSyncRun("whoop", userId, startedAt, {
      status: "failure",
      rowsSynced: 0,
      errorMessage: reason,
    });
  } catch (err) {
    console.error(`failed to record sync_runs row for whoop (user ${userId}):`, err);
  }
  await sendSyncFailureAlert(
    `JerkAI sync failure: whoop (${email})`,
    `The Whoop sync run for ${email} failed.\n\nReason: ${reason}\nTime: ${new Date().toISOString()}\n\nSee jerkai.app/status for last-successful-sync state.`,
  );
  return {
    userId,
    email,
    status: "failure",
    rowsSynced: 0,
    counts: { recoveries: 0, sleeps: 0, cycles: 0, workouts: 0 },
    skipped: [],
    errors: [reason],
  };
}

async function syncOneUser(
  userId: number,
  email: string,
  window: { start: string; end: string },
  startedAt: Date,
): Promise<UserSyncResult> {
  let accessToken: string | null;
  try {
    accessToken = await getFreshAccessToken(userId);
  } catch (err) {
    return userSyncFailed(userId, email, startedAt, `token refresh failed: ${message(err)}`);
  }
  if (!accessToken) {
    // listConnectedUsers() only returns rows that already have a
    // whoop_tokens row, so this should not happen in practice — treated as
    // a failure rather than silently skipped if it ever does.
    return userSyncFailed(userId, email, startedAt, "token row disappeared during sync");
  }

  let pull: WhoopPull;
  try {
    pull = await pullAll(accessToken, window);
  } catch (err) {
    // Reactive fallback to the proactive refresh in getFreshAccessToken():
    // one forced refresh + retry on 401 (clock skew, out-of-band revocation).
    if (err instanceof WhoopApiError && err.status === 401) {
      try {
        accessToken = await getFreshAccessToken(userId, { forceRefresh: true });
        if (!accessToken) throw new Error("token row disappeared during retry");
        pull = await pullAll(accessToken, window);
      } catch (retryErr) {
        return userSyncFailed(
          userId,
          email,
          startedAt,
          `Whoop API pull failed after token retry: ${message(retryErr)}`,
        );
      }
    } else {
      return userSyncFailed(userId, email, startedAt, `Whoop API pull failed: ${message(err)}`);
    }
  }

  const mapped = mapWhoopData(pull);
  const mappedWorkouts = mapWhoopWorkouts(pull.workouts);
  const skipped = [...mapped.skipped, ...mappedWorkouts.skipped];

  // Land rows one by one so a single bad record degrades this user's run to
  // 'partial' instead of discarding the batch — same shape as the ingest
  // route, scoped to this user only.
  let synced = 0;
  const errors: string[] = [];
  for (const reading of mapped.readings) {
    try {
      await upsertReading({ ...reading, userId });
      synced += 1;
    } catch (err) {
      errors.push(`${reading.metric} (${reading.readingDate}): ${message(err)}`);
    }
  }
  for (const workout of mappedWorkouts.workouts) {
    try {
      await upsertWorkout(userId, workout);
      synced += 1;
    } catch (err) {
      errors.push(`workout ${workout.workoutId} (${workout.readingDate}): ${message(err)}`);
    }
  }

  const outcome: SyncOutcome = {
    status: errors.length === 0 ? "success" : synced > 0 ? "partial" : "failure",
    rowsSynced: synced,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
  };
  try {
    await recordSyncRun("whoop", userId, startedAt, outcome);
  } catch (err) {
    console.error(`failed to record sync_runs row for whoop (user ${userId}):`, err);
  }

  if (outcome.status !== "success") {
    await sendSyncFailureAlert(
      `JerkAI sync ${outcome.status === "partial" ? "partial failure" : "failure"}: whoop (${email})`,
      `A Whoop sync run for ${email} completed with errors.\n\n${outcome.errorMessage}\nTime: ${new Date().toISOString()}\n\nSee jerkai.app/status for last-successful-sync state.`,
    );
  }

  return {
    userId,
    email,
    status: outcome.status,
    rowsSynced: synced,
    counts: {
      recoveries: pull.recoveries.length,
      sleeps: pull.sleeps.length,
      cycles: pull.cycles.length,
      workouts: pull.workouts.length,
    },
    skipped,
    errors,
  };
}

function aggregateStatus(results: UserSyncResult[]): SyncOutcome["status"] {
  if (results.length === 0) return "success"; // AC-WT1: zero connections is a legitimate empty run
  if (results.every((r) => r.status === "success")) return "success";
  if (results.every((r) => r.status === "failure")) return "failure";
  return "partial";
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = new Date();

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const window = resolveWindow(new URL(request.url).searchParams);
  if (!window) {
    return Response.json(
      { error: "invalid window: expected ?start=YYYY-MM-DD&end=YYYY-MM-DD with start < end" },
      { status: 400 },
    );
  }

  const connectedUsers = await listConnectedUsers();
  const results: UserSyncResult[] = [];
  for (const { userId, email } of connectedUsers) {
    results.push(await syncOneUser(userId, email, window, startedAt));
  }

  const status = aggregateStatus(results);
  return Response.json(
    {
      status,
      window,
      usersProcessed: results.length,
      rowsSynced: results.reduce((sum, r) => sum + r.rowsSynced, 0),
      skipped: results.flatMap((r) => r.skipped),
      errors: results.flatMap((r) => r.errors),
      results,
    },
    { status: status === "failure" ? 500 : 200 },
  );
}
