import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for whoop_tokens rows, keyed by user_id, so token logic
// tests run without Postgres: the module's SQL goes through getSql(), which
// we mock with a tagged-template fake that routes on the statement's first
// keyword and, for whoop_tokens specifically, on the bound user_id value.
const tokenRows = new Map<number, Record<string, unknown>>();

const fakeSql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join(" ");
  if (/^\s*select/i.test(text)) {
    const userId = values[0] as number;
    const row = tokenRows.get(userId);
    return row ? [row] : [];
  }
  if (/^\s*insert into whoop_tokens/i.test(text)) {
    const [userId, accessTokenEnc, refreshTokenEnc, expiresAt, scope] = values as [
      number,
      unknown,
      unknown,
      unknown,
      unknown,
    ];
    // Mirrors tests/unit/withings-oauth.test.ts:31-47's `inserted` flag so
    // saveTokens' prospective `RETURNING (xmax = 0) as inserted` clause has
    // something real to resolve against — without this, existingRowFound
    // would report `true` unconditionally regardless of whether the row
    // pre-existed (jerkai-falsify-prd round 3, [A/E, FM-02/FM-01]).
    const inserted = !tokenRows.has(userId);
    tokenRows.set(userId, {
      access_token_enc: accessTokenEnc,
      refresh_token_enc: refreshTokenEnc,
      expires_at: expiresAt,
      scope,
    });
    return [{ inserted }];
  }
  throw new Error(`fake sql got an unexpected statement: ${text}`);
});
vi.mock("@/lib/db", () => ({ getSql: () => fakeSql }));

const {
  buildAuthorizeUrl,
  exchangeCode,
  getFreshAccessToken,
  isFirstConnect,
  refreshTokens,
  saveTokens,
  WHOOP_TOKEN_URL,
} = await import("@/lib/whoop-oauth");
const { decryptToken } = await import("@/lib/whoop-crypto");

const TEST_USER_ID = 1;

const fetchMock = vi.fn();

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: "offline read:recovery",
      ...overrides,
    }),
    text: async () => "",
  };
}

beforeEach(() => {
  tokenRows.clear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WHOOP_CLIENT_ID", "client-id-123");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "client-secret-456");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://jerkai.app");
  vi.stubEnv("WHOOP_TOKEN_ENCRYPTION_KEY", "c".repeat(64));
});

afterEach(() => {
  fetchMock.mockReset();
  fakeSql.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildAuthorizeUrl", () => {
  it("targets Whoop's authorize endpoint with the exact registered redirect URI", () => {
    const url = new URL(buildAuthorizeUrl("state-abc"));
    expect(url.origin + url.pathname).toBe("https://api.prod.whoop.com/oauth/oauth2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id-123");
    // Must byte-match the Whoop Developer Dashboard registration.
    expect(url.searchParams.get("redirect_uri")).toBe("https://jerkai.app/api/whoop/callback");
    expect(url.searchParams.get("state")).toBe("state-abc");
    // offline is what makes Whoop issue a refresh token at all.
    expect(url.searchParams.get("scope")).toContain("offline");
  });

  it("normalizes a trailing slash on NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://jerkai.app/");
    const url = new URL(buildAuthorizeUrl("s"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://jerkai.app/api/whoop/callback");
  });
});

describe("token requests (form-urlencoded per RFC 6749)", () => {
  it("exchanges an authorization code with the registered redirect_uri", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    const tokens = await exchangeCode("auth-code-1");
    expect(tokens.access_token).toBe("access-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WHOOP_TOKEN_URL);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("client_secret")).toBe("client-secret-456");
    expect(body.get("redirect_uri")).toBe("https://jerkai.app/api/whoop/callback");
  });

  it("refreshes with the offline scope (Whoop requires it on refresh)", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    await refreshTokens("refresh-0");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-0");
    expect(body.get("scope")).toBe("offline");
  });

  it("surfaces a non-2xx token response with its body for diagnosis", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
      json: async () => ({}),
    });
    await expect(exchangeCode("stale-code")).rejects.toThrow(/400[\s\S]*invalid_grant/);
  });

  it("rejects a 200 response missing the token fields instead of storing garbage", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse({ refresh_token: undefined }));
    await expect(exchangeCode("code")).rejects.toThrow(/missing access_token/);
  });
});

