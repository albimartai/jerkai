import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FuelPanel } from "@/app/ui/fuel-panel";
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

// FuelPanel renders LogMealPanel (Log meal view) and FuelTargetsPanel
// (Targets view) behind a client-only View toggle (PRD §1). LogMealPanel
// pulls in LogMealForm, which now imports from the merged @/app/fuel/actions
// and @/app/fuel/action-state module — both prospective, PRD §1.
vi.mock("@/app/fuel/actions", () => ({
  logMealAction: vi.fn(),
  updateMealEntryAction: vi.fn(),
  deleteMealEntryAction: vi.fn(),
  listMealEntriesForDate: vi.fn(),
  getTargetsForCurrentUser: vi.fn(),
  saveTargetAction: vi.fn(),
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

// Scoped to the View radiogroup specifically — LogMealForm's own meal-type selector also
// renders native role="radio" inputs, so an unscoped getAllByRole("radio") would count
// those too.
function viewGroup() {
  return within(screen.getByRole("radiogroup", { name: /view/i }));
}

beforeEach(() => {
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([]);
  vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("FuelPanel — View toggle (AC-M38)", () => {
  it("AC-M38 (bare case): on mount, the radiogroup shows exactly one checked option — Log meal — and renders the Log Meal view", async () => {
    render(<FuelPanel />);
    await waitFor(() => expect(viewGroup().getAllByRole("radio")).toHaveLength(2));

    expect(screen.getByRole("radiogroup", { name: /view/i })).toBeTruthy();
    const logOption = viewGroup().getByRole("radio", { name: /log meal/i });
    const targetsOption = viewGroup().getByRole("radio", { name: /targets/i });
    expect(logOption.getAttribute("aria-checked")).toBe("true");
    expect(targetsOption.getAttribute("aria-checked")).toBe("false");
  });

  it("AC-M38: clicking the Targets option shows the Targets view with no route change, and mutual exclusivity holds (never both, never neither)", async () => {
    render(<FuelPanel />);
    await waitFor(() => expect(viewGroup().getAllByRole("radio")).toHaveLength(2));

    fireEvent.click(viewGroup().getByRole("radio", { name: /targets/i }));

    await waitFor(() =>
      expect(viewGroup().getByRole("radio", { name: /targets/i }).getAttribute("aria-checked")).toBe("true"),
    );
    expect(viewGroup().getByRole("radio", { name: /log meal/i }).getAttribute("aria-checked")).toBe("false");

    const checkedCount = viewGroup()
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true").length;
    expect(checkedCount).toBe(1);
  });

  it("AC-M38: switching to Targets and back to Log meal preserves the Log Meal view's date/entries state (no remount)", async () => {
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry()]);

    render(<FuelPanel />);
    await waitFor(() => expect(viewGroup().getAllByRole("radio")).toHaveLength(2));

    const dateInput = await screen.findByDisplayValue(TODAY);
    fireEvent.change(dateInput, { target: { value: EARLIER } });
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenLastCalledWith(EARLIER));

    fireEvent.click(viewGroup().getByRole("radio", { name: /targets/i }));
    await waitFor(() =>
      expect(viewGroup().getByRole("radio", { name: /targets/i }).getAttribute("aria-checked")).toBe("true"),
    );

    const callsBeforeReturn = vi.mocked(actions.listMealEntriesForDate).mock.calls.length;
    fireEvent.click(viewGroup().getByRole("radio", { name: /log meal/i }));
    await waitFor(() =>
      expect(viewGroup().getByRole("radio", { name: /log meal/i }).getAttribute("aria-checked")).toBe("true"),
    );

    expect(await screen.findByDisplayValue(EARLIER)).toBeTruthy();
    // NFR-167: returning to an already-mounted view fetches nothing new on its own.
    expect(vi.mocked(actions.listMealEntriesForDate).mock.calls.length).toBe(callsBeforeReturn);
  });

  it("NFR-167: the view toggle itself fires no Server Action call", async () => {
    render(<FuelPanel />);
    await waitFor(() => expect(viewGroup().getAllByRole("radio")).toHaveLength(2));
    vi.clearAllMocks();

    fireEvent.click(viewGroup().getByRole("radio", { name: /targets/i }));
    await waitFor(() =>
      expect(viewGroup().getByRole("radio", { name: /targets/i }).getAttribute("aria-checked")).toBe("true"),
    );

    expect(actions.logMealAction).not.toHaveBeenCalled();
    expect(actions.updateMealEntryAction).not.toHaveBeenCalled();
    expect(actions.deleteMealEntryAction).not.toHaveBeenCalled();
    expect(actions.saveTargetAction).not.toHaveBeenCalled();
  });
});

describe("FuelPanel — Total · Today vs. post-save card agreement (NFR-166)", () => {
  it("NFR-166: once both have settled, the transient post-save card and the persistent Total · Today card show identical numbers for the same save", async () => {
    const target = makeTarget({ caloriesTarget: 2200, proteinTargetG: 160 });
    vi.mocked(actions.getTargetsForCurrentUser).mockResolvedValue([target]);
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ calories: 500, proteinG: 30 })]);
    vi.mocked(actions.logMealAction).mockResolvedValue({
      status: "success",
      errors: [],
      entryDate: TODAY,
      totals: { calories: 500, proteinG: 30, carbsG: 0, fatG: 0, entryCount: 1 },
      target,
    });

    render(<FuelPanel />);
    await waitFor(() => expect(viewGroup().getAllByRole("radio")).toHaveLength(2));

    const caloriesInput = document.querySelector('input[name="calories"]') as HTMLInputElement;
    fireEvent.change(caloriesInput, { target: { value: "500" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(actions.logMealAction).toHaveBeenCalled());

    // Both the post-save card (log-meal-form.tsx's own success-state block)
    // and the persistent FuelTotalCard must settle on the same numbers — a
    // permanent disagreement after both have refetched indicates an
    // entryDate/refreshToken wiring bug (NFR-166), not an acceptable
    // transient lag.
    await waitFor(() => {
      const matches = screen.getAllByText(/500 \/ 2200 kcal/);
      expect(matches.length).toBe(2);
    });
  });
});
