import { createHash, timingSafeEqual } from "node:crypto";

import { sendSyncFailureAlert } from "@/lib/alerts";
import { upsertReading } from "@/lib/readings";
import { recordSyncRun, type SyncOutcome } from "@/lib/sync-runs";
import { fetchMeasureGroups, WithingsApiError } from "@/lib/withings-api";
import { mapWithingsData } from "@/lib/withings-map";
import { getFreshAccessToken, listConnectedUsers } from "@/lib/withings-oauth";

// The Withings pull pipe. Withings' API has no push equivalent this app
// uses, so a Vercel Cron job (vercel.json) invokes this route daily; the
// OAuth callback's first-connect backfill (§0/AC-WS8) also calls it directly
// with a wide ?start=&end= override. Mirrors app/api/whoop/sync/route.ts
// function-for-function under the withings source (§1):
//   - isAuthorized: bearer CRON_SECRET, reused as-is (no new secret, NFR-108).
//   - resolveWindow: ?start=&end=, default trailing window. A Withings scale
//     sync is same-day/next-day (no multi-day fitness-tracker-style delay),
//     so the default here is a narrower 3 days rather than Whoop's 7 —
//     generous enough to heal a routine missed or doubled cron run
//     (AC-WS11) without re-upserting a needlessly wide span every day.
//   - syncOneUser/userSyncFailed: per-user try/catch isolation, one
//     sync_runs row + one alert per failure, never blocking other connected
//     users in the same run (AC-WS3/AC-WS4/NFR-100).
//   - aggregateStatus: zero connections is a legitimate "success"
//     (AC-WS1), not a special case.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_WINDOW_DAYS = 3;
const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("withings sync rejected: CRON_SECRET is not set");
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
// record is dated by its own instant + the shared response timezone, not by
// the query window.
function resolveWindow(params: URLSearchParams): { start: string; end: string } | null {
  const startParam = params.get("start");
  const endParam = params.get("end");
  if ((startParam && !DAY_PARAM.test(startParam)) || (endParam && !DAY_PARAM.test(endParam))) {
    return null;
  }
  const end = endParam ? new Date(`${endParam}T23:59:59.999Z`) : new Date();
  const start = startParam
    ? new Date(`${startParam}T00:00:00.000Z`)
    : new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 3_600_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

type UserSyncResult = {
  userId: number;
  email: string;
  status: SyncOutcome["status"];
  rowsSynced: number;
  skipped: string[];
  errors: string[];
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A run that dies before any row lands for this user (refresh failure, API
// outage) is a whole-lane failure for that user only: one sync_runs failure
// row + one alert naming them, never affecting any other connected user's
// outcome in the same run (AC-WS4, NFR-100).
async function userSyncFailed(
  userId: number,
  email: string,
  startedAt: Date,
  reason: string,
): Promise<UserSyncResult> {
  try {
    await recordSyncRun("withings", userId, startedAt, {
      status: "failure",
      rowsSynced: 0,
      errorMessage: reason,
    });
  } catch (err) {
    console.error(`failed to record sync_runs row for withings (user ${userId}):`, err);
  }
  await sendSyncFailureAlert(
    `JerkAI sync failure: withings (${email})`,
    `The Withings sync run for ${email} failed.\n\nReason: ${reason}\nTime: ${new Date().toISOString()}\n\nSee jerkai.app/status for last-successful-sync state.`,
  );
  return { userId, email, status: "failure", rowsSynced: 0, skipped: [], errors: [reason] };
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
    // withings_tokens row, so this should not happen in practice — treated
    // as a failure rather than silently skipped if it ever does.
    return userSyncFailed(userId, email, startedAt, "token row disappeared during sync");
  }

  let pull: { measureGroups: Awaited<ReturnType<typeof fetchMeasureGroups>>["measureGroups"]; timezone: string | null };
  try {
    pull = await fetchMeasureGroups(accessToken, window);
  } catch (err) {
    // Reactive fallback to the proactive refresh in getFreshAccessToken():
    // one forced refresh + retry on 401, same shape as Whoop's sync route.
    if (err instanceof WithingsApiError && err.status === 401) {
      try {
        accessToken = await getFreshAccessToken(userId, { forceRefresh: true });
        if (!accessToken) throw new Error("token row disappeared during retry");
        pull = await fetchMeasureGroups(accessToken, window);
      } catch (retryErr) {
        return userSyncFailed(
          userId,
          email,
          startedAt,
          `Withings API pull failed after token retry: ${message(retryErr)}`,
        );
      }
    } else {
      return userSyncFailed(userId, email, startedAt, `Withings API pull failed: ${message(err)}`);
    }
  }

  const mapped = mapWithingsData({ measureGroups: pull.measureGroups, timezone: pull.timezone ?? undefined });

  // Land rows one by one so a single bad record degrades this user's run to
  // 'partial' instead of discarding the batch — same shape as the Whoop and
  // ingest routes, scoped to this user only.
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

  const outcome: SyncOutcome = {
    status: errors.length === 0 ? "success" : synced > 0 ? "partial" : "failure",
    rowsSynced: synced,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
  };
  try {
    await recordSyncRun("withings", userId, startedAt, outcome);
  } catch (err) {
    console.error(`failed to record sync_runs row for withings (user ${userId}):`, err);
  }

  if (outcome.status !== "success") {
    await sendSyncFailureAlert(
      `JerkAI sync ${outcome.status === "partial" ? "partial failure" : "failure"}: withings (${email})`,
      `A Withings sync run for ${email} completed with errors.\n\n${outcome.errorMessage}\nTime: ${new Date().toISOString()}\n\nSee jerkai.app/status for last-successful-sync state.`,
    );
  }

  return {
    userId,
    email,
    status: outcome.status,
    rowsSynced: synced,
    skipped: mapped.skipped,
    errors,
  };
}

function aggregateStatus(results: UserSyncResult[]): SyncOutcome["status"] {
  if (results.length === 0) return "success"; // AC-WS1: zero connections is a legitimate empty run
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
