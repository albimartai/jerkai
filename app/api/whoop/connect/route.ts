import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { buildAuthorizeUrl } from "@/lib/whoop-oauth";

// Starts the Whoop OAuth flow. This route stays BEHIND the Auth.js gate
// (proxy.ts does not exclude it) so only a signed-in session can initiate a
// connection — anyone else could otherwise link their own Whoop account and
// poison the data. The random state lands in an httpOnly cookie that the
// callback requires and compares, which also means a callback can only ever
// complete a flow this route started in the same browser (CSRF protection).
export async function GET(): Promise<Response> {
  // Defense in depth alongside the proxy gate, same as the pages.
  const session = await auth();
  if (!session) {
    return Response.json({ error: "sign in required" }, { status: 401 });
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("whoop_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on Whoop's top-level redirect back to the callback
    path: "/api/whoop",
    maxAge: 600,
  });
  return Response.redirect(buildAuthorizeUrl(state), 302);
}
