import { neon } from "@neondatabase/serverless";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Resend must never be hit from tests — mock the alert module and assert on
// the mock instead (same arrangement as ingest.test.ts).
const sendSyncFailureAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/alerts", () => ({ sendSyncFailureAlert }));

import { GET } from "@/app/api/whoop/sync/route";
import { saveTokens } from "@/lib/whoop-oauth";

// End-to-end over a real, disposable Neon branch: the route handler is
// invoked directly and every SQL statement runs against real Postgres —
// token load/decrypt, biometric upserts, whoop_workouts upserts, sync_runs.
// Only the Whoop API itself is stubbed (fetch), with fixtures mirroring the
// documented v2 shapes.

const CRON_SECRET = "integration-test-cron-secret";
const ENCRYPTION_KEY = "d".repeat(64);
const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Guard against ever running destructive test SQL on a persistent branch —
// see ingest.test.ts for the full rationale.
const CI_DATABASE = "jerkai_ci_test";

const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset");

const realFetch = globalThis.fetch;

// The Neon serverless driver ALSO runs over fetch, so the stub must only
// intercept Whoop's API host and pass every other request (i.e. the test
// database itself) through untouched.
const WHOOP_HOST = "api.prod.whoop.com";

function urlOf(input: URL | RequestInfo): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

const fetchMock = vi.fn();
const whoopCalls: string[] = [];

function stubWhoopHost(handler: (url: URL) => Promise<Response> | Response) {
  fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.hostname !== WHOOP_HOST) return realFetch(input as RequestInfo, init);
    whoopCalls.push(url.pathname);
    return handler(url);
  });
}

