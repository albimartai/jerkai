import { neon } from "@neondatabase/serverless";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// /status (app/status/page.tsx) is a Server Component that queries sync_runs
// directly and calls auth() for the signed-in session — no existing test file
// covers it (confirmed this session, PRD §6). auth() is mocked so the page's
// own logic runs against a real disposable Neon branch without the full
// Auth.js/session-cookie machinery; the page's async function is called and
// awaited directly (no Route Handler/JSX-tree renderer needed), then rendered
// with react-dom/server, the same pattern tests/unit/*-render.test.tsx already
// use for server-rendered pages.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

import Status from "@/app/status/page";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CI_DATABASE = "jerkai_ci_test";
const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset"); //gitleaks:allow — non-secret placeholder, same pattern as every other integration test file

async function renderStatusFor(userId: number): Promise<string> {
  authMock.mockResolvedValue({ user: { id: String(userId) } });
  const element = await Status();
  return renderToStaticMarkup(element);
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
  await sql`delete from users`;
});

afterEach(() => {
  authMock.mockReset();
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
    // Both ACTIVE_SYNC_SOURCES lanes ('whoop', 'fitdays') must read "never" for
    // userA — an unscoped query would leak userB's success date into one of them.
    expect((htmlForA.match(/never/g) ?? []).length).toBe(2);
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
    const hrefs = ["/weekly", "/daily", "/settings/targets", "/log-meal", "/status"];
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
