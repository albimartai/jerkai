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
 * Single-user app: only ALLOWLISTED_EMAIL may sign in (case-insensitive,
 * whitespace-trimmed). Runs when the magic link is *requested*, so unlisted
 * addresses are rejected before any email is sent (and again on link
 * verification). Fails closed: if the env var is unset, everyone is denied.
 */
export function signIn({ user }: { user: { email?: string | null } }): boolean {
  const allowed = process.env.ALLOWLISTED_EMAIL?.trim().toLowerCase();
  if (!allowed) {
    console.error("sign-in rejected: ALLOWLISTED_EMAIL is not set");
    return false;
  }
  return user.email?.trim().toLowerCase() === allowed;
}
