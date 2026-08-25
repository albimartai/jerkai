import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import RootLayout from "@/app/layout";

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Footer Privacy Policy Link
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */

// Prerequisite check (§6): app/layout.tsx calls Geist(...)/Geist_Mono(...) from
// next/font/google at module scope. Outside next build/next dev that module ships
// empty (verified live: node_modules/next/font/google/index.js), so Geist/Geist_Mono
// are not callable under plain Vitest without this mock. vi.mock calls are hoisted
// above imports by Vitest, so this applies before RootLayout above is evaluated
// (same pattern as tests/unit/nav-header-variants.test.tsx's next/link mock).
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
}));

const ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(ROOT, "app");
const LAYOUT_FILE = path.join(APP_DIR, "layout.tsx");

describe("root layout footer (AC-FT1, AC-FT2)", () => {
  it('AC-FT1: renders a footer with a "Privacy Policy" link to /privacy', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <div>placeholder page content</div>
      </RootLayout>,
    );
    expect(markup).toContain("<footer");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain("Privacy Policy");
  });

  it("AC-FT2: the same footer renders regardless of what children is passed", () => {
    const markupA = renderToStaticMarkup(
      <RootLayout>
        <div>weekly ledger placeholder</div>
      </RootLayout>,
    );
    const markupB = renderToStaticMarkup(
      <RootLayout>
        <p>signin placeholder</p>
      </RootLayout>,
    );
    for (const markup of [markupA, markupB]) {
      expect(markup).toContain("<footer");
      expect(markup).toContain('href="/privacy"');
      expect(markup).toContain("Privacy Policy");
    }
  });
});

// Enumerated from the filesystem (mirroring tests/unit/demo-isolation.test.ts's
// demoRoots() construction-based enumeration) rather than hardcoded, so a future
// route added under app/ is covered by construction, not by remembering to list it.
function appRoots(dir: string = APP_DIR): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return appRoots(full);
      return /^(page|layout)\.tsx$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

const OTHER_APP_ROOTS = appRoots().filter((file) => file !== LAYOUT_FILE);

describe("no per-page footer duplication (NFR-92)", () => {
  it("NFR-92: no page.tsx or layout.tsx other than app/layout.tsx renders its own footer or privacy link", () => {
    // Checks for href="/privacy" rather than the bare "Privacy Policy" string:
    // app/privacy/page.tsx's own <h1>Privacy Policy</h1> legitimately contains
    // that phrase, and a substring match on it would false-positive against the
    // very page this slice's footer links to.
    const offenders = OTHER_APP_ROOTS.filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return source.includes('href="/privacy"') || /<footer[\s>]/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("sanity check: the walk actually reaches a non-trivial set of routes (guards against a no-op check)", () => {
    expect(OTHER_APP_ROOTS.length).toBeGreaterThan(5);
  });
});

// Parses app/layout.tsx's own import specifiers directly (not a full ts.Program,
// per §1/§6: extending tests/unit/demo-isolation.test.ts's Program-based walk is
// out of this slice's file budget) — mirrors that file's collectOwnImportSpecifiers
// approach against a single source file instead of a whole program.
function collectImportSpecifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specifiers: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

const BANNED_SPECIFIERS = new Set([
  "@/lib/db",
  "@neondatabase/serverless",
  "@auth/neon-adapter",
  "pg",
  "pg-pool",
  "pg-native",
  "pg-cursor",
  "@/auth",
]);

describe("no new I/O in the root layout (NFR-93)", () => {
  it("NFR-93: app/layout.tsx imports no DB client and no auth() — stays a plain, session-free Server Component", () => {
    const hits = collectImportSpecifiers(LAYOUT_FILE).filter((specifier) => BANNED_SPECIFIERS.has(specifier));
    expect(hits).toEqual([]);
  });
});
