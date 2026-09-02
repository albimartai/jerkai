import { createHash, timingSafeEqual } from "node:crypto";

// Pure, unit-testable comparison extracted out of app/api/withings/callback/
// route.ts (AC-WS5, NFR-99): the connect->callback OAuth roundtrip must
// attribute tokens only to the session that initiated it. /api/withings/connect
// sets a second httpOnly cookie, withings_oauth_user, to session.user.id
// alongside the existing withings_oauth_state CSRF cookie; the callback compares
// that cookie against its own fresh session.user.id. Mirrors
// lib/whoop-oauth-binding.ts exactly — next/experimental/testing/server cannot
// exercise a Route Handler or cookies(), so this comparison is extracted here
// purely to be unit-testable without that machinery; the route handler's own
// wiring (cookies, redirects, auth()) stays covered by manual verification only.

function matchesTimingSafe(a: string, b: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

export function isBoundToInitiatingUser(
  cookieUserId: string | undefined,
  sessionUserId: string | undefined,
): boolean {
  if (!cookieUserId || !sessionUserId) return false;
  return matchesTimingSafe(cookieUserId, sessionUserId);
}

// AC-WS21–26, NFR-136–140 (JerkAI - Build PRD - OAuth Callback Identity
// Fallback, §0): a browser-context split between sign-in and the OAuth
// round trip can lose the session cookie by the time Withings redirects
// back to /api/withings/callback, even though the connect-time
// withings_oauth_user cookie survived. When no live session exists
// (sessionExists === false), fall back to that cookie's identity instead of
// refusing outright — but never when a session IS present and disagrees
// (that stays a hard refusal, unchanged, per isBoundToInitiatingUser above).
// Branches on session *existence*, not on sessionUserId's truthiness
// (NFR-136): a present session whose user.id resolves to "" is a mismatch,
// never treated as absent.
export type CallbackIdentityResolution =
  | { outcome: "resolved"; userId: number }
  | { outcome: "mismatch" }
  | { outcome: "unresolved" };

// "Usable" means non-empty, integer-parsing, and strictly positive
// (NFR-139) — Number.isInteger alone admits zero and negative values that
// can never correspond to a real users.id row.
function isUsablePositiveInteger(value: string | undefined): value is string {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

export function resolveCallbackIdentity(
  sessionExists: boolean,
  sessionUserId: string | undefined,
  cookieUserId: string | undefined,
): CallbackIdentityResolution {
  if (sessionExists) {
    if (!isBoundToInitiatingUser(cookieUserId, sessionUserId)) return { outcome: "mismatch" };
    return { outcome: "resolved", userId: Number(sessionUserId) };
  }

  if (!isUsablePositiveInteger(cookieUserId)) return { outcome: "unresolved" };
  return { outcome: "resolved", userId: Number(cookieUserId) };
}
