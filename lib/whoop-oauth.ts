import { after } from "next/server";

import { getSql } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/whoop-crypto";

// Whoop OAuth 2.0 (developer.whoop.com/docs/developing/oauth): standard
// authorization-code flow against Whoop's hosted endpoints. Two properties
// drive the design here:
//
//   - Refresh tokens ROTATE: using one invalidates the previous access/
//     refresh pair, so every refresh must persist the new pair immediately —
//     losing it strands the integration until Albert re-consents via
//     /api/whoop/connect.
//   - Access tokens are short-lived (expires_in ~1h) while the sync cron is
//     daily, so the stored access token is essentially always expired when a
//     sync starts. Refresh strategy is therefore PROACTIVE-ON-USE:
//     getFreshAccessToken() refreshes whenever the stored token is within
//     60s of expiry (in practice: once per sync run), which avoids a
//     guaranteed 401 round-trip per run. The sync route keeps a single
//     reactive retry (force refresh on 401) as a fallback for clock skew or
//     an access token revoked out-of-band.
//
// The `offline` scope is what makes Whoop issue a refresh token at all.

export const WHOOP_AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

// Minimal scope set for the pipes this app actually ingests (recovery,
// sleep, cycle, workout). Deliberately excludes read:profile and
// read:body_measurement — body composition stays Fitdays-owned.
export const WHOOP_SCOPES = "read:recovery read:cycles read:sleep read:workout offline";

export type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
};

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID and/or WHOOP_CLIENT_SECRET is not set");
  }
  return { clientId, clientSecret };
}

// Must byte-match the Redirect URL registered in the Whoop Developer
// Dashboard (https://jerkai.app/api/whoop/callback in production) — OAuth
// redirect URIs are compared as exact strings, so this is derived from
// NEXT_PUBLIC_APP_URL rather than the request host.
export function redirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build the Whoop redirect URI");
  }
  return `${appUrl.replace(/\/$/, "")}/api/whoop/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId } = clientCredentials();
  const url = new URL(WHOOP_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", WHOOP_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

// Whoop's token endpoint (ORY Hydra) takes application/x-www-form-urlencoded
// per RFC 6749, not JSON.
async function requestTokens(params: Record<string, string>): Promise<WhoopTokenResponse> {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whoop token request failed (${params.grant_type}): ${res.status} ${detail}`);
  }
  const tokens = (await res.json()) as Partial<WhoopTokenResponse>;
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string" ||
    typeof tokens.expires_in !== "number"
  ) {
    throw new Error(
      `Whoop token response (${params.grant_type}) is missing access_token/refresh_token/expires_in`,
    );
  }
  return tokens as WhoopTokenResponse;
}

export async function exchangeCode(code: string): Promise<WhoopTokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return requestTokens({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
  });
}

export async function refreshTokens(refreshToken: string): Promise<WhoopTokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return requestTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    scope: "offline",
  });
}

// whoop_tokens is keyed by user_id (Whoop Multi-Tenancy, AC-WT2/AC-WT5) — a
// Whoop connection is one-per-user, so user_id is the table's primary key
// itself, not a surrogate id alongside it.
//
// A single atomic `insert ... on conflict (user_id) do update ... returning
// (xmax = 0) as inserted`, not a separate SELECT-then-upsert (NFR-145,
// mirroring lib/withings-oauth.ts's NFR-98 precedent exactly) — race-free by
// construction, so a concurrent double-submit of the connect flow can never
// both observe "first connect" and double-trigger the backfill.
export async function saveTokens(
  userId: number,
  tokens: WhoopTokenResponse,
): Promise<{ existingRowFound: boolean }> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const rows = await sql`
    insert into whoop_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, scope, updated_at)
    values (${userId}, ${encryptToken(tokens.access_token)}, ${encryptToken(tokens.refresh_token)},
            ${expiresAt}, ${tokens.scope ?? null}, now())
    on conflict (user_id)
    do update set access_token_enc = excluded.access_token_enc,
                  refresh_token_enc = excluded.refresh_token_enc,
                  expires_at = excluded.expires_at,
                  scope = excluded.scope,
                  updated_at = now()
    returning (xmax = 0) as inserted
  `;
  const inserted = Boolean(rows[0]?.inserted);
  return { existingRowFound: !inserted };
}

// Pure decision function (§1, mirroring lib/withings-oauth.ts's isFirstConnect
// exactly): true only when saveTokens' atomic insert reports no pre-existing
// row — i.e. a genuine first connect. Takes the already-resolved boolean
// rather than re-querying, so the callback route's first-connect-vs-reconnect
// branch (AC-WT20/AC-WT21) is unit-testable without a Route Handler/cookies()
// context.
export function isFirstConnect(existingRowFound: boolean): boolean {
  return !existingRowFound;
}

