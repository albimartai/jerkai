import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the whoop_tokens row so token logic tests run
// without Postgres: the module's SQL goes through getSql(), which we mock
// with a tagged-template fake that routes on the statement's first keyword.
const tokenRow: { current: Record<string, unknown> | null } = { current: null };

const fakeSql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join(" ");
  if (/^\s*select/i.test(text)) {
    return tokenRow.current ? [tokenRow.current] : [];
  }
  if (/^\s*insert into whoop_tokens/i.test(text)) {
    tokenRow.current = {
      access_token_enc: values[0],
      refresh_token_enc: values[1],
      expires_at: values[2],
      scope: values[3],
    };
    return [];
  }
  throw new Error(`fake sql got an unexpected statement: ${text}`);
});
vi.mock("@/lib/db", () => ({ getSql: () => fakeSql }));

const {
  buildAuthorizeUrl,
  exchangeCode,
  getFreshAccessToken,
  refreshTokens,
  saveTokens,
  WHOOP_TOKEN_URL,
} = await import("@/lib/whoop-oauth");
const { decryptToken } = await import("@/lib/whoop-crypto");

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
  tokenRow.current = null;
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
    await saveTokens({
      access_token: "access-plain",
      refresh_token: "refresh-plain",
      expires_in: 3600,
    });
    const stored = tokenRow.current!;
    expect(stored.access_token_enc).not.toContain("access-plain");
    expect(decryptToken(stored.access_token_enc as string)).toBe("access-plain");
    expect(decryptToken(stored.refresh_token_enc as string)).toBe("refresh-plain");
  });

  it("returns null when Whoop was never connected (no token row)", async () => {
    expect(await getFreshAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the stored token without refreshing while it is comfortably unexpired", async () => {
    await saveTokens({ access_token: "a1", refresh_token: "r1", expires_in: 3600 });
    expect(await getFreshAccessToken()).toBe("a1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the ROTATED pair (Whoop invalidates the old one)", async () => {
    await saveTokens({ access_token: "a1", refresh_token: "r1", expires_in: -10 });
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "a2", refresh_token: "r2" }),
    );

    expect(await getFreshAccessToken()).toBe("a2");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get("refresh_token")).toBe("r1");
    // The rotated pair replaced the old row — losing it would strand the
    // integration until a manual re-connect.
    expect(decryptToken(tokenRow.current!.access_token_enc as string)).toBe("a2");
    expect(decryptToken(tokenRow.current!.refresh_token_enc as string)).toBe("r2");
  });

  it("treats a token expiring within the 60s margin as expired", async () => {
    await saveTokens({ access_token: "a1", refresh_token: "r1", expires_in: 30 });
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: "a2" }));
    expect(await getFreshAccessToken()).toBe("a2");
  });

  it("supports forceRefresh for the sync route's reactive 401 retry", async () => {
    await saveTokens({ access_token: "a1", refresh_token: "r1", expires_in: 3600 });
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: "a2" }));
    expect(await getFreshAccessToken({ forceRefresh: true })).toBe("a2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
