import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phase 0 Task 0.1. This is the toolchain guard, and it is deliberately not a
// smoke test: `expect(true).toBe(true)` would pass against a deleted tsconfig.
// Each assertion below names a source change that turns it red — loosening a
// strict flag, or rewriting `check` so it stops running one of its two halves.

const ROOT = join(import.meta.dir, "..");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  type?: string;
  scripts?: Record<string, string>;
};
const tsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")) as {
  compilerOptions?: Record<string, unknown>;
};

describe("toolchain", () => {
  test("check runs both halves — typecheck and the suite", () => {
    const check = pkg.scripts?.check;
    expect(check).toBeDefined();
    // Red if `check` is rewritten to run only one of the two.
    expect(check).toContain("typecheck");
    expect(check).toContain("bun test");
  });

  test("the package is ESM, as every first-party package here is", () => {
    expect(pkg.type).toBe("module");
  });

  test("the strict flags memory/ relies on are all on", () => {
    const opts = tsconfig.compilerOptions ?? {};
    // Anti-vacuity: prove we parsed a real config before asserting over it,
    // so a renamed or empty tsconfig fails loudly instead of asserting nothing.
    expect(Object.keys(opts).length).toBeGreaterThan(5);

    // Each of these is red if the corresponding flag is dropped or set false.
    const required = [
      "strict",
      "noUncheckedIndexedAccess",
      "noImplicitOverride",
      "noUnusedLocals",
      "noUnusedParameters",
      "exactOptionalPropertyTypes",
      "verbatimModuleSyntax",
    ];
    for (const flag of required) {
      expect({ flag, value: opts[flag] }).toEqual({ flag, value: true });
    }
  });
});

describe('no source file contains a NUL byte', () => {
  // Found 2026-08-20 while mutating eval/extract-metrics.ts: a mutation that should have turned a
  // test red turned nothing red, and the reason was that the pattern it searched for was not in the
  // file — two spaces inside a template literal were NUL bytes. `grep` reports such a file as
  // "Binary file matches" and shows nothing, `file` calls it data, and the suite passes throughout,
  // because NUL is a perfectly valid character in a JS string. A second NUL was then found in
  // src/extract/link.ts, shipped in Phase 10.
  //
  // This is the hazard the monorepo constitution already documents for the memory store — records
  // are NUL-joined, so text tools classify them as binary and skip them silently. It had never been
  // checked for source.
  const files = [...new Bun.Glob('**/*.ts').scanSync({ cwd: join(import.meta.dir, '..'), absolute: true })]
    .filter((f) => !f.includes('node_modules'));

  test('the sweep really did find files to check', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  test('every .ts file is free of NUL bytes', () => {
    const dirty = files
      .filter((f) => readFileSync(f).includes(0))
      .map((f) => f.slice(f.lastIndexOf('/engine/') + 1));
    expect(dirty).toEqual([]);
  });

  test('and the check can see a NUL when one is present', () => {
    // Anti-vacuity: proving the detector works without corrupting a real file.
    expect(Buffer.from('a\x00b', 'binary').includes(0)).toBe(true);
    expect(Buffer.from('ab', 'binary').includes(0)).toBe(false);
  });
});
