/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Prospective module — does not exist yet (PRD §1: "a small Client Component
// owning the Fitdays setup modal's open/close state"; naming/exact file left
// to the build agent, e.g. app/ui/fitdays-connect.tsx, mirroring
// app/ui/local-time.tsx's established narrow-client-leaf pattern, NFR-125).
// This import is expected to fail to resolve until that file is created.
import { FitdaysConnect } from "@/app/ui/fitdays-connect";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("FitdaysConnect — AC-DS13/AC-DS14/AC-DS15/AC-DS16: setup modal", () => {
  it("AC-DS13: clicking Connect opens a modal with Health Auto Export setup instructions and a Cancel / I've set it up action pair", async () => {
    render(<FitdaysConnect />);

    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /i.?ve set it up/i })).toBeTruthy();
    expect(screen.getByText(/health auto export/i)).toBeTruthy();
  });

  it("AC-DS14: the open modal's text never claims JerkAI generates a per-account key, and never renders the literal HEALTH_EXPORT_SHARED_SECRET value", async () => {
    vi.stubEnv("HEALTH_EXPORT_SHARED_SECRET", "test-shared-secret-value-do-not-leak");

    render(<FitdaysConnect />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy());

    const modalText = document.body.textContent ?? "";
    expect(modalText.toLowerCase()).not.toContain("we generate");
    expect(modalText).not.toContain("test-shared-secret-value-do-not-leak");
  });

  it("AC-DS15: clicking Cancel closes the modal and changes nothing else", async () => {
    render(<FitdaysConnect />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull());
  });

  it("AC-DS16/NFR-123: clicking \"I've set it up\" closes the modal and issues no network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("FitdaysConnect must never issue a network request (NFR-123)");
    });

    render(<FitdaysConnect />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /i.?ve set it up/i })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /i.?ve set it up/i }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
