/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Status Sync Times — Local Timezone Display
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Prospective module — does not exist yet (PRD §1: "a small Client Component
// responsible for formatting a raw instant into the viewer's local time";
// naming/shape left to the build agent, NFR-88 fixes the required boundary).
// This import is expected to fail to resolve until that file is created.
import { LocalTime } from "@/app/ui/local-time";

// A known UTC instant reused across cases below — its rendered local time must
// change with the forced TZ (NFR-91: the assertion must discriminate a real
// runtime zone conversion from a coincidental UTC-matching test environment;
// process.env.TZ was confirmed, this session, to dynamically change both
// Date's local getters and Intl.DateTimeFormat's resolved zone in this repo's
// Node/Vitest setup — no mock or library needed).
const KNOWN_INSTANT = "2026-08-19T14:30:00.000Z";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("LocalTime — AC-ST2/AC-ST3: viewer-local timestamp display", () => {
  it("AC-ST2: a known UTC instant renders in America/Chicago's local offset, not the literal UTC hour or a hardcoded UTC label", async () => {
    vi.stubEnv("TZ", "America/Chicago");

    render(<LocalTime iso={KNOWN_INSTANT} />);

    // 2026-08-19T14:30:00.000Z in America/Chicago (CDT, UTC-5) is 09:30 local,
    // same calendar day.
    await waitFor(() => expect(screen.getByText(/09:30/)).toBeTruthy());
    expect(screen.queryByText(/14:30/)).toBeNull();
    expect(screen.queryByText(/UTC/)).toBeNull();
  });

  it("AC-ST2/NFR-91: the same UTC instant renders a different local time under a different forced zone, proving the conversion is runtime-resolved rather than hardcoded", async () => {
    vi.stubEnv("TZ", "Asia/Kolkata");

    render(<LocalTime iso={KNOWN_INSTANT} />);

    // 2026-08-19T14:30:00.000Z in Asia/Kolkata (UTC+5:30) is 20:00 local. A
    // component that hardcoded America/Chicago (or any fixed zone) would fail
    // this case while still passing the one above — that asymmetry is the point.
    await waitFor(() => expect(screen.getByText(/20:00/)).toBeTruthy());
    expect(screen.queryByText(/09:30/)).toBeNull();
  });

  it("AC-ST3: the 'Last run' timestamp resolves local time through the same component/mechanism as AC-ST2's 'Last successful sync' — no divergence", async () => {
    vi.stubEnv("TZ", "America/Chicago");

    const lastRunInstant = "2026-08-19T03:05:00.000Z";
    render(<LocalTime iso={lastRunInstant} />);

    // 03:05 UTC in America/Chicago (CDT, UTC-5) is 22:05 the previous calendar day.
    await waitFor(() => expect(screen.getByText(/22:05/)).toBeTruthy());
  });

  it("NFR-90: renders nothing on the first synchronous commit (server can't know device-local time), then appears once the mount effect flushes — no persistent SSR/CSR mismatch", async () => {
    vi.stubEnv("TZ", "America/Chicago");

    // Mirrors the AC-M31 precedent (app/ui/log-meal-panel.tsx, tests/component/log-meal-panel.test.tsx):
    // RTL's render() already flushes passive effects, so flushSync is used here
    // to observe the genuinely pre-effect tick.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(<LocalTime iso={KNOWN_INSTANT} />);
    });
    expect(container.innerHTML).toBe("");

    await act(async () => {});

    expect(container.textContent).toMatch(/09:30/);

    root.unmount();
    document.body.removeChild(container);
  });
});
