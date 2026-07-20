import { describe, expect, it } from "vitest";

import { resolveTargetForDate, type TargetRow } from "@/lib/targets";

// Pure resolver tests (NFR-30): the one place "which target governs day X" is decided.
// Targets are insert-only and effective-dated (DL-pending-3) — history must never recolor
// when a later target is added.

const target = (overrides: Partial<TargetRow> & Pick<TargetRow, "id" | "effectiveDate">): TargetRow => ({
  caloriesTarget: 2300,
  proteinTargetG: 180,
  carbsTargetG: null,
  fatTargetG: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("resolveTargetForDate (NFR-30)", () => {
  it("AC-M11: returns null when no target has an effective date on or before the day", () => {
    const targets = [target({ id: 1, effectiveDate: "2026-07-10" })];
    expect(resolveTargetForDate(targets, "2026-07-01")).toBeNull();
  });

  it("AC-M10: a day on or after the effective date resolves to that target", () => {
    const targets = [target({ id: 1, effectiveDate: "2026-07-10", caloriesTarget: 2300 })];
    expect(resolveTargetForDate(targets, "2026-07-10")?.caloriesTarget).toBe(2300);
    expect(resolveTargetForDate(targets, "2026-07-15")?.caloriesTarget).toBe(2300);
  });

  it("DL-pending-3 boundary: the day before a target change keeps the old target, the day of/after gets the new one", () => {
    const targets = [
      target({ id: 1, effectiveDate: "2026-07-01", caloriesTarget: 2500 }),
      target({ id: 2, effectiveDate: "2026-07-15", caloriesTarget: 2100 }),
    ];
    expect(resolveTargetForDate(targets, "2026-07-14")?.caloriesTarget).toBe(2500);
    expect(resolveTargetForDate(targets, "2026-07-15")?.caloriesTarget).toBe(2100);
    expect(resolveTargetForDate(targets, "2026-07-20")?.caloriesTarget).toBe(2100);
  });

  it("history never recolors when a later target is added after the fact", () => {
    const before = [target({ id: 1, effectiveDate: "2026-07-01", caloriesTarget: 2500 })];
    const after = [
      ...before,
      target({ id: 2, effectiveDate: "2026-08-01", caloriesTarget: 1900 }),
    ];
    expect(resolveTargetForDate(before, "2026-07-10")?.caloriesTarget).toBe(2500);
    expect(resolveTargetForDate(after, "2026-07-10")?.caloriesTarget).toBe(2500);
  });

  it("same-day correction: ties on effective date resolve to the highest id (the latest insert)", () => {
    const targets = [
      target({ id: 1, effectiveDate: "2026-07-10", caloriesTarget: 2300 }),
      target({ id: 2, effectiveDate: "2026-07-10", caloriesTarget: 2200 }),
    ];
    expect(resolveTargetForDate(targets, "2026-07-10")?.caloriesTarget).toBe(2200);
  });

  it("unordered input resolves the same as sorted input", () => {
    const targets = [
      target({ id: 3, effectiveDate: "2026-07-20", caloriesTarget: 2000 }),
      target({ id: 1, effectiveDate: "2026-07-01", caloriesTarget: 2500 }),
      target({ id: 2, effectiveDate: "2026-07-10", caloriesTarget: 2300 }),
    ];
    expect(resolveTargetForDate(targets, "2026-07-15")?.caloriesTarget).toBe(2300);
  });
});
