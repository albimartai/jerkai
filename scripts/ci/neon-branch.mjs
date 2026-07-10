// Disposable Neon branch lifecycle for integration tests (CI and local).
//
//   node scripts/ci/neon-branch.mjs create          → creates ci-* branch off dev
//   node scripts/ci/neon-branch.mjs delete <id>     → deletes it (ci-* branches only)
//
// Requires NEON_API_KEY and NEON_PROJECT_ID in the environment. `create`
// branches from `dev` (copy-on-write — the parent is never modified), then
// creates a fresh EMPTY database on the new branch so migrations run from
// nothing rather than no-op against the schema inherited from dev. Outputs
// branch_id and database_url via $GITHUB_OUTPUT when set (Actions), or as
// shell export lines otherwise (local runs).

import { appendFileSync } from "node:fs";

const API_BASE = "https://console.neon.tech/api/v2";
const PARENT_BRANCH = "dev";
const CI_DATABASE = "jerkai_ci_test";
const BRANCH_PREFIX = "ci-";

const apiKey = process.env.NEON_API_KEY;
const projectId = process.env.NEON_PROJECT_ID;
if (!apiKey || !projectId) {
  console.error("NEON_API_KEY and NEON_PROJECT_ID must be set");
  process.exit(1);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}/projects/${projectId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Neon API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function waitForOperations(operations = []) {
  for (const op of operations) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const { operation } = await api(`/operations/${op.id}`);
      if (operation.status === "finished") break;
      if (["failed", "error", "cancelled", "skipped"].includes(operation.status)) {
        throw new Error(`Neon operation ${operation.action} ${operation.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

function emit(branchId, databaseUrl) {
  // Mask the connection string (it embeds the role password) before it can
  // appear in any Actions log line.
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${databaseUrl}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `branch_id=${branchId}\ndatabase_url=${databaseUrl}\n`,
    );
    console.error(`created Neon branch ${branchId} (outputs written)`);
  } else {
    console.error(`created Neon branch ${branchId}`);
    console.log(`export NEON_CI_BRANCH_ID=${branchId}`);
    console.log(`export DATABASE_URL='${databaseUrl}'`);
  }
}

async function create() {
  const { branches } = await api("/branches");
  const parent = branches.find((b) => b.name === PARENT_BRANCH);
  if (!parent) {
    throw new Error(`parent branch '${PARENT_BRANCH}' not found in project ${projectId}`);
  }

  const name = `${BRANCH_PREFIX}${process.env.GITHUB_RUN_ID ?? Date.now()}-${
    process.env.GITHUB_RUN_ATTEMPT ?? "local"
  }`;
  const created = await api("/branches", {
    method: "POST",
    body: {
      branch: { parent_id: parent.id, name },
      endpoints: [{ type: "read_write" }],
    },
  });
  await waitForOperations(created.operations);
  const branchId = created.branch.id;

  try {
    // A fresh database so migrations apply from a truly empty state — the
    // branch itself inherits dev's schema, which would make `migrate up` a
    // no-op and prove nothing about the migration files.
    const { roles } = await api(`/branches/${branchId}/roles`);
    const owner = roles.find((r) => !r.protected) ?? roles[0];
    if (!owner) throw new Error(`no role found on branch ${branchId}`);
    const db = await api(`/branches/${branchId}/databases`, {
      method: "POST",
      body: { database: { name: CI_DATABASE, owner_name: owner.name } },
    });
    await waitForOperations(db.operations);

    const { uri } = await api(
      `/connection_uri?branch_id=${branchId}&database_name=${CI_DATABASE}&role_name=${encodeURIComponent(owner.name)}`,
    );
    emit(branchId, uri);
  } catch (err) {
    // Don't leak a half-configured branch if setup fails after creation.
    await api(`/branches/${branchId}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }
}

async function destroy(branchId) {
  if (!branchId) throw new Error("usage: neon-branch.mjs delete <branch_id>");
  const { branch } = await api(`/branches/${branchId}`);
  // Hard guard: this script only ever deletes branches it created.
  if (!branch.name.startsWith(BRANCH_PREFIX) || branch.protected || branch.default) {
    throw new Error(`refusing to delete branch '${branch.name}' (${branchId}) — not a ${BRANCH_PREFIX}* branch`);
  }
  const deleted = await api(`/branches/${branchId}`, { method: "DELETE" });
  await waitForOperations(deleted.operations);
  console.error(`deleted Neon branch ${branch.name} (${branchId})`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "create") await create();
  else if (command === "delete") await destroy(arg);
  else {
    console.error("usage: neon-branch.mjs <create|delete <branch_id>>");
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
