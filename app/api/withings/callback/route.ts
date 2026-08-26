import { createHash, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { after } from "next/server";

import { auth } from "@/auth";
import { isBoundToInitiatingUser } from "@/lib/withings-oauth-binding";
import { exchangeCode, isFirstConnect, saveTokens } from "@/lib/withings-oauth";

// Withings' OAuth redirect target. The path is registered VERBATIM as the
// Redirect URL in the Withings Partner Hub — renaming it breaks the
// handshake with a redirect_uri mismatch. Excluded from proxy.ts's session
// gate (AC-WS20/NFR-108); gated here instead by the same three checks
// app/api/whoop/callback/route.ts uses: state-cookie match, a fresh
// session, and the withings_oauth_user binding cookie (AC-WS5, NFR-99).
//
// Difference from Whoop's callback (§0/AC-WS8/AC-WS10/NFR-105/NFR-109): once
// tokens are saved, a TRUE FIRST CONNECT (no pre-existing withings_tokens
// row before this saveTokens call, per NFR-98's atomic
// insert...on conflict...returning(xmax=0) flag) schedules the 1-year
// historical backfill via next/server#after(), so it runs after the
// redirect to /status is already sent and never blocks or risks the
// route's own maxDuration budget. A reconnect (row already existed) redirects
// the same way, with no backfill re-triggered.

// after()'s callback (triggerBackfill, below) awaits the full backfill
// fetch to /api/withings/sync before this invocation is allowed to end
// (Vercel's waitUntil keeps it alive that long) — after() runs within THIS
// route's own duration budget, not the sync route's (per Next's own after()
// docs). Without matching the sync route's maxDuration here too, a slow
// first-connect backfill could be killed mid-flight by this route's
// (shorter) default budget before the awaited fetch ever completes.
export const maxDuration = 60;

function matches(a: string, b: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

// Targets the deployment that is actually handling this callback
// (VERCEL_URL — Vercel's own per-deployment hostname, correct for
// production AND Preview alike), never NEXT_PUBLIC_APP_URL alone: that
// value is pinned to https://jerkai.app in every environment so Whoop's
// OAuth redirect_uri byte-matches its Dashboard registration, and reusing it
// here would misroute a Preview-environment first connect's backfill
// request to production's /api/withings/sync instead of the deployment that
// actually holds the new withings_tokens row (§0/NFR-109). Falls back to
// NEXT_PUBLIC_APP_URL only when VERCEL_URL is unset (local dev).
function backfillTargetOrigin(): string {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

const BACKFILL_WINDOW_DAYS = 365;

function triggerBackfill(): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("withings backfill not triggered: CRON_SECRET is not set");
    return;
  }
  const end = new Date();
  const start = new Date(end.getTime() - BACKFILL_WINDOW_DAYS * 24 * 3_600_000);
  const query = `?start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
  const url = `${backfillTargetOrigin()}/api/withings/sync${query}`;

  after(async () => {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${cronSecret}` } });
      if (!res.ok) {
        console.error(`withings backfill request failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
    } catch (err) {
      console.error("withings backfill request failed:", err);
    }
  });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("withings_oauth_state")?.value;
  const expectedUserId = cookieStore.get("withings_oauth_user")?.value;
  cookieStore.delete("withings_oauth_state"); // single-use, success or not
  cookieStore.delete("withings_oauth_user");

  const session = await auth();
  if (!session) {
    return Response.json(
      { error: "no active session — sign in, then restart from /api/withings/connect" },
      { status: 403 },
    );
  }

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

  if (!isBoundToInitiatingUser(expectedUserId, session.user.id)) {
    return Response.json(
      {
        error:
          "the signed-in session changed since this connection was started — restart from /api/withings/connect",
      },
      { status: 403 },
    );
  }

  const tokens = await exchangeCode(code);
  const { existingRowFound } = await saveTokens(Number(session.user.id), tokens);

  if (isFirstConnect(existingRowFound)) {
    triggerBackfill();
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return Response.redirect(`${appUrl}/status`, 302);
}
