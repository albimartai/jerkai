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
