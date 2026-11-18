# Proposal

## Why

A session's durable involvement outlives the change it names: after `review-until-pass` was archived,
the session's stored involvement still named it, so the next turn close started a whole-spec review
for the archived change, the round failed on unreadable artifacts, and the review gate refused the
close with no refusal budget. Every close started another round, and the manual workaround was
editing `.dsh` by hand, which is not a fix: any future archive with a live involvement repeats the
storm.

## What Changes

- The turn-close trigger path filters the session's involvement — durable, in-memory, and this
  turn's attributed writes — with the active change names, so an archived or missing change starts
  no conditional definition (the whole-spec or integration review).
- The turn-close gate does not evaluate a run whose recorded change has been archived: an open
  failed or blocked review of an archived change neither refuses the close nor demands a recovery
  that cannot exist. The run stays readable history; nothing is cancelled or deleted. A missing
  change keeps the refusal, so a broken intake still surfaces its cause.
- The stored involvement file is ignored, not rewritten: a stale record is harmless, needs no manual
  `.dsh` cleanup, and is pruned only as a side effect of the next involvement write.
- An active involved change keeps today's behavior: its review round starts at the close and only a
  current `PASS` ends it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: `Session change involvement` now states that an archived or missing change is not
  involved even when the durable record still names it; `Turn-close gate` now states that a review
  run bound to an archived change never holds the close.

## Impact

- `packages/plugin-workflows/src/host/index.ts`: the trigger-path involvement set and the close-gate
  run evaluation; `packages/plugin-workflows/test/host-wiring.test.ts`: three host regressions;
  `docs/workflows.md` and `docs/openspec-status.md`; regenerated `packages/plugin-workflows/lib/**`.
- No public API, definition schema, configuration, or dependency change. An archived change's runs
  and involvement record stay on disk unchanged.
