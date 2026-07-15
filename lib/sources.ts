// Source registry for biometric_readings and sync_runs.
//
// READING_SOURCES: every source that can appear in stored rows — the DB check
// constraints on biometric_readings.source and sync_runs.source allow all
// three. 'apple_health' is retired as a live pipe as of Session 8 (its only
// metric, step_count, was deleted as unsalvageable, and Apple Health now
// carries Fitdays data exclusively), but it remains a valid historical value
// in sync_runs, so it stays in this list.
//
// ACTIVE_SYNC_SOURCES: the lanes with a live pipe today — what /status
// displays. Deliberately hardcoded rather than derived from recent sync_runs
// activity: a pipe that dies completely stops writing sync_runs rows at all,
// and a display driven by recent activity would silently hide that dead lane
// — the exact failure /status exists to surface.
export const READING_SOURCES = ["fitdays", "whoop", "apple_health"] as const;

export type ReadingSource = (typeof READING_SOURCES)[number];

export const ACTIVE_SYNC_SOURCES = ["fitdays", "whoop"] as const;
