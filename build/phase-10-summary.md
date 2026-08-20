# PHASE 10 SUMMARY — Entity linking: from a mention to a record — 2026-08-20

## 1. Verdict

**Phase closed.** The gap Phase 9 named as its own largest — a proposal could say what the text
stated but not which records the phrases referred to — is closed, and closed **without introducing a
single constant**.

```
$ bun run --cwd engine check
 372 pass
 0 fail
 997 expect() calls
Ran 372 tests across 25 files. [4.52s]

$ node .claude/skills/constants-gate/scripts/gate.mjs --root engine
constants-gate: PASS — 11 constant(s) across 59 file(s), every one accounted for
```

Eleven constants before this phase and eleven after, across twelve more files.

| | |
|---|---|
| The port's defect | `'the deploy caused the outage'` vs `'the outage caused the deploy'` scores **1.000** and is declared `same_as` |
| Why no threshold fixes it | a set has no order, so the score is exactly 1.0 — the maximum |
| Constants introduced | **none**, asserted by a test that is red against a threshold |
| Defect in my own surface | the CLI pre-filled an ambiguous rank 1 into the command a caller would run |
| Name collision | `link` was already a verb; the new branch was dead code and nothing warned |

---

## Task 10.1 — Link a mention to ranked candidates, introducing no constant

Acceptance: a mention matching one record ranks it first; a mention matching nothing returns
`no_candidates`; two candidates scoring identically return `tie`. The margin is present whenever two
or more candidates exist and absent when fewer do. A test asserts the module declares **no numeric
constant**, and that test is shown red against a deliberately added threshold.

**Met.** `src/extract/link.ts`. Candidate generation is `src/resolve/blocking.ts` and ranking is
`src/resolve/similarity.ts` — the two stages the survey literature names already existed here, and
reusing them is what `DEC-014` requires.

The three verdicts are threshold-free facts. `tie` is proven to be a real tie before the verdict is
trusted:

```ts
expect(similarity(m, twins[0]!).total).toBe(similarity(m, twins[1]!).total);
expect(r.verdict).toBe('tie');
```

**The margin reflects the true top two, not the two that survived the display cap** — a cap applied
first would report a gap between records the caller never saw. Shown red by computing the margin
after the cap.

The no-constant guard proves itself rather than asserting a negative:

```ts
expect(CODE).not.toMatch(/[<>]=?\s*-?\d*\.\d/);
expect(`${CODE}\nconst ok = score >= 0.9;`).toMatch(/[<>]=?\s*-?\d*\.\d/);   // the scan works
expect(CODE.length).toBeGreaterThan(500);                                    // the source was read
```

### The exclusion, found by running it

The first version linked "The friday deploy" to `note-1` — the record the phrase was **read out
of**. Trivially correct and useless: the phrase is literally in that text, so it always ranks first
and pushes the records a caller actually wants down the list. `exclude` was added for it, and the
mutation removing it turns three tests red.

---

## Task 10.2 — Prove the port's defect is designed out

Acceptance: a test transcribing the original's `_calculate_text_similarity` exactly, asserting it
scores that pair 1.0 — the defect demonstrated rather than described — and asserting this engine's
scorer separates them. The test states which is which. No code path here emits a `same_as` or
identity claim, asserted structurally.

**Met.** `entity_linker.py:444` reads
`link_type="same_as" if similarity >= 0.9 else "related_to"`, where `similarity` is set-Jaccard over
whitespace-split words (`:481`). Transcribed exactly and run:

```
1.000  same_as    'dog bites man' vs 'man bites dog'
1.000  same_as    'the deploy caused the outage' vs 'the outage caused the deploy'
0.500  related_to 'acme' vs 'acme corp'
```

Two statements with **opposite causal direction**, declared the same entity, at confidence 1.000, in
a library for building causal graphs. And the test pins why no better constant rescues it:

```ts
expect(semanticaSimilarity(A, B) >= 0.9).toBe(true);
expect(semanticaSimilarity(A, B) >= 0.99).toBe(true);     // the score is exactly 1.0
```

**This engine's scorer separates them**, because trigram Jaccard carries order, and the test asserts
the two scorers genuinely disagree rather than only that ours is below 1.

**One claim I withdrew before writing it down.** I first ran the transcription without lowercasing
and recorded that `'acme'` and `'Acme'` score 0.000. The caller lowercases both sides at `:400`, so
that is wrong and it is not a defect. It never left the terminal.

`entity_linker.py` is also **reachable**, unlike Phase 9's provenance wrappers:
`context_graph.py:478` instantiates it. This is shipped behaviour, not a tested library.

---

## Task 10.3 — Offer links for what `extract` found

