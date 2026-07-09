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
//   - /signin: where unauthenticated visitors land
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
  matcher: ["/((?!api/ingest|api/auth|signin|_next/static|_next/image|favicon.ico).*)"],
};
