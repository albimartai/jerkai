import { beforeEach, describe, expect, it, vi } from "vitest";

// Closes a coverage gap surfaced by jerkai-falsify-diff on
// feat/whoop-historical-backfill (Finding 1, [A, FM-02, AC-WT20/AC-WT21]):
// isFirstConnect and triggerBackfill are each unit-tested in isolation
// (tests/unit/whoop-oauth.test.ts), but nothing exercised the route's own
// conditional wiring them together (app/api/whoop/callback/route.ts:99-101)
// — dropping or inverting that `if` would leave every existing test green.
// This file mocks the two libs the route imports and asserts the wiring
// itself, independent of isFirstConnect/triggerBackfill's own internals.

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

const resolveCallbackIdentityMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/whoop-oauth-binding", () => ({
  resolveCallbackIdentity: resolveCallbackIdentityMock,
}));

const exchangeCodeMock = vi.hoisted(() => vi.fn());
const saveTokensMock = vi.hoisted(() => vi.fn());
const isFirstConnectMock = vi.hoisted(() => vi.fn());
const triggerBackfillMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/whoop-oauth", () => ({
  exchangeCode: exchangeCodeMock,
  saveTokens: saveTokensMock,
  isFirstConnect: isFirstConnectMock,
  triggerBackfill: triggerBackfillMock,
}));

import { GET } from "@/app/api/whoop/callback/route";

const STATE = "matching-state-value";

function callbackRequest(): Request {
  return new Request(`https://jerkai.app/api/whoop/callback?code=abc123&state=${STATE}`);
}

describe("GET /api/whoop/callback — AC-WT20/AC-WT21: triggers backfill iff isFirstConnect(existingRowFound)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.clear();
    cookieStore.set("whoop_oauth_state", STATE);
    authMock.mockResolvedValue({ user: { id: "42" } });
    resolveCallbackIdentityMock.mockReturnValue({ outcome: "resolved", userId: 42 });
    exchangeCodeMock.mockResolvedValue({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    process.env.NEXT_PUBLIC_APP_URL = "https://jerkai.app";
  });

  it("AC-WT20: calls triggerBackfill(userId) when saveTokens reports a true first connect", async () => {
    saveTokensMock.mockResolvedValue({ existingRowFound: false });
    isFirstConnectMock.mockReturnValue(true);

    await GET(callbackRequest());

    expect(isFirstConnectMock).toHaveBeenCalledWith(false);
    expect(triggerBackfillMock).toHaveBeenCalledTimes(1);
    expect(triggerBackfillMock).toHaveBeenCalledWith(42);
  });

  it("AC-WT21: withholds triggerBackfill on a reconnect, where saveTokens reports an existing row", async () => {
    saveTokensMock.mockResolvedValue({ existingRowFound: true });
    isFirstConnectMock.mockReturnValue(false);

    await GET(callbackRequest());

    expect(isFirstConnectMock).toHaveBeenCalledWith(true);
    expect(triggerBackfillMock).not.toHaveBeenCalled();
  });
});
