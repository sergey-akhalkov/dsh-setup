# Proposal

## Why

The only mechanism that reaches a working session with state-derived checkpoint evidence before the
turn closes is the mid-turn request in `goal-continuity`. The shipped setup retired it when the
checkpoint close moved to the workflows `retro` definition (`checkpoint.automation: false`), so
advice about a bottleneck or a second independent stream now arrives only at the turn close, when
that turn's plan can no longer change. Even when the request was active it carried evidence and
questions but never a conclusion. A local audit of 93 root sessions with at least 100 steps found 35
with no worker start, and only 7 of 402 v2 checkpoint records computed parallel work.

## What Changes

- Add `checkpoint.periodic` (boolean, default `false`) to `goal-continuity`: a notice-only switch
  that steers the existing bounded checkpoint request at `stepInterval` even while
  `checkpoint.automation` stays `false`. It enables no close, parallel, remedy, or age gate.
- When the request is composed, name the steps since the last worker start and the distinct written
  path groups. When no worker started in the interval and at least two groups were written, add one
  advisory sentence naming a possible split; otherwise add no suggestion.
- Carry the turn's abort signal through the periodic steer: a stopped turn submits no request, and a
  queued request is removed from the inbox on abort.
- Set `checkpoint.periodic: true` in the shipped setup defaults while keeping `automation: false`,
  so the workflows `retro` definition remains the close-gate owner.
- Update the checkpoint documentation and tests for the new switch, the signal, and the suggestion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-checkpoints`: the periodic switch, the request's serial signal and suggestion, the config
  field, and the gate-only retirement semantics.
- `goal-continuity`: the work-checkpoint capability boundary (mid-turn request as well as the close)
  and the shipped defaults.

## Impact

- `packages/plugin-goal-continuity`: config schema, pre-step registration, evidence collection, and
  request composition, plus unit tests.
- `packages/setup/defaults.yml` and the generated setup patch: `checkpoint.periodic: true`.
- `docs/principles.md`, `docs/goal-continuity.md`, `docs/plugins.md`.
- No new dependency, tool, record, log, metric, UI surface, or workflow definition. The workflows
  `retro` definition, `work_checkpoint` schema, and review gates are unchanged.
