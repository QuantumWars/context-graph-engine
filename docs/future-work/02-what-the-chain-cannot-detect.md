# What the hash chain cannot detect

**Status: not built.** Both gaps below are real, both were found by Phase 3's adversarial suite,
and neither is closed. They are written here so a future session cannot mistake "the chain
verifies" for "the log is trustworthy".

**Tests that pin them:** `test/adversarial.test.ts`, the block titled *what this chain CANNOT
detect — stated, not hidden*. Those tests assert the **gap**, so they go red if it ever closes —
which is the correct direction: a closed gap should force this document to be rewritten.

---

## 1. Truncating whole records off the end

Drop the last N complete lines of `log.jsonl` and the file still verifies clean.

```
$ bun test test/adversarial.test.ts
✓ LIMITATION: truncating whole records off the END is not detected
```

The remaining records are internally perfect: `seq` runs 1…k with no gap, every `prev` matches
its predecessor's `digest`, every `contentDigest` recomputes. **Nothing in the file says how long
the file should be**, so a suffix truncation is indistinguishable from a store that was simply
never written to again.

This is not a bug in the implementation — it is what an unanchored hash chain is. A chain proves
*ordering and integrity of what is present*. It cannot prove *completeness*.

**Why it matters here specifically.** The engine's whole claim is that a record cannot be altered
undetectably. Truncation is not alteration, but it achieves the same end for an attacker whose
goal is to make a decision disappear: record the incriminating thing last, then cut the tail.

## 2. A wholesale rewrite by someone holding the code

```
✓ LIMITATION: a wholesale rewrite by someone holding the code is not detected
```

Anyone who can run this engine can delete `log.jsonl` and build a fresh one saying anything they
like. It will verify perfectly, because it is perfectly consistent — it is simply not true.

Detecting this needs an anchor **outside the file**, and the engine has none.

---

## The shared fix, and why it is not built yet

Both gaps have the same shape: the chain proves internal consistency, and nothing ties it to
anything an attacker does not control. The fix is an **anchor** — some fact about the log's head
held somewhere else. Three shapes, cheapest first:

| Approach | What it catches | Cost |
|---|---|---|
| **Head file with the last digest and count**, written on every append | truncation, if the head file is not also rewritten — so it only helps if the two live in different trust domains | trivial; helps least |
| **Signed head** — sign `(headDigest, count)` with a key the engine does not store | both, against an attacker without the key | needs a key lifecycle, which `DEC-004` currently says this engine has none of |
| **External witness** — publish the head digest somewhere append-only the attacker does not control (a second machine, a transparency log, a commit) | both, strongly | needs a network surface, which `DEC-002` says this engine does not have |

**Every one of them conflicts with a decision already made**, which is why none is a small change:

- A signed head needs a key. `DEC-004` says the engine holds no secrets, and the signing key would
  immediately become the most valuable secret in the system.
- An external witness needs a network. `DEC-002` fixes one local principal with no network surface,
  and adding one reopens the entire threat model.
- A head file alone is close to theatre: an attacker who can rewrite the log can rewrite the head
  file sitting beside it. It only helps when the two are separated — for example, the head
  committed to a git repository while the log is not.

## What would trigger doing it

The same trigger `DEC-007` already named for the Merkle history tree: **the first time something
that does not hold the log must be convinced of its consistency.** At that point the engine needs
an external verifier anyway, and the witness and the tree get built together — they are the same
piece of work.

Until then, the honest framing, which every document here must use:

> The chain proves that the records present have not been altered and are in the order they were
> written. It does not prove that all the records ever written are still present.

## What is built, and holds

Everything short of the two gaps above. `test/adversarial.test.ts` covers, each with a named reason
code and a proven failure: content edited in place, an attested field edited, two records' content
swapped, a record deleted, two reordered, a record replayed, a `prev` forged to a real earlier
digest, `seq` renumbered to close a gap after a deletion, the file truncated mid-line, a valid-JSON
non-record injected, and purge used as cover for a break elsewhere.

The renumbering case is worth reading if you ever wonder why the verifier checks both the link and
the sequence: renumbering defeats the sequence check completely, and the link is what survives to
catch it.
