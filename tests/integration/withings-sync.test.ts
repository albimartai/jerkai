/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Smart-Scale Integration
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { neon } from "@neondatabase/serverless";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Resend must never be hit from tests — mock the alert module and assert on
// the mock instead (same arrangement as whoop-sync.test.ts/ingest.test.ts).
const sendSyncFailureAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/alerts", () => ({ sendSyncFailureAlert }));

import { GET } from "@/app/api/withings/sync/route";
import { encryptToken } from "@/lib/withings-crypto";
import { saveTokens } from "@/lib/withings-oauth";

// End-to-end over a real, disposable Neon branch — mirrors
// tests/integration/whoop-sync.test.ts's harness exactly, adapted for
// Withings: the route handler is invoked directly and every SQL statement
// runs against real Postgres (token load/decrypt, biometric upserts,
// sync_runs). Only the Withings API itself is stubbed (fetch), with fixtures
// following this PRD's own stated (not yet live-confirmed, NFR-104) getmeas
// contract: a {status, body} envelope, body.measuregrps, and — per OQ-5's
// default — one body-level `timezone` shared across every measuregrp in the
// response, not a per-record field like Whoop's timezone_offset.

const CRON_SECRET = "integration-test-cron-secret";
const ENCRYPTION_KEY = "f".repeat(64);
const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Guard against ever running destructive test SQL on a persistent branch —
// see ingest.test.ts for the full rationale.
const CI_DATABASE = "jerkai_ci_test";

const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset"); //gitleaks:allow — non-secret placeholder, same pattern as every other integration test file

const realFetch = globalThis.fetch;

// Withings' own API host (developer.withings.com) — this planning session's
// unverified research; the build agent confirms the exact base URL live
// (NFR-104) before finalizing lib/withings-api.ts. The Neon serverless driver
// ALSO runs over fetch, so the stub must only intercept this host and pass
// every other request (i.e. the test database itself) through untouched.
const WITHINGS_HOST = "wbsapi.withings.net";

function urlOf(input: URL | RequestInfo): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

const fetchMock = vi.fn();
const withingsCalls: string[] = [];

function stubWithingsHost(handler: (url: URL, init?: RequestInit) => Promise<Response> | Response) {
  fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.hostname !== WITHINGS_HOST) return realFetch(input as RequestInfo, init);
    withingsCalls.push(url.pathname);
    return handler(url, init);
  });
}

