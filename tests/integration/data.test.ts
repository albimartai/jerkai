import { neon } from "@neondatabase/serverless";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// /data (app/data/page.tsx, relocated from app/status/page.tsx this slice,
// PRD §0.3/§1) is a Server Component that queries sync_runs directly and
// calls auth() for the signed-in session. auth() is mocked so the page's own
// logic runs against a real disposable Neon branch without the full
// Auth.js/session-cookie machinery; the page's async function is called and
// awaited directly (no Route Handler/JSX-tree renderer needed), then rendered
// with react-dom/server, the same pattern tests/unit/*-render.test.tsx already
// use for server-rendered pages.
//
// Prospective import (PRD §1): app/data/page.tsx does not exist yet — this
// resolves once the build agent performs the git mv from app/status/page.tsx.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

import Data from "@/app/data/page";
import { LocalTime } from "@/app/ui/local-time";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CI_DATABASE = "jerkai_ci_test";
const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset"); //gitleaks:allow — non-secret placeholder, same pattern as every other integration test file

async function renderStatusFor(userId: number): Promise<string> {
  authMock.mockResolvedValue({ user: { id: String(userId) } });
  const element = await Data();
  return renderToStaticMarkup(element);
}

async function renderStatusElementFor(userId: number) {
  authMock.mockResolvedValue({ user: { id: String(userId) } });
  return Data();
}

// renderToStaticMarkup never fires React effects, so LocalTime — a client
// component correctly gated behind useEffect (NFR-90) — always renders null
// under this harness, regardless of implementation correctness. Proving
// NFR-88 (server passes the raw instant through unmodified as a prop) means
// inspecting the JSX tree Status() returns directly, since LocalTime's
// content can never reach this harness's serialized HTML output.
type ReactElementLike = { type: unknown; props?: { iso?: unknown; children?: unknown } };

function isReactElementLike(node: unknown): node is ReactElementLike {
  return typeof node === "object" && node !== null && "type" in node;
}

function collectLocalTimeIsoProps(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectLocalTimeIsoProps);
  if (!isReactElementLike(node)) return [];
  const own = node.type === LocalTime && typeof node.props?.iso === "string" ? [node.props.iso] : [];
  return [...own, ...collectLocalTimeIsoProps(node.props?.children)];
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
});

beforeEach(async () => {
  // user_id has no ON DELETE cascade (OQ-3) — every child table across every
  // integration file is cleared defensively before users, since these tables
  // are shared across the whole test run (fileParallelism: false) and a
  // stray row left by any other integration file would otherwise block this
  // delete, even though this file only writes to sync_runs itself.
  await sql`delete from biometric_readings`;
  await sql`delete from manual_macro_entries`;
  await sql`delete from daily_targets`;
  await sql`delete from whoop_workouts`;
  await sql`delete from sync_runs`;
  await sql`delete from whoop_tokens`;
  await sql`delete from withings_tokens`;
  await sql`delete from users`;
});

