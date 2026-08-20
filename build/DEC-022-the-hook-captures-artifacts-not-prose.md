# DEC-022 — Session capture reads the artifacts a session created, never its transcript

_Decided 2026-08-20 · status: current — keeps `DEC-005` intact rather than superseding it_

The operator asked for a hook that auto-captures decisions at session end. The obvious
implementation reads the transcript and extracts decisions from prose. This one does not.

**The hook reads the session's event log and the files it names.** Nothing else.

**A decision is captured when the session *wrote one down* as an artifact** — a `DEC-*.md` file —
not when it sounded like it decided something.

**The captured text is the record's own title line.** No summarisation, no inference.

**It is idempotent and never blocks.** A decision already in the store is skipped; any failure is
silent.

## Why

**Because `DEC-005` survives this and would not survive the obvious version.** That record says the
store holds *the caller's explicit records and their provenance; never raw prompts, transcripts or
file contents*. Writing a `DEC-*.md` file **is** an explicit act by the caller. Recording that the
act happened captures an artifact, not a conversation. The transcript is never opened.

**Because the hooks here already hold this line.** `close.mjs` says: *"Everything below is a COUNT
or a TRANSITION — something a script can be right or wrong about... The moment a number here needed
an opinion to produce, it would belong in `session-forensics` instead."* Deciding what counts as a
decision in prose is exactly an opinion. Detecting that a file matching `DEC-*.md` was written is a
transition.

**Because inference at capture time is the one place fabrication is unrecoverable.** `f-fake-example`
is already in this store: an invented example in a document was read as a real decision, and a
decision record was nearly written for an incident that never happened. A hook that summarises prose
into decisions industrialises exactly that failure, and does it while nobody is watching.

**Because the alternative has no evidence to offer.** An extracted decision cannot show you the
sentence it came from. A captured one can point at the file, which is on disk, in git, and readable.

## What was rejected

- **Reading the transcript and extracting decisions from prose.** Rejected: it supersedes `DEC-005`,
  it requires judgement the hooks here deliberately refuse, and its failure mode is a confident
  record of something nobody decided.
- **Summarising the session into one "what happened" record.** Rejected for the same reason — a
  summary is an opinion, and this store's value is that its contents were deliberate.
- **Capturing every file the session wrote.** Rejected: that is a change log, and git already has
  it. The store is for decisions and what caused them.
- **Blocking session end on a capture failure.** Rejected, following `close.mjs`: *"A recorder that
  can stop a session from ending is a recorder that gets deleted the first time it is wrong."*

## What this constrains

- The hook may read `events.jsonl` and files whose paths appear in it. It may not read
  `transcript_path`, and a test asserts the string does not appear in it.
- Captured records carry `origin: 'session-capture'` and the session id, so a reader can always tell
  what a human typed from what a hook noticed.
- Capture is idempotent by record id. Running twice writes nothing the second time.
- If `bun` or the engine is unavailable, the hook exits silently. It never blocks and never throws.

## How to reverse it

Trivial: delete the hook entry from `settings.json`. Nothing already captured is affected, and every
captured record is an ordinary decision node that `retract` and `purge` handle like any other.
