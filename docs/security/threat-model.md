# Threat model

**Written:** 2026-08-19, Phase 4. Anchored to the four decisions made in Phase 0 rather than to a
new frame — `DEC-002` authorisation, `DEC-003` trust boundary, `DEC-004` secrets, `DEC-005` what is
stored. This phase checked whether the code kept them. It did not re-decide them.

**Every "mitigated" below names the test or the `file:line` that mitigates it.** A claim with
nothing behind it is not a mitigation, and there are none here. The unmitigated rows are in the
same table as the rest, not in a footnote.

## The adversary

`DEC-002` fixes **one principal: the local OS user**. There is no authentication, no network
listener, and no remote surface. So the realistic adversary is not a stranger — it is one of:

- **Someone with write access to the store file.** Another process on the machine, a shared
  account, malware, a careless script. They can already read everything; the question is whether
  they can *alter history undetectably*.
- **Hostile content that arrives through the agent.** A web page or tool result the agent read and
  recorded. It has no privileges — its only power is being *believed later*.
- **The operator's own mistake.** A credential pasted into a record, or a query answered from the
  wrong project's store. Not malice, and the most likely thing to actually happen.

## The table

| # | Threat | Adversary can | Outcome | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | **Edit a record's content** | write to `log.jsonl` | history says something it did not | **mitigated** | `content_tampered`; `adversarial.test.ts` "edit a record content in place" |
| 2 | **Edit an attested field** (backdate, re-scope) | write to the file | a record appears older or from elsewhere | **mitigated** | `digest_mismatch`; `adversarial.test.ts` "edit an attested field" |
| 3 | **Delete a record from the middle** | write to the file | a decision disappears | **mitigated**, two independent signals | `chain_break` + `sequence_gap` |
| 4 | **Renumber `seq` to hide a deletion** | write to the file | the gap closes and the log looks whole | **mitigated** by the link, not the sequence | `adversarial.test.ts` "renumber seq to close a gap" |
| 5 | **Replay or reorder records** | write to the file | a decision appears twice, or in the wrong order | **mitigated** | `chain_break` + `sequence_gap` |
| 6 | **Truncate whole records off the end** | write to the file | the most recent decisions vanish, silently | **NOT MITIGATED** | `adversarial.test.ts` "LIMITATION: truncating whole records off the END"; `future-work/02` |
| 7 | **Rewrite the entire log** | write to the file, and run this code | history becomes whatever they want, and verifies | **NOT MITIGATED** | `adversarial.test.ts` "LIMITATION: a wholesale rewrite"; `future-work/02` |
| 8 | **Purge used as cover** for a break elsewhere | write to the file | tampering hides behind a legitimate erasure | **mitigated** — a purged record skips only the content check | `chain.ts` verify order; `adversarial.test.ts` "purge-as-cover" |
| 9 | **Prompt injection with persistence** | get content recorded once | a later session acts on instructions in the store | **partially mitigated** — see below | `security.test.ts` "content that looks like an instruction is stored and returned as DATA" |
| 10 | **A credential reaches the store** | paste one, or record a tool result | a secret sits in an append-only log | **partially mitigated** — purge removes it here, not elsewhere | `store.test.ts` "the purged content is gone from the FILE"; `DEC-004`; `future-work/01` §5.1 |
| 11 | **Answering from the wrong project's store** | run the CLI from the wrong directory | one project's context leaks into another's answers | **mitigated** — resolution throws rather than guessing | `workspace_unresolved`, `workspace_mismatch`; `store.test.ts`; `DEC-002` |
| 12 | **Two writers corrupt the chain** | run two processes | records lost, chain broken, silently | **mitigated** — read and write share one lock | `ugly-input.test.ts` "two REAL processes appending concurrently" |
| 13 | **Malformed temporal input widening visibility** | write a bad timestamp | an expired record is reported active | **mitigated** — fails closed and names the record | `security.test.ts` "temporal input"; `DEC-003` |
| 14 | **Supply-chain compromise via a dependency** | publish a malicious package | arbitrary code in the engine | **mitigated for the core; the transport carries a pinned dependency** — see below | `security.test.ts` "the CORE ships zero runtime dependencies" and "mcp/ is the ONLY directory permitted an external import" |
| 15 | **A secret leaking through an error message** | trigger any error path | a credential lands in a terminal scrollback or CI log | **partially mitigated** — content never appears; **ids do** | `security.test.ts` "an error message never contains record CONTENT" |
| 16 | **Reading the store at rest** | read the file, without running the process | full disclosure of everything recorded | **NOT MITIGATED, by decision** | `DEC-002`: filesystem permissions are the access control; disk encryption is the OS's job |

