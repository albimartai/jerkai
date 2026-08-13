// The Auth.js callbacks that carry the app's actual access-control decisions,
// extracted from auth.ts so they can be unit tested without importing the
// full NextAuth setup (adapter, provider, Neon pool). auth.ts wires these
// into its config unchanged — keep the logic here, not there.

/**
 * Drives proxy.ts: any request without a valid session JWT is redirected to
 * pages.signIn with a callbackUrl. Required — without this callback, Auth.js
 * middleware authorizes every request.
 */
export function authorized({ auth }: { auth: object | null }): boolean {
  return !!auth;
}

/**
 * Only addresses in ALLOWLISTED_EMAILS (comma-separated) may sign in
 * (case-insensitive, whitespace-trimmed, per entry). Runs when the magic
 * link is *requested*, so unlisted addresses are rejected before any email
 * is sent (and again on link verification). Fails closed: an unset, empty,
 * or malformed-to-zero-entries list denies every address.
 */
export function signIn({ user }: { user: { email?: string | null } }): boolean {
  const allowed = (process.env.ALLOWLISTED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (allowed.length === 0) {
    console.error("sign-in rejected: ALLOWLISTED_EMAILS has no usable entries");
    return false;
  }
  return allowed.includes(user.email?.trim().toLowerCase() ?? "");
}

type SessionUser = { name?: string | null; email?: string | null; image?: string | null };
type BareSession = { user: SessionUser; expires: string };

/**
 * Auth.js's default session assembly strips everything but name/email/image
 * from session.user. The JWT's sub claim already carries the adapter's real
 * users.id (set by @auth/core's default jwt callback for the email provider
 * this app uses, confirmed against node_modules/@auth/core/lib/actions/callback/index.js) —
 * this callback is the one place that restores it onto session.user.id.
 */
export function session({ session, token }: { session: BareSession; token: { sub?: string } }) {
  return {
    ...session,
    user: {
      ...session.user,
      id: token.sub ?? "",
    },
  };
}
