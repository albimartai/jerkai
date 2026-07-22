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
// Completeness note: this guard bans a fixed, explicit list of module
// specifiers/paths (below), not "any module that opens a database
// connection" in full generality — it can't detect a future DB client this
// list doesn't name. A newly added DB client package needs a corresponding
// entry here; this list doesn't derive from package.json.
//
// Checked two ways, deliberately not via a single whole-program
// `program.getSourceFiles()` path substring scan:
//
// 1. Resolved local files (BANNED_PATH_SUBSTRINGS): lib/db.ts is a normal,
//    fully-typed project file, so it always resolves into the program —
//    checking its resolved path is reliable.
// 2. Literal import specifiers our own files write (BANNED_SPECIFIERS,
//    collectImportSpecifiers below): this project uses
//    `moduleResolution: "bundler"`, under which importing an UNTYPED
//    package (e.g. `pg`, a real devDependency here via node-pg-migrate,
//    with no bundled types and no @types/pg installed) resolves to an
//    implicit `any` with *zero* source file added to the program and *zero*
//    diagnostic — confirmed directly (`import "pg"` compiles clean under
//    this repo's tsconfig, and the module never appears in
//    `program.getSourceFiles()`). A path-substring scan over resolved
//    source files is therefore blind to it; `tsc --noEmit` is too. Because
//    the import specifier is a plain string literal in the *importing*
//    file's own AST regardless of whether TypeScript could resolve the
//    target, walking each of our own (non-node_modules) source files' own
//    import/require specifiers catches it directly — this is how the `pg`
//    gap was found and closed (verified below to actually fail on a
//    throwaway `import "pg"`, then removed once confirmed).
//
// TypeScript's module resolution otherwise still requires a split between
// lib/dashboard/data.ts/lib/targets.ts's DB-fetching code and their pure
// types (lib/dashboard/types.ts, lib/target-resolution.ts) — a *type-only*
// import of a typed module still pulls the whole file (and its value
// imports) into the program to resolve the type. See those files' header
// comments.

const ROOT = path.resolve(__dirname, "../..");
const DEMO_ROOTS = [
  path.join(ROOT, "app/demo/weekly/page.tsx"),
  path.join(ROOT, "app/demo/daily/page.tsx"),
  path.join(ROOT, "app/demo/layout.tsx"),
];

const BANNED_PATH_SUBSTRINGS = ["lib/db.ts"];

const BANNED_SPECIFIERS = new Set([
  "@/lib/db",
  "@neondatabase/serverless",
  "@auth/neon-adapter",
  "pg",
  "pg-pool",
  "pg-native",
  "pg-cursor",
]);

function buildProgram(roots: string[]): ts.Program {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  return ts.createProgram({ rootNames: roots, options: parsed.options });
}

// Every import/re-export/require specifier string written in our own
// (non-node_modules) source files reachable from `program`'s roots — robust
// to specifiers TypeScript can't resolve to a source file (see the file
// header comment).
function collectOwnImportSpecifiers(program: ts.Program): { specifier: string; from: string }[] {
  const found: { specifier: string; from: string }[] = [];

  function visit(sourceFile: ts.SourceFile, node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, from: sourceFile.fileName });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ specifier: (node.arguments[0] as ts.StringLiteral).text, from: sourceFile.fileName });
    }
    ts.forEachChild(node, (child) => visit(sourceFile, child));
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("/node_modules/")) continue; // only our own import statements matter
    visit(sourceFile, sourceFile);
  }
  return found;
}

describe("demo route isolation (AC-PD5, NFR-51)", () => {
  it("imports no DB-connecting module anywhere in its transitive graph", () => {
    const program = buildProgram(DEMO_ROOTS);

    const pathHits = program
      .getSourceFiles()
      .map((sf) => sf.fileName)
      .filter((fileName) => BANNED_PATH_SUBSTRINGS.some((banned) => fileName.includes(banned)));

    const specifierHits = collectOwnImportSpecifiers(program).filter(({ specifier }) =>
      BANNED_SPECIFIERS.has(specifier),
    );

    expect({ pathHits, specifierHits }).toEqual({ pathHits: [], specifierHits: [] });
  });

  it("sanity check: the walk actually reaches a non-trivial graph (guards against a no-op check)", () => {
    const program = buildProgram(DEMO_ROOTS);
    expect(program.getSourceFiles().length).toBeGreaterThan(50);
  });
});
