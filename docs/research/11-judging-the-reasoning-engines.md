# Judgement — Semantica's Rete and Datalog engines

**Ran:** 2026-08-20. **Method:** executed both engines against inputs with known answers.

> **Executed, not read.** This is the behaviour pass `recon-semantica/70-rebuild-plan.md` §6 said it
> could not run. Every result below came from running the code; the scripts are reproduced in full.
> `semantica` was read and executed, never modified, and every file written went to a scratch
> directory outside the repository.

**Versions.** `semantica` 0.6.5, commit `e6b159e5`, Python 3.13.10.

## The question the recon left open

> `semantica/reasoning/`'s Rete and Datalog engines. They are real implementations (387 and 431
> lines) but unreachable from any shipped entry point, so this pass has no evidence about whether
> they work — only that nothing calls them. Deciding their fate needs a behaviour pass this depth
> does not run.

## First, the reachability claim, sharpened

The recon said "unreachable from any shipped entry point". Measured, that is true of these two and
**not** of the package around them:

```
$ grep -rn "from.*reasoning import" --include=*.py . | grep -v /reasoning/ | grep -v /tests/
./mcp/tools/reasoning.py:23:        from semantica.reasoning import Reasoner
./semantica/core/orchestrator.py:146:  from ..reasoning import GraphReasoner
./semantica/cli.py:1975:              from .reasoning import Reasoner
./semantica/cli.py:2052:              from .reasoning import SPARQLReasoner
./semantica/cli.py:2470:              from .reasoning import TemporalReasoningEngine

$ grep -rn "ReteEngine\|DatalogReasoner" --include=*.py . | grep -v /reasoning/ | grep -v /tests/
(no output)
```

`Reasoner`, `GraphReasoner`, `SPARQLReasoner` and `TemporalReasoningEngine` all have shipped callers.
`ReteEngine` and `DatalogReasoner` have none — but both are exported from
`reasoning/__init__.py` and listed in `__all__`, so they are **published API with no internal
caller**, which is a different thing from dead code. A user following the package's own surface can
reach them.

---

## DatalogReasoner — it works

Six cases with known answers, including two the naive implementation of this fails:

```
DatalogReasoner — behaviour pass
  PASS  transitive closure            (5 facts, 0.1ms)
  PASS  three-deep chain              (9 facts, 0.1ms)
  PASS  cycle terminates              (6 facts, 0.1ms)
  PASS  two-predicate join            (3 facts, 0.0ms)
  PASS  no spurious derivation        (1 facts, 0.0ms)
  PASS  60-node chain (1830 pairs)    (1890 facts, 49.0ms)
```

- **Transitive closure is right.** `parent(alice,bob)`, `parent(bob,carol)` and the two standard
  ancestor rules derive `ancestor(alice,carol)`, and do **not** derive `ancestor(carol,alice)`.
- **Cycles terminate.** `parent(a,b)`, `parent(b,a)` derives `ancestor(a,a)` and `ancestor(b,b)` and
  halts. A naive fixpoint loop hangs here; this one does not, and its own progress message says
  "Starting semi-naive fixpoint evaluation", which is the correct algorithm by name.
- **Joins across two predicates work**, binding on the shared variable.
- **Nothing spurious.** Given `employs(acme,alice)` and a rule needing `skilled(P,S)`, it derives
  nothing rather than inventing a binding. That negative is the one that matters.
- **It scales acceptably** for its class: 1,890 derived facts in 49 ms.

**Verdict: sound.** If this engine is ever wanted, the algorithm is real and correct on the cases
that separate a working Datalog from a broken one.

### A correction to this document's own first run

The first probe reported all six as failures. The engine was right and the check was wrong: its
output formats terms as `ancestor(alice, bob)` with a space, and the expectations were written
without one. Recorded because a reader who saw only the first run would have concluded the opposite
of the truth.

---

## ReteEngine — it does not work

Rete exists to do two things: filter facts against conditions (the alpha network) and join partial
matches on shared variable bindings (the beta network). Both are stubbed:

```python
def _matches(self, fact: Fact) -> bool:
    """Check if fact matches condition."""
    # Simple matching - can be enhanced
    return True

def _can_join(self, left_fact: Fact, right_fact: Fact) -> bool:
    """Check if facts can be joined."""
    # Simple join logic - can be enhanced
    return True
```

And there is a wiring defect on top of the stubs. `_add_rule_to_network` creates the beta node and
**never appends it to any alpha node's `children`**; only the terminal is linked
(`final_node.children.append(terminal_node)`). `_propagate_from_alpha` iterates
`alpha_node.children`, so for any rule with more than one condition that list is empty and no fact
ever reaches the join.

Measured, with a rule whose conditions are `parent(X,Y)` and `parent(Y,Z)`:

```
ONE condition:   alpha children=[1]     matches=2
TWO conditions:  alpha children=[0, 0]  matches=0
```

Read those two rows together:

- **A rule with two or more conditions can never fire.** Not "fires wrongly" — never fires. The
  network reports itself as built (`{'total_nodes': 4, 'alpha_nodes': 2, 'beta_nodes': 1,
  'terminal_nodes': 1, 'facts': 2}`) and produces nothing, including for
  `parent(alice,bob)` + `parent(bob,carol)`, which is the case it exists for.
