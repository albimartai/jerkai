/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Resend Sending Domain Switch
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// auth.ts has no test file today by design (instantiating it requires a
// live-shaped Neon Pool and NextAuth's config-as-function wiring, which the
// node-env unit project cannot do cheaply — see auth.ts's own comments and
// PRD §1/NFR-116). AC-ES2 is falsified by reading its source text directly,
// never by importing or instantiating the module.
const authSource = readFileSync(
  path.resolve(import.meta.dirname, "../../auth.ts"),
  "utf8",
);

describe("auth.ts Resend provider sender address (AC-ES2)", () => {
  it("AC-ES2 uses the verified jerkai.app sender literal and never resend.dev", () => {
    // noreply@jerkai.app -> noreply@mail.jerkai.app (authorized value edit, 2026-08-31):
    // the bare jerkai.app root domain was never actually verified in Resend, which broke
    // magic-link sign-in in production ("domain is not verified" 403). Moved sending to a
    // dedicated mail.jerkai.app subdomain, now verified, to isolate transactional-send
    // reputation from the site's own domain per Resend's own recommendation. Same
    // reasoning applies to lib/alerts.ts's sync@ sender (AC-ES1).
    expect(authSource).toContain('from: "JerkAI <noreply@mail.jerkai.app>"');
    expect(authSource).not.toMatch(/resend\.dev/);
  });
});
