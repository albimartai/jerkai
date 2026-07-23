import type { NextFetchEvent, NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { BaseNextRequest } from "next/dist/server/base-http";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
// Next's own recommended pattern for testing a full proxy/middleware function
// (node_modules/next/dist/docs/.../proxy.md, "The entire proxy function can
// also be tested"): construct a real NextRequest and assert on the response
// via isRewrite/getRewrittenUrl, rather than hand-inspecting a fake object.
import { getRewrittenUrl, isRewrite } from "next/experimental/testing/server";

// proxy.ts's default export drags in the whole Auth.js setup (which doesn't
// resolve under vitest's node environment); auth() is mocked so both the
// matcher (below) and the runtime host-bypass logic (bottom of this file)
// can be exercised without it.
const authMock = vi.fn(async () => new Response("auth-ran"));
vi.mock("@/auth", () => ({ auth: authMock }));

const { config, default: proxy } = await import("@/proxy");

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
    // /demo (docs/prd/public-demo.md, AC-PD1, NFR-49): the public demo
    // surface — synthetic fixture data only, no auth() call, no DB import.
    "/demo",
    "/demo/weekly",
    "/demo/daily",
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
    // /demo is excluded with exact-match discipline (demo(?:$|/)) — a path
    // that merely starts with the string "demo" but isn't the subtree must
    // stay gated, same discipline as /privacy$.
    "/demography",
    "/demo-anything",
  ])("keeps %s behind the session gate", (pathname) => {
    expect(gated(pathname)).toBe(true);
  });

  it("fails closed on /privacy with a trailing slash", () => {
    // Next normalizes /privacy/ to /privacy before routing; if that ever
    // changes, the un-normalized path must land on the gate, not outside it.
    expect(gated("/privacy/")).toBe(true);
  });
});

// The path-only matcher above cannot express "any path under this host is
// public" — middleware evaluates its matcher against the request's ORIGINAL
// incoming path, which for a demo.jerkai.app visitor is "/" (or "/weekly",
// "/daily"), not "/demo/weekly", so those paths are NOT excluded by the
// demo(?:$|/) pattern. proxy.ts instead checks the Host header at runtime
// and rewrites directly into /demo/* for that host, regardless of path,
// never reaching auth() — these tests exercise that runtime logic directly
// via Next's own recommended isRewrite/getRewrittenUrl pattern (bug found
// live: pre-fix, demo.jerkai.app/ 307'd to jerkai.app/signin because auth()
// ran on the original "/" path before any rewrite could apply).
// NextRequest built from a bare URL string does not auto-populate a `Host`
// header (confirmed directly: proxy.ts's request.headers.get("host") read
// nothing without this) — a real request always carries one, so set it
// explicitly from the URL, matching what the request actually looks like
// on the wire.
function requestFor(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: new URL(url).host } });
}
const fakeEvent = {} as NextFetchEvent;

// proxy()'s two branches return different types (NextResponse.rewrite() vs
// the mocked auth()'s plain Response), so its inferred return type is a
// union; isRewrite/getRewrittenUrl require NextResponse specifically. This
// cast is compile-time only — isRewrite/getRewrittenUrl check response
// headers at runtime, so they behave correctly (return false/null) on a
// plain Response too, which is exactly what the "no rewrite" cases below
// rely on.
async function callProxy(url: string): Promise<NextResponse> {
  return (await proxy(requestFor(url), fakeEvent)) as NextResponse;
}

describe("proxy host bypass for demo.jerkai.app", () => {
  it("rewrites demo.jerkai.app/ to /demo/weekly without calling auth() (regression: used to 307 to jerkai.app/signin)", async () => {
    authMock.mockClear();
    const response = await callProxy("https://demo.jerkai.app/");
    expect(authMock).not.toHaveBeenCalled();
    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("https://demo.jerkai.app/demo/weekly");
  });

  it("rewrites demo.jerkai.app/daily (with a query string) to /demo/daily, preserving the query", async () => {
    authMock.mockClear();
    const response = await callProxy("https://demo.jerkai.app/daily?week=2026-07-13");
    expect(authMock).not.toHaveBeenCalled();
    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("https://demo.jerkai.app/demo/daily?week=2026-07-13");
  });

  it("still calls auth() (no rewrite) for the real jerkai.app host", async () => {
    authMock.mockClear();
    const response = await callProxy("https://jerkai.app/");
    expect(authMock).toHaveBeenCalledOnce();
    expect(isRewrite(response)).toBe(false);
  });

  it("still calls auth() (no rewrite) for a Vercel preview deployment host", async () => {
    authMock.mockClear();
    const response = await callProxy("https://jerkai-git-some-branch-albimartai817.vercel.app/");
    expect(authMock).toHaveBeenCalledOnce();
    expect(isRewrite(response)).toBe(false);
  });

  it("still calls auth() (no rewrite) for a lookalike host (not an exact match)", async () => {
    authMock.mockClear();
    let response = await callProxy("https://evildemo.jerkai.app/");
    expect(authMock).toHaveBeenCalledOnce();
    expect(isRewrite(response)).toBe(false);

    authMock.mockClear();
    response = await callProxy("https://demo.jerkai.app.evil.com/");
    expect(authMock).toHaveBeenCalledOnce();
    expect(isRewrite(response)).toBe(false);
  });

  it("rewrites for demo.jerkai.app with an explicit port (local/proxy testing)", async () => {
    authMock.mockClear();
    const response = await callProxy("http://demo.jerkai.app:3000/");
    expect(authMock).not.toHaveBeenCalled();
    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("http://demo.jerkai.app:3000/demo/weekly");
  });
});
