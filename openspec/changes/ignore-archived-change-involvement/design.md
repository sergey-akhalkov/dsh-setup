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
- Deleting runs of archived changes, or rewriting a terminal run's history; only an unresolved
  review run is settled cancelled once.
- Changing review rules, dedupe keys, the waiting close, `maxBlocks`, or the archive gate.

## Decisions

**D1 - Filter the involvement union in the trigger path, not inside `readInvolvement`.**
The union also carries in-memory and turn-attributed names, which a reader-side filter would miss,
and `readInvolvement` is also used by the recording merge that writes the record back. Filtering the
union at the trigger path with `activeChangeNames(workspace)` keeps the reader a pure persisted-set
reader and mirrors the existing gate-path filter. Alternative rejected: change `readInvolvement`'s
contract so every caller filters at once - it would couple a leaf utility to change-activity and
still miss the in-memory names.

**D2 - Settle an unresolved archived review run cancelled once, before the advance and the gate.**
The close advances every open run before it gates any, and an advance of an archived change's
review step settles the unreadable-artifact failure and persists the rewritten run. The exclusion is
applied to the advance pass as well as to the gate pass, and an unresolved run (`running` or
`blocked`) is settled `cancelled` once with a reason: a run preserved as `running` would keep
occupying a `maxRuns` slot forever (capacity counts only `running`/`blocked`), so an unrelated intake
would eventually be refused. A terminal run (`completed`, `failed`, `cancelled`, `interrupted`) is
still skipped and keeps its history byte-for-byte. Alternatives rejected: gate-only exclusion
(rewrites the history with a failed attempt); capacity exclusion (touches every admission path and
leaves unrecoverable runs open forever).

**D3 - Skip only an archived change's review run.**
`retro`, `verify`, and other runs keep today's semantics; only a review run is unrecoverable for an
archived change, because its evidence and artifacts are gone. Archived detection covers both
supported layouts - `archive/<date>-<name>` written by `openspec archive`, and `archive/<name>` from
a supported manual move - and because a date-prefixed name is itself a legal change name, an entry
such as `2026-01-01-keep` counts as both the dated layout of `keep` and the undated layout of
`2026-01-01-keep`. A *missing* change keeps refusing: the existing recordless-failure regression
requires its failed review to steer the cause instead of passing silently, and a deleted change is
an error worth surfacing. This is the narrowest rule that closes the reported storm. Alternative
rejected: skip every non-active change - it drops that real failure.

**D6 - Fence the committed approval on an active change.**
A reviewer that was already running when its change got archived can publish after the run settles
cancelled; writing the portable approval would `mkdir` the change directory and resurrect the
archived change as an active one. The single portable-approval writer therefore refuses when
`openspec/changes/<change>` is absent, returning an error that the publication path records without
a PASS. Alternative rejected: fence each caller (scheduler, task review, intake) - one choke point
covers every publication path, including a late retry.

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
