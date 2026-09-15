import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Fuel (Targets + Log Meal Merge)
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

// Plain fs.existsSync, matching tests/unit/body-page-route.test.ts's own
// standalone filesystem-existence convention (PRD §1) — no redirect stub
// anywhere, a genuine 404 for the two merged-away routes.
const ROOT = path.resolve(__dirname, "../..");

describe("fuel page route — merge of Log Meal + Targets, hard removal, no redirect stub (AC-M36, AC-M37)", () => {
  it("AC-M36: app/fuel/page.tsx exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "fuel", "page.tsx"))).toBe(true);
  });

  it("AC-M37: app/log-meal no longer exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "log-meal"))).toBe(false);
  });

  it("AC-M37: app/settings/targets no longer exists on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "settings", "targets"))).toBe(false);
  });
});
