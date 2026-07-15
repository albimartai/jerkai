import { describe, expect, it, vi } from "vitest";
import type { BaseNextRequest } from "next/dist/server/base-http";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";

// proxy.ts's default export drags in the whole Auth.js setup (which doesn't
// resolve under vitest's node environment); only the matcher is under test.
vi.mock("@/auth", () => ({ auth: () => undefined }));

const { config } = await import("@/proxy");

// Compile the real exported matcher exactly the way Next's build does
// (path-to-regexp via tryToParsePath) and run it through the runtime
// matcher, so these tests exercise the actual gate, not a re-typed copy.
const matches = getMiddlewareRouteMatcher(
  config.matcher.map((source) => {
    const { regexStr, error } = tryToParsePath(source);
    if (!regexStr) throw error ?? new Error(`unparseable matcher: ${source}`);
    return { regexp: regexStr, originalSource: source };
  }),
);

// The matcher has no `has`/`missing` conditions, so the request is unused.
const gated = (pathname: string) => matches(pathname, {} as BaseNextRequest, {});

describe("proxy matcher", () => {
  it.each([
    "/privacy",
    "/signin",
    "/signin/sent",
    "/api/auth/callback/resend",
    "/api/ingest/health",
    // Whoop's OAuth redirect target and Vercel Cron's sync target carry no
    // session; each has its own auth (state cookie + session check, and
    // CRON_SECRET bearer, respectively).
    "/api/whoop/callback",
    "/api/whoop/sync",
    "/favicon.ico",
  ])("leaves %s reachable without a session", (pathname) => {
    expect(gated(pathname)).toBe(false);
  });

  it.each([
    "/",
    "/status",
    // /privacy is excluded with an exact match — anything that merely
    // starts with it must stay behind the session gate.
    "/privacy/anything",
    "/privacy-policy",
    "/privacypolicy",
    // Only a signed-in session may INITIATE a Whoop connection — the
    // callback/sync exclusions are exact matches and must not leak here.
    "/api/whoop/connect",
    "/api/whoop/callback/extra",
    "/api/whoop/sync-anything",
    "/api/whoop",
    "/some/future/route",
  ])("keeps %s behind the session gate", (pathname) => {
    expect(gated(pathname)).toBe(true);
  });

  it("fails closed on /privacy with a trailing slash", () => {
    // Next normalizes /privacy/ to /privacy before routing; if that ever
    // changes, the un-normalized path must land on the gate, not outside it.
    expect(gated("/privacy/")).toBe(true);
  });
});
