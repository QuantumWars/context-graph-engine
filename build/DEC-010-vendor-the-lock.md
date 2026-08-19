# DEC-010 — Vendor the file lock instead of importing it, because a standalone repository has no sibling to import from

_Decided 2026-08-19 · status: current_

Supersedes `DEC-001`. Every verdict in that register still stands except one.

`memory/src/lock.ts` is **copied into `engine/src/store/lock.ts`**, verbatim, with a provenance
header naming where it came from and what vendoring costs. The engine imports nothing outside its
own repository. Every other line of the reuse register is unchanged: RRF reimplemented, the edge
store's pattern taken but not its code, `graph-traverse`'s anchoring idea taken, `facts.ts`'s
id-excludes-mutable-fields practice taken, `ledger.ts`'s three-way outcome shape taken, `embed.ts`
ignored.

## Why

`DEC-001` chose the import on two measurements that were both correct: `lock.ts` reaches only
`node:fs/promises`, so it drags none of the sibling package's heavy tree, and concurrency
correctness is expensive to re-derive. That reasoning held for as long as the engine lived inside
the workspace containing that sibling.

It stopped holding the moment the engine became its own repository. The import is
`../../../../memory/src/lock` — four levels up — which resolves **only at one exact filesystem
depth**. Measured, in a worktree of the same commit at a different path:

```
src/store/log.ts(18,30): error TS2307: Cannot find module '../../../../memory/src/lock'
error: Cannot find module '../../../../memory/src/lock' from
  '/Users/doniel/code/Personal/graph-engine-worktrees/store/src/store/log.ts'
```

Four of eleven feature branches failed typecheck for this and this alone. A clone of this
repository anywhere other than its original parent directory does not build.

**`DEC-001` anticipated a reversal and underestimated its trigger.** It wrote: *"If `memory/`
restructures `src/`, this breaks at typecheck rather than at runtime — which is the reason to keep
it to one site."* The trigger was not a restructure. It was **relocation**, which is a far more
ordinary event than restructuring — and it is exactly what publishing does.

Keeping it to one site is what made the fix cheap. `DEC-001` estimated reversal at "roughly 150
lines with its own tests — cheap, perhaps an hour". It was 148 lines and one import statement.

## What was rejected

- **Keep the relative import and document that the repository only builds in one place.**
  Rejected: a repository that cannot be cloned is not a repository, and a caveat in a README is
  not a substitute for working code.
- **Publish the engine inside the monorepo instead, so the sibling is always present.** Rejected
  by the operator this session — the engine is its own product with its own repository. Recorded
  because it is the alternative that keeps `DEC-001` intact.
- **Extract the lock into a shared published package both consume.** Rejected for now, for the
  same reason `DEC-009` rejected extracting RRF: a third package, its own lockfile and release, for
  148 lines with two consumers. The trigger is the same — a third consumer.
- **Reimplement the lock rather than copying it.** Rejected: the original states its own
  limitations precisely — advisory not mandatory, POSIX-only in practice, and the stale-lock trade
  with its reasoning for a 30s default. A reimplementation would either reproduce that reasoning or
  quietly lose it, and losing it is how a caller ends up believing the lock is stronger than it is.
- **Depend on the sibling package by version from a registry.** Rejected: it is `private: true`
  and unpublished, and publishing it to make this import work would be the tail wagging the dog.

## What this constrains

- **No import in `engine/src/` may leave the repository.** Checkable in one command, and it should
  stay checkable:

  ```
  command grep -rn "^import.*\.\./\.\./" engine/src/
  ```

- The vendored copy does **not** receive upstream fixes. That is stated in its header rather than
  left to be discovered. If a defect is found in either copy, both must be checked.
- The copy is verbatim apart from the added header. Editing it makes it a fork rather than a
  vendored copy, and a fork needs its own record.
- Every feature branch must typecheck and pass its tests **in a worktree at an arbitrary path**,
  not only in the original directory. That is the check that caught this, and it is the check that
  keeps it caught.

## How to reverse it

Going back to an import means the engine stops being independently clonable, so it is only
reversible by also reversing the decision to publish it separately. Moving to a shared package is
additive: publish the lock, have both consumers depend on it, and delete both copies — assume a day,
most of it spent re-proving the live sibling package rather than moving the code.
