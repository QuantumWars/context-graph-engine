# Phase 4 — Stage 4: the security pass — 2026-08-19

**What closes this phase:** a threat model that names what this engine defends against and what it
does not, every boundary shown to validate, and a §T run against the **packaged artifact in a clean
environment** rather than the development tree.

Scope: `engine/docs/security/`, `engine/test/`, and whatever the pass proves is wrong.

```
⛔ HARD RULES

1. Read before write; cite file:line.
2. One PR per phase. The PR body pastes real output — a query result, a
   captured row, a screenshot, a terminal transcript. No evidence, no merge.
3. Tests assert positive outcomes on real artifacts. "No error" is not
   evidence, and neither is "tests pass".
4. No silent returns. Every guard logs a reason code.
5. Never fabricate. Unverifiable ⇒ write UNVERIFIED and the exact query or
   command that would settle it.
6. An assertion that fails three times ⇒ STOP and report. Do not keep trying.
```

## Stage rules, from `algorithm-first-development`

> Secrets, input validation at every boundary, authorisation on every path that touches data,
> dependency audit, error messages that do not leak internals.

Security-last is a good default and a bad absolute, and the four decisions that could not wait were
made in Phase 0 — `DEC-002` authorisation, `DEC-003` trust boundary, `DEC-004` secrets, `DEC-005`
what is stored. **This phase does not re-decide them. It checks whether the code kept them**, and
reports every place it did not.

Two things changed since those decisions were written, and both must be re-examined rather than
assumed still covered:

- **A query now mutates the store** (Phase 3.4). Reads append.
- **Two attacks are known to be undetectable** (Phase 3.2) — end-truncation and wholesale rewrite.

## Task 4.1 — Write the threat model

`engine/docs/security/threat-model.md`. Who the adversary is, what they can already do, what they
want, and for each: what stops them, or the plain statement that nothing does.

Anchor it to the four Phase 0 decisions rather than inventing a new frame. Every "mitigated" claim
must name the test or the code that mitigates it; every unmitigated one must say so in the same
table rather than in a footnote.

Acceptance: a table of at least eight threats, each with an adversary capability, an outcome, a
verdict of mitigated / partially mitigated / **not mitigated**, and a citation to a test or a
`file:line`. The two undetectable attacks from Phase 3 appear as **not mitigated**. No threat is
listed as mitigated on the strength of a claim that has no test behind it.

## Task 4.2 — Prove every boundary validates

`DEC-003` says validation happens **once, at the ingest boundary**, and that no stored string ever
selects a code path. Check it, do not assume it.

Enumerate every point where data enters the engine — CLI arguments, record content, record ids,
temporal strings, edge types, queries, and the log file itself — and for each, show the validation
and the reason code, or record that there is none.

Acceptance: a test that drives every enumerated entry point with hostile input and asserts a named
reason code rather than a crash or a silent accept. Specifically: content that contains what looks
like an instruction is stored and returned as **data**, never interpreted; no `eval`, no dynamic
dispatch on a stored string, proven by a search whose output is pasted; and an id or edge type that
is not in its closed set is refused.

## Task 4.3 — Dependency audit, secrets scan, and error hygiene

Three checks, each with real output.

The dependency tree, including what is actually shipped versus what is only used to build. A scan
for anything secret-shaped in the repository, with every hit triaged rather than counted. And every
error path the CLI can reach, checked for leaking an absolute path, a stack frame, or record content
into a message a user or a log will keep.

Acceptance: the full runtime dependency list pasted, with a statement of what each is trusted for;
every secret-shaped hit in the repo listed and explained; and a test proving a CLI error message
contains no stack frame and no record content. If an error message must contain a path, say why and
show the worst case.

## Task 4.4 — §T: run it on a clean machine

`verification-suite`'s rule — test the artifact you ship, not the one in your workspace. The
development tree has `node_modules`, a warm bun cache, a store that already exists, and environment
variables set by three phases of work. None of that is true for a user.

Acceptance: a §T checklist run against a **fresh clone into an empty directory**, with no
inherited environment: install, typecheck, suite, `--help`, and a full record → link → retract →
purge → verify session against a store the clean environment creates. Every result pasted. Any step
that needs something the clean environment lacks is reported as **not shipped**, not as a caveat.

## Task 4.5 — Close the build

The post-mortem: what the build actually cost, the characteristic failure across all four phases,
where time was wasted, what is still open, and the standing rules that come out of it.

Acceptance: at most ten rules, each traceable to a specific failure in a phase summary, and each one
moved into `engine/CLAUDE.md` rather than left in the post-mortem — a rule that stays in the
post-mortem stops applying the moment that document scrolls out of context.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, the clean-environment run pasted, and the work pushed as feature
branches on `QuantumWars/context-graph-engine`.
