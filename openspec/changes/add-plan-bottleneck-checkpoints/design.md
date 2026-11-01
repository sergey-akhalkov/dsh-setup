# Design

## Context

See `proposal.md` — Why. The current implementation lives in `packages/plugin-goal-continuity`:
`agent/pre-step` steers one bounded request at `stepInterval` (40) steps, `agent/turn-stopping`
refuses the close until a fresh checkpoint exists, and the `work_checkpoint` tool writes one atomic,
redacted, untracked record under `.dsh/work-checkpoints/<session>/<turn>.json`. The parallel gate
already requires a tagged worker start when the checkpoint *declares* parallel work, but the
declaration is a boolean the model writes, and the serial escape is free text. The always-on
contract is capped at 1500 estimated tokens, so new text replaces existing text. Records are local
and untracked; the change must not add a log, a storage surface, or a package.

The observed failure is not a missing trigger: after the tool was loaded, 16 of 16 checkpoints in
the reference session were reached, and 12 declared the same serial reason. The plugin could not
tell that the plan was unchanged, that the bottleneck remedy was never attempted, or that the same
owner kept the same lanes blocked for hours.

## Goals / Non-Goals

**Goals:**

- Make the checkpoint carry a checkable plan: lanes with owners and scopes, a derived remainder.
- Derive the parallel obligation from the plan instead of trusting a flag.
- Require the bottleneck remedy to be executed before the close, with the missing evidence named.
- Escalate a bottleneck that survives a second checkpoint without a data change.
- Surface stalled lanes in the request so a long lane becomes a decision, not silence.
- Keep every refusal under the existing `maxBlocks` budget and fail open.
- Measure the effect from the records, with no new log.

**Non-Goals:**

- No reviewer child, second model call, timer, or separate reflection skill.
- No automatic worker dispatch: the lead writes the brief; the gate only refuses a close without it.
- No coupling to a Team board or to OpenSpec task ids; a lane id is local to the checkpoint.
- No change to `task-review`, `spec-review`, the block review, or the archive gate.
- No new package, bundle row, installer array, market entry, or DSH version change.

## Decisions

### 1. Lanes are the plan and the remainder is derived

The tool accepts `lanes[]` and a `bottleneck` object; `remaining` disappears. A lane is
`{id, owner, scope[], state, blockedBy[]}`. Validation: unique ids, `blockedBy` names an existing
lane, at least one scope entry, at most 8 lanes, `state` in `running|blocked|done`. The record
stores the plan and the derived remainder.

Alternative: keep `remaining` and reconcile it with the board. Rejected: the board may be absent in
a single-agent profile, and free text is exactly what went stale. The checkpoint is the smallest
artifact that works with or without a board.

### 2. Parallelizability is computed from the plan

`runnable(lane) = state == running && every blockedBy lane is done`. The plugin computes parallel
work when two runnable lanes have different owners and their scopes do not overlap. Scope overlap is
component-aware containment (case-insensitive, `\\` and `/` unified): equal, or one path beneath the
other, so `src` and `src2` are disjoint. A scope entry beginning with `resource:` matches exactly, so
two lanes sharing `resource:live-stand` are serial by construction. The existing tagged-worker gate then applies unchanged: a worker start whose arguments
contain the checkpoint id, or a later checkpoint in the same turn whose plan removes the pair. The
existing `WORKER_START_TOOLS` classifier and its cached-delegate exclusion stay the definition of a
worker start for both gates; this change does not extend the classifier, so `send_message` is not a
start.

Alternative: validate the `serialReason` text against the lanes. Rejected: brittle and still
model-authored. Alternative: require a worker for every runnable lane. Rejected: one dispatch that
unblocks the pair is enough progress for this gate; the next checkpoint recomputes.

### 3. The remedy is a tool call, not a sentence

A `continue` checkpoint carries
`bottleneck: {id, owner, action, blockingLanes[], targets[]}`. `action` is `worker_start`,
`lead_action`, or `user_decision`; `targets` is required for `lead_action` and lists file or
directory paths. After the checkpoint and before the close, the plugin looks for one matching call:
a successful worker start from the same classifier the parallel gate uses
(`WORKER_START_TOOLS`, excluding a cached `delegate` reuse) whose arguments contain the checkpoint
id; an `edit`/`write` that completes successfully and whose `file_path` equals a declared target or
lies beneath a declared directory target; or `ask_user_question`. No match refuses the close with a
steer naming the bottleneck's action, blocking lanes, and the missing evidence. The destination
match is component-aware containment on a successful result, never the call's other arguments: the
destination must equal the target or lie beneath it by path component, so `src2/file.ts` does not
match `src`, and a failed or pending write is not evidence. A write to `notes.md` whose content
mentions a declared target is not evidence, and a shell command whose text contains the target is
not evidence either. A command-only remedy is therefore not verifiable; the checkpoint must
dispatch it, edit the target, or ask the user.

Alternative: keep the sentence and trust it. Rejected by the reference session, where a named
bottleneck was followed by ten-minute waits. Alternative: make `next` the evidence. Rejected:
`next` may describe several steps and cannot be matched.