afterEach(() => {
  authMock.mockReset();
  vi.unstubAllEnvs();
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Whoop Multi-Tenancy
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/status — AC-WT8: sync history scoped to the signed-in user", () => {
  it("AC-WT8: a signed-in user sees only their own sync history, never another connected user's", async () => {
    const [userA] = await sql`insert into users (email) values ('status-test-a@example.com') returning id`;
    const [userB] = await sql`insert into users (email) values ('status-test-b@example.com') returning id`;

    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('whoop', ${userA.id}, now(), now(), 'success', 5)
    `;
    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('fitdays', ${userB.id}, now(), now(), 'failure', 0)
    `;

    const htmlForA = await renderStatusFor(userA.id);
    expect(htmlForA).not.toMatch(/failure/i);

    const htmlForB = await renderStatusFor(userB.id);
    expect(htmlForB).toMatch(/failure/i);
  });

  it("AC-WT8 (bare case): a signed-in user with zero sync_runs rows of their own sees their own empty 'never' state for every source, even though another user has history", async () => {
    const [userA] = await sql`insert into users (email) values ('status-test-empty-a@example.com') returning id`;
    const [userB] = await sql`insert into users (email) values ('status-test-empty-b@example.com') returning id`;

    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('whoop', ${userB.id}, now(), now(), 'success', 3)
    `;

    const htmlForA = await renderStatusFor(userA.id);
    expect(htmlForA).not.toMatch(/failure/i);
    // Every ACTIVE_SYNC_SOURCES lane must read "never" for userA — an
    // unscoped query would leak userB's success date into one of them.
    // Count updated 2->3 (PRD-authorized exception to this block's own
    // DO-NOT-EDIT header, mirroring the precedent in
    // tests/integration/whoop-sync.test.ts's own retired-block comment):
    // the Withings Smart-Scale Integration PRD (§1, AC-WS13) adds
    // 'withings' to ACTIVE_SYNC_SOURCES, which is what makes this literal
    // count derive from the registry rather than an independent fact.
    expect((htmlForA.match(/never/g) ?? []).length).toBe(3);
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Nav Header Cleanup & Status Page Chrome
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/status — AC-D18: shared header chrome", () => {
  it("AC-D18: /status renders the same NavHeader as every other gated page, with neither Weekly nor Daily active", async () => {
    const [user] = await sql`insert into users (email) values ('status-header-test@example.com') returning id`;

    const html = await renderStatusFor(user.id);

    expect(html).toContain("JerkAI");

    // Content AND order (AC-D18's own language) — a scramble must fail this,
    // not just an absence, so each href's index must strictly increase.
    // PRD-authorized exception to this block's own DO-NOT-EDIT header
    // (Data Page Redesign & Connect, §0.3): last entry "/status" -> "/data",
    // the identical convention this file already used twice for AC-WT8/AC-ST1.
    const hrefs = ["/weekly", "/daily", "/settings/targets", "/log-meal", "/data"];
    const indices = hrefs.map((href) => html.indexOf(`href="${href}"`));
    for (const index of indices) {
      expect(index).toBeGreaterThan(-1);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }

    expect(html).not.toContain('aria-current="page"');
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Status Sync Times — Local Timezone Display
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/status — AC-ST1/AC-ST2/AC-ST3: local-timezone timestamp display", () => {
  it("AC-ST1 (bare case): a source with no successful sync still shows the literal 'never' text, unaffected by this slice's timezone change", async () => {
    const [user] = await sql`insert into users (email) values ('status-tz-bare@example.com') returning id`;

    const html = await renderStatusFor(user.id);

    // Every ACTIVE_SYNC_SOURCES lane has zero sync_runs rows for this fresh
    // user — "never" is not a timestamp and carries no timezone (§4.1).
    // Count updated 2->3 (PRD-authorized exception to this block's own
    // DO-NOT-EDIT header, same reasoning as the AC-WT8 block above): the
    // Withings Smart-Scale Integration PRD (§1, AC-WS13) adds 'withings' to
    // ACTIVE_SYNC_SOURCES.
    expect((html.match(/never/g) ?? []).length).toBe(3);
  });

  it("AC-ST2/NFR-88: a non-null 'Last successful sync' timestamp reaches the rendered output as a raw ISO instant, never formatted or timezone-converted on the server", async () => {
    const [user] = await sql`insert into users (email) values ('status-tz-success@example.com') returning id`;
    const knownInstant = new Date("2026-08-19T14:30:00.000Z");

    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('whoop', ${user.id}, ${knownInstant.toISOString()}, ${knownInstant.toISOString()}, 'success', 5)
    `;

    const element = await renderStatusElementFor(user.id);
    const html = renderToStaticMarkup(element);

    // NFR-88's ordered path (raw instant -> prop -> client formats) means the
    // server's own output must carry no server-baked "UTC" label...
    expect(html).not.toContain("UTC");

    // ...and LocalTime must have received the raw instant itself as a prop,
    // unformatted and machine-parseable as a real date — proof the server
    // stopped formatting rather than just dropped the label. LocalTime's own
    // rendered text is unreachable here (renderToStaticMarkup never fires the
    // mount effect NFR-90 requires), so this inspects the prop directly
    // rather than the DOM output.
    const isoValues = collectLocalTimeIsoProps(element);
    expect(isoValues.length).toBeGreaterThan(0);
    for (const iso of isoValues) {
      expect(iso).not.toContain("UTC");
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    }
  });

  it("AC-ST3/NFR-88: a non-null 'Last run' timestamp (failure/partial status) reaches the rendered output as a raw ISO instant too, by the same mechanism as the success timestamp", async () => {
    const [user] = await sql`insert into users (email) values ('status-tz-failure@example.com') returning id`;
    const knownInstant = new Date("2026-08-19T03:05:00.000Z");

    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('fitdays', ${user.id}, ${knownInstant.toISOString()}, ${knownInstant.toISOString()}, 'failure', 0)
    `;

    const element = await renderStatusElementFor(user.id);
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("UTC");
    const isoValues = collectLocalTimeIsoProps(element);
    expect(isoValues.length).toBeGreaterThan(0);
    for (const iso of isoValues) {
      expect(iso).not.toContain("UTC");
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    }
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Withings Smart-Scale Integration
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/status — AC-WS13: a connected user's own Withings sync history", () => {
  it("AC-WS13: a signed-in user with a connected Withings account sees their own Withings lane, achieved solely by ACTIVE_SYNC_SOURCES gaining 'withings' (no other change to this page)", async () => {
    const [user] = await sql`insert into users (email) values ('status-withings-test@example.com') returning id`;

    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('withings', ${user.id}, now(), now(), 'success', 3)
    `;

    const html = await renderStatusFor(user.id);
    expect(html).toMatch(/withings/i);
    expect(html).not.toMatch(/failure/i);
  });

  it("AC-WS13: a Withings sync failure for one user is never shown on another user's /status page", async () => {
    const [userA] = await sql`insert into users (email) values ('status-withings-a@example.com') returning id`;
    const [userB] = await sql`insert into users (email) values ('status-withings-b@example.com') returning id`;

    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('withings', ${userB.id}, now(), now(), 'failure', 0)
    `;

    const htmlForA = await renderStatusFor(userA.id);
    expect(htmlForA).not.toMatch(/failure/i);
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/data — AC-DS1/AC-DS4/AC-DS5: categorized card layout", () => {
  it("AC-DS1 (bare case): a non-primary user with no tokens and zero sync_runs sees both category headings, three 'Not connected' tags, and 'never' x3", async () => {
    const [user] = await sql`insert into users (email) values ('data-bare-case@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-bare-case-someone-else@example.com");

    const html = await renderStatusFor(user.id);

    expect(html).toContain(">Data<");
    expect(html).toContain("Scale");
    expect(html).toContain("Performance");
    expect((html.match(/Not connected/g) ?? []).length).toBe(3);
    expect((html.match(/never/g) ?? []).length).toBe(3);
  });

  it("AC-DS4: renders exactly two category headings, 'Scale' before 'Performance', with Fitdays then Withings inside Scale and Whoop inside Performance", async () => {
    const [user] = await sql`insert into users (email) values ('data-categories@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-categories-someone-else@example.com");

    const html = await renderStatusFor(user.id);

    expect((html.match(/Scale/g) ?? []).length).toBe(1);
    expect((html.match(/Performance/g) ?? []).length).toBe(1);

    const order = ["Scale", "Fitdays", "Withings", "Performance", "Whoop"].map((needle) =>
      html.indexOf(needle),
    );
    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("AC-DS5: each source card shows its method label — 'Apple Health' for Fitdays, 'OAuth' for Whoop and for Withings", async () => {
    const [user] = await sql`insert into users (email) values ('data-method-label@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-method-label-someone-else@example.com");

    const html = await renderStatusFor(user.id);

    expect(html).toContain("Apple Health");
    expect((html.match(/OAuth/g) ?? []).length).toBe(2);
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/data — AC-DS3: nav link renamed Status -> Data", () => {
  it("AC-DS3: the resolution-adjacent link that used to read 'Status' now reads exactly 'Data' with href=/data, not 'Status'/'/status'", async () => {
    const [user] = await sql`insert into users (email) values ('data-nav-rename@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-nav-rename-someone-else@example.com");

    const html = await renderStatusFor(user.id);

    expect(html).toContain('href="/data"');
    expect(html).toContain(">Data<");
    expect(html).not.toContain('href="/status"');
    expect(html).not.toContain(">Status<");
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/data — AC-DS6/AC-DS7/AC-DS8/AC-DS9: Whoop/Withings connected-state and Connect actions", () => {
  it("AC-DS6 (bare/not-connected): a user with no whoop_tokens row sees a Connect anchor with href=/api/whoop/connect", async () => {
    const [user] = await sql`insert into users (email) values ('data-whoop-bare@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-whoop-bare-someone-else@example.com");

    const html = await renderStatusFor(user.id);

    expect(html).toMatch(/<a[^>]*href="\/api\/whoop\/connect"/);
  });

  it("AC-DS6 (bare/not-connected, Withings): a user with no withings_tokens row sees a Connect anchor with href=/api/withings/connect", async () => {
    const [user] = await sql`insert into users (email) values ('data-withings-bare@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-withings-bare-someone-else@example.com");

    const html = await renderStatusFor(user.id);

    expect(html).toMatch(/<a[^>]*href="\/api\/withings\/connect"/);
  });

  it("AC-DS7 (connected): a user with a whoop_tokens row sees a 'Connected' tag and no Connect action for that card", async () => {
    const [user] = await sql`insert into users (email) values ('data-whoop-connected@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-whoop-connected-someone-else@example.com");
    await sql`
      insert into whoop_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, updated_at)
      values (${user.id}, 'enc', 'enc', now() + interval '1 hour', now())
    `;

    const html = await renderStatusFor(user.id);

    expect(html).not.toContain('href="/api/whoop/connect"');
    expect(html).toMatch(/Connected/);
  });

  it("AC-DS8 (cross-user isolation): user A's whoop_tokens row never leaks a 'Connected' state onto user B's own /data render", async () => {
    const [userA] = await sql`insert into users (email) values ('data-whoop-a@example.com') returning id`;
    const [userB] = await sql`insert into users (email) values ('data-whoop-b@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-whoop-isolation-someone-else@example.com");
    await sql`
      insert into whoop_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, updated_at)
      values (${userA.id}, 'enc', 'enc', now() + interval '1 hour', now())
    `;

    const htmlForB = await renderStatusFor(userB.id);

    expect(htmlForB).toMatch(/<a[^>]*href="\/api\/whoop\/connect"/);
  });

  it("AC-DS9 (connected + failed last run compose correctly): a whoop_tokens row plus a failed sync_runs row render both the 'Connected' tag and the existing unconditional failure line together", async () => {
    const [user] = await sql`insert into users (email) values ('data-whoop-connected-failed@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "data-whoop-connected-failed-someone-else@example.com");
    await sql`
      insert into whoop_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, updated_at)
      values (${user.id}, 'enc', 'enc', now() + interval '1 hour', now())
    `;
    await sql`
      insert into sync_runs (source, user_id, started_at, finished_at, status, rows_synced)
      values ('whoop', ${user.id}, now(), now(), 'failure', 0)
    `;

    const html = await renderStatusFor(user.id);

    expect(html).not.toContain('href="/api/whoop/connect"');
    expect(html).toMatch(/Connected/);
    expect(html).toMatch(/Last run: failure at/);
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Data Page Redesign & Connect
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("/data — AC-DS10/AC-DS11/AC-DS12: Fitdays connected-state via primary-user identity", () => {
  it("AC-DS10 (bare case): a user whose id does not equal resolvePrimaryUserId()'s resolved id sees a 'Not connected' tag and a Connect button (not a link) for Fitdays", async () => {
    const primaryEmail = "data-fitdays-primary-a@example.com";
    await sql`insert into users (email) values (${primaryEmail})`;
    const [other] = await sql`insert into users (email) values ('data-fitdays-other-a@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", primaryEmail);

    const html = await renderStatusFor(other.id);

    expect(html).toContain("Not connected");
    // Fitdays' Connect action is a client-side button, not a navigable href
    // (AC-DS10) — a <button> element existing at all is the distinguishing
    // signal, since Whoop/Withings's own not-connected Connect actions are
    // real <a href> anchors (AC-DS6), never a <button>.
    expect(html).toMatch(/<button[^>]*>[^<]*Connect[^<]*<\/button>/);
  });

  it("AC-DS11: a user whose id equals resolvePrimaryUserId()'s resolved id sees a 'Connected' tag and no Connect action for Fitdays", async () => {
    const primaryEmail = "data-fitdays-primary-b@example.com";
    const [primary] = await sql`insert into users (email) values (${primaryEmail}) returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", primaryEmail);

    const html = await renderStatusFor(primary.id);

    expect(html).toMatch(/Connected/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Connect[^<]*<\/button>/);
  });

  it("AC-DS12 (fail-closed): when resolvePrimaryUserId() throws (PRIMARY_USER_EMAIL unset), the Fitdays card reads 'Not connected' and the rest of the page still renders — no 500", async () => {
    const [user] = await sql`insert into users (email) values ('data-fitdays-failclosed@example.com') returning id`;
    vi.stubEnv("PRIMARY_USER_EMAIL", "");

    const html = await renderStatusFor(user.id);

    expect(html).toContain("JerkAI");
    expect(html).toContain("Scale");
    expect(html).toContain("Performance");
    expect(html).toContain("Not connected");
  });
});
