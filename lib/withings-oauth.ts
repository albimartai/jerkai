import { getSql } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/withings-crypto";

// Withings OAuth 2.0 (developer.withings.com). Same authorization-code shape
// as Whoop's (lib/whoop-oauth.ts), with two structural differences below.
// NFR-104 — OPEN RISK, not yet live-verified: these come from search against
// Withings' own API surface and third-party client implementations, since
// developer.withings.com itself is JS-rendered and was not fetchable
// directly this session. As of this commit, no live OAuth token exchange
// has been performed against a real connected account — a Preview test of
// this branch reached Withings' real consent screen (confirming
// client_id/redirect_uri registration) but stopped before authorizing, so
// exchangeCode()/refreshTokens() have never actually run against Withings'
// live token endpoint. Flag as an open risk in the PR description until a
// real first connect exercises this path and confirms (or corrects) the
// shape below:
//
//   - The token endpoint is a single action-dispatched URL
//     (https://wbsapi.withings.net/v2/oauth2, action=requesttoken), not a
//     dedicated /token path, and its response is wrapped in a
//     {status, body} envelope — status 0 means success, and the actual
//     token fields live under body, not at the top level.
//   - Refresh tokens ROTATE on every refresh, exactly like Whoop's — the
//     rotated pair must be persisted immediately or the integration strands
//     until Albert re-consents via /api/withings/connect. Access tokens are
//     short-lived, so the same PROACTIVE-ON-USE refresh strategy applies:
//     getFreshAccessToken() refreshes whenever the stored token is within
//     60s of expiry.
//
// user.metrics is the scope that grants body-composition read access
// (weight/fat-free-mass/fat-ratio, §0) — this integration requests nothing
// broader (no activity/sleep/workout scopes; those stay Whoop-owned).

export const WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
export const WITHINGS_TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
export const WITHINGS_SCOPES = "user.metrics";

export type WithingsTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
  userid?: string;
};

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("WITHINGS_CLIENT_ID and/or WITHINGS_CLIENT_SECRET is not set");
  }
  return { clientId, clientSecret };
}

// Must byte-match the Redirect URL registered in the Withings Partner Hub —
// derived from NEXT_PUBLIC_APP_URL rather than the request host, same
// reasoning as lib/whoop-oauth.ts#redirectUri.
export function redirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build the Withings redirect URI");
  }
  return `${appUrl.replace(/\/$/, "")}/api/withings/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId } = clientCredentials();
  const url = new URL(WITHINGS_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", WITHINGS_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

type WithingsTokenEnvelope = {
  status?: number;
  body?: Partial<WithingsTokenResponse>;
  error?: string;
};

async function requestTokens(params: Record<string, string>): Promise<WithingsTokenResponse> {
  const res = await fetch(WITHINGS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action: "requesttoken", ...params }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Withings token request failed (${params.grant_type}): ${res.status} ${detail}`);
  }
  const envelope = (await res.json()) as WithingsTokenEnvelope;
  if (envelope.status !== 0 || !envelope.body) {
    throw new Error(
      `Withings token request (${params.grant_type}) returned status ${envelope.status}: ${envelope.error ?? "unknown error"}`,
    );
  }
  const tokens = envelope.body;
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string" ||
    typeof tokens.expires_in !== "number"
  ) {
    throw new Error(
      `Withings token response (${params.grant_type}) is missing access_token/refresh_token/expires_in`,
    );
  }
  return tokens as WithingsTokenResponse;
}

export async function exchangeCode(code: string): Promise<WithingsTokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return requestTokens({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri(),
  });
}

export async function refreshTokens(refreshToken: string): Promise<WithingsTokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return requestTokens({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
}

// withings_tokens is keyed by user_id from creation (§0/NFR-98) — a single
// atomic `insert ... on conflict (user_id) do update ... returning
// (xmax = 0) as inserted`, not a separate SELECT-then-upsert, so the
// first-connect determination is race-free with the write itself.
export async function saveTokens(
  userId: number,
  tokens: WithingsTokenResponse,
): Promise<{ existingRowFound: boolean }> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const rows = await sql`
    insert into withings_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, scope, updated_at)
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

// Pure decision function (§1): true only when saveTokens' atomic insert
// reports no pre-existing row — i.e. a genuine first connect. Takes the
// already-resolved boolean rather than re-querying, so the callback route's
// first-connect-vs-reconnect branch (AC-WS8/AC-WS10) is unit-testable
// without a Route Handler/cookies() context.
export function isFirstConnect(existingRowFound: boolean): boolean {
  return !existingRowFound;
}

type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: Date };

async function loadTokens(userId: number): Promise<StoredTokens | null> {
  const sql = getSql();
  const rows = await sql`
    select access_token_enc, refresh_token_enc, expires_at from withings_tokens where user_id = ${userId}
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
// of it. Returns null when this user has never connected Withings.
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

// The cron loop's iteration source (app/api/withings/sync/route.ts) — every
// row in withings_tokens already carries the user_id to attribute pulls to;
// this joins to users for the email AC-WS14's failure alert names.
export async function listConnectedUsers(): Promise<{ userId: number; email: string }[]> {
  const sql = getSql();
  const rows = await sql`
    select withings_tokens.user_id as user_id, users.email as email
    from withings_tokens
    join users on users.id = withings_tokens.user_id
    order by withings_tokens.user_id
  `;
  return rows.map((row) => ({ userId: row.user_id as number, email: row.email as string }));
}
