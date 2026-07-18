import { describe, expect, it } from "vitest";

import { DASHBOARD_CONFIG } from "@/lib/dashboard/config";
import { leanMassChange, recoveryReadout } from "@/lib/dashboard/readouts";
import { rollingAverage } from "@/lib/dashboard/rolling";

// Executable spec for the guardrail readout row (AC-N8, AC-N9): summary
// statistics, never charts, with thresholds coming from the typed config
// (NFR-16) so they are tunable without touching component code. These
// readouts supersede the v1 guardrail-strip descriptors (AC-D12).

// A flat series of `days` values with a linear drift toward `end`.
const drift = (days: number, start: number, end: number): number[] =>
  Array.from({ length: days }, (_, i) => start + ((end - start) * i) / (days - 1));

describe("leanMassChange (AC-N8)", () => {
  const cfg = DASHBOARD_CONFIG.leanMass;

  it("AC-N8: with ≥30 days of data, reports the 30-day change over the smoothed series", () => {
    const avg7 = rollingAverage(drift(40, 152.0, 152.0), 7);
    const readout = leanMassChange(avg7, cfg);
    expect(readout).not.toBeNull();
    expect(readout!.spanDays).toBe(cfg.windowDays);
    expect(readout!.deltaLb).toBeCloseTo(0, 5);
  });

  it("AC-N8: a change within ±0.5 lb reads 'holding'", () => {
    const avg7 = rollingAverage(drift(40, 152.0, 151.7), 7);
    expect(leanMassChange(avg7, cfg)!.state).toBe("holding");
  });

  it("AC-N8: a drop below −0.5 lb over the window is the warning state", () => {
    const avg7 = rollingAverage(drift(40, 152.0, 149.5), 7);
    const readout = leanMassChange(avg7, cfg)!;
    expect(readout.state).toBe("down");
    expect(readout.deltaLb).toBeLessThan(-cfg.bandLb);
  });

  it("AC-N8: a gain above +0.5 lb reads 'up', never the warning state", () => {
    const avg7 = rollingAverage(drift(40, 150.0, 152.5), 7);
    expect(leanMassChange(avg7, cfg)!.state).toBe("up");
  });

  it("AC-N8: with <30 days of data, reports the available window labeled with its actual span", () => {
    const avg7 = rollingAverage(drift(12, 152.0, 151.9), 7);
    const readout = leanMassChange(avg7, cfg)!;
    expect(readout.spanDays).toBe(11); // 12 daily readings span 11 days
    expect(readout.spanDays).toBeLessThan(cfg.windowDays);
  });

  it("AC-N8/NFR-16: the holding band comes from config, not a hardcoded constant", () => {
    const avg7 = rollingAverage(drift(40, 152.0, 151.0), 7); // ~-1.0 lb drift
    expect(leanMassChange(avg7, cfg)!.state).toBe("down");
    expect(leanMassChange(avg7, { ...cfg, bandLb: 2.0 })!.state).toBe("holding");
  });

  it("AC-N2/AC-D13: gap days are skipped, and endpoints land on present days", () => {
    const series = [152.0, null, null, 151.8, null, 151.6];
    const readout = leanMassChange(series, { ...cfg, windowDays: 30 })!;
    expect(readout.deltaLb).toBeCloseTo(-0.4, 5);
    expect(readout.spanDays).toBe(5);
  });

  it("AC-N8: fewer than two present values yields no readout rather than a fabricated change", () => {
    expect(leanMassChange([], cfg)).toBeNull();
    expect(leanMassChange([null, 152.0, null], cfg)).toBeNull();
  });
});

describe("recoveryReadout (AC-N9)", () => {
  const cfg = DASHBOARD_CONFIG.recovery;

  it("AC-N9: reports the 7-day average and the red-zone day count", () => {
    // Last 7 days: 60, 70, 80, 33, 20, 90, 70 → avg 60.43, 2 red (<34).
    const series = [50, 50, 60, 70, 80, 33, 20, 90, 70];
    const readout = recoveryReadout(series, cfg)!;
    expect(readout.avgPct).toBeCloseTo((60 + 70 + 80 + 33 + 20 + 90 + 70) / 7, 2);
    expect(readout.redDays).toBe(2);
  });

  it("AC-N9/NFR-16: the red-zone boundary is Whoop's own <34%, from config", () => {
    const series = [50, 50, 50, 50, 50, 34, 33.9];
    expect(recoveryReadout(series, cfg)!.redDays).toBe(1); // 34 is NOT red; <34 is
    expect(recoveryReadout(series, { ...cfg, redBelowPct: 50 })!.redDays).toBe(2);
  });

  it("AC-N2/AC-D13: gap days inside the window are skipped, never counted as zero or red", () => {
    const series = [null, null, 60, null, 70, null, 80];
    const readout = recoveryReadout(series, cfg)!;
    expect(readout.avgPct).toBeCloseTo(70, 5);
    expect(readout.redDays).toBe(0);
  });

  it("AC-N9: no data in the window yields no readout", () => {
    expect(recoveryReadout([], cfg)).toBeNull();
    expect(recoveryReadout([null, null, null], cfg)).toBeNull();
  });
});
