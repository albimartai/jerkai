/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Smart-Scale Integration
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for withings_tokens rows, keyed by user_id — mirrors
// tests/unit/whoop-oauth.test.ts's fake-getSql pattern so this runs without
// Postgres. §0/NFR-98: withings_tokens is created directly in the post-
// multi-tenancy shape (user_id integer primary key, no surrogate id, no
// singleton phase) — there is no pre-existing-row migration to fake here.
//
// NFR-98 requires the first-connect determination to be race-free: a single
// atomic `insert ... on conflict (user_id) do update ... returning
// (xmax = 0) as inserted`, not a separate SELECT-then-upsert. The fake's
// insert branch mirrors that contract by reporting whether the user_id
// already had a row, in the same statement that writes it.
const tokenRows = new Map<number, Record<string, unknown>>();

const fakeSql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join(" ");
  if (/^\s*select/i.test(text)) {
    const userId = values[0] as number;
    const row = tokenRows.get(userId);
    return row ? [row] : [];
  }
  if (/^\s*insert into withings_tokens/i.test(text)) {
    const [userId, accessTokenEnc, refreshTokenEnc, expiresAt, scope] = values as [
      number,
      unknown,
      unknown,
      unknown,
      unknown,
    ];
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

const { saveTokens, getFreshAccessToken, isFirstConnect } = await import("@/lib/withings-oauth");
const { decryptToken } = await import("@/lib/withings-crypto");

beforeEach(() => {
  tokenRows.clear();
  vi.stubEnv("WITHINGS_TOKEN_ENCRYPTION_KEY", "e".repeat(64));
});

afterEach(() => {
  fakeSql.mockClear();
  vi.unstubAllEnvs();
});

describe("saveTokens + getFreshAccessToken", () => {
  it("AC-WS2: a first connect stores exactly one withings_tokens row with both tokens only in their AES-256-GCM-encrypted form, never plaintext", async () => {
    const userId = 1;
    await saveTokens(userId, {
      access_token: "access-plain",
      refresh_token: "refresh-plain",
      expires_in: 3600,
    });

    expect(tokenRows.size).toBe(1);
    const stored = tokenRows.get(userId)!;
    expect(stored.access_token_enc).not.toContain("access-plain");
    expect(stored.refresh_token_enc).not.toContain("refresh-plain");
    expect(decryptToken(stored.access_token_enc as string)).toBe("access-plain");
    expect(decryptToken(stored.refresh_token_enc as string)).toBe("refresh-plain");
  });

  it("AC-WS6: reconnecting an already-connected user updates their existing row in place rather than duplicating it", async () => {
    const userId = 2;
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

    expect(tokenRows.size).toBe(1);
    expect(await getFreshAccessToken(userId)).toBe("reconnect-access");
  });

  it("AC-WS7: getFreshAccessToken returns null for a signed-in user with no withings_tokens row of their own", async () => {
    expect(await getFreshAccessToken(999)).toBeNull();
    expect(fakeSql).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe("isFirstConnect — pure first-connect decision, race-free via saveTokens' atomic insert (AC-WS8a, NFR-98, NFR-105)", () => {
  it("AC-WS8: isFirstConnect derives true from saveTokens' result on a true first connect (no pre-existing row)", async () => {
    const result = await saveTokens(2001, {
      access_token: "a1",
      refresh_token: "r1",
      expires_in: 3600,
    });
    expect(isFirstConnect(result.existingRowFound)).toBe(true);
  });

  it("AC-WS10/NFR-105: isFirstConnect derives false from saveTokens' result on a reconnect (a pre-existing row was found), so a reconnect never re-triggers the backfill", async () => {
    const userId = 2002;
    await saveTokens(userId, { access_token: "a1", refresh_token: "r1", expires_in: 3600 });
    const reconnect = await saveTokens(userId, {
      access_token: "a2",
      refresh_token: "r2",
      expires_in: 3600,
    });
    expect(isFirstConnect(reconnect.existingRowFound)).toBe(false);
  });

  it("AC-WS8/AC-WS10: isFirstConnect is a pure function of the boolean alone — it never re-queries the database itself", () => {
    fakeSql.mockClear();
    expect(isFirstConnect(false)).toBe(true);
    expect(isFirstConnect(true)).toBe(false);
    expect(fakeSql).not.toHaveBeenCalled();
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Backfill Trigger Logging
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
// No existing test in this repo mocks or exercises next/server's after() (NFR-141) —
// this establishes that seam for the first time, running the callback synchronously
// so the AC-WS28/AC-WS29 fetch-outcome assertions don't need real timers.
vi.mock("next/server", () => ({ after: (cb: () => void | Promise<void>) => cb() }));

const { triggerBackfill, logBackfillSkipped } = await import("@/lib/withings-oauth");

describe("triggerBackfill / logBackfillSkipped — backfill-trigger logging (AC-WS27–31)", () => {
  const fetchMock = vi.fn();
  const cronSecretValue = "test-cron-secret-value";
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", cronSecretValue);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://jerkai.app");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubGlobal("fetch", fetchMock);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("AC-WS27: writes a trigger log identifying the user and the computed start/end window, before the internal fetch is attempted", () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves — isolates this assertion from any outcome log
    const userId = 90909;

    triggerBackfill(userId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    const start = requestedUrl.searchParams.get("start");
    const end = requestedUrl.searchParams.get("end");
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const triggerMessage = String(logSpy.mock.calls[0][0]);
    expect(triggerMessage).toContain(String(userId));
    // NFR-142: the logged window must be the same start/end values used to build the actual request URL.
    expect(triggerMessage).toContain(start!);
    expect(triggerMessage).toContain(end!);
    // NFR-143: never log the secret.
    expect(triggerMessage).not.toContain(cronSecretValue);

    // NFR-144: trigger log precedes the fetch attempt.
    const logOrder = logSpy.mock.invocationCallOrder[0];
    const fetchOrder = fetchMock.mock.invocationCallOrder[0];
    expect(logOrder).toBeLessThan(fetchOrder);
  });

  it("AC-WS28: writes a success log identifying the same user once the internal fetch resolves ok, after the trigger log", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const userId = 51515;

    triggerBackfill(userId);
    expect(logSpy).toHaveBeenCalledTimes(1); // AC-WS27's trigger line, written synchronously
    const triggerOrder = logSpy.mock.invocationCallOrder[0];

    await vi.waitFor(() => {
      expect(logSpy.mock.calls.length).toBeGreaterThan(1);
    });

    const successCallIndex = logSpy.mock.calls.length - 1;
    const successMessage = String(logSpy.mock.calls[successCallIndex][0]);
    expect(successMessage).toContain(String(userId));
    expect(successMessage).not.toContain(cronSecretValue);
    // NFR-144: success log follows the trigger log, never precedes or replaces it.
    expect(logSpy.mock.invocationCallOrder[successCallIndex]).toBeGreaterThan(triggerOrder);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("AC-WS29: logs the response status and body text when the internal fetch returns a non-2xx response, after the trigger log", async () => {
    const bodyText = "sync route exploded";
    fetchMock.mockResolvedValue(new Response(bodyText, { status: 500 }));
    const userId = 61616;

    triggerBackfill(userId);
    const triggerOrder = logSpy.mock.invocationCallOrder[0];

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(`withings backfill request failed: 500 ${bodyText}`);
    });

    expect(errorSpy.mock.invocationCallOrder[0]).toBeGreaterThan(triggerOrder);
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(cronSecretValue);
  });

  it("AC-WS29: logs the caught error when the internal fetch throws, after the trigger log", async () => {
    const thrown = new TypeError("network down");
    fetchMock.mockRejectedValue(thrown);
    const userId = 61617;

    triggerBackfill(userId);
    const triggerOrder = logSpy.mock.invocationCallOrder[0];

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("withings backfill request failed:", thrown);
    });

    expect(errorSpy.mock.invocationCallOrder[0]).toBeGreaterThan(triggerOrder);
  });

  it("AC-WS30: logs an explicit skip identifying the user when the connect was a reconnect, and triggers no fetch", () => {
    const userId = 71717;

    logBackfillSkipped(userId);

    // Distinguishes a correctly-skipped reconnect from a first connect whose trigger never fired.
    expect(fetchMock).not.toHaveBeenCalled();
    const allCalls = [...logSpy.mock.calls, ...errorSpy.mock.calls];
    expect(allCalls).toHaveLength(1);
    expect(String(allCalls[0][0])).toContain(String(userId));
  });

  it("AC-WS31: CRON_SECRET unset — logs the existing message unchanged and writes no AC-WS27 trigger line", () => {
    vi.stubEnv("CRON_SECRET", "");
    const userId = 81818;

    triggerBackfill(userId);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("withings backfill not triggered: CRON_SECRET is not set");
    expect(logSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
