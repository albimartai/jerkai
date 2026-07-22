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
export default function proxy(request: NextRequest, event: NextFetchEvent) {
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
