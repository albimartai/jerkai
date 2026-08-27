/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Smart-Scale Integration
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { describe, expect, it } from "vitest";

import { isBoundToInitiatingUser } from "@/lib/withings-oauth-binding";

// AC-WS5 (§1, mirroring lib/whoop-oauth-binding.ts's AC-WT4 precedent): the
// connect->callback OAuth roundtrip must attribute tokens only to the session
// that initiated it. /api/withings/connect sets a second httpOnly cookie,
// withings_oauth_user, to session.user.id alongside the existing
// withings_oauth_state CSRF cookie; /api/withings/callback compares that
// cookie against its own fresh session.user.id. This pure comparison is
// extracted so it is unit-testable without a Route Handler/cookies() context
// (next/experimental/testing/server cannot exercise either, per §1) — the
// route handler's own wiring stays covered by manual verification only (§6).
// session.user.id is a string (mirrors NFR-70's Whoop precedent), so both
// sides of the comparison are strings here, not numbers.

describe("isBoundToInitiatingUser — AC-WS5: connect/callback binding refuses a mismatched session", () => {
  it("AC-WS5: returns true when the connect-time cookie's user id matches the callback's fresh session user id", () => {
    expect(isBoundToInitiatingUser("42", "42")).toBe(true);
  });

  it("AC-WS5: returns false when the active session changed to a different user between connect and callback", () => {
    // User A initiates /api/withings/connect (withings_oauth_user cookie
    // carries "42"); before Withings' redirect reaches /api/withings/callback,
    // the browser's active session becomes user B's ("99") — the callback
    // must refuse, not attribute the resulting tokens to user B.
    expect(isBoundToInitiatingUser("42", "99")).toBe(false);
  });

  it("AC-WS5: returns false (fails closed) when the connect-time cookie is missing entirely", () => {
    expect(isBoundToInitiatingUser(undefined, "42")).toBe(false);
  });

  it("AC-WS5: returns false (fails closed) when the callback's fresh session user id is missing", () => {
    expect(isBoundToInitiatingUser("42", undefined)).toBe(false);
  });

  it("AC-WS5: returns false when both sides are the empty string rather than treating it as a vacuous match", () => {
    expect(isBoundToInitiatingUser("", "")).toBe(false);
  });
});
