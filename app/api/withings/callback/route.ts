import { createHash, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { resolveCallbackIdentity } from "@/lib/withings-oauth-binding";
import {
  exchangeCode,
  isFirstConnect,
  logBackfillSkipped,
  saveTokens,
  triggerBackfill,
} from "@/lib/withings-oauth";

// Withings' OAuth redirect target. The path is registered VERBATIM as the
// Redirect URL in the Withings Partner Hub — renaming it breaks the
// handshake with a redirect_uri mismatch. Excluded from proxy.ts's session
// gate (AC-WS20/NFR-108); gated here instead by the state-cookie match and
// the withings_oauth_user binding cookie (AC-WS5, NFR-99), with the session
// check demoted from a hard gate to a best-available identity source —
// AC-WS21-26, NFR-136-140 (JerkAI - Build PRD - OAuth Callback Identity
// Fallback, §0): a live, matching session is preferred, but its total
// absence (a browser-context split losing only the session cookie) falls
// back to the connect-time binding cookie rather than refusing outright; a
// live session that actively disagrees with the binding cookie is still
// refused, unchanged.
//
// Difference from Whoop's callback (§0/AC-WS8/AC-WS10/NFR-105/NFR-109): once
// tokens are saved, a TRUE FIRST CONNECT (no pre-existing withings_tokens
// row before this saveTokens call, per NFR-98's atomic
// insert...on conflict...returning(xmax=0) flag) schedules the 1-year
// historical backfill via next/server#after(), so it runs after the
// redirect to /status is already sent and never blocks or risks the
// route's own maxDuration budget. A reconnect (row already existed) redirects
// the same way, with no backfill re-triggered.

// after()'s callback (triggerBackfill, in lib/withings-oauth.ts, called
// below) awaits the full backfill fetch to /api/withings/sync before this
// invocation is allowed to end (Vercel's waitUntil keeps it alive that
// long) — after() runs within THIS route's own duration budget, not the
// sync route's (per Next's own after() docs), regardless of which file the
// call to after() physically lives in — what matters is that it's invoked
// synchronously within this GET handler's own execution. Without matching
// the sync route's maxDuration here too, a slow first-connect backfill
// could be killed mid-flight by this route's (shorter) default budget
// before the awaited fetch ever completes.
export const maxDuration = 60;

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
  const expectedState = cookieStore.get("withings_oauth_state")?.value;
  const expectedUserId = cookieStore.get("withings_oauth_user")?.value;
  cookieStore.delete("withings_oauth_state"); // single-use, success or not
  cookieStore.delete("withings_oauth_user");

  const session = await auth();

  // Withings reports consent-screen denials etc. as ?error=...
  const oauthError = params.get("error");
  if (oauthError) {
    return Response.json({ error: `Withings authorization failed: ${oauthError}` }, { status: 400 });
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || !matches(state, expectedState)) {
    return Response.json(
      { error: "missing or mismatched OAuth state — restart from /api/withings/connect" },
      { status: 403 },
    );
  }

  const identity = resolveCallbackIdentity(session !== null, session?.user.id, expectedUserId);
  if (identity.outcome === "mismatch") {
    return Response.json(
      {
        error:
          "the signed-in session changed since this connection was started — restart from /api/withings/connect",
      },
      { status: 403 },
    );
  }
  if (identity.outcome === "unresolved") {
    return Response.json(
      { error: "unable to verify this connection — restart from /api/withings/connect" },
      { status: 403 },
    );
  }

  const tokens = await exchangeCode(code);
  const { existingRowFound } = await saveTokens(identity.userId, tokens);

  if (isFirstConnect(existingRowFound)) {
    triggerBackfill(identity.userId);
  } else {
    logBackfillSkipped(identity.userId);
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return Response.redirect(`${appUrl}/status`, 302);
}