Acceptance: the log is byte-identical across a proposal-with-candidates run, and the run is shown to
have computed something. A proposal whose subject matches a record offers it as a candidate with its
score; one that matches nothing says `no_candidates` rather than offering a poor match. Confirming
still requires the caller to name both endpoints.

**Met.** `Store.linkMention` is a new enumerated read path, and `propose` now carries `subjectLink`
and `objectLink`, each excluding the source record.

```ts
const before = readFileSync(paths.log, 'utf8');
const ps = s.propose('note-1');
expect(ps[0]!.subjectLink.candidates.length).toBeGreaterThan(0);   // it really did the work
expect(readFileSync(paths.log, 'utf8')).toBe(before);
```

A phrase matching nothing says so rather than offering its best poor match:

```ts
expect(p.subjectLink.verdict).toBe('no_candidates');
expect(p.subjectLink.candidates).toEqual([]);
```

---

## Task 10.4 — Reach it from the CLI and MCP

Acceptance: a pasted session against a real store — record two decisions and a note, extract, see the
proposals with candidate endpoints and scores, link a mention directly, confirm using a suggested
endpoint, and verify. Driven through the shipped surface, not the API.

**Met**, with one correction to my own surface described below. The session:

```
=== extract, now with candidate endpoints ===
#0  CAUSED  [caused-direct]
  subject  "The friday deploy"
  object   "a checkout outage"
  stated by "The friday deploy caused a checkout outage"
  subject → ranked  margin 0.030
      0.114  d-gate
      0.083  d-friday
  object → no candidate records
  to accept: engine confirm note-1 --n 0 --from <record> --to <record>

=== refers, on a phrase ===
"pre-deploy gate"  ranked  margin 0.320
  0.404  d-gate  we added a pre-deploy gate
  0.084  note-1  The friday deploy caused a checkout outage.

Ranked, not decided. No threshold was applied — the margin is the gap to the
runner-up, and a small one means rank 1 is not an answer.

=== a phrase nothing matches ===
"quantum tunnelling"  no_candidates
  no record shares enough with that phrase to be a candidate
```

### The defect in my own surface

The first version printed `--from d-gate` on the copy-paste line, from a list whose margin was
**0.030** — and whose rank 1 is arguably the wrong record. The margin was displayed two lines above
and **does not survive a copy-paste**. Filling the engine's guess into the command a caller runs is
exactly what "reports, never decides" exists to prevent, and I had built it into the surface while
the module underneath was scrupulous about it.

Fixed without a threshold, because `DEC-014` forbids one: an endpoint is pre-filled **only when
there is exactly one candidate** — a fact about the list, not a judgement about the score. Shown red
by changing `=== 1` to `>= 1`.

---

## 2. The name collision, and what did not catch it

`link` was already a CLI verb and an MCP tool — for creating a causal edge between two records. The
new mention-lookup verb reused the name, which produced:

- a second `case 'link'` in a switch, **unreachable**, because the first match wins;
- `'link'` twice in the `known` array;
- two MCP tools registered under one name, which broke the server and failed **seven** tests.

**Neither `tsc` nor the linter said anything about any of the three.** Only the MCP round-trip
failed, and it failed with symptoms that pointed nowhere near the cause. Renamed to `refers`.

A duplicate-verb guard now exists, and was shown red against a duplicated entry:

```ts
expect(verbs).toEqual([...new Set(verbs)].sort());
```

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the source-record exclusion | removing `excluded.has(r.id)` | red — 3 tests |
| margin before the cap | computing it after the cap | red |
| **no ambiguous pre-fill** | `=== 1` → `>= 1` | red |
| no constant in the linker | the scan is proven against an added `>= 0.9` and an added `export const` | proves itself |
| duplicate CLI verbs | duplicating `refers` in `known` | red |
| read-path enumeration | adding `linkMention` | red, unprompted |

## 4. Still open

- **The ranking is weak on short mentions against long record names.** `"The friday deploy"` ranks
  `d-gate` (0.114) above `d-friday` (0.083), which is probably the wrong order, at a margin of 0.030.
  The design's answer is that it never asserts — the caller sees both scores and the margin — but the
  ranking itself is not good, and a phrase-aware scorer would be a real improvement.
- **No evaluation harness for linking**, so there is no Recall@k or Top-1 figure and none should be
  quoted. What would calibrate anything here is a labelled set of mentions from this store's records
  with their true referents, **including mentions that refer to nothing**. It does not exist.
- **`no_candidates` is a property of the blocker, not of meaning.** A mention sharing no token
  prefix or phonetic key with any record is unlinkable here even if a person would link it
  instantly.
- **Nothing consumes `subjectLink`/`objectLink` automatically**, by design. A caller still types both
  endpoints unless a list has exactly one entry.
- Everything carried from Phase 9.
