# DEC-004 — Hold no secrets of our own, and treat a secret that reaches the store as an incident that purge exists to answer

_Decided 2026-08-19 · status: current_

The engine has **no credentials**. It opens no network connection, calls no model, and reads
no environment variable for an API key, token or password. There is nothing for it to store,
rotate or leak from its own configuration.

The real exposure runs the other way: **a secret arriving as content**. An agent reads a
tool result containing an API key and records it, and the key is now in an append-only,
hash-chained log that is designed to resist editing. Three rules follow:

1. **No field is ever designated for a secret.** There is no `token`, `apiKey` or
   `credential` field in any record kind. A schema field for a secret is an invitation.
2. **Purge is the designated remedy**, and its acceptance is written to match: after a purge
   the tombstone must contain no field value of the purged content. That test is the control.
3. **The store is never committed.** The store directory carries its own `.gitignore` from
   the moment it is created, per the monorepo constitution's standing rule that captured
   content is never committed.

The engine does not scan content for secrets and does not claim to detect them.

## Why

`memory/src/ledger.ts` already demonstrates the discipline this record generalises: it stores
a hash of the prompt text and its character count, and never the text itself. Confirm with:

```
command grep -n "textHash" memory/src/ledger.ts
```

The asymmetry matters. A secret in an ordinary log is deleted by truncating the log. A secret
in a hash-chained append-only log cannot be deleted without breaking the chain — which is
exactly the tension Task 1.3's research step is scoped to settle. Deciding in Phase 0 that
purge is the answer is what forces Task 1.3 to produce a real one rather than a note saying
erasure is out of scope.

Rejecting content scanning is a deliberate limit. A detector that catches most keys teaches
callers that the store is safe to put keys in, which is worse than no detector.

Chosen on judgement. No measurement was taken.

## What was rejected

- **Scanning content for secret-shaped strings and refusing or redacting them.** Rejected:
  partial detection produces false confidence, and redaction silently alters content that
  provenance claims is verbatim — which would make the hash chain attest to a lie.
- **Encrypting record content at rest.** Rejected for the reason in DEC-002: for a local CLI
  the key ends up beside the ciphertext, and the threat model does not include an attacker
  with disk access but not process access.
- **Reading credentials from the environment "for later use".** Rejected: the engine has no
  use for one, and an unused credential path is the cheapest possible way to leak one.
- **Treating a leaked secret as a Phase 4 concern.** Rejected: by Phase 4 the record format
  is fixed and the log is append-only, so the remedy must exist in the format from the start.

## What this constrains

- No record kind may gain a credential-shaped field without superseding this record.
- Purge must remove content from **every** persisted representation, not only the primary
  record. Any derived index that is persisted rather than rebuilt breaks this guarantee,
  which is the second reason Phase 2.1 rebuilds indexes on load rather than storing them.
- A leaked secret is still spent. Purge removes it from this store; it does not un-disclose
  it, and no document here may imply otherwise.
- The engine must never log record content at error level, where it would escape the store's
  own protections into a terminal transcript or a CI log.

## How to reverse it

If the engine ever gains a network surface or calls a model, it acquires a credential and
this record is superseded rather than amended — that change needs a key-storage decision, a
rotation story, and a redaction rule for logs. Adding secret scanning later is additive and
cheap, but must be paired with a statement of its false-negative rate, or it recreates the
false confidence rejected above.
