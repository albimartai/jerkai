import { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogMealPanel } from "@/app/ui/log-meal-panel";
import * as actions from "@/app/fuel/actions";
import type { MealEntryRow } from "@/lib/meal-entries";
import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import { defaultMealType, type MealType } from "@/lib/dashboard/meal-type";

// Date-Scoped Entries List (docs/prd/date-scoped-entries-list.md), NFR-44: interactive
// component tests exercising DOM events + re-fetch/re-render, which the node-env unit tier
// and string-match rendering can't express. Server actions are mocked — no DATABASE_URL.

// getTargetsForCurrentUser (Fuel, PRD §1): LogMealPanel now renders FuelTotalCard
// alongside the form/list, which reads this on mount — mocked here too so this file keeps
// testing LogMealPanel as a standalone unit, unaware of /fuel as a route.
vi.mock("@/app/fuel/actions", () => ({
  logMealAction: vi.fn(),
  updateMealEntryAction: vi.fn(),
  deleteMealEntryAction: vi.fn(),
  listMealEntriesForDate: vi.fn(),
  getTargetsForCurrentUser: vi.fn(),
}));

const TODAY = "2026-07-21";
const EARLIER = "2026-07-08";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function dateInputs() {
  return document.querySelectorAll('input[type="date"]');
}

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

// TODAY is fixed at noon (beforeEach) — the create-mode default (Meal-Type Edit Staleness
// Fix, docs/prd/meal-type-edit-staleness.md) is whatever defaultMealType() resolves at that
// hour, computed here rather than hardcoded so the assertions stay correct if the config's
// hour boundaries ever change.
const CREATE_DEFAULT_MEAL_TYPE = defaultMealType(12, DASHBOARD_CONFIG.mealType);
const CREATE_DEFAULT_LABEL = MEAL_TYPE_LABELS[CREATE_DEFAULT_MEAL_TYPE];

async function expectMealTypeChecked(label: string) {
  await waitFor(() => {
    expect((screen.getByRole("radio", { name: label }) as HTMLInputElement).checked).toBe(true);
  });
}