describe("saveTokens + getFreshAccessToken (proactive refresh-on-use)", () => {
  it("stores tokens encrypted, never in the clear", async () => {
    await saveTokens(TEST_USER_ID, {
      access_token: "access-plain",
      refresh_token: "refresh-plain",
      expires_in: 3600,
    });
    const stored = tokenRows.get(TEST_USER_ID)!;
    expect(stored.access_token_enc).not.toContain("access-plain");
    expect(decryptToken(stored.access_token_enc as string)).toBe("access-plain");
    expect(decryptToken(stored.refresh_token_enc as string)).toBe("refresh-plain");
  });

  it("returns null when Whoop was never connected (no token row)", async () => {
    expect(await getFreshAccessToken(TEST_USER_ID)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the stored token without refreshing while it is comfortably unexpired", async () => {
    await saveTokens(TEST_USER_ID, { access_token: "a1", refresh_token: "r1", expires_in: 3600 });
    expect(await getFreshAccessToken(TEST_USER_ID)).toBe("a1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the ROTATED pair (Whoop invalidates the old one)", async () => {
    await saveTokens(TEST_USER_ID, { access_token: "a1", refresh_token: "r1", expires_in: -10 });
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "a2", refresh_token: "r2" }),
    );

    expect(await getFreshAccessToken(TEST_USER_ID)).toBe("a2");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get("refresh_token")).toBe("r1");
    // The rotated pair replaced the old row — losing it would strand the
    // integration until a manual re-connect.
    const stored = tokenRows.get(TEST_USER_ID)!;
    expect(decryptToken(stored.access_token_enc as string)).toBe("a2");
    expect(decryptToken(stored.refresh_token_enc as string)).toBe("r2");
  });

  it("treats a token expiring within the 60s margin as expired", async () => {
    await saveTokens(TEST_USER_ID, { access_token: "a1", refresh_token: "r1", expires_in: 30 });
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: "a2" }));
    expect(await getFreshAccessToken(TEST_USER_ID)).toBe("a2");
  });

  it("supports forceRefresh for the sync route's reactive 401 retry", async () => {
    await saveTokens(TEST_USER_ID, { access_token: "a1", refresh_token: "r1", expires_in: 3600 });
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: "a2" }));
    expect(await getFreshAccessToken(TEST_USER_ID, { forceRefresh: true })).toBe("a2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Whoop Multi-Tenancy
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("saveTokens + getFreshAccessToken — per-user (AC-WT5, AC-WT6)", () => {
  // §1: saveTokens/loadTokens/getFreshAccessToken all gain a userId parameter
  // once whoop_tokens is keyed by user_id instead of the singleton id = 1.
  // These stubs call the prospective per-user signatures directly.

  it("AC-WT5: reconnecting an already-connected user updates their stored token in place rather than leaving the old one live", async () => {
    const userId = 501;
    await saveTokens(userId, {
      access_token: "first-connect-access",
      refresh_token: "first-connect-refresh",
      expires_in: 3600,
    });
    await saveTokens(userId, {
      access_token: "reconnect-access",
      refresh_token: "reconnect-refresh",
      expires_in: 3600,
    });

    expect(await getFreshAccessToken(userId)).toBe("reconnect-access");
  });

  it("AC-WT6: getFreshAccessToken(userId) returns null for a signed-in user with no whoop_tokens row of their own, even when a different user is connected", async () => {
    const connectedUserId = 601;
    const unconnectedUserId = 602;
    await saveTokens(connectedUserId, {
      access_token: "connected-access",
      refresh_token: "connected-refresh",
      expires_in: 3600,
    });

    expect(await getFreshAccessToken(unconnectedUserId)).toBeNull();
    expect(await getFreshAccessToken(connectedUserId)).toBe("connected-access");
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Whoop Historical Backfill on First Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("isFirstConnect — pure first-connect decision, race-free via saveTokens' atomic insert (AC-WT20a, AC-WT21, NFR-145, NFR-148)", () => {
  it("AC-WT20a: isFirstConnect derives true from saveTokens' result on a true first connect (no pre-existing whoop_tokens row)", async () => {
    const result = await saveTokens(7001, {
      access_token: "a1",
      refresh_token: "r1",
      expires_in: 3600,
    });
    expect(isFirstConnect(result.existingRowFound)).toBe(true);
  });

  it("AC-WT21/NFR-148: isFirstConnect derives false from saveTokens' result on a reconnect (a pre-existing row was found), so a reconnect never re-triggers the 90-day backfill", async () => {
    const userId = 7002;
    await saveTokens(userId, { access_token: "a1", refresh_token: "r1", expires_in: 3600 });
    const reconnect = await saveTokens(userId, {
      access_token: "a2",
      refresh_token: "r2",
      expires_in: 3600,
    });
    expect(isFirstConnect(reconnect.existingRowFound)).toBe(false);
  });

  it("AC-WT20a/AC-WT21: isFirstConnect is a pure function of the boolean alone — it never re-queries the database itself", () => {
    fakeSql.mockClear();
    expect(isFirstConnect(false)).toBe(true);
    expect(isFirstConnect(true)).toBe(false);
    expect(fakeSql).not.toHaveBeenCalled();
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Whoop Historical Backfill on First Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
// No existing test in this file mocks or exercises next/server's after() —
// this establishes that seam for Whoop's own triggerBackfill(), mirroring
// tests/unit/withings-oauth.test.ts's AC-WS27 test shape only (§1): the
// four-state trigger/success/failure/skip logging assertions are NOT
// mirrored here — Whoop's triggerBackfill() carries no such logging in this
// slice (§1, §8 OQ-4).
vi.mock("next/server", () => ({ after: (cb: () => void | Promise<void>) => cb() }));

const { triggerBackfill } = await import("@/lib/whoop-oauth");

describe("triggerBackfill / backfillTargetOrigin — AC-WT20d", () => {
  const backfillFetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret-value");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubGlobal("fetch", backfillFetchMock);
  });

  afterEach(() => {
    backfillFetchMock.mockReset();
  });

  it("AC-WT20d: makes exactly one internal fetch call, targeting VERCEL_URL's own deployment origin, never NEXT_PUBLIC_APP_URL alone (NFR-146)", () => {
    vi.stubEnv("VERCEL_URL", "my-preview-deployment.vercel.app");
    backfillFetchMock.mockImplementation(() => new Promise(() => {}));

    triggerBackfill(9001);

    expect(backfillFetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(backfillFetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.origin).toBe("https://my-preview-deployment.vercel.app");
    expect(requestedUrl.pathname).toBe("/api/whoop/sync");
  });

  it("AC-WT20d/NFR-146: falls back to NEXT_PUBLIC_APP_URL only when VERCEL_URL is unset", () => {
    vi.stubEnv("VERCEL_URL", "");
    backfillFetchMock.mockImplementation(() => new Promise(() => {}));

    triggerBackfill(9002);

    const requestedUrl = new URL(backfillFetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.origin).toBe("https://jerkai.app");
  });

  it("AC-WT20d/NFR-147: the ?start=&end= window spans exactly BACKFILL_WINDOW_DAYS = 90 days ending today, needing no further chunking", () => {
    backfillFetchMock.mockImplementation(() => new Promise(() => {}));

    triggerBackfill(9003);

    const requestedUrl = new URL(backfillFetchMock.mock.calls[0][0] as string);
    const start = requestedUrl.searchParams.get("start");
    const end = requestedUrl.searchParams.get("end");
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    const spanDays = Math.round(
      (new Date(end!).getTime() - new Date(start!).getTime()) / (24 * 3_600_000),
    );
    expect(spanDays).toBe(90);

    const today = new Date().toISOString().slice(0, 10);
    expect(end!.slice(0, 10)).toBe(today);
  });
});
