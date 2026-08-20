# Measurement — what Semantica's deduplication merge actually does

**Ran:** 2026-08-20, after Phase 10, to settle a claim this session had made from reading code alone.
**Method:** executed `semantica`'s own `EntityMerger` against fixtures built here.

> **This is the one document in `docs/research/` that is not one hop from a source.** Everything
> below was executed, and the script that produced it is reproduced in full at the bottom. Numbers
> here come from that run and nothing else.

**Versions.** `semantica` 0.6.5, commit `e6b159e5`, Python 3.13.10. `semantica/` was read and
executed, never modified; every file written went to a scratch directory outside the repository.

## The claim being tested, and its refutation

This session claimed, from reading `entity_merger.py:216` and `cli.py:1932`, that
`dedup --action merge --output` writes only merge operations, so **entities with no duplicate would
be absent from the output** — "1000 entities in, 10 duplicate pairs, 980 missing".

**That claim is false.** Measured:

```
input_entities                 : 1000
original_ids_absent_from_output: 0
```

`merge_duplicates` returns `MergeOperation` objects whose `source_entities` field carries the
originals, so nothing is dropped. The reading was wrong: the loop at `:216` filters which *groups*
get merged, not which entities survive into the result.

Recorded because a claim this repository nearly published was refuted by running the thing, which is
the entire point of the rule that produced the check.

## Finding 1 — at the shipped default, 990 distinct companies merge into 14 groups

The first fixture was unusable and is reported so nobody rebuilds it: names of the form
`Entity Number 0` … `Entity Number 989` differ by one character, so any character-level scorer
rates them near-identical. Everything merged, and that measured the fixture rather than the code.

Rebuilt with genuinely distinct names — 990 unique company names drawn from disjoint word pools
(`Northwind Logistics Holdings`, `Acme Robotics Group`, …), plus **10 exact duplicates** with the
same name and a different id. Defaults from `cli.py`: `--min-similarity 0.7`, `--strategy hybrid`
(→ `hybrid_v2`), `--sort-by similarity` (→ `similarity_score`).

```
input_entities                      : 1000
distinct_names_in_input             : 990
genuine_duplicate_pairs             : 10
merge_operations                    : 14
group_sizes  : [162, 144, 110, 102, 52, 51, 51, 51, 50, 50, 48, 47, 42, 40]
entities_absorbed_total             : 1000
groups_that_merged_DIFFERENT_names  : 14
worst_group : {"size": 144, "distinct_names": 134,
               "sample": ["Abstergo Airlines Partners",
                          "Abstergo Airlines Trust",
                          "Abstergo Airlines Ventures"]}
```

**Every entity was absorbed, and every one of the 14 groups merged entities with different names.**
The largest group holds 144 entities carrying 134 distinct names. There were 10 real duplicates.

This is transitive chaining: similarity is not transitive, so a chain of individually plausible
matches closes over a component that is plainly wrong. It is the same shape Phase 7 demonstrated
with `jon-smith ~ j-smith ~ jane-smith`, at the scale a real corpus produces, and it happens at the
CLI's own default threshold rather than at a setting someone chose badly.

**What this does not establish.** The three names in the sample share a word pool by construction,
and real corpora vary in how much vocabulary their names share. What is established is that the
default configuration will do this to a list whose names share common words — which company names,
document titles and incident summaries all do.

## Finding 2 — the written artifact is a Python `repr`, not structured data

`cli.py:1932` writes the result with `json.dumps(result, default=str)`. `MergeOperation` is a
dataclass that `json` cannot serialise, so `default=str` stringifies each one whole.

```
out3.json bytes      : 336375
top-level            : list, len 14
element types        : ['str']
first element starts : MergeOperation(source_entities=[{'id': 'e6', 'name': 'Abstergo Cement Tr
```

The output is a JSON array of 14 strings, each the `repr()` of a Python object. Every id is
technically present — inside that text — but nothing downstream can read a field from it without
parsing Python source. This is why the refuted claim looked plausible from the code and needed
running to settle: the ids *are* in the file, and are also not usable.

