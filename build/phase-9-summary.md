# PHASE 9 SUMMARY — Extraction with span provenance — 2026-08-20

## 1. Verdict

**Phase closed. The recon's list is finished** — Task 3.2 was the last item nothing here had built.

```
$ bun run --cwd engine check
 347 pass
 0 fail
 932 expect() calls
Ran 347 tests across 24 files. [3.72s]

$ .claude/check.sh
PASS — 9 gate(s) passed, 1 skipped
```

Finding A-8 is closed, and the design's one real insight is that **immutability removes the need
for the copied quote** the standard prescribes — which is what keeps purge working.

| | |
|---|---|
| A-8 fixture | ten entities, no stated relation → **0 relations** |
| The offset trap | Python says start 3, this engine says 5; slicing with Python's number yields `"\ude80 the friday depl"` |
| After purging the source | evidence reports `source_purged`, and **0 occurrences** of the sentence remain in the log file |
| My own error | one hand-counted offset was wrong; the test caught it |

---

## Task 9.1 — Define a span, and resolve it against the store

Acceptance: a span resolves to exactly the quoted substring; an out-of-bounds span, a reversed span,
and a span into a purged record each return a distinct named reason code rather than an empty string
or a throw. A test proves a stored span contains **no field value** of its source's content, scanned
the way the tombstone test scans, and proves the scan can find a value when one is present.

**Met.** `src/extract/span.ts`. Six reason codes, asserted as a set so a missing one cannot pass:

```ts
expect(got).toEqual([
  'source_not_found', 'source_purged', 'source_has_no_text',
  'span_out_of_bounds', 'span_inverted', 'span_not_integral',
]);
```

A purged source is reported as **purged**, not as "no text" — reporting an erasure as a formatting
problem would tell a person the wrong thing about the one operation whose whole job is to be
trustworthy. An empty span is a *success* (`{ok: true, quote: ''}`) and stays distinguishable from
every failure.

The no-text scan follows the tombstone test's shape, including proving itself:

```ts
expect(Object.keys(span).sort()).toEqual(['end', 'source', 'start']);
expect(JSON.stringify({ ...span, quote: 'friday deploy' })).toContain('friday deploy');
```

---

## Task 9.2 — Extract only what a rule matched

Acceptance: closes A-8. A paragraph naming ten entities with no stated relation between them emits
**zero** relations, and the same fixture is asserted to contain ten findable entity mentions, so the
zero is a result rather than an empty input. A sentence stating one relation emits exactly one, with
the trigger span resolving to the words that stated it. Two entities sharing a surface form are both
reachable, asserted against the ported last-wins behaviour in the same test.

**Met.** `src/extract/rules.ts`. The A-8 fixture, and the anti-vacuity that makes its zero mean
something:

```ts
expect(extract('r1', TEN)).toEqual([]);
expect(names.filter((n) => TEN.includes(n))).toHaveLength(10);
expect((names.length * (names.length - 1)) / 2).toBe(45);   // what co-occurrence would have emitted
```

**Three defects designed out**, all confirmed by reading the source this session:

1. **No co-occurrence extractor exists here in any form.** The original's
   `extract_relations_cooccurrence` emits `related_to` for every entity pair within 100 characters at
   `confidence=0.6,  # Meets default threshold` — a comment stating the value was chosen to clear
   the filter it would be tested against.
2. **No confidence float.** A rule matched or it did not, and the key set is asserted so one cannot
   creep back in.
3. **No entity map.** The original's `{e.text.lower(): e}` is last-wins, so two entities sharing a
   surface form collapse. Subject and object here are spans read straight from the match, so
   `checkout caused checkout to fail` yields two different spans and cannot collapse.

Rules emit only the **closed** causal vocabulary, asserted against `CAUSAL_EDGE_TYPES` — an
extractor emitting `related_to`, as the original does, would produce relations that can never become
edges.

---

## Task 9.3 — Prove the offset unit, with a character that can tell the difference

Acceptance: a fixture whose text contains an astral character before the span, and a test asserting
the resolved quote is exactly right. The test is shown red against code-point offsets, with the
wrong quote pasted. A second test asserts the documented unit matches what the code does, by
measuring rather than by restating the comment.

**Met.** The fixture proves it can tell the units apart before it proves anything else:

```ts
expect(text.length).toBe(47);          // UTF-16 code units
expect([...text].length).toBe(45);     // Unicode code points
```

And what porting Semantica's `start_char` without its unit would have produced:

```
Python would report start = 3 (code points)
this engine reports  start = 5 (utf16 code units)
slicing with the Python number gives: "\ude80 the friday depl"
```

A lone surrogate and shifted text, silently. **Shown red**, by making `resolveSpan` slice by code
points:

```
(fail) resolving with UTF-16 offsets gives the right text
(fail) resolving with CODE-POINT offsets gives a lone surrogate and shifted text
(fail) the declared unit matches what the code does, measured rather than restated
```

---

## Task 9.4 — Propose, then let a caller dispose

Acceptance: the log is byte-identical before and after a proposal run, and the run is shown to have
computed something so "wrote nothing" is not "did nothing". A confirmed proposal appends exactly one
edge, that edge's span provenance resolves back to the trigger text, and the chain verifies. There
is no path that writes an edge without a caller naming it, asserted structurally.

**Met.** `Store.propose` / `Store.confirm` / `Store.evidenceFor`.

```ts
const before = readFileSync(paths.log, 'utf8');
const proposals = s.propose('note-1');
expect(readFileSync(paths.log, 'utf8')).toBe(before);
expect(proposals).toHaveLength(1);        // anti-vacuity
```

