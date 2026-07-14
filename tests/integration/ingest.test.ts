import { neon } from "@neondatabase/serverless";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Resend must never be hit from tests — mock the alert module and assert on
// the mock instead. The alert module's own behavior is unit tested in
// lib/alerts.test.ts with a mocked fetch.
const sendSyncFailureAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/alerts", () => ({ sendSyncFailureAlert }));

import { POST } from "@/app/api/ingest/health/route";

// End-to-end over a real, disposable Neon branch: the route handler is
// invoked directly (no HTTP server), but every SQL statement runs against
// real Postgres — the layer where Session 2's actual bug lived, and the one
// a hand-written database mock can't regression-test.

const SECRET = "integration-test-shared-secret";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Guard against ever running destructive test SQL on a persistent branch:
// scripts/ci/neon-branch.mjs provisions the throwaway database under this
// name, and dev/prod use Neon's default database name instead. Vitest does
// not load .env.local, so a bare local `npm run test:integration` fails here
// rather than silently hitting the dev branch.
const CI_DATABASE = "jerkai_ci_test";

const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset");

function ingestRequest(body: string, apiKey?: string): Request {
  return new Request("http://localhost/api/ingest/health", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey === undefined ? {} : { "x-api-key": apiKey }),
    },
    body,
  });
}

const point = (date: string, qty: number) => ({ date: `${date} 07:30:00 -0500`, qty });

// One data point per currently-mapped metric, mirroring Health Auto Export's
// payload shape.
const fullPayload = {
  data: {
    metrics: [
      { name: "weight_body_mass", units: "lb", data: [point("2026-07-09", 180.2)] },
      { name: "body_fat_percentage", units: "%", data: [point("2026-07-09", 18.3)] },
      { name: "body_mass_index", units: "count", data: [point("2026-07-09", 24.9)] },
      { name: "lean_body_mass", units: "lb", data: [point("2026-07-09", 147.1)] },
      { name: "heart_rate_variability", units: "ms", data: [point("2026-07-09", 62)] },
      { name: "resting_heart_rate", units: "bpm", data: [point("2026-07-09", 51)] },
      { name: "sleep_analysis", units: "hr", data: [{ date: "2026-07-09", totalSleep: 7.4 }] },
      { name: "step_count", units: "count", data: [point("2026-07-09", 10432)] },
    ],
  },
};

const expectedRows = [
  { source: "apple_health", metric: "step_count", value: "10432" },
  { source: "fitdays", metric: "bmi", value: "24.9" },
  { source: "fitdays", metric: "body_fat_pct", value: "18.3" },
  { source: "fitdays", metric: "lean_body_mass", value: "147.1" },
  { source: "fitdays", metric: "weight", value: "180.2" },
  { source: "whoop", metric: "hrv", value: "62" },
  { source: "whoop", metric: "rhr", value: "51" },
  { source: "whoop", metric: "sleep_duration", value: "7.4" },
];

async function readingRows() {
  return sql`
    select source, metric, value::text as value
    from biometric_readings
    order by source, metric
  `;
}

async function syncRuns() {
  return sql`
    select source, status, rows_synced, error_message
    from sync_runs
    order by source
  `;
}

beforeAll(() => {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Integration tests need a disposable Neon branch — see scripts/ci/neon-branch.mjs.",
    );
  }
  if (!new URL(DATABASE_URL).pathname.includes(CI_DATABASE)) {
    throw new Error(
      `refusing to run: DATABASE_URL does not point at the '${CI_DATABASE}' database. ` +
        "These tests delete rows between cases and must never target the persistent dev/prod branches.",
    );
  }
  vi.stubEnv("HEALTH_EXPORT_SHARED_SECRET", SECRET);
});

beforeEach(async () => {
  await sql`delete from biometric_readings`;
  await sql`delete from sync_runs`;
});

afterEach(() => {
  sendSyncFailureAlert.mockClear();
});

