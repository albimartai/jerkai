import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FuelTotalCard } from "@/app/ui/fuel-total-card";
import * as actions from "@/app/fuel/actions";
import type { MealEntryRow } from "@/lib/meal-entries";
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
  listMealEntriesForDate: vi.fn(),
  getTargetsForCurrentUser: vi.fn(),
}));

const TODAY = "2026-09-14";
const EARLIER = "2026-09-01";

function makeEntry(overrides: Partial<MealEntryRow> = {}): MealEntryRow {
  return {
    id: 1,
    mealType: "breakfast",
    entryDate: TODAY,
    description: "Oats",
    calories: 400,
    proteinG: 20,
    carbsG: 50,
    fatG: 10,
    createdAt: `${TODAY}T08:00:00.000Z`,
    updatedAt: `${TODAY}T08:00:00.000Z`,
    ...overrides,
  };
}

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

describe("FuelTotalCard", () => {
  it("AC-M41 (bare case): zero logged entries and no saved target renders '0 kcal logged' and the 'No target set yet' fallback", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([]);
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);

    render(<FuelTotalCard entryDate={TODAY} refreshToken={0} />);

    expect(await screen.findByText("0 kcal logged")).toBeTruthy();
    expect(screen.getByText(/No target set yet/)).toBeTruthy();
    expect(screen.getByText("set targets")).toBeTruthy();
  });

  it("AC-M41: the 'set targets' fallback is a button that calls switchToTargets, not an <a href> to /settings/targets", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([]);
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);
    const switchToTargets = vi.fn();

    render(<FuelTotalCard entryDate={TODAY} refreshToken={0} switchToTargets={switchToTargets} />);

    const setTargets = await screen.findByText("set targets");
    expect(setTargets.tagName).toBe("BUTTON");
    expect(setTargets.closest("a")).toBeNull();

    fireEvent.click(setTargets);
    expect(switchToTargets).toHaveBeenCalled();
  });

  it("AC-M41: FuelTotalCard renders correctly even when switchToTargets is omitted (optional prop)", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([]);
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);

    render(<FuelTotalCard entryDate={TODAY} refreshToken={0} />);

    const setTargets = await screen.findByText("set targets");
    expect(() => fireEvent.click(setTargets)).not.toThrow();
  });

  it("AC-M42: with logged entries and a target in force, shows the sum/target ratio and protein line matching dailyTotals/resolveTargetForDate", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([
      makeEntry({ calories: 400, proteinG: 20 }),
      makeEntry({ id: 2, calories: 300, proteinG: 15 }),
    ]);
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([
      makeTarget({ effectiveDate: "2026-01-01", caloriesTarget: 2000, proteinTargetG: 150 }),
    ]);

    render(<FuelTotalCard entryDate={TODAY} refreshToken={0} />);

    expect(await screen.findByText("700 / 2000 kcal")).toBeTruthy();
    expect(screen.getByText("Protein 35g / 150g")).toBeTruthy();
  });

  it("AC-M43: a refreshToken change triggers a recompute", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([]);
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);

    const { rerender } = render(<FuelTotalCard entryDate={TODAY} refreshToken={0} />);
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenCalledWith(TODAY));

    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ calories: 250 })]);
    rerender(<FuelTotalCard entryDate={TODAY} refreshToken={1} />);

    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("250 kcal logged")).toBeTruthy();
  });

  it("AC-M43: an entryDate change triggers a recompute for the newly viewed date", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([]);
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);

    const { rerender } = render(<FuelTotalCard entryDate={TODAY} refreshToken={0} />);
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenCalledWith(TODAY));

    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ entryDate: EARLIER, calories: 100 })]);
    rerender(<FuelTotalCard entryDate={EARLIER} refreshToken={0} />);

    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenLastCalledWith(EARLIER));
    expect(await screen.findByText("100 kcal logged")).toBeTruthy();
  });
});
