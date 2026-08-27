// Typed client for the Withings API's measure.getmeas operation
// (developer.withings.com).
// NFR-104 — OPEN RISK, not yet live-verified: the shapes below come from
// search against Withings' own API surface and third-party client
// implementations (the docs site itself is JS-rendered and was not
// fetchable directly this session). As of this commit, no live getmeas call
// has been made — a Preview test of this branch stopped at Withings'
// consent screen, before any code in this file ever ran against a real
// access token. Flag as an open risk in the PR description until a real
// first connect confirms (or corrects) the following:
//   - getmeas paginates via `offset`/`more` in the response body, not
//     Whoop's next_token style — a truthy `more` means re-request with the
//     returned `offset`.
//   - The documented rate cap is 120 requests/minute; this client stays at
//     half that (NFR-101) via a fixed pacing window rather than firing every
//     request immediately.
//   - No specific 429 response-header name for Withings' rate-limit reset
//     was independently confirmed — apiGet retries once on 429 honoring a
//     Retry-After-style header when present, falling back to a fixed delay
//     otherwise, mirroring lib/whoop-api.ts#apiGet's bounded-retry shape.
//     Reconcile the exact header name against a live 429 response on first
//     real backfill run.
//
// Every measuregrp is also stored verbatim in raw_payload by the mapping
// layer, so fields not modeled here are preserved regardless.

const WITHINGS_API_BASE = "https://wbsapi.withings.net";

export class WithingsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WithingsApiError";
  }
}

export type WithingsMeasure = {
  type: number;
  value: number;
  unit: number; // actual value = value * 10^unit
};

export type WithingsMeasureGroup = {
  grpid: number;
  date: number; // Unix epoch seconds
  measures: WithingsMeasure[];
  [key: string]: unknown;
};

type WithingsGetMeasBody = {
  timezone?: string | null;
  measuregrps?: WithingsMeasureGroup[];
  more?: number | boolean;
  offset?: number;
};

type WithingsEnvelope = {
  status?: number;
  body?: WithingsGetMeasBody;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// NFR-101: never issue more than half of Withings' documented 120 req/min
// cap — a fixed pacing window rather than a token bucket, since a chunked
// backfill's request pattern is simple sequential pagination.
const MAX_REQUESTS_PER_MINUTE = 60;
const PACING_WINDOW_MS = 60_000;
// Small safety margin over the bare window so concurrent-call scheduling
// jitter can never shave the observed gap below the documented cap.
const PACING_SAFETY_MARGIN_MS = 250;
let windowStart = Date.now();
let requestsInWindow = 0;

async function paceRequest(): Promise<void> {
  const now = Date.now();
  if (now - windowStart >= PACING_WINDOW_MS) {
    windowStart = now;
    requestsInWindow = 0;
  }
  if (requestsInWindow >= MAX_REQUESTS_PER_MINUTE) {
    const waitMs = PACING_WINDOW_MS + PACING_SAFETY_MARGIN_MS - (now - windowStart);
    await sleep(Math.max(waitMs, 0));
    windowStart = Date.now();
    requestsInWindow = 0;
  }
  requestsInWindow += 1;
}

// Exported (unlike Whoop's private apiGet) so lib/withings-api.test.ts can
// reach it directly with a mocked fetch (DoD §6, AC-WS9).
export async function apiGet(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<WithingsGetMeasBody> {
  const url = new URL(`${WITHINGS_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // One retry on 429, waiting out the advertised reset (or a fixed fallback
  // delay when no reset header is present) — enough for a chunked backfill
  // to brush the per-minute limit without failing the whole run.
  for (let attempt = 0; ; attempt++) {
    await paceRequest();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 429 && attempt === 0) {
      const header = res.headers.get("retry-after");
      const retryAfter = header === null ? Number.NaN : Number(header);
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter, 60) : 30;
      await sleep(waitSeconds * 1000);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new WithingsApiError(res.status, `GET ${path} failed: ${res.status} ${detail}`);
    }
    const envelope = (await res.json()) as WithingsEnvelope;
    if (envelope.status !== 0 || !envelope.body) {
      throw new WithingsApiError(
        502,
        `GET ${path} returned status ${envelope.status}: ${envelope.error ?? "unknown error"}`,
      );
    }
    return envelope.body;
  }
}

// Measure types this app maps (§0/NFR-104): 1 = weight, 5 = fat-free mass,
// 6 = fat ratio. Filtered server-side via meastypes (fewer bytes, fewer
// irrelevant records to discard) rather than pulled unfiltered (OQ-2).
export const WITHINGS_MEASURE_TYPES = "1,5,6";

// Hard cap on pagination so a malformed offset/more loop can't spin
// forever — mirrors lib/whoop-api.ts#fetchCollection's MAX_PAGES discipline.
const MAX_PAGES = 400;

export async function fetchMeasureGroups(
  accessToken: string,
  window: { start: string; end: string },
): Promise<{ measureGroups: WithingsMeasureGroup[]; timezone: string | null }> {
  const startdate = String(Math.floor(new Date(window.start).getTime() / 1000));
  const enddate = String(Math.floor(new Date(window.end).getTime() / 1000));

  const measureGroups: WithingsMeasureGroup[] = [];
  let timezone: string | null = null;
  let offset: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await apiGet("/measure", accessToken, {
      action: "getmeas",
      meastypes: WITHINGS_MEASURE_TYPES,
      startdate,
      enddate,
      ...(offset !== undefined ? { offset: String(offset) } : {}),
    });
    measureGroups.push(...(body.measuregrps ?? []));
    if (typeof body.timezone === "string") timezone = body.timezone;
    if (!body.more || typeof body.offset !== "number") return { measureGroups, timezone };
    offset = body.offset;
  }
  throw new WithingsApiError(508, `measure.getmeas: pagination exceeded ${MAX_PAGES} pages`);
}
