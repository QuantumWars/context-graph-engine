# Erasure versus the hash chain — how it was solved, what it costs, what is still open

**Status:** the core is **built and tested** in Phase 1. The open items below are *not* built,
and each says so.
**Decision of record:** `engine/build/DEC-007-content-commitment.md`.
**Research it came from:** `engine/docs/research/01-provenance-chain.md`.
**See it run:** `bun --cwd engine demo.ts purge`

---

## 1. The problem, stated properly

We committed early (`DEC-004`) that if a secret reaches the store — an API key pasted into a
tool result and recorded as context — **purge is the remedy**. Delete it.

We also committed (`DEC-007`, originally `DEC-006`) that the store is an **append-only,
hash-chained log**, so tampering is detectable.

These two commitments fight each other, and the fight is not a detail.

A hash chain works by making every record's fingerprint depend on the record before it:

```
digest(record N) = hash( content(N) + digest(record N-1) )
```

That is what makes tampering visible. Change any record's content and its own fingerprint no
longer matches. Delete a record and the record after it points at a fingerprint that no longer
exists.

**Which is exactly what a legitimate deletion looks like.** If the content is inside the hash,
then erasing it is indistinguishable from an attacker erasing it — because it *is* the same
operation. The chain cannot tell "the owner asked us to forget this" from "someone tampered
with the log".

So you appear to get a choice between two bad options:

| Option | Consequence |
|---|---|
| Keep the chain intact | You cannot ever delete anything. A leaked key stays in the log forever. |
| Allow deletion | The chain breaks, and afterwards it proves nothing at all. |

## 2. What the two systems we studied do

Neither solves it. Both **avoid** it, honestly, and it is worth knowing that before reading the
solution as obvious.

- **Semantica** (`semantica/semantica/context/context_graph.py`) scopes purge to a single graph
  and says so in the docstring — "one step of an erasure workflow, not the whole of it"
  (`:1734`). Its provenance chain hashes field values directly
  (`provenance/integrity.py:74-116`), so a purge inside the chained store would break it. The
  two subsystems simply do not meet.
- **`memory/`** (`memory/src/facts.ts`) never erases at all. Its header states the rule
  plainly: nothing is deleted, only invalidated. A fact marked `invalidated` still holds its
  content.

Both are defensible. Neither was available to us, because `DEC-004` had already promised purge
would work.

## 3. The solution: hash a commitment, not the content

The literature on cryptographic erasure over append-only ledgers has converged on an answer
that is neither of the two options above. **Keep the payload out of the hashed material and
commit to it instead.**

Concretely, every record carries **two** hashes instead of one:

```
contentDigest = SHA-256( salt ‖ canonicalJson(content) )     ← the commitment
digest        = SHA-256( canonicalJson({ ...record, contentDigest }) )   ← the chain link
```

The critical structural fact:

- `contentDigest` **is inside** `digest`.
- `content` and `salt` **are not**.

So the chain attests to *the commitment*, never to the payload. And a purge can therefore
delete the payload without touching anything the chain depends on:

```
purge(record):
    record.content = null
    record.salt    = null
    # digest, prev, seq, contentDigest — all untouched
```

The chain still verifies. Every record before it still links. Every record after it still
links. The purged record still proves it was there, at that position, in that order.

### The salt is not decoration

Deleting the salt is the half that makes this real rather than theatrical.

Without a salt, `contentDigest` is just `hash(content)`. If the content had low entropy — a
boolean, a status flag, a short name, a yes/no decision — an attacker holding the surviving
digest can simply hash every candidate until one matches. The commitment would leak exactly
what it committed to.

With a per-record random salt that is deleted alongside the content, the attacker must guess
the content **and** a random salt simultaneously. That is not feasible. The commitment becomes
genuinely one-way at the moment of purge.

This is why `content` and `salt` are always removed **together**. Removing one but not the
other is not a partial purge; it is a corrupt record, and the verifier reports it as
`content_tampered` rather than accepting it:

```ts
if (e.salt === null || e.content === null) {
  // Half-purged: one of the pair removed. Never legitimate; they go together.
```

### Verification becomes four checks, not three

Splitting the payload out of the chain link means the payload needs a check of its own —
otherwise editing content in place would no longer be caught by anything.

| # | Check | Reason code | Skipped when |
|---|---|---|---|
| 1 | `contentDigest` re-computes from `salt ‖ content` | `content_tampered` | the record is purged |
| 2 | `digest` re-computes from the record's other fields | `digest_mismatch` | never |
| 3 | `prev` equals the predecessor's stored `digest` | `chain_break` | never |
| 4 | `seq` equals the predecessor's `seq` plus one | `sequence_gap` | never |

**A purged record skips only check 1.** It must still pass 2, 3 and 4. That is deliberate and
load-bearing: if a purge exempted a record from the chain checks, then "purge" would become a
way to hide tampering, and the erasure feature would have destroyed the integrity feature it
was supposed to coexist with.

There is a test for exactly that — *"a purge still cannot hide a real break elsewhere"* — and
the demo shows it:

