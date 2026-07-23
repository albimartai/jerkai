import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

import { auth } from "@/auth";

// Session gate for the whole app (Next 16 renamed middleware to proxy).
// Calling `auth` with the request invokes Auth.js's middleware handling:
// it verifies the JWT session cookie (no database round-trip), asks the
// `authorized` callback in auth.ts, and redirects unauthenticated visitors
// to /signin with a callbackUrl. Routes excluded from the matcher below
// stay reachable without a session:
//   - /api/ingest/health: machine-to-machine, has its own x-api-key auth
//   - /api/auth/*: Auth.js's own sign-in/callback routes
//   - /api/whoop/callback: Whoop's OAuth redirect target — Whoop must reach
//     it even when the session cookie is stale (a 307 to /signin would
//     strand the one-time code); it verifies the state cookie + session
//     itself. Exact match, so /api/whoop/connect STAYS gated (only a
//     signed-in session may initiate a connection).
//   - /api/whoop/sync: Vercel Cron target — cron invocations carry no
//     session cookie and never follow redirects; it has its own CRON_SECRET
//     bearer auth. Exact match.
//   - /signin: where unauthenticated visitors land
//   - /privacy: public privacy policy (WHOOP's OAuth consent flow links to
//     it, so it must render without a session). Excluded with `privacy$` —
//     exact match only, so /privacy/* or any future /privacy-* stays gated.
//   - /demo, /demo/*: the public demo surface (docs/prd/public-demo.md,
//     AC-PD1) — renders the same dashboard UI over a committed synthetic
//     fixture only. Never opens a DB connection or calls auth() (see
//     tests/unit/demo-isolation.test.ts), so there is nothing to bypass;
//     mirrors /privacy's static-only precedent. Excluded with `demo(?:$|/)`
//     — exact-match discipline, so /demo and /demo/* open, but a
//     hypothetical /demo-anything or /demography stays gated.
//   - Next.js static assets and the favicon
// Pages also re-check the session themselves (defense in depth) — see
// app/page.tsx and app/status/page.tsx.
//
// The demo.jerkai.app HOST is handled entirely here, in proxy()'s body, not
// via next.config.ts's rewrites — and not via a matcher exclusion either.
// Per Next's own docs (node_modules/next/dist/docs/.../proxy.md,
// "Execution order"), Proxy always runs BEFORE any next.config.js rewrite
// (steps 3 vs 4/6/8), regardless of beforeFiles/afterFiles/fallback. A
// visitor typing "demo.jerkai.app" requests path "/" (or "/weekly",
// "/daily"), not "/demo/weekly" — that path doesn't match the demo(?:$|/)
// matcher exclusion, so proxy() DOES run for it, and a next.config.ts
// rewrite from "/" to "/demo/weekly" would never get a chance to fire
// before auth() had already redirected the request. (Confirmed live, pre-fix:
// demo.jerkai.app/demo/weekly worked; demo.jerkai.app/ 307'd to
// jerkai.app/signin, because auth() ran on the original "/" path.)
//
// The fix: proxy() itself detects the host and issues the rewrite directly
// via NextResponse.rewrite(), before ever considering auth() — deterministic,
// no dependency on next.config.js rewrite ordering. This is the sole
// mechanism that routes demo.jerkai.app; there is no longer a matching
// rewrite in next.config.ts (removed — it could never fire once proxy()
// itself rewrites the URL first, and having two competing rewrite paths for
// the same host risked exactly this kind of ordering bug on the other one
// too). Applying this to every path on the host (not just "/") is safe
// because the destination is always the DB-free /demo subtree
// (docs/prd/public-demo.md, NFR-51) — there is no other content reachable
// there — and even if this logic ever regressed, the real page components
// underneath still call auth() themselves as defense in depth (see the
// comment above).
const DEMO_HOST = "demo.jerkai.app";

function isDemoHost(host: string): boolean {
  return host === DEMO_HOST || host.startsWith(`${DEMO_HOST}:`);
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isDemoHost(request.headers.get("host") ?? "")) {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname === "/" ? "/demo/weekly" : `/demo${url.pathname}`;
    return NextResponse.rewrite(url);
  }
  // The auth config is lazily initialized (see auth.ts), which makes `auth`'s
  // TS overloads unavailable — but a (request, event) call is supported at
  // runtime and returns the middleware response.
  return auth(request as never, event as never) as unknown as Promise<Response>;
}

export const config = {
  matcher: [
    "/((?!api/ingest|api/auth|api/whoop/callback$|api/whoop/sync$|signin|privacy$|demo(?:$|/)|_next/static|_next/image|favicon.ico).*)",
  ],
};