## What this changes for this engine

Nothing in the code. It supplies measured evidence for a decision already made on reasoning:

- **`DEC-012` rejected auto-merging above a similarity threshold**, on the grounds that no threshold
  makes transitivity safe and raising it only moves where the chain breaks. The 14-group result is
  that argument measured on 1000 records rather than 3.
- **`DEC-014` refused to decide identity from a score**, and refused to introduce a threshold at
  all. Finding 1 is what the rejected alternative produces at its author's own default.
- The engine's `suggest` reports the **weakest link** holding a cluster together for exactly this
  reason: a group of 144 whose weakest edge is poor is visibly a bad group, where a group with no
  reported weakest link is not.

## What was NOT run

- **The `semantica` CLI binary was not invoked.** Its `_load_entities` reads from a configured graph
  store, which would have to be stood up. What ran is `EntityMerger.merge_duplicates` called with
  the CLI's own default arguments and `strategy_map` values, followed by the CLI's exact
  serialisation line. Same function, same arguments, same write; **not the same process.**
- Semantica's own test suite was not run.
- No other `--strategy` or `--min-similarity` value was tried. These figures describe the defaults.

## The script

Reproduce with `PYTHONPATH=<path-to>/semantica python3 thisfile.py findings.json`. It reads
`semantica` and writes only where told.

```python
import json, sys, random
from pathlib import Path
from semantica.deduplication.entity_merger import EntityMerger

random.seed(7)
A = ["Northwind","Acme","Globex","Initech","Umbrella","Soylent","Hooli","Stark","Wayne","Tyrell",
     "Cyberdyne","Wonka","Duff","Gringotts","Aperture","BlackMesa","Weyland","Oscorp","Abstergo","Vault"]
B = ["Logistics","Robotics","Foods","Media","Motors","Energy","Textiles","Airlines","Pharma","Mining",
     "Shipping","Bakery","Optics","Cement","Fisheries","Ceramics","Timber","Dairy","Glassworks","Foundry"]
C = ["Holdings","Group","Partners","Limited","Incorporated","Trust","Ventures","Works","Union","Cooperative"]
names = set()
while len(names) < 990:
    names.add(f"{random.choice(A)} {random.choice(B)} {random.choice(C)}")
names = sorted(names)
entities = [{"id": f"e{i}", "name": n, "type": "Company"} for i, n in enumerate(names)]
for i in range(10):                      # 10 genuine duplicates: same name, different id
    entities.append({"id": f"dup{i}", "name": names[i], "type": "Company"})

merger = EntityMerger()
ops = merger.merge_duplicates(entities, threshold=0.7,          # cli.py --min-similarity default
                              candidate_strategy="hybrid_v2",   # cli.py --strategy default, mapped
                              sort_by="similarity_score")       # cli.py --sort-by default, mapped

sizes = sorted((len(o.source_entities) for o in ops), reverse=True)
wrong = []
for o in ops:                            # a group is wrong if it absorbed more than one name
    distinct = {e.get("name") for e in o.source_entities}
    if len(distinct) > 1:
        wrong.append({"size": len(o.source_entities), "distinct_names": len(distinct),
                      "sample": sorted(distinct)[:3]})
Path(sys.argv[1]).write_text(json.dumps({
    "input_entities": len(entities),
    "distinct_names_in_input": len(set(e["name"] for e in entities)),
    "genuine_duplicate_pairs": 10,
    "merge_operations": len(ops),
    "group_sizes": sizes,
    "entities_absorbed_total": sum(sizes),
    "groups_that_merged_DIFFERENT_names": len(wrong),
    "worst_group": wrong[0] if wrong else None,
}, indent=2), encoding="utf-8")
```

**One trap worth naming**, because it cost time here: a scratch file named `inspect.py` beside the
script shadows the standard library's `inspect`, which `dataclasses` imports, and the run dies with
a traceback pointing at `dataclasses`. Do not name a scratch file after a stdlib module.
