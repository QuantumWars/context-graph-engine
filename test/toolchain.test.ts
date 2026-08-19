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