// The calories field is required (native HTML constraint validation) — jsdom blocks form
// submission outright if it's left empty, so any test that actually submits create-mode
// must fill it first.
function fillCalories(value: string) {
  const input = document.querySelector('input[name="calories"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
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

describe("LogMealPanel", () => {
  it("AC-M25: exactly one date input renders, and form + list share one date after mount", async () => {
    render(<LogMealPanel />);

    await waitFor(() => expect(dateInputs()).toHaveLength(1));
    expect((dateInputs()[0] as HTMLInputElement).value).toBe(TODAY);
    expect(actions.listMealEntriesForDate).toHaveBeenCalledWith(TODAY);
    expect(await screen.findByText("Today's meals")).toBeTruthy();
  });

  it("AC-M31: the panel renders nothing on the first synchronous commit, then appears as a unit once the mount effect flushes", async () => {
    // RTL's render() wraps in act() and flushes passive effects before returning, so it
    // can't observe the pre-effect tick. flushSync forces just the initial commit — before
    // the mount effect runs — so the entryDate === null gate is genuinely observable here.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(<LogMealPanel />);
    });
    expect(container.innerHTML).toBe("");

    await act(async () => {});

    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(await screen.findByText("Today's meals")).toBeTruthy();

    root.unmount();
    document.body.removeChild(container);
  });

  it("AC-M26: changing the form's date re-queries and re-renders the list for that day", async () => {
    render(<LogMealPanel />);
    await waitFor(() => expect(dateInputs()).toHaveLength(1));

    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ entryDate: EARLIER })]);

    fireEvent.change(dateInputs()[0], { target: { value: EARLIER } });

    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenLastCalledWith(EARLIER));
    expect(await screen.findByText(`Meals · ${EARLIER}`)).toBeTruthy();
  });

  it("AC-M27: a date-edit save snaps the page to the saved date; the moved entry is present with Edit/Delete", async () => {
    const movedEntry = makeEntry({ entryDate: EARLIER });
    vi.mocked(actions.listMealEntriesForDate).mockImplementation(async (date: string) =>
      date === TODAY ? [makeEntry()] : [],
    );
    vi.mocked(actions.updateMealEntryAction).mockResolvedValue({
      status: "success",
      errors: [],
      entryDate: EARLIER,
      totals: { calories: 400, proteinG: 20, carbsG: 50, fatG: 10, entryCount: 1 },
      target: null,
    });

    render(<LogMealPanel />);
    await waitFor(() => expect(dateInputs()).toHaveLength(1));
    expect(await screen.findByText(/Oats/)).toBeTruthy();

    fireEvent.click(screen.getByText("Edit"));
    expect(await screen.findByText("Edit meal")).toBeTruthy();

    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([movedEntry]);
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect((dateInputs()[0] as HTMLInputElement).value).toBe(EARLIER));
    expect(await screen.findByText(`Meals · ${EARLIER}`)).toBeTruthy();
    expect(await screen.findByText(/Oats/)).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
  });

  it("AC-M28: logging a new entry for a non-today date keeps the page on that date", async () => {
    vi.mocked(actions.logMealAction).mockResolvedValue({
      status: "success",
      errors: [],
      entryDate: EARLIER,
      totals: { calories: 300, proteinG: 10, carbsG: 20, fatG: 5, entryCount: 1 },
      target: null,
    });

    render(<LogMealPanel />);
    await waitFor(() => expect(dateInputs()).toHaveLength(1));

    fireEvent.change(dateInputs()[0], { target: { value: EARLIER } });
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenLastCalledWith(EARLIER));

    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ entryDate: EARLIER })]);
    fillCalories("300");
    const saveButtons = screen.getAllByText("Save");
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(actions.logMealAction).toHaveBeenCalled());
    await waitFor(() => expect((dateInputs()[0] as HTMLInputElement).value).toBe(EARLIER));
    expect(await screen.findByText(`Meals · ${EARLIER}`)).toBeTruthy();
  });

  it("NFR-42 (save-snap race): a stale pre-save fetch for the pre-edit day never overwrites the saved day's list", async () => {
    // Distinct trigger path from the plain date-change race (covered in
    // meal-entries-list.test.tsx): here the in-flight fetch belongs to the *pre-save* date,
    // and it's the save's onMutationSuccess snap — not a direct date-input change — that
    // moves entryDate while that fetch is still pending.
    //
    // Fuel's Total · Today card (PRD §0.3) independently calls listMealEntriesForDate(TODAY)
    // alongside MealEntriesList, so a call-count threshold can't distinguish "the initial
    // mount" from "the post-save refetch" — an explicit arm flag does, regardless of how
    // many consumers call in on either side of it.
    let staleModeArmed = false;
    const staleTodayFetch = deferred<MealEntryRow[]>();
    const earlierFetch = deferred<MealEntryRow[]>();

    vi.mocked(actions.listMealEntriesForDate).mockImplementation(async (date: string) => {
      if (date === TODAY) {
        return staleModeArmed ? staleTodayFetch.promise : [makeEntry()];
      }
      return earlierFetch.promise;
    });

    render(<LogMealPanel />);
    expect(await screen.findByText(/Oats/)).toBeTruthy();

    // A same-day create-save: onMutationSuccess(TODAY) makes setEntryDate a no-op, but the
    // refreshToken bump still fires a fresh (now-pending) fetch for TODAY from every
    // consumer.
    vi.mocked(actions.logMealAction).mockResolvedValue({
      status: "success",
      errors: [],
      entryDate: TODAY,
      totals: { calories: 700, proteinG: 30, carbsG: 70, fatG: 15, entryCount: 2 },
      target: null,
    });
    staleModeArmed = true;
    fillCalories("300");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(actions.logMealAction).toHaveBeenCalled());

    // Now, while that TODAY refetch is still pending, edit the (still-displayed, stale)
    // entry and save it onto an earlier day.
    vi.mocked(actions.updateMealEntryAction).mockResolvedValue({
      status: "success",
      errors: [],
      entryDate: EARLIER,
      totals: { calories: 400, proteinG: 20, carbsG: 50, fatG: 10, entryCount: 1 },
      target: null,
    });
    fireEvent.click(screen.getByText("Edit"));
    expect(await screen.findByText("Edit meal")).toBeTruthy();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenLastCalledWith(EARLIER));

    // Resolve the earlier (current) fetch first, then the stale today fetch after —
    // out-of-order resolution is exactly what the `cancelled` guard must survive.
    await act(async () => {
      earlierFetch.resolve([makeEntry({ entryDate: EARLIER })]);
    });
    await act(async () => {
      staleTodayFetch.resolve([makeEntry({ entryDate: TODAY, description: "Stale today entry" })]);
    });

    expect(screen.queryByText("Stale today entry")).toBeNull();
    expect(await screen.findByText(`Meals · ${EARLIER}`)).toBeTruthy();
  });

  // Meal-Type Edit Staleness Fix (docs/prd/meal-type-edit-staleness.md), AC-M32–M35: the
  // meal-type selector must show the edited entry's actual stored value, re-sync on every
  // editEntry transition, leave create mode's own default untouched, and never leak an
  // edited value back into create mode after Cancel/Save.

  it("AC-M32: opening Edit on an entry shows its actual stored meal type, not the create-mode default", async () => {
    expect(CREATE_DEFAULT_MEAL_TYPE).not.toBe("breakfast");
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ mealType: "breakfast" })]);

    render(<LogMealPanel />);
    await expectMealTypeChecked(CREATE_DEFAULT_LABEL);

    fireEvent.click(screen.getByText("Edit"));
    expect(await screen.findByText("Edit meal")).toBeTruthy();
    await expectMealTypeChecked("Breakfast");
  });

  it("AC-M33(a): cancelling an edit and opening Edit on a different entry re-syncs the selector", async () => {
    const entryA = makeEntry({ id: 1, mealType: "lunch", description: "Sandwich" });
    const entryB = makeEntry({ id: 2, mealType: "dinner", description: "Pasta" });
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([entryA, entryB]);

    render(<LogMealPanel />);
    expect(await screen.findByText(/Sandwich/)).toBeTruthy();

    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(await screen.findByText("Edit meal")).toBeTruthy();
    await expectMealTypeChecked("Lunch");

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Edit meal")).toBeNull());

    fireEvent.click(screen.getAllByText("Edit")[1]);
    expect(await screen.findByText("Edit meal")).toBeTruthy();
    await expectMealTypeChecked("Dinner");
  });

  it("AC-M33(b): clicking Edit on a different entry while one is still being edited re-syncs the selector", async () => {
    const entryA = makeEntry({ id: 1, mealType: "lunch", description: "Sandwich" });
    const entryB = makeEntry({ id: 2, mealType: "dinner", description: "Pasta" });
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([entryA, entryB]);

    render(<LogMealPanel />);
    expect(await screen.findByText(/Sandwich/)).toBeTruthy();

    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(await screen.findByText("Edit meal")).toBeTruthy();
    await expectMealTypeChecked("Lunch");

    // meal-entries-list.tsx applies no disabled/editing guard to other rows' Edit buttons,
    // so clicking straight from A to B (without Cancel) is a reachable transition.
    fireEvent.click(screen.getAllByText("Edit")[1]);
    await expectMealTypeChecked("Dinner");
  });

  it("AC-M34: create mode's meal-type default is still computed from device-local time-of-day, unaffected by this fix", async () => {
    render(<LogMealPanel />);
    await expectMealTypeChecked(CREATE_DEFAULT_LABEL);
  });

  it("AC-M41 (fallback parity): the post-save card's 'set targets' fallback is a button that calls switchToTargets, not an <a href> to /settings/targets", async () => {
    vi.mocked(actions.logMealAction).mockResolvedValue({
      status: "success",
      errors: [],
      entryDate: TODAY,
      totals: { calories: 300, proteinG: 10, carbsG: 20, fatG: 5, entryCount: 1 },
      target: null,
    });
    const switchToTargets = vi.fn();

    render(<LogMealPanel switchToTargets={switchToTargets} />);
    await waitFor(() => expect(dateInputs()).toHaveLength(1));
    fillCalories("300");
    fireEvent.click(screen.getByText("Save"));

    const setTargets = await screen.findByText("set targets");
    expect(setTargets.tagName).toBe("BUTTON");
    expect(setTargets.closest("a")).toBeNull();
    expect(document.querySelector('a[href="/settings/targets"]')).toBeNull();

    fireEvent.click(setTargets);
    expect(switchToTargets).toHaveBeenCalled();
  });

  it("AC-M35: cancelling an edit does not leak the edited entry's meal type into create mode", async () => {
    expect(CREATE_DEFAULT_MEAL_TYPE).not.toBe("dinner");
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([makeEntry({ mealType: "dinner" })]);

    render(<LogMealPanel />);
    await expectMealTypeChecked(CREATE_DEFAULT_LABEL);

    fireEvent.click(screen.getByText("Edit"));
    expect(await screen.findByText("Edit meal")).toBeTruthy();
    await expectMealTypeChecked("Dinner");

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Edit meal")).toBeNull());

    await expectMealTypeChecked(CREATE_DEFAULT_LABEL);
  });
});
