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

// whoop_tokens holds exactly one row (id = 1, enforced by the schema) —
// single-user app, one Whoop account.
export async function saveTokens(tokens: WhoopTokenResponse): Promise<void> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await sql`
    insert into whoop_tokens (id, access_token_enc, refresh_token_enc, expires_at, scope, updated_at)
    values (1, ${encryptToken(tokens.access_token)}, ${encryptToken(tokens.refresh_token)},
            ${expiresAt}, ${tokens.scope ?? null}, now())
    on conflict (id)
    do update set access_token_enc = excluded.access_token_enc,
                  refresh_token_enc = excluded.refresh_token_enc,
                  expires_at = excluded.expires_at,
                  scope = excluded.scope,
                  updated_at = now()
  `;
}

type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: Date };

async function loadTokens(): Promise<StoredTokens | null> {
  const sql = getSql();
  const rows = await sql`
    select access_token_enc, refresh_token_enc, expires_at from whoop_tokens where id = 1
  `;
  if (rows.length === 0) return null;
  return {
    accessToken: decryptToken(rows[0].access_token_enc as string),
    refreshToken: decryptToken(rows[0].refresh_token_enc as string),
    expiresAt: new Date(rows[0].expires_at as string),
  };
}

// Returns a usable access token, refreshing (and persisting the rotated
// pair) when the stored one is expired or within 60s of it. Returns null
// when Whoop has never been connected — callers treat that as an expected
// pre-connection state, not an error.
export async function getFreshAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const stored = await loadTokens();
  if (!stored) return null;
  const expiryMarginMs = 60_000;
  if (!options.forceRefresh && stored.expiresAt.getTime() - Date.now() > expiryMarginMs) {
    return stored.accessToken;
  }
  const refreshed = await refreshTokens(stored.refreshToken);
  await saveTokens(refreshed);
  return refreshed.access_token;
}
