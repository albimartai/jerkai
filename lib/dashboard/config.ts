// Dashboard tuning knobs in one typed module (NFR-16): guardrail thresholds
// and rendering margins live here — never hardcoded in component code — so
// they can be tuned without touching the strips or readouts.

export type LeanMassConfig = {
  // Guardrail band: a change within ±bandLb over windowDays reads as
  // "holding"; a drop below −bandLb is the warning state (AC-N8).
  // ±0.5 lb ≈ the ±0.2 kg band, confirmed 2026-07-18.
  bandLb: number;
  windowDays: number;
};

export type RecoveryConfig = {
  // Whoop's own red zone: a Recovery Score below this is a red day (AC-N9).
  // Boundary resolved 2026-07-18 (OQ-2): <34%.
  redBelowPct: number;
  windowDays: number;
};

export type DashboardConfig = {
  leanMass: LeanMassConfig;
  recovery: RecoveryConfig;
  // Fitted Y domains (AC-N7): headroom added above/below the observed range,
  // as a fraction of that range, so dots never sit on the strip edge and
  // genuine drift stays visually detectable (never zero-based).
  yDomainMarginFraction: number;
};

export const DASHBOARD_CONFIG: DashboardConfig = {
  leanMass: { bandLb: 0.5, windowDays: 30 },
  recovery: { redBelowPct: 34, windowDays: 7 },
  yDomainMarginFraction: 0.12,
};
