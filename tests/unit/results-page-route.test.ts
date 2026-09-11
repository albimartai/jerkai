import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Rename Weekly Page to Results
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

// Plain fs.existsSync, not tests/unit/root-layout.test.tsx's heavier
// appRoots() program-walk — this slice's own PRD §1 scopes this file to a
// standalone filesystem-existence check only (NFR-150, AC-W18/AC-W20).
const ROOT = path.resolve(__dirname, "../..");

describe("results page route — hard removal, no redirect stub (AC-W18, AC-W20, NFR-150)", () => {
  it("AC-W18: app/weekly no longer exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "weekly"))).toBe(false);
  });

  it("AC-W18: app/results/page.tsx exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "results", "page.tsx"))).toBe(true);
  });

  it("AC-W20: app/demo/weekly no longer exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "demo", "weekly"))).toBe(false);
  });

  it("AC-W20: app/demo/results/page.tsx exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "demo", "results", "page.tsx"))).toBe(true);
  });
});
