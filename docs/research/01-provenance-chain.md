# Research — Algorithm 1, the hash-chained provenance record

**Ran:** 2026-08-19, Phase 1 Task 1.1, after the port and before the design was fixed.
**Method:** built-in `WebSearch`. `../../../.mcp.json` declares `{"mcpServers": {}}`, so exa,
firecrawl and context7 do not exist here.

> **Evidence caveat.** Everything below came through a search-result summarisation layer, so
> it is **one hop from the source, not zero**. It is good enough to design from and not good
> enough to quote. No passage here is presented as a verbatim quotation, and any claim that
> leaves this repository must be spot-checked against the URL first.

## The question

Semantica's chain hashes raw field values, concatenated with no separator
(`semantica/semantica/provenance/integrity.py:74-116`). Three things were worth checking
before copying the shape: is a flat hash chain the right structure at all; is there a
standard for the canonical bytes; and can an append-only chain survive an erasure.

---

## 1. Canonical form — confirmed, and it has a name

The rule `DEC-006` had already fixed by reasoning — sort keys by UTF-16 code unit, strip
insignificant whitespace, normalise numbers — is the **JSON Canonicalization Scheme**,
standardised as **RFC 8785**. It exists for exactly this purpose: JSON is not deterministic,
because key order, number formatting and whitespace vary between serialisers, languages and
runtime versions, and a signature or hash over a non-deterministic encoding breaks validation
for reasons unrelated to tampering.

**Changed nothing about the design.** It gives the rule a specification to name and a
conformance target, which is worth more than an invented rule that happens to agree.

## 2. Structure — a flat chain is the right choice *here*, and the trigger to change is known

Crosby and Wallach's *Efficient Data Structures for Tamper-Evident Logging* (2009) introduced
the **history tree**: a Merkle structure over an append-only log. Certificate Transparency
adopted the shape in 2012. The advantage is proof size — a tree turns a linear traversal into
a logarithmic inclusion proof, and the figure repeatedly cited is a log of 80 million events
needing roughly 3 KB of proof.

**Decision: keep the flat chain.** The tree's advantage is *proving something to a party who
does not hold the log* — an inclusion proof, or a consistency proof between two published
versions. This engine has no such party: `DEC-002` fixes one local principal, no network
surface, and no remote verifier. Verification here is a full scan by the process that already
holds the whole log, and for that a chain and a tree cost the same. Buying logarithmic proofs
we never request, at the price of a materially more complex structure, is the wrong trade.

**The trigger that reverses this** is specific, so it can be recognised rather than argued:
the first time the engine must convince something that does not hold the log — a remote
verifier, a second machine syncing, or an auditor given a proof rather than the store — the
history tree earns its complexity, and this is a migration, not a tweak.

## 3. Erasure versus an append-only chain — this one changed the design

The real finding. The tension `DEC-004` created is a known, studied problem, and the
literature has converged on an answer that is **not** the two we already knew about.

Rejected by the sources as well as by us:

- **Chameleon-hash / redactable-chain constructions** rewrite history under a trapdoor key.
  They require centralised key governance, and the sources note they do not reach replicas
  that already copied the data.
- **Declaring erasure out of scope**, which is what `semantica/context/context_graph.py`'s
  `purge_node` does by scoping itself to one graph, and what `memory/src/facts.ts` does by
  never erasing at all.

The pattern the sources converge on instead: **keep the payload out of the hashed material
and commit to it instead.** Store a keyed or salted hash — a commitment — in the chain, and
keep the payload in a store you can actually clear. Then a redaction clears the payload and
appends the fact of the redaction, and because the row hashes cover *content digests* rather
than the payload itself, the chain stays verifiable after redaction. The summaries describe
this as letting erasure and an unbroken audit history coexist: the payload becomes
unrecoverable while the fact and outcome of every record remain provable. The salt is not
optional — an unsalted hash of low-entropy content is brute-forceable, so the guidance is
specifically *salted or keyed* commitments.

### What this changes in Algorithm 1

Semantica cannot purge without breaking its chain, because it hashes field values directly.
We hash a commitment instead:

```
contentDigest = SHA-256(salt ‖ canonicalJson(content))
digest        = SHA-256(canonicalJson(record minus digest, content, salt))
```

`contentDigest` is inside `digest`; `content` and `salt` are not. Purge deletes **both**
`content` and `salt` — deleting the salt is what makes the surviving `contentDigest`
non-invertible rather than merely inconvenient — and sets a purged marker. `digest`, `prev`
and `seq` are untouched, so the chain still verifies across a purged record.

The cost, stated plainly: after a purge, nobody can prove *what* the content was, only that
some content was committed to at that position and has since been removed. That is the
correct trade for an erasure request, and it is the whole point.

### And it makes verification four checks, not three

Splitting the payload out of the digest means the payload needs its own check, or editing
content in place would no longer be caught:

| # | Check | Reason code | Skipped when |
|---|---|---|---|
| 1 | `contentDigest` matches a re-computation over `salt ‖ content` | `content_tampered` | the record is purged — content is absent by design |
| 2 | `digest` matches a re-computation over the record's other fields | `digest_mismatch` | never |
| 3 | `prev` equals the predecessor's stored `digest` | `chain_break` | never |
| 4 | `seq` equals the predecessor's `seq` plus one | `sequence_gap` | never |

A purged record must still pass 2, 3 and 4. That is the property Task 1.3's acceptance turns
into a test.

## 4. Carried over from Semantica unchanged, because it was right

- **Link before hashing.** `manager.py:156-166` assigns `previous_checksum` *then* computes
  the checksum, so the link is inside the digest rather than beside it. A link stored outside
  the digest can be rewritten without detection.
- **Advance state from the entry's own stored fields, flagged or not.** `manager.py:1475-1479`
  does this explicitly so one corrupt row does not cascade into a spurious break for every
  row after it. The comment says so at the site.
- **Check the sequence as well as the link.** `manager.py:1432-1436` records why: two distinct
  rows could share a checksum, and a checksum-only check would then miss a gap the sequence
  check still catches.

## 5. Not carried over

Semantica excludes its primary key from the hash (`integrity.py:45-55`) because its versioning
archives a prior value under a new id, so hashing the id would turn a legitimate rename into a
permanent false chain break. We do not inherit the exclusion because we do not inherit the
cause: records here are immutable and a correction is a new record, so no id is ever
relabelled. Recorded because the reasoning is good and the next reader will wonder why we
diverged.

## Sources

One hop from source; spot-check before quoting.

- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/rfc8785/)
- [Crosby & Wallach, Efficient Data Structures for Tamper-Evident Logging](https://www.researchgate.net/publication/221260542_Efficient_Data_Structures_For_Tamper-Evident_Logging)
- [Transparent Logs for Skeptical Clients — research!rsc](https://research.swtch.com/tlog)
- [SoK: Cryptographic Erasure on Public Ledgers](https://eprint.iacr.org/2026/1109)
- [GDPR-Compliant Use of Blockchain for Secure Usage Logs](https://arxiv.org/pdf/2104.09971)
- [Redactable Blockchain — Leveraging Chameleon Hash Functions](https://monami.hs-mittweida.de/files/11867/Druckversion_Precht_paper.pdf)
