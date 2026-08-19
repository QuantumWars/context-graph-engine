# DEC-007 — Hash a salted commitment to the content, not the content itself, so a purge and an unbroken chain can coexist

_Decided 2026-08-19 · status: current_

Supersedes `DEC-006`. Everything that record decided about the store format and the canonical
form still holds and is restated here; the one clause that changed is which fields the digest
covers.

**Format.** One append-only file, `log.jsonl`, UTF-8, one JSON object per line, `\n`
terminated. It is the only source of truth. Records are discriminated by `kind`. Every derived
view — node table, adjacency index, decision lookup, lexical index — is rebuilt on load and
**never persisted beside the log**.

**Canonical form.** Object keys sorted ascending by UTF-16 code unit; no insignificant
whitespace; UTF-8 output; `null` written explicitly and an absent field omitted entirely, so
omission and `null` are distinct and must survive a write and a reload unchanged. This is the
**JSON Canonicalization Scheme, RFC 8785**, which Task 1.1's research identified as the
standard for precisely this rule.

**The change: two digests, not one.**

```
contentDigest = SHA-256(salt ‖ canonicalJson(content))
digest        = SHA-256(canonicalJson(record minus digest, content, salt))
```

`contentDigest` is **inside** `digest`. `content` and `salt` are **not**. Chain fields `seq`
(contiguous from 1) and `prev` (the predecessor's `digest`, `null` for the first) are inside
`digest`, assigned before it is computed.

**Purge deletes `content` and `salt` together** and sets a purged marker. `digest`, `prev`,
`seq` and `contentDigest` are untouched, so the chain still verifies across a purged record.

**Verification is four checks, in this order**, each with a reason code, and state advances
from each record's own stored fields whether or not it was flagged, so one corrupt record does
not cascade:

| # | Check | Reason code | Skipped when |
|---|---|---|---|
| 1 | `contentDigest` re-computes from `salt ‖ content` | `content_tampered` | the record is purged |
| 2 | `digest` re-computes from the record's other fields | `digest_mismatch` | never |
| 3 | `prev` equals the predecessor's stored `digest` | `chain_break` | never |
| 4 | `seq` equals the predecessor's `seq` plus one | `sequence_gap` | never |

## Why

`DEC-004` names purge as the remedy for a secret that reaches the store. `DEC-006` hashed the
content directly, which makes that remedy impossible: erasing the content breaks the digest of
the record holding it and the link of every record after it. The two records were in conflict
and one of them had to move.

Task 1.1's research found this is a studied problem with a converged answer, and it is neither
of the two options already in front of us. The pattern is to keep the payload out of the hashed
material and commit to it: store a salted or keyed hash in the chain, keep the payload where it
can actually be cleared, and let a redaction clear the payload and append the fact of it.
Because the row hashes cover content digests rather than payloads, the chain stays verifiable
after redaction. Full sources and the evidence caveat: `engine/docs/research/01-provenance-chain.md`.

**The salt is load-bearing, not decoration.** An unsalted hash of low-entropy content — a
boolean, a short name, a flag — is brute-forceable, so the surviving `contentDigest` would leak
what it committed to. Deleting the salt along with the content is what makes the commitment
non-invertible rather than merely inconvenient. A purge that kept the salt would be theatre.

**The cost, stated plainly.** After a purge, nobody can prove *what* the content was — only
that some content was committed to at that position and has since been removed. That is the
correct trade for an erasure request and it is the entire point.

Chosen from the literature, cross-checked against `DEC-004`'s obligation. No measurement was
taken; the research is qualitative.

## What was rejected

- **Hashing the content directly**, which is `DEC-006` and Semantica's
  `integrity.py:74-116`. Rejected: it makes erasure and chain integrity mutually exclusive, and
  `DEC-004` has already committed to erasure being possible.
- **Chameleon-hash and redactable-chain constructions**, which rewrite history under a trapdoor
  key. Rejected: they need centralised key governance, the trapdoor becomes the most valuable
  secret in a system that `DEC-004` says holds no secrets, and the sources note they do not
  reach replicas that already copied the data.
- **A Merkle history tree instead of a flat chain** (Crosby & Wallach 2009; adopted by
  Certificate Transparency in 2012). Rejected **for now, with a named trigger**: its advantage
  is logarithmic proofs to a party that does not hold the log, and `DEC-002` fixes one local
  principal with no network surface and no remote verifier. Verification here is a full scan by
  the process that already holds the log, where a chain and a tree cost the same. The trigger
  that reverses this is specific: the first time something that does not hold the log must be
  convinced of its consistency.
- **Declaring erasure out of scope**, as `context_graph.py`'s `purge_node` does by scoping
  itself to one graph and as `memory/src/facts.ts` does by never erasing. Rejected: `DEC-004`
  depends on purge working, and a store that cannot forget is a liability for a component that
  records everything an agent read.
- **Encrypting content and throwing away the key** — crypto-shredding. Not rejected on merit;
  it is a real alternative and is strictly more work for the same outcome here, because a
  deleted salt already makes the commitment non-invertible without introducing a key lifecycle.
  Revisit if content must remain in place while becoming unreadable.
- **Keeping the salt after a purge** so the digest stays checkable against a known value.
  Rejected: that is what makes the commitment invertible for low-entropy content.

## What this constrains

- `content` and `salt` are the only two fields excluded from `digest`, and they are excluded
  **together**. Excluding a third field without superseding this record breaks the guarantee
  that every non-payload field is attested.
- Every record carries a salt from creation. There is no unsalted path, because a record
  written without one could never be purged safely.
- Verification must run check 1 before check 2, and must skip only check 1 for a purged record.
  A verifier that skips check 2, 3 or 4 for a purged record would let a purge hide a real break.
- A purged record is permanently unprovable as to content. No code or document may claim a
  purged record's content can be recovered or re-verified.
- The canonical serialiser is one function with one test suite, and every digest goes through
  it. A second serialisation path is a defect.

## How to reverse it

Changing the canonical form or the hashed field set invalidates every digest ever written, so
it is a migration rather than a change: re-hash the whole log under the new rule and record
that the old chain cannot be verified against the new one. Moving to a Merkle history tree is
triggered by the remote-verifier case named above and is a structure change plus a proof API,
not a tweak. Returning to hashing content directly would require withdrawing `DEC-004` first,
since the two cannot both hold.
