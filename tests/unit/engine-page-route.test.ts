import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Engine Page
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

// Plain fs.existsSync, modeled on tests/unit/body-page-route.test.ts's own
// standalone filesystem-existence check (PRD §1) — but asserting existence,
// not removal: Engine has no predecessor route to hard-remove.
const ROOT = path.resolve(__dirname, "../..");

describe("engine page route — new route exists (AC-E1)", () => {
  it("AC-E1: app/engine/page.tsx exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "engine", "page.tsx"))).toBe(true);
  });
});
