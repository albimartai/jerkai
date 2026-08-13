import type { DefaultSession } from "next-auth";

// session.user.id is a real, typed field everywhere Session is referenced —
// not a cast, not an `any` — matching lib/auth-callbacks.ts#session, which
// derives it from the JWT's sub claim (NFR-70). The underlying users.id
// column is a serial (integer); this stays string because that is exactly
// what the JWT sub claim is (@auth/core sets it via .toString()) — callers
// scoping a query by user_id must explicitly Number(session.user.id).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