function syncRequest(auth?: string, query = ""): Request {
  return new Request(`http://localhost/api/withings/sync${query}`, {
    method: "GET",
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

const CHICAGO_TZ = "America/Chicago";

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

// 2026-07-10T03:55:00Z is 22:55 on 2026-07-09 in Chicago (CDT) — same
// instant lib/whoop-map.test.ts's own fixture uses, kept consistent here.
const MEASURE_GROUP = {
  grpid: 1,
  date: epochSeconds("2026-07-10T03:55:00.000Z"),
  measures: [
    { type: 1, value: 850, unit: -1 }, // weight, 85.0 kg
    { type: 5, value: 650, unit: -1 }, // fat-free mass, 65.0 kg
    { type: 6, value: 235, unit: -1 }, // fat ratio, 23.5%
  ],
};

function getmeasResponse(measuregrps: unknown[], timezone: string | null = CHICAGO_TZ) {
  return new Response(JSON.stringify({ status: 0, body: { measuregrps, timezone } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubWithingsApi(measuregrps: unknown[]) {
  stubWithingsHost(() => getmeasResponse(measuregrps));
}

const FIXTURE_USER_EMAIL = "withings-sync-test-primary@example.com";

// user_id has no ON DELETE cascade (OQ-3) — a stray row from any other
// integration file blocks `delete from users`; every child table is cleared
// defensively before users, regardless of whether this file writes to all of
// them (fileParallelism: false, shared database across integration files).
let testUserId: number;

beforeAll(async () => {
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
  vi.stubEnv("WITHINGS_TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY);
  vi.stubEnv("WITHINGS_CLIENT_ID", "test-client");
  vi.stubEnv("WITHINGS_CLIENT_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://jerkai.app");
  await sql`delete from biometric_readings`;
  await sql`delete from manual_macro_entries`;
  await sql`delete from daily_targets`;
  await sql`delete from whoop_workouts`;
  await sql`delete from sync_runs`;
  await sql`delete from whoop_tokens`;
  await sql`delete from withings_tokens`;
  await sql`delete from users`;
  const [user] = await sql`insert into users (email) values (${FIXTURE_USER_EMAIL}) returning id`;
  testUserId = user.id;
});

beforeEach(async () => {
  await sql`delete from biometric_readings`;
  await sql`delete from sync_runs`;
  await sql`delete from withings_tokens`;
  await saveTokens(testUserId, {
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_in: 3600,
  });
  // Default: any Withings call is unexpected until a test stubs it explicitly.
  stubWithingsHost((url) => {
    throw new Error(`unexpected Withings API call: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
  fetchMock.mockReset();
  withingsCalls.length = 0;
  sendSyncFailureAlert.mockClear();
});

const AUTH = `Bearer ${CRON_SECRET}`;

async function readingRows() {
  return sql`
    select source, metric, to_char(reading_date, 'YYYY-MM-DD') as day, value::text as value, unit
    from biometric_readings
    where source = 'withings'
    order by metric
  `;
}

async function seedConnectedUser(email: string, accessToken: string): Promise<number> {
  const [user] = await sql`insert into users (email) values (${email}) returning id`;
  await sql`
    insert into withings_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, scope, updated_at)
    values (${user.id}, ${encryptToken(accessToken)}, ${encryptToken(`${accessToken}-refresh`)},
            ${new Date(Date.now() + 3_600_000).toISOString()}, null, now())
  `;
  return user.id as number;
}

describe("GET /api/withings/sync — auth", () => {
  it("rejects a missing or wrong bearer token without touching the database", async () => {
    expect((await GET(syncRequest())).status).toBe(401);
    expect((await GET(syncRequest("Bearer wrong"))).status).toBe(401);
    expect(await sql`select count(*)::int as n from sync_runs where source = 'withings'`).toEqual([
      { n: 0 },
    ]);
    expect(withingsCalls).toEqual([]);
  });

  it("rejects a malformed backfill window", async () => {
    const res = await GET(syncRequest(AUTH, "?start=July-9&end=2026-07-10"));
    expect(res.status).toBe(400);
  });
});

/**
 * AC-WS1 (bare case): zero connections is a legitimate, successful empty run.
 */
describe("GET /api/withings/sync — AC-WS1: zero connections is a legitimate empty run", () => {
  it("AC-WS1: completes successfully having processed zero users when withings_tokens holds zero rows, writing no rows and sending no alert", async () => {
    await sql`delete from withings_tokens`;
    const res = await GET(syncRequest(AUTH));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(await sql`select count(*)::int as n from biometric_readings where source = 'withings'`).toEqual(
      [{ n: 0 }],
    );
    expect(await sql`select count(*)::int as n from sync_runs where source = 'withings'`).toEqual([
      { n: 0 },
    ]);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
    expect(withingsCalls).toEqual([]);
  });
});

describe("GET /api/withings/sync — happy path", () => {
  it("lands weight/lean_body_mass/body_fat_pct with source='withings' and logs a success sync_runs row", async () => {
    stubWithingsApi([MEASURE_GROUP]);
    const res = await GET(syncRequest(AUTH));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("success");

    expect(await readingRows()).toEqual([
      { source: "withings", metric: "body_fat_pct", day: "2026-07-09", value: "23.5", unit: "%" },
      { source: "withings", metric: "lean_body_mass", day: "2026-07-09", value: "65", unit: "kg" },
      { source: "withings", metric: "weight", day: "2026-07-09", value: "85", unit: "kg" },
    ]);

    expect(await sql`select source, status from sync_runs where source = 'withings'`).toEqual([
      { source: "withings", status: "success" },
    ]);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
  });
});

/**
 * AC-WS8 (part b — integration): the backfill window override lands rows
 * across a full trailing-365-day span, the same resolveWindow mechanism
 * app/api/whoop/sync/route.ts#resolveWindow already proves out for Whoop.
 */
describe("GET /api/withings/sync — AC-WS8 (backfill window override)", () => {
  it("AC-WS8: a 365-day ?start=&end= override pulls and lands data from a group dated inside that window", async () => {
    stubWithingsApi([MEASURE_GROUP]);
    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 3_600_000);
    const query = `?start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;

    const res = await GET(syncRequest(AUTH, query));
    expect(res.status).toBe(200);
    expect(await readingRows()).toEqual([
      { source: "withings", metric: "body_fat_pct", day: "2026-07-09", value: "23.5", unit: "%" },
      { source: "withings", metric: "lean_body_mass", day: "2026-07-09", value: "65", unit: "kg" },
      { source: "withings", metric: "weight", day: "2026-07-09", value: "85", unit: "kg" },
    ]);
  });
});

/**
 * AC-WS10 (real-Postgres half): NFR-98's atomic
 * `insert ... on conflict (user_id) do update ... returning (xmax = 0)`
 * first-connect flag depends on real Postgres xmax semantics that an
 * in-memory fake (tests/unit/withings-oauth.test.ts) cannot faithfully
 * reproduce — exercised here against the real disposable branch instead.
 */
describe("saveTokens — AC-WS10/NFR-98: atomic first-connect flag against real Postgres", () => {
  it("AC-WS10: saveTokens reports existingRowFound=false on a true first connect and existingRowFound=true on a reconnect, atomically with the write", async () => {
    const [user] = await sql`insert into users (email) values ('withings-sync-test-firstconnect@example.com') returning id`;

    const first = await saveTokens(user.id, {
      access_token: "a1",
      refresh_token: "r1",
      expires_in: 3600,
    });
    expect(first.existingRowFound).toBe(false);

    const reconnect = await saveTokens(user.id, {
      access_token: "a2",
      refresh_token: "r2",
      expires_in: 3600,
    });
    expect(reconnect.existingRowFound).toBe(true);

    expect(await sql`select count(*)::int as n from withings_tokens where user_id = ${user.id}`).toEqual(
      [{ n: 1 }],
    );
  });
});

/**
 * AC-WS11: the daily sync re-upserts a fixed uniform trailing window and
 * idempotently heals via upsertReading's (user_id, source, metric,
 * reading_date) upsert — a second identical run updates in place, no
 * duplicates.
 */
describe("GET /api/withings/sync — AC-WS11: idempotent uniform-window re-upsert", () => {
  it("AC-WS11: a second identical run updates the same rows in place rather than duplicating them", async () => {
    stubWithingsApi([MEASURE_GROUP]);
    await GET(syncRequest(AUTH));
    const res = await GET(syncRequest(AUTH));

    expect((await res.json()).status).toBe("success");
    expect(
      await sql`select count(*)::int as n from biometric_readings where source = 'withings'`,
    ).toEqual([{ n: 3 }]);
    // sync_runs is append-only.
    expect(await sql`select count(*)::int as n from sync_runs where source = 'withings'`).toEqual([
      { n: 2 },
    ]);
  });
});

/**
 * AC-WS3: two connected users, correctly attributed readings, never crossed.
 */
describe("GET /api/withings/sync — AC-WS3: two connected users, correctly attributed", () => {
  it("AC-WS3: each user's pulled readings are attributed to their own user_id, never crossed, even for the identical metric and date", async () => {
    const userA = testUserId;
    const userB = await seedConnectedUser("withings-sync-test-userb@example.com", "userb-access");

    stubWithingsApi([MEASURE_GROUP]);
    const res = await GET(syncRequest(AUTH));
    expect(res.status).toBe(200);

    const rows = await sql`
      select user_id from biometric_readings
      where source = 'withings' and metric = 'weight' order by user_id
    `;
    expect(rows.map((r) => r.user_id).sort((a, b) => a - b)).toEqual(
      [userA, userB].sort((a, b) => a - b),
    );
  });
});

/**
 * AC-WS4: one connected user's failure never blocks or misattributes
 * another connected user's sync in the same run.
 */
describe("GET /api/withings/sync — AC-WS4: per-user failure isolation", () => {
  it("AC-WS4: one connected user's Withings API failure does not block, skip, or mark failed the other connected user's sync in the same run", async () => {
    const userA = testUserId;
    const userB = await seedConnectedUser(
      "withings-sync-test-userb-fail@example.com",
      "userb-fail-access",
    );

    fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.hostname !== WITHINGS_HOST) return realFetch(input as RequestInfo, init);
      withingsCalls.push(url.pathname);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      if (auth.includes("userb-fail-access")) {
        return new Response("upstream exploded for user B", { status: 500 });
      }
      return getmeasResponse([MEASURE_GROUP]);
    });

    const res = await GET(syncRequest(AUTH));
    expect(res.status).toBe(200);

    const runs = await sql`
      select user_id, status from sync_runs where source = 'withings' order by user_id
    `;
    const runA = runs.find((r) => r.user_id === userA);
    const runB = runs.find((r) => r.user_id === userB);
    expect(runA?.status).toBe("success");
    expect(runB?.status).toBe("failure");
  });
});

/**
 * AC-WS12: one sync_runs row per connected user per run, never one row
 * conflating both users' outcomes.
 */
describe("GET /api/withings/sync — AC-WS12: one sync_runs row per connected user per run", () => {
  it("AC-WS12: a cron run covering two connected users writes one sync_runs row per user", async () => {
    const userA = testUserId;
    const userB = await seedConnectedUser(
      "withings-sync-test-userb-runs@example.com",
      "userb-runs-access",
    );

    stubWithingsApi([MEASURE_GROUP]);
    await GET(syncRequest(AUTH));

    const runs = await sql`select user_id from sync_runs where source = 'withings' order by user_id`;
    expect(runs.map((r) => r.user_id).sort((a, b) => a - b)).toEqual(
      [userA, userB].sort((a, b) => a - b),
    );
  });
});

/**
 * AC-WS14: the sync-failure alert body names the affected user by email.
 */
describe("GET /api/withings/sync — AC-WS14: failure alert names the affected user", () => {
  it("AC-WS14: the sync-failure alert body names the failed user by email", async () => {
    const failEmail = "withings-sync-test-userc-fail@example.com";
    await seedConnectedUser(failEmail, "userc-fail-access");

    fetchMock.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.hostname !== WITHINGS_HOST) return realFetch(input as RequestInfo, init);
      withingsCalls.push(url.pathname);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      if (auth.includes("userc-fail-access")) {
        return new Response("upstream exploded", { status: 500 });
      }
      return getmeasResponse([]);
    });

    await GET(syncRequest(AUTH));

    expect(sendSyncFailureAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(failEmail),
    );
  });
});

/**
 * AC-WS18/AC-WS19: the production migration widens both source-check
 * constraints to accept 'withings' without touching any pre-existing row —
 * a straightforward additive-ALTER assertion, no complex harness needed.
 */
describe("migration — AC-WS18/AC-WS19: 'withings' is an accepted source value", () => {
  it("AC-WS18: an insert with source='withings' into biometric_readings succeeds against biometric_readings_source_check", async () => {
    await sql`
      insert into biometric_readings (user_id, source, metric, reading_date, value, unit, raw_payload)
      values (${testUserId}, 'withings', 'weight', '2026-08-01', 80, 'kg', '{}'::jsonb)
    `;
    const rows = await sql`
      select source from biometric_readings where user_id = ${testUserId} and source = 'withings'
    `;
    expect(rows).toEqual([{ source: "withings" }]);
  });

  it("AC-WS19: an insert with source='withings' into sync_runs succeeds against sync_runs_source_check", async () => {
    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('withings', ${testUserId}, now(), now(), 'success', 1)
    `;
    const rows = await sql`
      select source from sync_runs where user_id = ${testUserId} and source = 'withings'
    `;
    expect(rows.length).toBeGreaterThan(0);
  });
});
