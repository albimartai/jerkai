import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TargetsForm } from "@/app/ui/targets-form";
import * as actions from "@/app/fuel/actions";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Fuel (Targets + Log Meal Merge)
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

// TargetsForm's saveTargetAction import moves from @/app/settings/targets/actions
// into the merged @/app/fuel/actions module (PRD §1) — prospective, doesn't exist yet.
vi.mock("@/app/fuel/actions", () => ({
  saveTargetAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fillRequiredFields() {
  fireEvent.change(document.querySelector('input[name="caloriesTarget"]') as HTMLInputElement, {
    target: { value: "2000" },
  });
  fireEvent.change(document.querySelector('input[name="proteinTargetG"]') as HTMLInputElement, {
    target: { value: "150" },
  });
}

describe("TargetsForm — onSaved callback (AC-M46)", () => {
  it("AC-M46: onSaved fires exactly once after a successful save, not on every render", async () => {
    vi.mocked(actions.saveTargetAction).mockResolvedValue({ status: "success", errors: [] });
    const onSaved = vi.fn();

    render(<TargetsForm onSaved={onSaved} />);
    await waitFor(() => expect(document.querySelector('input[type="date"]')).not.toBeNull());

    fillRequiredFields();
    fireEvent.click(screen.getByText("Save target"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    // A subsequent keystroke-driven re-render, still on the same settled
    // success state, must not re-fire onSaved.
    fireEvent.change(document.querySelector('input[name="caloriesTarget"]') as HTMLInputElement, {
      target: { value: "2100" },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("AC-M46: onSaved is optional — TargetsForm renders and saves with no error when it is omitted", async () => {
    vi.mocked(actions.saveTargetAction).mockResolvedValue({ status: "success", errors: [] });

    render(<TargetsForm />);
    await waitFor(() => expect(document.querySelector('input[type="date"]')).not.toBeNull());

    fillRequiredFields();
    expect(() => fireEvent.click(screen.getByText("Save target"))).not.toThrow();
  });

  it("AC-M46: onSaved does not fire on a failed save", async () => {
    vi.mocked(actions.saveTargetAction).mockResolvedValue({
      status: "error",
      errors: ["calories target is required"],
    });
    const onSaved = vi.fn();

    render(<TargetsForm onSaved={onSaved} />);
    await waitFor(() => expect(document.querySelector('input[type="date"]')).not.toBeNull());

    fillRequiredFields();
    fireEvent.click(screen.getByText("Save target"));

    await waitFor(() => expect(actions.saveTargetAction).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
