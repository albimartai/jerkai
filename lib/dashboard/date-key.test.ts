import { describe, expect, it } from "vitest";

import { readingDateKey } from "@/lib/dashboard/date-key";

// Executable spec for the shared date key on the dashboard read path (NFR-2;
// README timezone convention): reading_date is the device-local calendar day,
// and formats whose leading component could be a UTC day are rejected loudly
// rather than silently shifting evening readings onto the next day.

describe("readingDateKey", () => {
  it("NFR-2: accepts a bare device-local calendar day as-is", () => {
    expect(readingDateKey("2026-07-16")).toBe("2026-07-16");
  });

  it("NFR-2: a reading just after local midnight lands on the correct local day", () => {
    // 00:05 local on Jul 10 is 05:05 UTC — the local day must win.
    expect(readingDateKey("2026-07-10 00:05:12 -0500")).toBe("2026-07-10");
  });

  it("NFR-2: rejects ISO-8601 UTC timestamps loudly", () => {
    expect(() => readingDateKey("2026-07-10T05:05:12Z")).toThrow(/device-local/);
  });

  it("NFR-2: rejects ISO-8601 offset timestamps loudly (T separator means not our format)", () => {
    expect(() => readingDateKey("2026-07-10T00:05:12-05:00")).toThrow(/device-local/);
  });

  it("NFR-2: rejects anything else loudly rather than guessing a day", () => {
    expect(() => readingDateKey("July 10, 2026")).toThrow(/device-local/);
    expect(() => readingDateKey("")).toThrow(/device-local/);
  });
});
