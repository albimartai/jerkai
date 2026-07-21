import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MealEntriesList } from "@/app/ui/meal-entries-list";
import * as actions from "@/app/log-meal/actions";
import type { MealEntryRow } from "@/lib/meal-entries";

// Date-Scoped Entries List (docs/prd/date-scoped-entries-list.md), NFR-44: MealEntriesList
// mounted directly, controlled — the `entryDate` prop drives which day it queries.

vi.mock("@/app/log-meal/actions", () => ({
  deleteMealEntryAction: vi.fn(),
  listMealEntriesForDate: vi.fn(),
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

beforeEach(() => {
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("MealEntriesList", () => {
  it("NFR-42: a rerender to a new entryDate before the first fetch resolves renders only the current date's rows", async () => {
    const todayFetch = deferred<MealEntryRow[]>();
    const earlierFetch = deferred<MealEntryRow[]>();

    vi.mocked(actions.listMealEntriesForDate).mockImplementation(async (date: string) =>
      date === TODAY ? todayFetch.promise : earlierFetch.promise,
    );

    const { rerender } = render(
      <MealEntriesList entryDate={TODAY} refreshToken={0} onEdit={() => {}} />,
    );
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenCalledWith(TODAY));

    rerender(<MealEntriesList entryDate={EARLIER} refreshToken={0} onEdit={() => {}} />);
    await waitFor(() => expect(actions.listMealEntriesForDate).toHaveBeenCalledWith(EARLIER));

    // Resolve the current (earlier) fetch first, then the stale (today) one after — the
    // `cancelled` guard must drop the late-arriving stale response regardless of order.
    await act(async () => {
      earlierFetch.resolve([makeEntry({ entryDate: EARLIER, description: "Earlier meal" })]);
    });
    await act(async () => {
      todayFetch.resolve([makeEntry({ entryDate: TODAY, description: "Stale today meal" })]);
    });

    expect(await screen.findByText(/Earlier meal/)).toBeTruthy();
    expect(screen.queryByText(/Stale today meal/)).toBeNull();
  });

  it("AC-M30: deleting a row (confirm step included) removes it from the list and fires onDeleted", async () => {
    const entry = makeEntry();
    vi.mocked(actions.listMealEntriesForDate).mockResolvedValue([entry]);
    vi.mocked(actions.deleteMealEntryAction).mockResolvedValue({
      status: "success",
      errors: [],
      deletedId: entry.id,
    });

    const onDeleted = vi.fn();
    render(
      <MealEntriesList entryDate={TODAY} refreshToken={0} onEdit={() => {}} onDeleted={onDeleted} />,
    );

    expect(await screen.findByText(/Oats/)).toBeTruthy();

    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(await screen.findByText("Confirm"));

    await waitFor(() => expect(screen.queryByText(/Oats/)).toBeNull());
    expect(onDeleted).toHaveBeenCalled();
  });
});
