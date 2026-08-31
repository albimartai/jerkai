/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation,
 * except the exact value edits and name grooms this file's own PRD-cited
 * slice enumerates.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { describe, expect, it, vi } from "vitest";

// app/status/page.tsx stays at its own path (unlike the earlier Data Page
// Redesign & Connect slice, which relocated it to app/data/page.tsx) — this
// slice instead amends its redirect target in place: `redirect("/data")`
// becomes `redirect("/connect")` (Rename /data Page to /connect, PRD
// §0.2/§1, amending AC-DS2 in place). Until the build agent makes that edit,
// this import resolves to the OLD stub, which throws a NEXT_REDIRECT to
// /data, not /connect — expected to fail until the edit happens.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

import Status from "@/app/status/page";

// Next's redirect() throws an Error carrying a `digest` string shaped
// "NEXT_REDIRECT;<type>;<url>;<statusCode>;" — confirmed live this session,
// node_modules/next/dist/client/components/redirect.js#getRedirectError,
// per AGENTS.md's requirement to read node_modules/next/dist/docs before
// assuming redirect()'s throw/catch mechanics (no precedent test in this
// repo exercises it, PRD §1). isRedirectError/getURLFromRedirectError/
// getRedirectStatusCodeFromError carry no next/navigation re-export in this
// Next version (confirmed live this session) — this stub reaches them via
// next's own internal module path, the only way to assert this mechanism at
// all without re-deriving the digest format by hand.
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  getRedirectStatusCodeFromError,
  getURLFromRedirectError,
} from "next/dist/client/components/redirect";

describe("/status — AC-DS2: redirects to /connect", () => {
  it("AC-DS2: a signed-in request to /status throws a NEXT_REDIRECT to /connect with a 307 status", async () => {
    authMock.mockResolvedValue({ user: { id: "1" } });

    let thrown: unknown;
    try {
      await Status();
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
