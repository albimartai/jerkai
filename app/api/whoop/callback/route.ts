import { createHash, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { resolveCallbackIdentity } from "@/lib/whoop-oauth-binding";
import { exchangeCode, saveTokens } from "@/lib/whoop-oauth";

// Whoop's OAuth redirect target. The path is registered VERBATIM as the
// Redirect URL in the Whoop Developer Dashboard
// (https://jerkai.app/api/whoop/callback) — renaming it breaks the handshake
// with a redirect_uri mismatch. It is excluded from proxy.ts's session gate
// (Whoop's redirect must reach it even if the session cookie went stale
// mid-flow, where a 307 to /signin would strand the one-time code); in its
// place:
//   - the state parameter must match the httpOnly cookie set by
//     /api/whoop/connect — which only a signed-in session can reach — so a
//     forged or attacker-initiated callback fails before any token exchange;
//   - the whoop_oauth_user cookie set at connect time must match a live
//     session's own user id (AC-WT4, NFR-78, §0) — closes the narrow gap
//     where the browser's active session changed between initiating and
//     completing the flow;
//   - the session check itself is demoted from a hard gate to a
//     best-available identity source — AC-WT14-19, NFR-136-140 (JerkAI -
//     Build PRD - OAuth Callback Identity Fallback, §0): a live, matching
//     session is preferred, but its total absence (a browser-context split
//     losing only the session cookie) falls back to the connect-time
//     binding cookie rather than refusing outright; a live session that
//     actively disagrees with the binding cookie is still refused,
//     unchanged.

function matches(a: string, b: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("whoop_oauth_state")?.value;
  const expectedUserId = cookieStore.get("whoop_oauth_user")?.value;
  cookieStore.delete("whoop_oauth_state"); // single-use, success or not
  cookieStore.delete("whoop_oauth_user");

  const session = await auth();

  // Whoop reports consent-screen denials etc. as ?error=...
  const oauthError = params.get("error");
  if (oauthError) {
    return Response.json(
      { error: `Whoop authorization failed: ${oauthError}`, detail: params.get("error_description") },
      { status: 400 },
    );
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || !matches(state, expectedState)) {
    return Response.json(
      { error: "missing or mismatched OAuth state — restart from /api/whoop/connect" },
      { status: 403 },
    );
  }

  const identity = resolveCallbackIdentity(session !== null, session?.user.id, expectedUserId);
  if (identity.outcome === "mismatch") {
    return Response.json(
      {
        error:
          "the signed-in session changed since this connection was started — restart from /api/whoop/connect",
      },
      { status: 403 },
    );
  }
  if (identity.outcome === "unresolved") {
    return Response.json(
      { error: "unable to verify this connection — restart from /api/whoop/connect" },
      { status: 403 },
    );
  }

  const tokens = await exchangeCode(code);
  await saveTokens(identity.userId, tokens);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return Response.redirect(`${appUrl}/status`, 302);
}
