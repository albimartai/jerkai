import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TargetsHistory } from "@/app/ui/targets-history";
import * as actions from "@/app/fuel/actions";
import type { TargetRow } from "@/lib/targets";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Fuel (Targets + Log Meal Merge)
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

vi.mock("@/app/fuel/actions", () => ({
  getTargetsForCurrentUser: vi.fn(),
}));

function makeTarget(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    id: 1,
    effectiveDate: "2026-01-01",
    caloriesTarget: 2000,
    proteinTargetG: 150,
    carbsTargetG: null,
    fatTargetG: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TargetsHistory", () => {
  it("AC-M44 (bare case): zero saved targets renders 'No targets saved yet.' rather than an empty table shell", async () => {
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);

    render(<TargetsHistory refreshToken={0} />);

    expect(await screen.findByText("No targets saved yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("AC-M45: with saved targets, lists every row fetchTargets() returns, with Effective/Calories/Protein columns, newest effective date first", async () => {
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([
      makeTarget({ id: 1, effectiveDate: "2026-01-01", caloriesTarget: 1800, proteinTargetG: 120 }),
      makeTarget({ id: 2, effectiveDate: "2026-03-01", caloriesTarget: 2000, proteinTargetG: 150 }),
      makeTarget({ id: 3, effectiveDate: "2026-06-01", caloriesTarget: 2200, proteinTargetG: 160 }),
    ]);

    render(<TargetsHistory refreshToken={0} />);

    const table = await screen.findByRole("table");
    expect(table).toBeTruthy();
    expect(screen.getByText("Effective")).toBeTruthy();
    expect(screen.getByText("Calories")).toBeTruthy();
    expect(screen.getByText("Protein")).toBeTruthy();

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("2026-06-01");
    expect(rows[1].textContent).toContain("2026-03-01");
    expect(rows[2].textContent).toContain("2026-01-01");
  });

  it("AC-M45: a refreshToken change triggers a re-fetch and reflects newly saved rows", async () => {
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([
      makeTarget({ id: 1, effectiveDate: "2026-01-01" }),
    ]);

    const { rerender } = render(<TargetsHistory refreshToken={0} />);
    await screen.findByText("2026-01-01");

    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([
      makeTarget({ id: 1, effectiveDate: "2026-01-01" }),
      makeTarget({ id: 2, effectiveDate: "2026-09-14" }),
    ]);
    rerender(<TargetsHistory refreshToken={1} />);

    expect(await screen.findByText("2026-09-14")).toBeTruthy();
  });
});
