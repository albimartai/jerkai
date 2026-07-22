import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// AC-PD5/NFR-51 (docs/prd/public-demo.md): the demo route module tree must
// not import lib/db.ts or any module that opens a database connection. This
// is the machine-checked safety case for the whole slice — it must fail
// loudly if the demo is ever wired to the DB (verified manually during
// build: a throwaway `import "@/lib/db"` added to a demo page made this test
// fail, then removed once confirmed — see the PR description).
//
// Uses the TypeScript compiler API (already a devDependency, no new
// dependency needed) rather than a whole-program source-file walk: a plain
// `ts.createProgram` source-file list would include lib/db.ts even for a
// *type-only* import several hops away (TypeScript must still resolve the
// whole imported file to type-check it), which is why lib/dashboard/data.ts
// and lib/targets.ts were split into DB-free type/logic modules
// (lib/dashboard/types.ts, lib/target-resolution.ts) — see those files'
// header comments. With that split in place, a plain program-wide check is
// accurate: nothing in the demo's real (non-type-only-triggered) graph
// resolves to a DB-touching module.

const ROOT = path.resolve(__dirname, "../..");
const DEMO_ROOTS = [
  path.join(ROOT, "app/demo/weekly/page.tsx"),
  path.join(ROOT, "app/demo/daily/page.tsx"),
  path.join(ROOT, "app/demo/layout.tsx"),
];

const BANNED_MODULE_SUBSTRINGS = ["lib/db.ts", "@neondatabase/serverless", "@auth/neon-adapter"];

function importGraphFiles(roots: string[]): string[] {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({ rootNames: roots, options: parsed.options });
  return program.getSourceFiles().map((sf) => sf.fileName);
}

describe("demo route isolation (AC-PD5, NFR-51)", () => {
  it("imports no DB-connecting module anywhere in its transitive graph", () => {
    const files = importGraphFiles(DEMO_ROOTS);
    const hits = files.filter((fileName) =>
      BANNED_MODULE_SUBSTRINGS.some((banned) => fileName.includes(banned)),
    );
    expect(hits).toEqual([]);
  });

  it("sanity check: the walk actually reaches a non-trivial graph (guards against a no-op check)", () => {
    const files = importGraphFiles(DEMO_ROOTS);
    expect(files.length).toBeGreaterThan(50);
  });
});
