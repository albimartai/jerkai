/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Smart-Scale Integration
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AC-WS9/NFR-101 (§0/§1): no precedent file exists for this pattern —
// lib/whoop-api.ts's own apiGet is private/untested today. This slice's
// lib/withings-api.ts must export its retry/429 + rate-pacing helper
// (unlike Whoop's private apiGet) specifically so this file can reach it
// directly with a mocked fetch, asserting request pacing and 429-retry
// behavior without a real network call (DoD §6).
//
// The exact response envelope, rate-limit header name, and whether getmeas
// paginates a one-year window are this planning session's own unverified
// research (NFR-104) — the build agent confirms these live before finalizing
// lib/withings-api.ts. To avoid pinning an unconfirmed header name into a
// strict stub, the 429 test below asserts observable retry BEHAVIOR (one
// retry, then success) rather than which specific header value is read.
const fetchMock = vi.fn();

const { apiGet } = await import("@/lib/withings-api");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("apiGet — 429/rate-limit response handling (AC-WS9, NFR-101)", () => {
  it("AC-WS9: retries exactly once after a 429 and succeeds, mirroring lib/whoop-api.ts#apiGet's bounded-retry pattern, rather than failing the whole backfill on one rate-limit response", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "0" }),
          text: async () => "rate limited",
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ status: 0, body: { measuregrps: [] } }),
        text: async () => "",
      };
    });

    const result = await apiGet("/measure", "access-token", { action: "getmeas" });
    expect(calls).toBe(2);
    // apiGet unwraps the {status, body} envelope and returns body itself
    // (its callers — fetchMeasureGroups/mapWithingsData — read
    // measuregrps/timezone directly, never the raw envelope).
    expect(result).toEqual({ measuregrps: [] });
  });

  it("AC-WS9: surfaces a second consecutive 429 as a thrown error rather than retrying unboundedly", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "0" }),
      text: async () => "rate limited",
      json: async () => ({}),
    });

    await expect(apiGet("/measure", "access-token", { action: "getmeas" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("apiGet — self-throttles under the documented rate cap (AC-WS9, NFR-101)", () => {
  it("AC-WS9/NFR-101: never issues more than 60 requests within any rolling 60-second window during a backfill-sized burst", async () => {
    vi.useFakeTimers();
    const callTimestamps: number[] = [];
    fetchMock.mockImplementation(async () => {
      callTimestamps.push(Date.now());
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ status: 0, body: { measuregrps: [] } }),
        text: async () => "",
      };
    });

    const calls = Array.from({ length: 65 }, (_, i) =>
      apiGet("/measure", "access-token", { action: "getmeas", offset: String(i) }),
    );
    await vi.runAllTimersAsync();
    await Promise.all(calls);

    expect(callTimestamps.length).toBe(65);
    for (let i = 0; i + 60 < callTimestamps.length; i++) {
      expect(callTimestamps[i + 60] - callTimestamps[i]).toBeGreaterThanOrEqual(60_000);
    }
  });
});
