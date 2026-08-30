/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { describe, expect, it, vi } from "vitest";

// app/status/page.tsx is relocated (git mv) to app/data/page.tsx by this
// slice, and this path is freed for a new, small stub whose only job is
// `redirect("/data")` (PRD §1, AC-DS2). Until the build agent performs that
// move, this import resolves to the OLD /status page (pre-existing auth-gate
// + sync_runs query), which does not throw a NEXT_REDIRECT error for a
// signed-in session — expected to fail until the relocation happens.
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

describe("/status — AC-DS2: redirects to /data", () => {
  it("AC-DS2: a signed-in request to /status throws a NEXT_REDIRECT to /data with a 307 status", async () => {
    authMock.mockResolvedValue({ user: { id: "1" } });

    let thrown: unknown;
    try {
      await Status();
    } catch (error) {
      thrown = error;
    }

    expect(isRedirectError(thrown)).toBe(true);
    expect(getURLFromRedirectError(thrown as Error)).toBe("/data");
    expect(getRedirectStatusCodeFromError(thrown as Error)).toBe(307);
  });
});
