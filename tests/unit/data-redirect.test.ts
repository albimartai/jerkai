/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Rename /data Page to /connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { describe, expect, it, vi } from "vitest";

// app/data/page.tsx is relocated (git mv) to app/connect/page.tsx by this
// slice, and this path is freed for a new, small stub whose only job is
// `redirect("/connect")` (PRD §1, AC-DS23) — the same shape as
// app/status/page.tsx's own stub. Until the build agent performs that move,
// this import resolves to the OLD /data page (the categorized-cards Server
// Component, which calls getSql() unconditionally after the auth check), so
// a signed-in call throws "DATABASE_URL is not set" (no DATABASE_URL in the
// unit tier, vitest.config.ts) rather than a NEXT_REDIRECT error — expected
// to fail until the relocation happens.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

import Data from "@/app/data/page";

// Next's redirect() throws an Error carrying a `digest` string shaped
// "NEXT_REDIRECT;<type>;<url>;<statusCode>;" — mirrors
// tests/unit/status-redirect.test.ts's own proven mechanics
// (isRedirectError/getURLFromRedirectError/getRedirectStatusCodeFromError,
// reached via next's internal module path since next/navigation re-exports
// none of them in this Next version, confirmed live in that file).
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  getRedirectStatusCodeFromError,
  getURLFromRedirectError,
} from "next/dist/client/components/redirect";

describe("/data — AC-DS23: redirects to /connect", () => {
  it("AC-DS23: a signed-in request to /data throws a NEXT_REDIRECT to /connect with a 307 status", async () => {
    authMock.mockResolvedValue({ user: { id: "1" } });

    let thrown: unknown;
    try {
      await Data();
    } catch (error) {
      thrown = error;
    }

    expect(isRedirectError(thrown)).toBe(true);
    // Non-behavioral: narrows `thrown` via the type guard instead of an `as Error`
    // cast for strict-mode compile cleanliness. Expected values below are unchanged.
    if (!isRedirectError(thrown)) throw new Error("unreachable — asserted above");
    expect(getURLFromRedirectError(thrown)).toBe("/connect");
    expect(getRedirectStatusCodeFromError(thrown)).toBe(307);
  });
});
