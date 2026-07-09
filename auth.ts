import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import NeonAdapter from "@auth/neon-adapter";
import { Pool } from "@neondatabase/serverless";

// Pin production magic links to the canonical domain. Without this, a link
// requested via a *.vercel.app deployment URL would point back at that URL
// (Auth.js builds callback URLs from the request host). Preview deployments
// keep host-derived URLs so their callbacks stay on the preview domain.
if (process.env.VERCEL_ENV === "production" && process.env.NEXT_PUBLIC_APP_URL) {
  process.env.AUTH_URL ??= process.env.NEXT_PUBLIC_APP_URL;
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  // Pool is created per request (config-as-function), per the Neon adapter
  // docs — a module-level pool can't be safely reused across serverless
  // invocations. No connection is opened until the adapter actually queries.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return {
    adapter: NeonAdapter(pool),
    providers: [
      Resend({
        // API key comes from AUTH_RESEND_KEY via Auth.js env inference.
        // onboarding@resend.dev delivers only to the Resend account owner —
        // the same constraint lib/alerts.ts already accepts, and fine here
        // because the allowlist restricts sign-in to that one address anyway.
        from: "JerkAI <onboarding@resend.dev>",
      }),
    ],
    // JWT sessions so proxy.ts can verify a session without a database
    // round-trip; the adapter is still required for magic-link
    // verification tokens.
    session: { strategy: "jwt" },
    pages: {
      signIn: "/signin",
      verifyRequest: "/signin/sent",
      // Auth.js redirects failures to /signin?error=<code>, which the
      // sign-in page renders as a visible rejection — never a silent no-op.
      error: "/signin",
    },
    callbacks: {
      // Drives proxy.ts: any request without a valid session JWT is
      // redirected to pages.signIn with a callbackUrl. Required — without
      // this callback, Auth.js middleware authorizes every request.
      authorized({ auth }) {
        return !!auth;
      },
      // Single-user app: only ALLOWLISTED_EMAIL may sign in. This runs when
      // the magic link is *requested*, so unlisted addresses are rejected
      // before any email is sent (and again on link verification).
      signIn({ user }) {
        const allowed = process.env.ALLOWLISTED_EMAIL?.trim().toLowerCase();
        if (!allowed) {
          console.error("sign-in rejected: ALLOWLISTED_EMAIL is not set");
          return false;
        }
        return user.email?.trim().toLowerCase() === allowed;
      },
    },
  };
});
