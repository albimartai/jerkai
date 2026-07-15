// Typed client for the Whoop API v2 collection endpoints
// (developer.whoop.com/api). Collections paginate via next_token with at
// most 25 records per page; rate limits are 100 req/min / 10,000 req/day,
// surfaced as 429s with an X-RateLimit-Reset header (seconds until reset).
//
// Record types describe only the fields this app reads; every record is also
// stored verbatim in raw_payload, so fields not modeled here are preserved.

const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";

export class WhoopApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhoopApiError";
  }
}

export type WhoopScoreState = "SCORED" | "PENDING_SCORE" | "UNSCORABLE";

export type WhoopRecovery = {
  cycle_id?: number;
  sleep_id?: string;
  score_state?: WhoopScoreState;
  score?: {
    user_calibrating?: boolean;
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
  [key: string]: unknown;
};

export type WhoopSleep = {
  id?: string;
  nap?: boolean;
  start?: string; // ISO-8601 UTC
  end?: string;
  timezone_offset?: string; // "+hh:mm" | "-hh:mm" | "Z"
  score_state?: WhoopScoreState;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
    };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
  [key: string]: unknown;
};

export type WhoopCycle = {
  id?: number;
  start?: string;
  end?: string; // absent while the cycle is in progress
  timezone_offset?: string;
  score_state?: WhoopScoreState;
  score?: {
    strain?: number;
    kilojoule?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
  };
  [key: string]: unknown;
};

export type WhoopWorkout = {
  id?: string;
  sport_name?: string;
  start?: string;
  end?: string;
  timezone_offset?: string;
  score_state?: WhoopScoreState;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
  };
  [key: string]: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${WHOOP_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // One retry on 429, waiting out the advertised reset — enough for the
  // chunked historical backfill to brush the per-minute limit without
  // failing the whole run.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 429 && attempt === 0) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      await sleep((Number.isFinite(reset) && reset > 0 ? Math.min(reset, 60) : 30) * 1000);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new WhoopApiError(res.status, `GET ${path} failed: ${res.status} ${detail}`);
    }
    return res.json();
  }
}

// Hard cap on pagination so a malformed next_token loop can't spin forever:
// 400 pages x 25 records covers ~27 years of daily records.
const MAX_PAGES = 400;

export async function fetchCollection<T>(
  path: string,
  accessToken: string,
  window: { start: string; end: string },
): Promise<T[]> {
  const records: T[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = (await apiGet(path, accessToken, {
      limit: "25",
      start: window.start,
      end: window.end,
      ...(nextToken ? { nextToken } : {}),
    })) as { records?: T[]; next_token?: string | null };
    records.push(...(body.records ?? []));
    if (!body.next_token) return records;
    nextToken = body.next_token;
  }
  throw new WhoopApiError(508, `GET ${path}: pagination exceeded ${MAX_PAGES} pages`);
}

export const whoopCollections = {
  recovery: "/recovery",
  sleep: "/activity/sleep",
  cycle: "/cycle",
  workout: "/activity/workout",
} as const;

// Fallback for recoveries whose sleep fell outside the fetched window (e.g.
// a recovery re-scored days after its sleep) — the wake-day mapping needs
// the sleep record's end + timezone_offset.
export async function fetchSleepById(
  sleepId: string,
  accessToken: string,
): Promise<WhoopSleep | null> {
  try {
    return (await apiGet(`/activity/sleep/${sleepId}`, accessToken, {})) as WhoopSleep;
  } catch (err) {
    if (err instanceof WhoopApiError && err.status === 404) return null;
    throw err;
  }
}
