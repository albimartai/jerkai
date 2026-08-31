import type { ReadingSource } from "@/lib/sources";

// Category/method/display-name metadata for /data's card layout — presentation-only
// facts with exactly one consumer (this page), so they live here rather than widening
// lib/sources.ts's flat string-array exports (Data Page Redesign & Connect, §0.6, NFR-126).
export type DataSource = Extract<ReadingSource, "fitdays" | "whoop" | "withings">;

export const SOURCE_METADATA: Record<DataSource, { displayName: string; method: string }> = {
  fitdays: { displayName: "Fitdays", method: "Apple Health" },
  withings: { displayName: "Withings", method: "OAuth" },
  whoop: { displayName: "Whoop", method: "OAuth" },
};

// Order matches the mockup's grouping (§0.2/AC-DS4): Scale (Fitdays, Withings), then
// Performance (Whoop). apple_health is retired as a live pipe (lib/sources.ts's own header
// comment) and is not a fourth card.
export const CATEGORIES: { name: "Scale" | "Performance"; sources: DataSource[] }[] = [
  { name: "Scale", sources: ["fitdays", "withings"] },
  { name: "Performance", sources: ["whoop"] },
];
