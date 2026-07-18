// Display-unit conversion (NFR-16): the dashboard shows weight and lean
// body mass in lb regardless of stored source units. Stored rows are never
// rewritten (README: units stored as-sent); conversion happens here at
// read/render time only.

const LB_PER_KG = 2.204622621848776;

// All real history arrives in lb (README, verified 2026-07-14); kg is the
// one plausible alternative a source could switch to. Anything else passes
// through untouched — fabricating a conversion for an unknown unit would
// falsify the raw value.
export function toPounds(value: number, unit: string | null): number {
  return unit === "kg" ? value * LB_PER_KG : value;
}
