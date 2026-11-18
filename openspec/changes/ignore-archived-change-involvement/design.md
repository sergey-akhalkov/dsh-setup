# Design

## Context

See `proposal.md` - Why. The turn-close trigger path builds the session's involvement from three
sources (durable record, in-memory set, this turn's attributed writes), then evaluates each
condition-bearing definition once per involved change name. The whole-spec review's condition reads
`session.involved`, which is true whenever a change name is iterated - an archived name included.
The close gate then computes a review obligation for every open run carrying a review step, keyed by
the run's recorded change name, and `evaluateTurnClose` decides the review branch before the
terminal-run allowance. An archived change makes both wrong: the trigger starts a round whose review
cannot read the change, and the failed run refuses every later close.

An active-change filter already exists in the gate path (`involvedChangesOf` ->
`activeChangeNames`), so this change reuses that predicate instead of adding a new notion of
"active".

## Goals / Non-Goals

**Goals:**

- A persisted involvement that names an archived or missing change starts no conditional definition
  and needs no `.dsh` cleanup.
- An open failed or blocked review run bound to an archived change never holds the close.
- An active involved change keeps today's review round, refusal, and waiting-close behavior.

**Non-Goals:**

- Pruning involvement files, or making `writeInvolvement` persist an empty list.
- Cancelling, deleting, or rewriting runs of archived changes; they stay readable history.
- Changing review rules, dedupe keys, the waiting close, `maxBlocks`, or the archive gate.

## Decisions

**D1 - Filter the involvement union in the trigger path, not inside `readInvolvement`.**
The union also carries in-memory and turn-attributed names, which a reader-side filter would miss,
and `readInvolvement` is also used by the recording merge that writes the record back. Filtering the
union at the trigger path with `activeChangeNames(workspace)` keeps the reader a pure persisted-set
reader and mirrors the existing gate-path filter. Alternative rejected: change `readInvolvement`'s
contract so every caller filters at once - it would couple a leaf utility to change-activity and
still miss the in-memory names.

**D2 - The close gate skips the run instead of passing no review input.**
`evaluateTurnClose` refuses an open run that reached an owned review step in a separate branch
(`reviewObligationReached` plus a review step) even when no resolved review input is supplied, so
omitting the input alone would still refuse. Skipping the run before the gate evaluates it removes
every refusal path for a change that cannot be reviewed. Alternative rejected: make the gate accept
an "inactive" flag - a new parameter on a hot, well-tested decision function for one caller.

**D3 - Skip only an archived change's review run.**
`retro`, `verify`, and other runs keep today's semantics; only a review run is unrecoverable for an
archived change, because its evidence and artifacts are gone. A *missing* change (never created, or
deleted) keeps refusing: the existing recordless-failure regression requires its failed review to
steer the cause instead of passing silently, and a deleted change is an error worth surfacing. This
is the narrowest rule that closes the reported storm. Alternative rejected: skip every non-active
change - it drops that real failure.

**D4 - The stale involvement record stays on disk.**
No pruning and no empty-list write: the record is ignored when read, so a stale file is harmless and
the next involvement write may replace it. Alternative rejected: write and prune an empty list - it
adds a state transition (and an empty-file format) for no observable behavior.

**D5 - The anti-overfilter test is a canary, not a mutation-check case.**
`(c)` proves an active change still starts its round; it passes before and after the fix by design.
The mutation check applies to `(a)` and `(b)` (they must fail with the fix reverted), and `(c)` must
fail under an over-filter mutation that drops active names too.

## Risks / Trade-offs

- [An unreadable `openspec/changes` makes every change inactive] -> the existing predicate already
  never throws and returns an empty set; the close then starts no review and no review run holds it,
  which fails open instead of storming. No new failure mode.
- [A change re-created with the same name re-activates old runs] -> such runs are terminal
  (`failed`/`cancelled`) and a terminal run is never steered or revived; only a live run would be
  evaluated again, and a live run cannot exist for an archived change.
- [One extra `readdir` per involved event and per close] -> `activeChangeNames` is a single bounded
  directory listing already used by the gate path on every close.

## Migration Plan

No stored-state or configuration migration. Deploy by releasing the plugin; a stale involvement
record is ignored immediately after the update. Rollback is the previous version, which re-reads the
record as before.

## Open Questions

None.