function syncRequest(auth?: string, query = ""): Request {
  return new Request(`http://localhost/api/whoop/sync${query}`, {
    method: "GET",
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

const SLEEP = {
  id: "e3a1b2c4-0000-0000-0000-000000000001",
  nap: false,
  start: "2026-07-09T04:10:00.000Z",
  end: "2026-07-09T11:30:00.000Z", // 06:30 Chicago — wake day 2026-07-09
  timezone_offset: "-05:00",
  score_state: "SCORED",
  score: {
    stage_summary: {
      total_in_bed_time_milli: 26_400_000,
      total_awake_time_milli: 1_800_000,
      total_light_sleep_time_milli: 12_600_000,
      total_slow_wave_sleep_time_milli: 5_400_000,
      total_rem_sleep_time_milli: 7_200_000,
    },
    respiratory_rate: 14.8,
    sleep_performance_percentage: 88,
    sleep_consistency_percentage: 71,
    sleep_efficiency_percentage: 93.2,
  },
};

const RECOVERY = {
  cycle_id: 93845,
  sleep_id: SLEEP.id,
  user_id: 10129,
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

const CYCLE = {
  id: 93845,
  start: "2026-07-09T04:10:00.000Z",
  end: "2026-07-10T03:55:00.000Z",
  timezone_offset: "-05:00",
  score_state: "SCORED",
  score: { strain: 13.52, kilojoule: 8200, average_heart_rate: 68, max_heart_rate: 154 },
};

const WORKOUT = {
  id: "b1c2d3e4-0000-0000-0000-000000000002",
  sport_name: "weightlifting",
  start: "2026-07-09T22:30:00.000Z",
  end: "2026-07-09T23:45:00.000Z",
  timezone_offset: "-05:00",
  score_state: "SCORED",
  score: { strain: 8.1, average_heart_rate: 121, max_heart_rate: 162, kilojoule: 1450 },
};

// Routes stubbed Whoop calls by collection path; single page each (no
// next_token).
function stubWhoopApi(
  data: Partial<Record<"recovery" | "sleep" | "cycle" | "workout", unknown[]>>,
) {
  stubWhoopHost((url) => {
    const records = url.pathname.endsWith("/recovery")
      ? (data.recovery ?? [])
      : url.pathname.endsWith("/activity/sleep")
        ? (data.sleep ?? [])
        : url.pathname.endsWith("/cycle")
          ? (data.cycle ?? [])
          : url.pathname.endsWith("/activity/workout")
            ? (data.workout ?? [])
            : null;
    if (records === null) throw new Error(`unexpected Whoop API call: ${url.pathname}`);
    return new Response(JSON.stringify({ records, next_token: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeAll(() => {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Integration tests need a disposable Neon branch — see scripts/ci/neon-branch.mjs.",
    );
  }
  if (!new URL(DATABASE_URL).pathname.includes(CI_DATABASE)) {
    throw new Error(
      `refusing to run: DATABASE_URL does not point at the '${CI_DATABASE}' database. ` +
        "These tests delete rows between cases and must never target the persistent dev/prod branches.",
    );
  }
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("WHOOP_TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY);
  vi.stubEnv("WHOOP_CLIENT_ID", "test-client");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://jerkai.app");
});

beforeEach(async () => {
  await sql`delete from biometric_readings`;
  await sql`delete from whoop_workouts`;
  await sql`delete from sync_runs`;
  await sql`delete from whoop_tokens`;
  await saveTokens({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 });
  // Default: any Whoop call is unexpected until a test stubs it explicitly.
  stubWhoopHost((url) => {
    throw new Error(`unexpected Whoop API call: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
  fetchMock.mockReset();
  whoopCalls.length = 0;
  sendSyncFailureAlert.mockClear();
});

const AUTH = `Bearer ${CRON_SECRET}`;

async function readingRows() {
  return sql`
    select source, metric, to_char(reading_date, 'YYYY-MM-DD') as day, value::text as value, unit
    from biometric_readings
    order by metric
  `;
}

describe("GET /api/whoop/sync — auth", () => {
  it("rejects a missing or wrong bearer token without touching the database", async () => {
    expect((await GET(syncRequest())).status).toBe(401);
    expect((await GET(syncRequest("Bearer wrong"))).status).toBe(401);
    expect(await sql`select count(*)::int as n from sync_runs`).toEqual([{ n: 0 }]);
    expect(whoopCalls).toEqual([]);
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(syncRequest(AUTH));
    expect(res.status).toBe(401);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
  });

  it("rejects a malformed backfill window", async () => {
    const res = await GET(syncRequest(AUTH, "?start=July-9&end=2026-07-10"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/whoop/sync — happy path", () => {
  it("lands recovery/sleep/cycle metrics and per-workout rows, and logs a whoop success run", async () => {
    stubWhoopApi({ recovery: [RECOVERY], sleep: [SLEEP], cycle: [CYCLE], workout: [WORKOUT] });
    const res = await GET(syncRequest(AUTH));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.skipped).toEqual([]);
    expect(body.errors).toEqual([]);

    expect(await readingRows()).toEqual([
      { source: "whoop", metric: "day_strain", day: "2026-07-09", value: "13.52", unit: null },
      { source: "whoop", metric: "hrv", day: "2026-07-09", value: "31.813562", unit: "ms" },
      { source: "whoop", metric: "recovery_score", day: "2026-07-09", value: "44", unit: "%" },
      { source: "whoop", metric: "respiratory_rate", day: "2026-07-09", value: "14.8", unit: "rpm" },
      { source: "whoop", metric: "rhr", day: "2026-07-09", value: "64", unit: "bpm" },
      { source: "whoop", metric: "skin_temp_c", day: "2026-07-09", value: "33.7", unit: "C" },
      { source: "whoop", metric: "sleep_consistency_pct", day: "2026-07-09", value: "71", unit: "%" },
      { source: "whoop", metric: "sleep_duration", day: "2026-07-09", value: "7", unit: "hr" },
      { source: "whoop", metric: "sleep_efficiency_pct", day: "2026-07-09", value: "93.2", unit: "%" },
      { source: "whoop", metric: "sleep_performance_pct", day: "2026-07-09", value: "88", unit: "%" },
      { source: "whoop", metric: "spo2_pct", day: "2026-07-09", value: "95.6875", unit: "%" },
    ]);

    const workouts = await sql`
      select id, sport_name, to_char(reading_date, 'YYYY-MM-DD') as day, strain::text as strain,
             score_state, raw_payload
      from whoop_workouts
    `;
    expect(workouts).toEqual([
      {
        id: WORKOUT.id,
        sport_name: "weightlifting",
        day: "2026-07-09",
        strain: "8.1",
        score_state: "SCORED",
        raw_payload: WORKOUT,
      },
    ]);

    expect(await sql`select source, status, rows_synced from sync_runs`).toEqual([
      { source: "whoop", status: "success", rows_synced: 12 },
    ]);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
  });

  it("is idempotent: a second identical run updates in place, no duplicates", async () => {
    stubWhoopApi({ recovery: [RECOVERY], sleep: [SLEEP], cycle: [CYCLE], workout: [WORKOUT] });
    await GET(syncRequest(AUTH));
    const res = await GET(syncRequest(AUTH));

    expect((await res.json()).status).toBe("success");
    expect(await sql`select count(*)::int as n from biometric_readings`).toEqual([{ n: 11 }]);
    expect(await sql`select count(*)::int as n from whoop_workouts`).toEqual([{ n: 1 }]);
    // Run log is append-only.
    expect(await sql`select count(*)::int as n from sync_runs`).toEqual([{ n: 2 }]);
  });

  it("overwrites the Apple-Health-era row for the same (source, metric, day) — the backfill path", async () => {
    // An old HAE-sourced sleep_duration row for the same wake day: the
    // Whoop-direct value replaces it in place, which is exactly how the
    // planned historical backfill heals the old timeline.
    await sql`
      insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
      values ('whoop', 'sleep_duration', '2026-07-09', 7.4, 'hr', '{"totalSleep": 7.4}'::jsonb)
    `;
    stubWhoopApi({ recovery: [], sleep: [SLEEP], cycle: [], workout: [] });
    await GET(syncRequest(AUTH));

    const rows = await sql`
      select value::text as value, raw_payload -> 'score_state' as score_state
      from biometric_readings where metric = 'sleep_duration'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("7");
    expect(rows[0].score_state).toBe("SCORED"); // raw_payload is now the Whoop record
  });

  it("reports not_connected (no failure run, no alert) when no token row exists", async () => {
    await sql`delete from whoop_tokens`;
    const res = await GET(syncRequest(AUTH));
    expect((await res.json()).status).toBe("not_connected");
    expect(await sql`select count(*)::int as n from sync_runs`).toEqual([{ n: 0 }]);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
  });
});

describe("GET /api/whoop/sync — failure paths", () => {
  it("records a whoop failure run and alerts when the Whoop API is down", async () => {
    stubWhoopHost(() => new Response("upstream exploded", { status: 500 }));
    const res = await GET(syncRequest(AUTH));

    expect(res.status).toBe(500);
    const runs = await sql`select source, status, error_message from sync_runs`;
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe("whoop");
    expect(runs[0].status).toBe("failure");
    expect(runs[0].error_message).toContain("500");
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });

  it("retries once with a forced token refresh on 401, then succeeds", async () => {
    let apiCalls = 0;
    stubWhoopHost((url) => {
      if (url.pathname.includes("/oauth/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "rotated-access",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      apiCalls += 1;
      if (apiCalls === 1) return new Response("expired", { status: 401 });
      return new Response(JSON.stringify({ records: [], next_token: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await GET(syncRequest(AUTH));
    expect((await res.json()).status).toBe("success");
    // The rotated refresh token was persisted.
    const rows = await sql`select refresh_token_enc from whoop_tokens`;
    expect(rows).toHaveLength(1);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
  });
});
