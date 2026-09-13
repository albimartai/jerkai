import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Rename Results Page to Body
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

// Plain fs.existsSync, not tests/unit/root-layout.test.tsx's heavier
// appRoots() program-walk — this slice's own PRD §1 scopes this file to a
// standalone filesystem-existence check only (NFR-155, AC-W26/AC-W28).
const ROOT = path.resolve(__dirname, "../..");

describe("body page route — hard removal, no redirect stub (AC-W26, AC-W28, NFR-155)", () => {
  it("AC-W26: app/results no longer exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "results"))).toBe(false);
  });

  it("AC-W26: app/body/page.tsx exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "body", "page.tsx"))).toBe(true);
  });

  it("AC-W28: app/demo/results no longer exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "demo", "results"))).toBe(false);
  });

  it("AC-W28: app/demo/body/page.tsx exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "demo", "body", "page.tsx"))).toBe(true);
  });
});