// Targets the deployment actually handling this callback (VERCEL_URL —
// Vercel's own per-deployment hostname, correct for production AND Preview
// alike), never NEXT_PUBLIC_APP_URL alone: that value is pinned to
// https://jerkai.app in every environment, and reusing it here would misroute
// a Preview-environment first connect's backfill request to production's
// /api/whoop/sync instead of the deployment that actually holds the new
// whoop_tokens row (NFR-146, mirroring lib/withings-oauth.ts's
// backfillTargetOrigin exactly). Falls back to NEXT_PUBLIC_APP_URL only when
// VERCEL_URL is unset (local dev).
function backfillTargetOrigin(): string {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

// §0/NFR-147: 90 days, not Withings' 365 — JerkAI's own dashboard never reads
// more than 90 days of history regardless (app/weekly/page.tsx,
// app/daily/page.tsx), and app/api/whoop/sync/route.ts's own header comment
// already treats ~90 days as the safe chunk size for a single Whoop
// historical pull, so this needs no further internal chunking.
const BACKFILL_WINDOW_DAYS = 90;

// Fires the internal, wide-window sync call after the callback's own
// response is sent (NFR-149's maxDuration budget covers this route, not the
// sync route's) — mirroring lib/withings-oauth.ts's triggerBackfill exactly,
// including its console.error fallback when CRON_SECRET is unset. Unlike
// Withings' own triggerBackfill, this carries no four-state
// (triggered/succeeded/failed/skipped) logging — that pattern is Withings'
// own AC-WS27–31, out of scope for this slice (§1, §8 OQ-4).
export function triggerBackfill(userId: number): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("whoop backfill not triggered: CRON_SECRET is not set");
    return;
  }
  const end = new Date();
  const start = new Date(end.getTime() - BACKFILL_WINDOW_DAYS * 24 * 3_600_000);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const url = `${backfillTargetOrigin()}/api/whoop/sync?start=${startStr}&end=${endStr}`;

  after(async () => {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${cronSecret}` } });
      if (!res.ok) {
        console.error(`whoop backfill request failed: ${res.status} ${await res.text().catch(() => "")}`);
        return;
      }
    } catch (err) {
      console.error("whoop backfill request failed:", err);
    }
  });
}

type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: Date };

async function loadTokens(userId: number): Promise<StoredTokens | null> {
  const sql = getSql();
  const rows = await sql`
    select access_token_enc, refresh_token_enc, expires_at from whoop_tokens where user_id = ${userId}
  `;
  if (rows.length === 0) return null;
  return {
    accessToken: decryptToken(rows[0].access_token_enc as string),
    refreshToken: decryptToken(rows[0].refresh_token_enc as string),
    expiresAt: new Date(rows[0].expires_at as string),
  };
}

// Returns a usable access token for the given user, refreshing (and
// persisting the rotated pair) when the stored one is expired or within 60s
// of it. Returns null when this user has never connected Whoop — callers
// treat that as an expected pre-connection state, not an error.
export async function getFreshAccessToken(
  userId: number,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const stored = await loadTokens(userId);
  if (!stored) return null;
  const expiryMarginMs = 60_000;
  if (!options.forceRefresh && stored.expiresAt.getTime() - Date.now() > expiryMarginMs) {
    return stored.accessToken;
  }
  const refreshed = await refreshTokens(stored.refreshToken);
  await saveTokens(userId, refreshed);
  return refreshed.access_token;
}

// Data Page Redesign & Connect (§1, NFR-120): a direct, read-only existence
// check for the /connect page's "Connected" tag — never calls or wraps
// getFreshAccessToken, which proactively refreshes and re-persists tokens as
// a side effect of being called (confirmed above, getFreshAccessToken's own
// docstring). Viewing the page must never rotate a stored refresh token.
export async function hasWhoopTokens(userId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`select 1 from whoop_tokens where user_id = ${userId} limit 1`;
  return rows.length > 0;
}

// The cron loop's iteration source (app/api/whoop/sync/route.ts, §0/NFR-77) —
// every row in whoop_tokens already carries the user_id to attribute pulls
// to; this joins to users for the email AC-WT9's failure alert names.
export async function listConnectedUsers(): Promise<{ userId: number; email: string }[]> {
  const sql = getSql();
  const rows = await sql`
    select whoop_tokens.user_id as user_id, users.email as email
    from whoop_tokens
    join users on users.id = whoop_tokens.user_id
    order by whoop_tokens.user_id
  `;
  return rows.map((row) => ({ userId: row.user_id as number, email: row.email as string }));
}