describe("POST /api/ingest/health — happy path", () => {
  it("lands correctly-tagged rows for every mapped metric and logs success runs", async () => {
    const res = await POST(ingestRequest(JSON.stringify(fullPayload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.sources).toEqual({
      apple_health: { status: "success", rowsSynced: 1, errorMessage: null },
      fitdays: { status: "success", rowsSynced: 4, errorMessage: null },
      whoop: { status: "success", rowsSynced: 3, errorMessage: null },
    });
    expect(body.ignoredMetrics).toEqual([]);

    expect(await readingRows()).toEqual(expectedRows);
    expect(await syncRuns()).toEqual([
      { source: "apple_health", status: "success", rows_synced: 1, error_message: null },
      { source: "fitdays", status: "success", rows_synced: 4, error_message: null },
      { source: "whoop", status: "success", rows_synced: 3, error_message: null },
    ]);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
  });

  it("is idempotent: re-sending the identical payload produces zero duplicate rows", async () => {
    await POST(ingestRequest(JSON.stringify(fullPayload), SECRET));
    const res = await POST(ingestRequest(JSON.stringify(fullPayload), SECRET));

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("success");
    // Same 8 rows, not 16 — the upsert keyed on (source, metric, reading_date)
    // absorbed the re-send Health Auto Export performs on every scheduled run.
    expect(await readingRows()).toEqual(expectedRows);
    // Both runs are logged: sync_runs is an append-only run log, not deduped.
    const runs = await syncRuns();
    expect(runs).toHaveLength(6);
    expect(runs.every((run) => run.status === "success")).toBe(true);
  });

  it("reports unmapped metrics as ignored while landing the mapped ones", async () => {
    const payload = {
      data: {
        metrics: [
          { name: "active_energy", units: "kcal", data: [point("2026-07-09", 550)] },
          { name: "weight_body_mass", units: "lb", data: [point("2026-07-09", 180.2)] },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.ignoredMetrics).toEqual(["active_energy"]);
    expect(await readingRows()).toEqual([
      { source: "fitdays", metric: "weight", value: "180.2" },
    ]);
  });
});

describe("POST /api/ingest/health — apple_health (step count) lane", () => {
  it("gives a step-count-only payload its own sync_runs row and no other lanes", async () => {
    const payload = {
      data: {
        metrics: [{ name: "step_count", units: "count", data: [point("2026-07-09", 10432)] }],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.sources).toEqual({
      apple_health: { status: "success", rowsSynced: 1, errorMessage: null },
    });

    // The widened check constraint accepted the row, and /status's per-source
    // aggregation now has an independent apple_health lane to read.
    expect(await readingRows()).toEqual([
      { source: "apple_health", metric: "step_count", value: "10432" },
    ]);
    expect(await syncRuns()).toEqual([
      { source: "apple_health", status: "success", rows_synced: 1, error_message: null },
    ]);
    expect(sendSyncFailureAlert).not.toHaveBeenCalled();
  });

  it("sums multiple same-day step samples into one row and preserves them in raw_payload", async () => {
    const payload = {
      data: {
        metrics: [
          {
            name: "step_count",
            units: "count",
            data: [
              { date: "2026-07-09 08:00:00 -0500", qty: 512.25 },
              { date: "2026-07-09 12:30:00 -0500", qty: 3011 },
              { date: "2026-07-09 22:15:00 -0500", qty: 96.5 },
            ],
          },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));

    expect(res.status).toBe(200);
    const rows = await sql`
      select value::text as value, raw_payload from biometric_readings
      where source = 'apple_health' and metric = 'step_count'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("3619.75");
    expect(rows[0].raw_payload.points).toHaveLength(3);
  });

  it("stays idempotent when the identical payload is re-sent (no double-counting)", async () => {
    const payload = {
      data: {
        metrics: [
          {
            name: "step_count",
            units: "count",
            data: [
              { date: "2026-07-09 08:00:00 -0500", qty: 500 },
              { date: "2026-07-09 12:30:00 -0500", qty: 3000 },
            ],
          },
        ],
      },
    };
    await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));

    expect(res.status).toBe(200);
    const rows = await sql`
      select value::text as value from biometric_readings
      where source = 'apple_health' and metric = 'step_count'
    `;
    expect(rows).toEqual([{ value: "3500" }]);
  });

  it("accumulates a day split across two Since-Last-Sync calls without losing either half", async () => {
    const call = (points: { date: string; qty: number }[]) => ({
      data: { metrics: [{ name: "step_count", units: "count", data: points }] },
    });
    // Morning half arrives on the first sync, afternoon half on the next —
    // Health Auto Export's documented incremental behavior.
    await POST(
      ingestRequest(
        JSON.stringify(call([{ date: "2026-07-09 08:00:00 -0500", qty: 4000 }])),
        SECRET,
      ),
    );
    const res = await POST(
      ingestRequest(
        JSON.stringify(
          call([
            { date: "2026-07-09 15:00:00 -0500", qty: 5000 },
            { date: "2026-07-09 21:00:00 -0500", qty: 1500 },
          ]),
        ),
        SECRET,
      ),
    );

    expect(res.status).toBe(200);
    const rows = await sql`
      select value::text as value, raw_payload from biometric_readings
      where source = 'apple_health' and metric = 'step_count'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("10500");
    expect(rows[0].raw_payload.points.map((p: { date: string }) => p.date)).toEqual([
      "2026-07-09 08:00:00 -0500",
      "2026-07-09 15:00:00 -0500",
      "2026-07-09 21:00:00 -0500",
    ]);
  });

  it("heals a legacy pre-fix row (single-sample raw_payload) on re-export without double-counting", async () => {
    // Production's pre-fix step rows hold one interval sample as raw_payload
    // and its qty as value. A re-export of that day includes the same sample
    // timestamp, so the merge replaces it in place and the corrected total
    // overwrites the wrong value.
    await sql`
      insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
      values ('apple_health', 'step_count', '2026-07-09', 12.5, 'count',
              '{"qty": 12.5, "date": "2026-07-09 22:15:00 -0500", "source": "Albi iPhone"}'::jsonb)
    `;
    const payload = {
      data: {
        metrics: [
          {
            name: "step_count",
            units: "count",
            data: [
              { date: "2026-07-09 08:00:00 -0500", qty: 4000 },
              { date: "2026-07-09 22:15:00 -0500", qty: 12.5, source: "Albi iPhone" },
            ],
          },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));

    expect(res.status).toBe(200);
    const rows = await sql`
      select value::text as value, raw_payload from biometric_readings
      where source = 'apple_health' and metric = 'step_count'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("4012.5");
    expect(rows[0].raw_payload.points).toHaveLength(2);
  });

  it("degrades to partial on mixed valid/invalid step points, landing the valid sum", async () => {
    const payload = {
      data: {
        metrics: [
          {
            name: "step_count",
            units: "count",
            data: [
              { date: "2026-07-09 08:00:00 -0500", qty: 4000 },
              { date: "2026-07-09 09:00:00 -0500" }, // no qty
              { date: "2026-07-09 10:00:00 -0500", qty: 250 },
            ],
          },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(body.sources.apple_health.status).toBe("partial");
    const rows = await sql`
      select value::text as value from biometric_readings
      where source = 'apple_health' and metric = 'step_count'
    `;
    expect(rows).toEqual([{ value: "4250" }]);
    expect(await syncRuns()).toEqual([
      {
        source: "apple_health",
        status: "partial",
        rows_synced: 1,
        error_message: "step_count (2026-07-09): data point has no numeric value",
      },
    ]);
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });

  it("attributes a bad step-count point to the apple_health lane, not whoop", async () => {
    const payload = {
      data: {
        metrics: [
          { name: "step_count", units: "count", data: [{ date: "2026-07-09 07:30:00 -0500" }] },
          { name: "resting_heart_rate", units: "bpm", data: [point("2026-07-09", 51)] },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(body.sources.apple_health.status).toBe("failure");
    expect(await syncRuns()).toEqual([
      {
        source: "apple_health",
        status: "failure",
        rows_synced: 0,
        error_message: "step_count (2026-07-09): data point has no numeric value",
      },
      { source: "whoop", status: "success", rows_synced: 1, error_message: null },
    ]);
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ingest/health — rejected requests", () => {
  it("returns 401 on a bad api key, logs failure runs for every source lane, and alerts", async () => {
    const res = await POST(ingestRequest(JSON.stringify(fullPayload), "wrong-key"));

    expect(res.status).toBe(401);
    expect(await readingRows()).toEqual([]);
    expect(await syncRuns()).toEqual(
      ["apple_health", "fitdays", "whoop"].map((source) => ({
        source,
        status: "failure",
        rows_synced: 0,
        error_message: "unauthorized: missing or invalid x-api-key header",
      })),
    );
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });

  it("returns 401 on a missing api key header", async () => {
    const res = await POST(ingestRequest(JSON.stringify(fullPayload)));
    expect(res.status).toBe(401);
    expect(await readingRows()).toEqual([]);
  });

  it("returns 400 on a non-JSON body, logs failure runs, and alerts", async () => {
    const res = await POST(ingestRequest("{definitely not json", SECRET));

    expect(res.status).toBe(400);
    expect(await readingRows()).toEqual([]);
    const runs = await syncRuns();
    expect(runs.map((run) => [run.source, run.status])).toEqual([
      ["apple_health", "failure"],
      ["fitdays", "failure"],
      ["whoop", "failure"],
    ]);
    expect(runs[0].error_message).toContain("body is not valid JSON");
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when every data point is unusable, and alerts", async () => {
    const payload = {
      data: {
        metrics: [{ name: "weight_body_mass", units: "lb", data: [{ qty: 180 }] }],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no parseable date");
    expect(await readingRows()).toEqual([]);
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ingest/health — partial success", () => {
  it("lands the good metric, reports partial, and logs per-source outcomes", async () => {
    const payload = {
      data: {
        metrics: [
          { name: "weight_body_mass", units: "lb", data: [point("2026-07-09", 180.2)] },
          // Missing qty → mapping error attributed to whoop's lane.
          { name: "heart_rate_variability", units: "ms", data: [{ date: "2026-07-09 07:30:00 -0500" }] },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(body.sources.fitdays).toEqual({
      status: "success",
      rowsSynced: 1,
      errorMessage: null,
    });
    expect(body.sources.whoop.status).toBe("failure");

    // The good row still landed despite the bad metric in the same payload.
    expect(await readingRows()).toEqual([
      { source: "fitdays", metric: "weight", value: "180.2" },
    ]);
    expect(await syncRuns()).toEqual([
      { source: "fitdays", status: "success", rows_synced: 1, error_message: null },
      {
        source: "whoop",
        status: "failure",
        rows_synced: 0,
        error_message: "heart_rate_variability (2026-07-09): data point has no numeric value",
      },
    ]);
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });

  it("degrades one source to partial when it has both a good and a bad point", async () => {
    const payload = {
      data: {
        metrics: [
          {
            name: "weight_body_mass",
            units: "lb",
            data: [point("2026-07-09", 180.2), { date: "bad-date", qty: 179 }],
          },
        ],
      },
    };
    const res = await POST(ingestRequest(JSON.stringify(payload), SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(body.sources.fitdays.status).toBe("partial");
    expect(await readingRows()).toEqual([
      { source: "fitdays", metric: "weight", value: "180.2" },
    ]);
    expect(sendSyncFailureAlert).toHaveBeenCalledTimes(1);
  });
});
