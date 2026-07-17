import { describe, expect, it } from "vitest";

import { trendDescriptor } from "@/lib/dashboard/trend-descriptor";

// Executable spec for the guardrail strips' short trend descriptor
// (AC-D12): latest value vs the trailing week, described passively.

describe("trendDescriptor", () => {
  it("AC-D12: reads 'steady' when the latest value sits within 2% of the trailing-week mean", () => {
    expect(trendDescriptor([150, 150.5, 149.8, 150.2])).toBe("steady");
  });

  it("AC-D12: reads 'up' when the latest value is more than 2% above the trailing-week mean", () => {
    expect(trendDescriptor([100, 100, 100, 110])).toBe("up");
  });

  it("AC-D12: reads 'down' when the latest value is more than 2% below the trailing-week mean", () => {
    expect(trendDescriptor([100, 100, 100, 90])).toBe("down");
  });

  it("AC-D13: gap days are skipped, not read as zeros", () => {
    expect(trendDescriptor([150, null, 150.4, null, 150.1])).toBe("steady");
  });

  it("AC-D12: too little history reads 'steady' rather than inventing a trend", () => {
    expect(trendDescriptor([])).toBe("steady");
    expect(trendDescriptor([null, null])).toBe("steady");
    expect(trendDescriptor([72])).toBe("steady");
  });
});
