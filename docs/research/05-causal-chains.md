# Research — Algorithm 5, composing confidence along a causal chain

**Ran:** 2026-08-19, Phase 1 Task 1.5, after the port.
**Method:** built-in `WebSearch`.

> **Evidence caveat.** One hop from source through a summarisation layer. Good enough to
> design from, not good enough to quote.

## The search came back thin, and that is recorded rather than papered over

The question was whether product, minimum or noisy-OR is the right way to compose confidence
along a chain of causal hops. The search returned material on noisy-OR belief networks and on
uncertainty propagation generally, but **no direct comparison of the three for this purpose**,
and the result set itself said so.

So the design below rests on **structural reasoning, not on a cited result.** It is marked that
way here and at the definition site, because the alternative — dressing an argument up as a
finding — is the exact failure this repository's evidence rules exist to prevent. If a later
session finds the comparative literature, this note is the thing to revise.

## What the search did establish

Noisy-OR models the influence of several parents on one node, and needs only one parameter per
parent. That is its shape: **several independent causes of a single effect.**

That shape is the reason it is the wrong operator here, and this part follows from the
definition rather than from a measurement. A causal chain is **serial** — A caused B caused C
— not parallel. Noisy-OR combines evidence arriving *at* a node from several places; it does
not compose a path. It would be the right tool for a different question this engine does not
yet ask: *several distinct chains support the same decision, how much do they jointly support
it?* Recorded so that when that question arrives, the operator is already chosen.

## The reasoning that settled product versus minimum

Both are standard conjunction operators, and they differ in what they assume:

- **Product** — `w₁ · w₂ · … · wₙ`. Treats the hops as **independent**. Along a causal chain
  they generally are not: consecutive hops often share a cause, an author, or a moment, so the
  independence assumption is usually violated in the direction that makes the product *too
  low*. It is best read as a lower bound.
- **Minimum** — the weakest-link reading. Assumes nothing about dependence. It is the more
  conservative *statement* while being the higher *number*, since the product can never exceed
  the minimum.

Neither is wrong. They answer different questions, and the honest position is that **the data
does not support choosing between them here**, for a reason that is specific rather than
squeamish: the hop weights themselves are uncalibrated. Nothing in this engine has measured
what a weight of 0.7 means, and no evaluation harness exists yet to measure it. Collapsing
uncalibrated inputs through either operator into a single confidence figure produces a number
with more apparent precision than its inputs carry.

**Decision: report both, label the assumption each carries, emit no blended figure.**
`productConfidence` and `weakestConfidence` are separate fields, and the report also names the
weakest hop so a reader can see *where* the chain is thin rather than only *that* it is.

## What was dropped from the port, and why

`_build_causal_chain_report` (`context_graph.py:3938-3974`) ends by turning the product into an
English sentence using thresholds of **0.7** and **0.4** — "high confidence", "confidence
decays to", "is weak evidence". Those constants are not derived from anything in that
repository, and could not be: `semantica/evals/__init__.py` is ten lines reading
`__status__ = "coming_soon"`, so no threshold in that system has ever been measured.

Not ported. A prose verdict built on unmeasured thresholds is the "uncalibrated constants
shipped silently" item on the teardown's own reject list, and it is more dangerous than the
raw number because it reads as a conclusion.

The **distance bands** (`helpers.py:586-605`, boundaries at 1 / 3 / 6) *are* ported, because
they classify hop count — an exact integer — rather than a confidence, and the original is
explicit that they are the single source of truth for two consumers. They carry a **declared
placeholder** note at the definition site: carried over, not calibrated.

## Carried over unchanged, because the original is right

- **Per-path cycle detection, not a global visited set.** The original's comment says a global
  set "silently loses valid chains"; concretely, a diamond returns one arm and drops the other
  without saying so. Proven here: replacing the per-path set with a real global one turns the
  diamond test red.
- **Only asserted edges are traversed.** `_CAUSAL_EDGE_TYPES` is documented at its definition
  site as what the caller asserted, as distinct from relationships inferred from shared
  entities and timestamps. Mixing the two would let a heuristic masquerade as a record.
- **The weakest link is reported by name**, not just its value.

## Sources

One hop from source; spot-check before quoting. Listed including the ones that did **not**
answer the question, so a later session does not repeat the same search expecting more.

- [Efficient Search-Based Inference for Noisy-OR Belief Networks](https://arxiv.org/pdf/1302.3584)
- [Learning noisy-OR Bayesian Networks with Max-Product](https://arxiv.org/pdf/2302.00099)
- [Uncertainty Propagation — overview](https://www.sciencedirect.com/topics/computer-science/uncertainty-propagation)
