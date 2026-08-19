# DEC-011 — Third-party code lives only in `mcp/`; `src/` stays dependency-free

_Decided 2026-08-19 · status: current_

`engine/src/` imports **nothing but `node:` builtins and its own modules**. That is unchanged and
enforced by a test that walks every tracked file under `src/`.

The MCP transport needs the protocol SDK and a schema validator. Those live in **`engine/mcp/`**,
which is the only directory permitted an external import. The dependency is declared in
`package.json` as a normal `dependency` — it genuinely ships — and the security test is amended to
assert two things rather than one:

1. `src/` has no external import. **Unchanged**, and still the load-bearing assertion.
2. `mcp/` is the **only** place one appears. New — so the boundary is enforced rather than
   remembered, and a third-party import appearing in `eval/`, `scripts/` or `test/` fails.

## Why

`docs/security/threat-model.md` threat 14 — supply-chain compromise via a dependency — is recorded
as **mitigated by construction**, because there is no third-party code to compromise. That is the
strongest security property in the project and it was free: nothing needed a library.

A transport does. Adding the SDK to the core would trade that property for a protocol, and the
trade would be invisible afterwards — the test asserting zero dependencies would simply be deleted
and nobody would revisit it.

Confining it means the property degrades **precisely**, and the threat model can say exactly how
far: the algorithms, the store, the chain and the retrieval path remain reviewable without trusting
anyone. Only the transport does not. That is a much narrower claim than "zero dependencies" and it
is still worth having, because the transport handles no records — it parses a request, calls a
function that was already tested, and serialises the result.

The bundle changes the shape of the risk without removing it: `bun build` inlines the SDK into a
single committed artifact, so what ships is pinned and reviewable rather than resolved at install
time. A test asserts the bundle is current with its source, because a committed build artifact that
has drifted from the code is a different program wearing the code's name.

## What was rejected

- **Add the SDK to `src/` and delete the zero-dependency assertion.** Rejected: it trades the
  project's strongest security property for a transport, and the deletion of the test is the part
  that makes it irreversible — nobody re-derives a property that no longer has a guard.
- **Write an MCP server with no SDK, speaking the protocol by hand.** Rejected: the protocol is a
  moving target, and a hand-rolled implementation of someone else's wire format is a maintenance
  burden that buys a purity claim rather than a security one. The SDK is the same one
  `project-graphx` already ships here.
- **Ship the MCP layer as a separate package.** Rejected *for now*: a second `package.json`, a
  second lockfile and a second release for one directory. The boundary is enforced by a test, which
  is cheaper and equally checkable. If the transport ever grows its own surface area, revisit —
  that is the trigger.
- **Vendor the SDK, as `DEC-010` did for the file lock.** Rejected: the lock was 148 lines of
  `node:fs/promises` with a stable contract. The SDK is large, evolving, and vendoring it would
  mean owning a fork of a protocol implementation. `DEC-010`'s reasoning does not generalise by
  size alone.

## What this constrains

- No file outside `engine/mcp/` may import a non-`node:` module. Checkable in one command, and the
  security test enforces it:

  ```
  command grep -rn "^import.*from '[^.]" engine/src engine/eval engine/scripts engine/test
  ```

- `engine/mcp/` must contain **no algorithm and no storage logic**. It parses, dispatches to code
  that already exists and is already tested, and serialises. A defect in the transport must not be
  able to produce a wrong record.
- The threat model's threat 14 is downgraded from "mitigated by construction" to "mitigated for the
  core; the transport carries a reviewable, pinned dependency." That row must be updated in the
  same change, not later.
- The committed bundle is an artifact, not a source of truth. A test asserts it matches its source.

## How to reverse it

Removing the MCP surface removes the dependency and restores the original claim — cheap, because
nothing in `src/` will have come to rely on it. Widening the boundary to let another directory take
a dependency is the change to resist: it is one line in a test, and the property it protects took no
effort to have and cannot be recovered once several directories depend on things.
