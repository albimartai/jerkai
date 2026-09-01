import { createHash, timingSafeEqual } from "node:crypto";

// Pure, unit-testable comparison extracted out of app/api/whoop/callback/
// route.ts (AC-WT4, NFR-78): the connect→callback OAuth roundtrip must
// attribute tokens only to the session that initiated it. /api/whoop/connect
// sets a second httpOnly cookie, whoop_oauth_user, to session.user.id
// alongside the existing whoop_oauth_state CSRF cookie; the callback compares
// that cookie against its own fresh session.user.id. Reading session.user.id
// fresh at callback time is *almost* sufficient (the state cookie already
// ties the callback to the same browser that started the flow) but misses
// the case where the browser's active session changed mid-flight (log out, a
// different user logs in, Whoop's redirect completes) — this closes that gap
// the same way the state cookie closes the CSRF gap: mismatch is refused.
//
// next/experimental/testing/server cannot exercise a Route Handler or
// cookies() (confirmed against its full exported surface — no mechanism to
// invoke a Route Handler or establish a cookies() context), so this
// comparison is extracted here purely to be unit-testable without that
// machinery; the route handler's own wiring (cookies, redirects, auth())
// stays covered by manual verification only.

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

// AC-WT14–19, NFR-136–140 (JerkAI - Build PRD - OAuth Callback Identity
// Fallback, §0): a browser-context split between sign-in and the OAuth
// round trip can lose the session cookie by the time Whoop redirects back
// to /api/whoop/callback, even though the connect-time whoop_oauth_user
// cookie survived. When no live session exists (sessionExists === false),
// fall back to that cookie's identity instead of refusing outright — but
// never when a session IS present and disagrees (that stays a hard refusal,
// unchanged, per isBoundToInitiatingUser above). Branches on session
// *existence*, not on sessionUserId's truthiness (NFR-136): a present
// session whose user.id resolves to "" is a mismatch, never treated as
// absent.
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
