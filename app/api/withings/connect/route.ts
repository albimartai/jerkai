import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { buildAuthorizeUrl } from "@/lib/withings-oauth";

// Starts the Withings OAuth flow. Mirrors app/api/whoop/connect/route.ts
// exactly: this route stays BEHIND the Auth.js gate (proxy.ts does not
// exclude it) so only a signed-in session can initiate a connection. The
// random state lands in an httpOnly cookie the callback requires and
// compares (CSRF protection); a second cookie binds the roundtrip to the
// initiating user (AC-WS5, NFR-99).
export async function GET(): Promise<Response> {
  // Defense in depth alongside the proxy gate, same as the pages.
  const session = await auth();
  if (!session) {
    return Response.json({ error: "sign in required" }, { status: 401 });
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const, // sent on Withings' top-level redirect back to the callback
    path: "/api/withings",
    maxAge: 600,
  };
  cookieStore.set("withings_oauth_state", state, cookieOptions);
  // Binds the roundtrip to the initiating user (AC-WS5, NFR-99, §0): the
  // callback compares this against its own fresh session.user.id, so a
  // session change mid-flight is refused rather than silently attributing
  // the resulting tokens to whoever is signed in when Withings' redirect
  // completes.
  cookieStore.set("withings_oauth_user", session.user.id, cookieOptions);
  return Response.redirect(buildAuthorizeUrl(state), 302);
}