## The three that need more than a row

### 14 — the dependency boundary, after `DEC-011`

Until Phase 6 this row read *mitigated by construction*, and it was free: nothing needed a library.
The MCP transport does, so the claim narrowed rather than being quietly deleted.

**What is unchanged:** `engine/src/` imports nothing but `node:` builtins and its own modules. The
algorithms, the store, the chain and the retrieval path remain reviewable without trusting anyone,
and a test walks every tracked file under `src/` to keep it that way.

**What changed:** `engine/mcp/` carries `@modelcontextprotocol/sdk` and `zod`. It contains no
algorithm and no storage logic — it parses a request, dispatches to code that already exists and is
already tested, and serialises the result. A defect there cannot produce a wrong record.

**What enforces it:** a second test asserts `mcp/` is the *only* directory with an external import,
so the property cannot erode one convenience at a time. Both were demonstrated red — once with an
import added to `src/`, once with one added to `eval/`. The shipped artifact is a bundle with the
SDK inlined, and a test asserts it is byte-identical to a clean rebuild, so what ships is pinned
and reviewable rather than resolved at install time.

### 9 — prompt injection with persistence

This is the threat specific to a context engine, and the engine can only do half of the job.

**What is mitigated:** the engine never interprets stored content. There is no `eval`, no
`Function` constructor, no dynamic import, and no dispatch on a stored string — proven by a source
scan in the suite rather than by assertion. Every vocabulary that selects behaviour (`kind`, edge
type) is a closed set validated at the boundary. Content round-trips byte-identical and inert, and
a record whose *content* claims `kind: "tombstone"` is still stored and read as a node.

**What is not:** the engine hands text to a consumer, and if that consumer is a language model, the
model may act on instructions in it. Nothing here can prevent that, and nothing here should claim
to. What the engine provides is the material a consumer needs to be careful — every retrieved item
carries its source, so "this came from a web page we ingested" is answerable.

**The standing statement:** the engine guarantees stored content is never *executed by the engine*.
It cannot guarantee it is never *acted on by a reader*.

### 15 — ids appear in error messages

Record **content** never appears in an error; that is tested against four error paths with a
distinctive secret in the body. Record **ids** do appear — `duplicate_id: "x" is already in this
store` — because an error that will not say which record it is about is not actionable.

The consequence, stated rather than assumed away: **an id is not a place to put a secret.**
`DEC-005` governs what may be stored; this pins the narrower rule for ids specifically. There is a
test asserting an id reaches the message, so this stays true rather than drifting.

The store path also appears in load errors. Accepted deliberately: `DEC-002` makes "which store
answered?" the question that matters, so naming the file is the actionable part, and the worst case
is disclosing a local filesystem layout to a user who already has read access to it.

### 6 and 7 — the two the chain cannot see

Both are what an unanchored hash chain **is**, not implementation defects. A chain proves ordering
and integrity of what is present; it cannot prove completeness.

Every candidate fix conflicts with a decision already made — a signed head needs a key `DEC-004`
says we do not hold, an external witness needs a network `DEC-002` says we do not have, and a head
file beside the log is theatre against an attacker who can rewrite the log.
`docs/future-work/02-what-the-chain-cannot-detect.md` carries the full analysis and the trigger.

**The phrasing every document here must use:**

> The chain proves that the records present have not been altered and are in the order they were
> written. It does not prove that all the records ever written are still present.

## What changed since Phase 0, and was re-examined

- **A query now mutates the store** (Phase 3.4). `find` appends a retrieval decision. Re-checked
  against `DEC-005`: the row carries a query *hash* and length, never the text, and the served ids
  are already in the log. Retrieval rows are excluded from the search corpus so a query cannot
  match earlier queries. No new disclosure; the log simply grows with reads.
- **The lock is vendored** (`DEC-010`). It is 148 lines of `node:fs/promises` with no transitive
  dependencies, and its own header states its limitations — advisory not mandatory, POSIX-only in
  practice, and a 30-second stale-lock window in which a genuinely slow holder can be stolen from.
  That last one is a real residual risk on threat 12 and is **UNKNOWN** under contention:

  ```
  bun --cwd engine scripts/measure.ts
  ```

## What this model does not cover

- **An attacker with memory access to the running process.** Salts and content are in memory
  between read and purge. Out of scope per `DEC-002`, and stated so the claim is bounded.
- **Network-mounted stores.** The vendored lock states `O_EXCL` is unreliable over NFS. Nothing
  here tests it and nothing should claim it works.
- **Windows.** The lock's POSIX create semantics are verified on Darwin and expected on Linux.
  **UNVERIFIED** elsewhere; settle it by running the suite there.