```
$ bun --cwd engine demo.ts purge
── 4. And a purge cannot be used to hide a real break ──
  ✗ chain INVALID — 1 problem(s) across 4 entries
      digest_mismatch at seq 4 (d4)
```

## 4. What it costs, stated plainly

**After a purge, nobody can prove what the content was.** Not the owner, not an auditor, not a
court. What survives is: something was committed at this position, in this order, and has since
been removed — plus a tombstone recording when and why.

That is the correct trade for an erasure request. It is also irreversible, and no document or
code in this repository may imply a purged record can be recovered or re-verified.

**The chain is a detection control, not a prevention control.** It tells you the log was
altered. It cannot stop anyone with write access from altering it. `DEC-002` is explicit that
filesystem permissions are the actual access control.

## 5. What is still open

None of the following is built. Each is here so a future session does not mistake the solved
part for the whole problem.

### 5.1 Downstream propagation — the biggest gap

GDPR Art. 17 reaches **every copy** of the data, not the primary record, and a controller who
made data public must take reasonable steps to inform other holders, who then become
independently responsible.

This store can clear its own copy. It cannot reach a copy something else made — a backup, a
transcript, an exported report, another machine that synced.

**What is built:** every tombstone carries `scope: 'this-store-only'`, so nothing here can
claim more than it did. That is honesty, not a solution.

**What is not built:** any notification mechanism, any registry of downstream holders, any
export manifest recording what left the store and where it went. Until that exists, a purge is
one step of an erasure workflow, and whoever runs it is responsible for the rest.

**Where to start:** an export ledger. If nothing can leave the store without a row recording
where it went, the notification list writes itself. That is cheaper to add now than to
reconstruct later, and it should probably happen before the engine gains any export feature at
all.

### 5.2 Backups and copies of the log file itself

A purge rewrites the live `log.jsonl`. A backup taken before the purge still holds the content,
and the engine does not know that backup exists.

**Not solved, and not solvable by the engine alone.** It is an operational matter: retention
policy on backups, and re-running purges against restored snapshots. It belongs in whatever
runbook covers restoring this store, and there is no such runbook yet.

### 5.3 Crypto-shredding as an alternative

The rejected-but-real alternative from `DEC-007`: encrypt each record's content with a
per-record key and, to erase, destroy the key. The content stays physically in place but
becomes unreadable.

**Why it was not chosen:** it achieves the same outcome as a deleted salt while adding a key
lifecycle — where keys live, how they rotate, what happens when one is lost — and `DEC-004`
says this engine holds no secrets. A deleted salt gets non-invertibility without any of that.

**When it would win:** if content must remain physically present — an append-only medium that
genuinely cannot be rewritten, or a regulatory requirement that the record not be modified —
then shredding is the only option, because it never rewrites anything. Revisit if the store
ever lands on write-once storage.

### 5.4 The Merkle history tree

`DEC-007` keeps a flat hash chain and names the trigger for changing: **the first time
something that does not hold the log must be convinced of its consistency** — a remote
verifier, a second machine syncing, an auditor given a proof rather than the store.

A flat chain verifies by full scan, which is fine for a process that holds the whole log.
Crosby & Wallach's history tree (SIGIR 2009; adopted by Certificate Transparency) gives
logarithmic inclusion and consistency proofs instead.

**It does not help with erasure.** Worth stating, because the two topics get conflated: a
Merkle tree has exactly the same deletion problem, and the commitment design above is what
solves it in either structure. Migrating is a structure change plus a proof API, and it
invalidates every digest already written.

### 5.5 Purge at scale

Purging one record is `O(1)`. Purging *everything matching a predicate* — "erase everything
about this person" — means scanning the whole log, and every purge rewrites the file.

**Not built.** There is no query-then-purge path, no batching, and no measurement of how long a
rewrite takes on a realistic log. `DEC-007` notes the rebuild-on-load cost is unmeasured too.
Both need the same thing first: a log big enough to measure against.

### 5.6 The salt lives in memory while the process runs

Between reading a record and purging it, the salt and content are in process memory, and may be
in a swap file or a crash dump. The engine does nothing about this.

**Realistically out of scope** given `DEC-002`'s threat model, which does not include an
attacker with memory access to the running process. Recorded so the claim is bounded rather
than absolute.

## 6. How to check any of this yourself

```
bun --cwd engine demo.ts purge     # erasure with the chain surviving
bun --cwd engine demo.ts chain     # what tampering looks like when it is NOT authorised
bun --cwd engine demo.ts retract   # the other operation — "no longer true", content kept
bun --cwd engine test test/chain.test.ts
```

The tests that pin this behaviour, by name:

- `a purged entry still verifies, and the chain stays valid`
- `a purge leaves the attested fields untouched, which is why the chain survives`
- `a purge still cannot hide a real break elsewhere`
- `purging destroys the salt, so the commitment cannot be brute-forced back`
- `half a purge — salt removed but content kept — is content_tampered, not purged`
- `the serialised tombstone contains NO field value of the purged content`

Each was seen red against a named source change before it was claimed. The transcripts are in
`engine/build/phase-1-summary.md`.