### 4. Bottleneck age is counted by owner and blocking lanes

The plugin reads the previous checkpoint record of the same session and counts consecutive
checkpoints whose bottleneck has the same owner and the same blocking lane ids. At
`bottleneckAge` (default 2) the close is refused until the owner changes, a blocking lane changes
state, or a `user_decision` question was asked. A record from another session, a record without a
bottleneck, or a legacy record without the object does not count.

Alternative: count by bottleneck id. Rejected: renaming the id would reset the age while the same
owner keeps the same lanes blocked. Counting the lanes and the owner makes the reset require a data
change.

### 5. Stalled lanes are surfaced, not gated

The request names each lane whose state did not change for `laneStaleCheckpoints` (default 2)
checkpoints, and the current bottleneck's age. The model must then classify the lane or make it the
bottleneck. No gate: a long build or a bounded live run is legitimate, and a hard rule would force
fake state changes.

### 6. Keep the trigger, the budget, and fail-open behavior

The trigger stays `agent/pre-step` at `stepInterval` plus `agent/turn-stopping`. All new refusals
share `maxBlocks`; after the cap the close is allowed with an UNCHECKED notice that is not a pass.
Internal state errors fail open. Subagent turns are not evaluated. `checkpoint.enabled: false`
disables the checkpoint only; `enforceParallel: false` disables the parallel gate only.

### 7. No reviewer child

The removed goal-round speed review was the only independent reflection child; it ran once in the
reference session and produced no verdict. Reintroducing it would add a model call whose failure is
silent, and the verdict would still be unchecked. The engine is the critic: it supplies observed
facts and verifies the decision. Independent review stays with `task-review`/`spec-review` and the
manual `advisor`/`blocker` rules.

### 8. Record v2, legacy v1 readable

The record gains `lanes`, `bottleneck`, `derivedRemaining`, `parallelComputed`, `remedy`, and
`bottleneckAge`; it keeps the checkpoint id, turn, time, session, redaction, and bounds. The reader
tolerates a v1 record (no lanes or bottleneck) and does not treat it as a satisfied plan; the next
checkpoint writes v2. No migration script: the records are local and untracked.

### 9. Measurement is derived, not claimed

The observability row already counts `work_checkpoint` by tool name. The checkpoint extraction
keeps metadata only: lane count, blocked lane count, the computed parallel flag, the bottleneck
action, the bottleneck age, and whether the remedy was matched before the next checkpoint.
`metrics.ts` aggregates four counters from it: parallel share, blocked-lane rate, remedy resolution
(share of `continue` checkpoints resolved before the next checkpoint), and dispatch per checkpoint
(worker starts between two checkpoints). The existing report surface renders them, and
`hypotheses.ts` adds `parallel-share` and `remedy-resolution` to the fixed metric catalog so a
hypothesis can compare them, with the existing guardrail and sample rules. Verification uses known
checkpoint and worker sequences with exact expected numbers, and the metrics must read not
applicable when the window holds no checkpoint. No new log, storage surface, or raw text.

## Risks / Trade-offs

- **Ritual migration**: the model can invent lanes, share scopes, or rename bottlenecks. → The
  escapes require data changes, and the record is auditable; the counters (parallel share,
  blocked-lane rate, remedy resolution) detect migration. If the blocked rate stays near 100 %, the
  next tightening is to require scope entries to exist as paths, not before.
- **Over-strict for genuinely serial work**: a single owner, a shared scope, or a blocked lane is
  the serial form. A no-worker profile reports nothing from the parallel gate; `enforceParallel`
  is the off switch; the cap still allows the close with UNCHECKED.
- **More refusals in long turns**: one refusal costs a step. The interval (40) bounds the count; the
  shared `maxBlocks` bounds a stuck turn. Measure before changing either.
- **Command-only remedies are not evidence**: a build or live run fixes a bottleneck without an
  `edit`/`write`, so the gate refuses it. The checkpoint must dispatch that work (`worker_start`),
  edit the target file, or ask the user; the steer names the action and the target.
- **Re-tasking is not a start**: `send_message` does not satisfy `worker_start`, because the shared
  classifier excludes it. A lead that only re-tasks an existing worker must use `delegate`, spawn a
  worker, or let the lane state change resolve the bottleneck.
- **Windows target matching**: normalize separators and case; a declared target matches an equal
  destination or a descendant by path component, never a textual sibling, and only after a
  successful result. The steer names the target when no call matches.
- **Tool schema break**: a profile that calls the tool with v1 arguments gets a field diagnostic
  naming the removed field. The setup release note states the break; rollback is uninstalling the
  row or disabling the checkpoint, which keeps continuity supervision and the block review.
- **Contract budget**: the three clauses are rewritten, not appended; the budget test must pass.

## Migration Plan

1. Ship the plugin change in the next setup version; no data migration is needed.
2. On an existing profile, the first checkpoint after the upgrade writes v2; v1 records stay
   readable and do not satisfy the plan or the age check.
3. Rollback: disable `checkpoint` (supervision and block review keep running) or `enforceParallel`
   (the parallel gate only). Uninstalling the row reverts to the previous setup version.
