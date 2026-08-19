# DEC-002 — Treat the local OS user as the single trust principal, and enforce the workspace boundary instead of per-record authorisation

_Decided 2026-08-19 · status: current_

The engine has **one principal**: whoever can read and write the store directory. There is
no user model, no roles, no per-record access control, and no authentication. Anyone who can
read `<workspace>/.claude/graph-engine/` can read everything in it.

The one boundary that **is** enforced is the **workspace stamp**. Every written record
carries the workspace root it was written under, together with how that root was determined.
A writer whose resolved root disagrees with the store's own root does not write into the
store — it writes to a rejected sidecar and logs a reason code. Reads never silently span
workspaces.

This is stated explicitly so that no later code assumes an authorisation layer exists.

## Why

The engine is a local library and CLI, with no network listener, no multi-tenancy and no
remote surface (operator decision, this session). Inventing a permission model for a
single-user local process produces the worst outcome available: code that looks like
authorisation, is never tested against an adversary, and is trusted as though it were.

The boundary that genuinely bites here is not *who* is asking but *which store answers*.
`memory/src/workspace.ts` records that six separate `.claude/memory` stores once existed
under this one repository, and `graph-engine/CLAUDE.md` carries the same hazard as a standing
rule: workspace resolution consults filesystem indicators before the environment variable, so
a working-directory change can silently swap which store is read and written. A context
engine that answers from the wrong project's store has leaked data across a boundary that
matters, without any attacker involved. That is the failure this decision defends against.

The pattern is taken from `memory/src/ledger.ts`, which stamps every row with its workspace
and diverts a disagreeing writer to `ledger-rejected.jsonl` rather than accepting the row.

Chosen on judgement about the deployment shape. No measurement was taken.

## What was rejected

- **A role or permission model on records.** Rejected: untestable against a real adversary in
  a single-user local process, and its presence would be read as protection.
- **Encrypting the store at rest with a key the engine manages.** Rejected: it moves the
  problem to key storage, which for a local CLI ends with the key beside the ciphertext. Disk
  encryption is the operating system's job and it already does it.
- **Trusting `process.cwd()` to identify the workspace.** Rejected by name: it is the exact
  mechanism that produced six stores under one repository.
- **Deferring the whole question to the Phase 4 security pass.** Rejected: bolting
  authorisation onto a system that assumed one trusted principal is a rebuild, not a patch,
  which is why this record exists in Phase 0 at all.

## What this constrains

- No code may assume a caller identity, and no record may carry an "owner" field.
- Every write path resolves the workspace explicitly and stamps the record. A write path that
  does not is a defect, not a shortcut.
- The store directory's filesystem permissions are the access control. The engine must not
  widen them, and must create the store directory without group or world write.
- Because reads are unrestricted, DEC-005's limits on *what is stored* are the only thing
  standing between the store and a disclosure. The two records are load-bearing together.

## How to reverse it

Adding real authorisation later means introducing a principal, threading it through every
read and write path, and deciding what an existing unowned record means — every record
written before the change has no owner. Assume a full phase plus a migration, and a second
decision record about the unowned backlog. Adding a *network* surface reverses this decision
implicitly and must not be done without replacing it.