**A proposal deliberately does not say which records the subject and object are.** Nothing here
recognises entities, so mapping "the friday deploy" to a record id would be invented. The caller
names the endpoints at `confirm`, and a `confirm` naming an endpoint that is not a live record is
refused with `endpoint_not_found`. A span that no longer resolves is refused with
`span_unresolvable`, because recording evidence that already points at nothing would make the edge
look supported when it is not.

### The property the whole decision rests on

```ts
// before purge — prove the scan works
expect(withText).toContain('checkout outage');
await s.purge('note-1', 'contained a customer name');
for (const v of [SENTENCE, 'friday deploy', 'checkout outage']) expect(after).not.toContain(v);
```

Purging the source leaves **no copy** in the edge, and `evidenceFor` reports
`{ok: false, reason: 'source_purged'}` while the edge itself stands and the chain still verifies.

Had we ported Semantica's `context: str` — a ±30-character copy — that grep would return a hit.
**Shown red** by adding `context: q.quote` to the edge meta:

```
(fail) THE EDGE STORES NO TEXT — the whole point of DEC-013
(fail) and the sentence is gone from the FILE — no copy survives in the edge
```

---

## Task 9.5 — Reach it from the CLI and MCP

Acceptance: a pasted session against a real store — record a text, extract, see the proposals with
their trigger quotes, confirm one, see the edge, verify the chain, and see `why` walk it. Driven
through the shipped surface, not the API.

**Met.** Three verbs on both surfaces. The full session, through the CLI, against a real store:

```
=== extract ===
#0  CAUSED  [caused-direct]
  subject  "The friday deploy"
  object   "a checkout outage"
  stated by "The friday deploy caused a checkout outage"
  to accept: engine confirm note-1 --n 0 --from <record> --to <record>

#1  INFLUENCED  [influenced-direct]
  subject  "The outage"
  object   "the gate"
  stated by "The outage informed the gate"

Nothing was written. These say what the TEXT states; they do not say which
records the subject and object are — nothing here recognises entities, so you
name the endpoints yourself.

=== confirm #0 ===
confirmed d-friday --CAUSED--> d-gate  seq=4
  evidence: "The friday deploy caused a checkout outage" in note-1 [caused-direct]
  the edge stores offsets, not that text — purge note-1 and the evidence goes with it.

=== evidence ===
d-friday->d-gate:CAUSED  [caused-direct]
  read from note-1
  states: "The friday deploy caused a checkout outage"

=== why (downstream of d-friday) ===
d-friday → d-gate
  hops 1  band direct
  weakest link: d-friday --CAUSED(1)--> d-gate

=== verify ===
✓ chain verifies — 4 record(s), 0 purged, 0 problems
```

And the same store after purging the record the edge was read from:

```
=== evidence now ===
d-friday->d-gate:CAUSED  [caused-direct]
  read from note-1
  unresolvable: source_purged

=== the edge itself still stands, and so does the chain ===
✓ chain verifies — 5 record(s), 1 purged, 0 problems
```

The CLI's `confirm` re-runs extraction and takes proposal `#n`. That index is stable **because**
records are immutable (`DEC-007`) and the rules are a module constant — stated at the call site
rather than assumed.

## 2. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| A-8: proximity emits nothing | a rule matching `[,\s]` instead of stated causation | red — 4 tests |
| the offset unit | `resolveSpan` slicing by code points | red — 3 tests |
| no confidence float | adding `confidence: 0.75` | red |
| **the edge stores no text** | adding `context: q.quote` to the edge meta | red — 2 tests |
| read-path enumeration | adding `propose`/`evidenceFor` | red, unprompted |
| CLI/MCP verb parity | naming the MCP tool `confirm_extraction` | red, unprompted |

The parity guard caught a genuine mismatch rather than a cosmetic one, and it was resolved by
renaming the MCP tool to match the CLI rather than by adding an alias map — an alias map would have
made the guard unable to see a CLI verb with no tool behind it, which is the thing it exists for.

## 3. The characteristic failure, twice

**A prediction about my own code was wrong, and a hand-counted number was wrong.**

The comment justifying a fresh `RegExp` per call claimed a `g`-flagged literal leaks `lastIndex`
across calls. It does not — `matchAll` clones the regex and leaves the original at 0. Measured:

```
lastIndex before      : 0
lastIndex after call 1: 0
--- but exec DOES advance it ---
lastIndex after exec  : 20
```

The mutation that should have killed the test I wrote for it killed a *different* test, which is how
it surfaced. The comment now says what was measured, and a test pins both halves so a future rewrite
into `while ((m = re.exec(text)))` over a shared regex — which would silently drop every relation in
the **second** record — goes red.

The second was arithmetic: I asserted a trigger span ended at 41 having counted the sentence by eye.
It ends at 42. The test is now derived from the sentence rather than hand-counted.

Nineteen and twenty. The pattern has not weakened; what has changed is that both were caught in
minutes by guards written before the claims.

## 4. Still open

- **No entity recognition, deliberately.** A proposal says what the text states and not which
  records those phrases refer to. Until something maps phrases to records, a caller supplies every
  endpoint by hand. That is the honest state, and it is the largest remaining gap in this feature.
- **The rules are a declared placeholder.** Three rule families, hand-written from the causal
  language in this repository's own decision records, not from a corpus. What would calibrate them
  is a labelled set of decision texts, which does not exist. Recall misses are expected and
  acceptable; they are visible in a way a manufactured edge is not.
- **Extraction has no evaluation harness.** Phases 5 and 7 built one for retrieval and for
  resolution; this has none, so there is no precision or recall figure for the rules at all. Do not
  quote one.
- **`propose` reads only a `text` key.** A record whose content is shaped differently — the store's
  own decisions use `scenario`/`outcome` — cannot be extracted from at all, and returns `[]` rather
  than saying why.
- Everything carried from Phase 8.
