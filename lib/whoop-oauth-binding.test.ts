import { describe, expect, it } from "vitest";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Whoop Multi-Tenancy
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { isBoundToInitiatingUser } from "@/lib/whoop-oauth-binding";

// AC-WT4/NFR-78 (§0, §1): the connect→callback roundtrip must attribute tokens
// only to the session that initiated it. /api/whoop/connect sets a second
// httpOnly cookie, whoop_oauth_user, to session.user.id alongside the existing
// whoop_oauth_state cookie; /api/whoop/callback compares that cookie against
// its own fresh session.user.id. This pure comparison — extracted so it is
// unit-testable without a Route Handler/cookies() context (§1's
// next/experimental/testing/server finding) — is what this stub exercises.
// session.user.id is a string (NFR-70), so both sides of the comparison are
// strings here, not numbers.

describe("isBoundToInitiatingUser — AC-WT4: connect/callback binding refuses a mismatched session", () => {
  it("AC-WT4: returns true when the connect-time cookie's user id matches the callback's fresh session user id", () => {
    expect(isBoundToInitiatingUser("42", "42")).toBe(true);
  });

  it("AC-WT4: returns false when the active session changed to a different user between connect and callback", () => {
    // User A initiates /api/whoop/connect (whoop_oauth_user cookie carries "42");
    // before Whoop's redirect reaches /api/whoop/callback, the browser's active
    // session becomes user B's ("99") — the callback must refuse, not attribute
    // the resulting tokens to user B.
    expect(isBoundToInitiatingUser("42", "99")).toBe(false);
  });

  it("AC-WT4: returns false (fails closed) when the connect-time cookie is missing entirely", () => {
    expect(isBoundToInitiatingUser(undefined, "42")).toBe(false);
  });

  it("AC-WT4: returns false (fails closed) when the callback's fresh session user id is missing", () => {
    expect(isBoundToInitiatingUser("42", undefined)).toBe(false);
  });

  it("AC-WT4: returns false when both sides are the empty string rather than treating it as a vacuous match", () => {
    expect(isBoundToInitiatingUser("", "")).toBe(false);
  });
});
