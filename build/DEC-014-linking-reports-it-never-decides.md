# DEC-014 — Entity linking reports ranked candidates and never decides identity from a score

_Decided 2026-08-20 · status: current_

Phase 9 left `extract` unable to say which records a phrase refers to. This record fixes how that
gap is closed, and how it is not.

**Linking returns a ranked list.** For a mention, `link` returns the candidate records ordered by
score, each with its score, plus the **margin** between the top two.

**The only verdicts are threshold-free facts.** `no_candidates` when the generator returned nothing;
`tie` when the two best score identically; `ranked` otherwise. **No constant is introduced**, and
the margin is reported as a number rather than compared against one.

**Linking proposes and never writes.** It appends nothing, and it never emits an identity claim.

**Candidate generation and ranking reuse `src/resolve/`.** No second scorer.

## Why

**Because the thing Semantica thresholds cannot support the claim at any threshold.**
`entity_linker.py:444` reads `link_type="same_as" if similarity >= 0.9 else "related_to"`, where
`similarity` is set-Jaccard over whitespace-split words. Transcribed exactly and run:

```
1.000  same_as  'the deploy caused the outage' vs 'the outage caused the deploy'
```

A set has no order, so two statements with **opposite causal direction** score exactly 1.0 and are
declared the same entity — in a library for building causal graphs. Raising the threshold to 0.99
changes nothing. The defect is not the constant; a better constant would not fix it.

**Because inventing two constants here would repeat the finding.** Two of the four standard NIL
techniques need a threshold, and there is no labelled set in this repository to calibrate one
against. Adding `LINK_FLOOR` and `LINK_MARGIN` would place two unprovenanced numbers beside the one
whose lack of provenance is the finding. The other two techniques — *no candidates*, and *a tie* —
are facts about the result and need no number, so those are the verdicts.

**Because the margin is the honest signal, and it is standard.** The evaluation literature names
"difference between the two highest-scoring candidates" as a NIL technique in its own right: a top
candidate at 0.9 against a runner-up at 0.88 is ambiguous however high the top score is, and a
threshold on the top score alone cannot see it. Reporting the margin gives the caller that signal
without this engine pretending to know where the line is.

**Because deciding identity from a score is already refused.** `DEC-012` rejected auto-merging above
a similarity threshold: no threshold makes transitivity safe, and an automatic merge is an
unreviewable assertion about identity. A `same_as` link emitted from a Jaccard score is the same
assertion wearing a different name. Identity in this engine is a `merge`, and a caller asserts it.

**Because a second scorer is the duplication this monorepo has already made four times.**
`src/resolve/blocking.ts` is candidate generation and `src/resolve/similarity.ts` is ranking; the
stages the survey literature names are the modules that already exist.

## What was rejected

- **A `same_as` link emitted above a threshold**, as the original does. Rejected: it is an
  unreviewable identity assertion, it contradicts `DEC-012`, and the function it would threshold
  cannot distinguish two sentences with opposite meaning.
- **`LINK_FLOOR` and `LINK_MARGIN` as declared placeholders.** Rejected, though the constants rule
  would have permitted it. A declared placeholder is honest when a number must exist; here the
  design works without one, and choosing a number nothing calibrates — in the very feature whose
  finding is an uncalibrated number — would be the wrong lesson to take from the port.
- **Auto-linking `extract`'s endpoints.** Rejected: it would turn a proposal into an assertion in one
  step and reintroduce everything `DEC-013` refused.
- **Reporting the similarity score as a confidence**, as `confidence=similarity` does. Rejected: a
  Jaccard ratio is not a probability, and naming it confidence invites arithmetic on it.
- **Word-set Jaccard as the scorer.** Rejected on the evidence above; `src/resolve/similarity.ts`
  uses trigram Jaccard, which is order-sensitive, and its weights are already declared.
- **Returning every candidate.** A display limit is applied. It is a display cap and not a decision
  about identity, and it is stated as such at the call site.

## What this constrains

- `link` writes nothing. A test asserts the log is byte-identical across a run.
- No constant may be introduced by this feature. A test asserts the module declares none, so a
  future threshold cannot arrive quietly.
- Every returned candidate carries its score, and the margin is present whenever two or more
  candidates exist.
- Nothing may turn a link into an edge or a merge without a caller naming both ends.
- Any future NIL threshold arrives with the labelled set that calibrates it and supersedes this
  record; it may not be added as a default parameter.

## How to reverse it

Cheap in the direction of more automation: a threshold can be added later on top of a ranked list
without changing anything already stored, because nothing is stored. Reversing toward Semantica's
behaviour — asserting identity from a score — means superseding `DEC-012` as well, and would make
every link written under it unreviewable after the fact, which is precisely the state that makes a
trusted log untrustworthy.