- **A rule with one condition fires on every fact.** The `matches=2` above includes
  `cafeteria_menu(tuesday)` matching a rule about `parent(X,Y)`, because `_matches` returns `True`.

So the joins — the entire point of Rete — are **unreachable**, and the one path that does execute
does not discriminate. `_can_join` returning `True` unconditionally is moot: nothing gets to it.

**I predicted this would match everything and it matches nothing.** The prediction followed from the
two stubs; the wiring defect was not visible until the network was inspected. Recorded because the
disagreement is what prompted reading `_add_rule_to_network`, and the true diagnosis is worse than
the predicted one.

**Verdict: refuted.** Take nothing from it. It is a class hierarchy in the shape of Rete with the
two predicates that would make it Rete replaced by `return True`, and a build step that does not
connect the network.

---

## What this means for this engine

**Neither is needed now, and that is not a criticism of Datalog.** This engine records what an agent
knew and decided; it has typed causal edges and a `why` walk over them. A rule engine would let a
caller say *if X CAUSED Y and Y CAUSED Z then X PRECEDENT_FOR Z* and materialise the conclusion —
which is a real capability and one this build has never needed.

If it is ever wanted, two of this project's own decisions constrain it before any code is written:

- `DEC-012` and `DEC-013` make derived things **derived** — recomputed, never stored. A rule engine
  that writes inferred edges into the log creates assertions no caller made, which `DEC-013` refuses
  for extraction and `DEC-012` refuses for identity.
- The honest shape would be inference at **read time**, reported as derived, with the rule that
  produced each conclusion named — the same shape `evidenceFor` already uses for extracted edges.

**The one thing worth taking from `DatalogReasoner` is that its algorithm is correct**, which is now
established rather than assumed. Its cycle handling is the part most implementations get wrong.

## What was NOT tested

- **Neither engine's error paths**, malformed rules, or `execute_matches`.
- **`ReteEngine` with a rule whose `conditions` are structured objects** rather than strings. The
  `Rule` dataclass types `conditions` as `List[Any]`, and the stubs ignore the value entirely, so no
  shape of condition can change the result — but only strings were passed.
- **The other nine modules in `reasoning/`**, including `Reasoner`, `AbductiveReasoner` and
  `SPARQLReasoner`, which *are* reachable and were not judged here.
- **Semantica's own test suite**, which was not run.

## The scripts

Reproduce with `PYTHONPATH=<path-to>/semantica python3 <file>`.

```python
# DatalogReasoner
import re, time
from semantica.reasoning import DatalogReasoner
norm = lambda s: re.sub(r'\s+', '', s)          # its output spaces terms; the first run missed this

def run(label, facts, rules, expect_present, expect_absent=()):
    r = DatalogReasoner()
    for f in facts: r.add_fact(f)
    for rl in rules: r.add_rule(rl)
    derived = {norm(x) for x in r.derive_all()}
    missing = [e for e in expect_present if norm(e) not in derived]
    wrong   = [e for e in expect_absent if norm(e) in derived]
    print(f"  {'PASS' if not missing and not wrong else 'FAIL'}  {label}  ({len(derived)} facts)")

run("transitive closure", ["parent(alice,bob)","parent(bob,carol)"],
    ["ancestor(X,Y) :- parent(X,Y)","ancestor(X,Y) :- parent(X,Z), ancestor(Z,Y)"],
    ["ancestor(alice,carol)"], ["ancestor(carol,alice)"])
run("cycle terminates", ["parent(a,b)","parent(b,a)"],
    ["ancestor(X,Y) :- parent(X,Y)","ancestor(X,Y) :- parent(X,Z), ancestor(Z,Y)"],
    ["ancestor(a,a)","ancestor(b,b)"])
run("no spurious derivation", ["employs(acme,alice)"],
    ["capability(C,S) :- employs(C,P), skilled(P,S)"], [], ["capability(acme,welding)"])
```

```python
# ReteEngine
from semantica.reasoning import ReteEngine
from semantica.reasoning.reasoner import Rule, Fact, RuleType
def F(i,p,*a): return Fact(fact_id=f"f{i}", predicate=p, arguments=list(a))

one = Rule(rule_id="r1", name="one", conditions=["parent(X,Y)"], conclusion="x",
           rule_type=RuleType.IMPLICATION)
two = Rule(rule_id="r2", name="two", conditions=["parent(X,Y)","parent(Y,Z)"], conclusion="x",
           rule_type=RuleType.IMPLICATION)

for label, rule in (("ONE condition", one), ("TWO conditions", two)):
    e = ReteEngine(); e.build_network([rule])
    alphas = [n for n in e.network.values() if type(n).__name__ == "AlphaNode"]
    for f in [F(1,"parent","alice","bob"), F(2,"cafeteria_menu","tuesday")]:
        e.add_fact(f)
    print(f"{label}: alpha children={[len(a.children) for a in alphas]}  "
          f"matches={len(e.match_patterns())}")
```

**One trap**: `semantica` prints progress bars without newlines, so piping its output through `grep`
loses interleaved lines. Write to a file and parse it, or a real result will vanish — one did here.
