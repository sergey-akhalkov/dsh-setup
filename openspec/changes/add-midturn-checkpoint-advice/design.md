# Design

## Context

The checkpoint capability is split: `goal-continuity` owns the `work_checkpoint` tool, its record,
the request composer, and the `agent/pre-step` hook; the workflows `retro` definition owns the close
gate while `checkpoint.automation` is `false`; `observability` reads the session log after the fact.
The request registration sits behind the same `automation` switch as the close gates, so retiring
the close also retired the only mid-turn notice.

See `proposal.md` for the measured gap. The constraints are the workflows ownership rule (the
`retro` definition stays `own`), the bounded request budget, and the existing `goal-continuity`
config field diagnostics.

## Goals / Non-Goals

**Goals:**

- Restore one bounded mid-turn request without changing which component owns the close gate.
- Add a conclusion to the request when the turn's own observations support one.
- Keep the advice advisory, bounded, redacted, and optional.

**Non-Goals:**

- Re-enabling `checkpoint.automation` or flipping `retro` to `defer`.
- A new workflow trigger, review, gate, metric, record, or UI.
- Changing the `work_checkpoint` schema, the close-time gate rules, or the review gates.
- Claiming that two written groups are independent; the sentence stays conditional.

## Decisions

### D1. A notice-only `checkpoint.periodic` switch in `goal-continuity`

Register the pre-step listener and the shell-observation listener when `automation || periodic`, and
steer only the request when `periodic` is on and `automation` is off. Keep the turn-stopping close
gate behind `automation` alone, so the gate owner does not change. `retro` stays `own`.

Alternatives considered:

- `checkpoint.automation: true` with `retro: defer` (the spec-supported rollback). Rejected: it
  reverses the workflows-owned checkpoint and the workflows spec's "Owned checkpoint gate" requires
  the legacy automation to stay off while `retro` is `own`; the user-facing outcome is the same
  without the rollback.
- A periodic trigger in the workflows engine. Rejected: it duplicates the composer, evidence,
  redaction, and attribution for a per-step notice, and the engine has no per-step trigger.
- Leaving the request off. Rejected by the measured gap: advice at close cannot change that turn.

### D2. The signal is computed live from the current turn

At request time use only what the turn already observes: steps since the last successful worker
start (or turn start), the written paths grouped by their first path component (deduplicated, at
most three), and whether a worker started since the previous checkpoint or turn start.

Alternatives considered:

- Reuse `serialRunFindings`. Rejected: an episode closes at the next human message, session end, or
  idle gap, so a live turn has no completed episode to evaluate.
- Ask the model without a signal (the current request). Rejected: that is the gap.
- Read git status. Rejected: a larger surface for no extra signal; written paths already exist.

### D3. One conditional sentence, never an obligation

Add a suggestion only when no worker started in the interval and at least two written groups exist.
The sentence names the first two groups, offers a worker for one "if they are independent", and says
to keep the plan serial otherwise. A turn with a worker start, one group, or no write gets no
suggestion and no synthetic claim.

Rationale: two groups are necessary but not sufficient for independent work; an advisory sentence
costs one line on a false positive, while a gate would cost a refused close and an unwanted worker.
The close-time lane, parallel, remedy, and age rules remain the only enforcement.

### D4. The request stays bounded, cancellable, and attributed

The new lines are part of the existing `maxMessageChars` message; the suggestion is dropped first
under budget pressure and the questions tail survives. Redaction and the no-idle-start,
`requireWrite`, and `ask_user_question` guards are unchanged.

The pre-step listener passes the turn's abort signal through `evaluateStep` to the existing `steer`
helper. A stopped turn submits no request, and a request already queued is removed from the agent
inbox when the signal aborts, matching the close path. This is required because the shipped setup
will run periodic requests under `automation: false`; without the signal, a stop could leave a
request that wakes another turn.

Attribution stays `goal-continuity` with the `work_checkpoint` tool match; no new storage.

### D5. Defaults and rollback

The plugin default is `periodic: false` (standalone installs opt in; `automation: true` keeps its
existing periodic behavior). The shipped setup sets `periodic: true` with `automation: false`.
Validation is fail-loud on a non-boolean value. Rollback is `checkpoint.periodic: false`; no release
downgrade.

## Risks / Trade-offs

- Noise in long sessions -> the interval, `requireWrite`, the no-idle-start rule, and the conditional
  suggestion bound it; the switch can be turned off per profile.
- A false split suggestion -> the sentence says "if they are independent"; it never requires a
  worker, and the review gates are unchanged.
- Two requests near a close -> the periodic request is suppressed within `stepInterval` of a
  successful checkpoint, and `retro` remains the only close gate; existing per-turn budgets are
  untouched.
- A stopped turn keeps a queued request -> the pre-step abort signal reaches `steer`, which revokes
  the message; tests cover abort before the interval and abort after the request is queued.
- Config drift between the plugin and the setup row -> the setup composition test and the mirrored
  defaults cover it.
- The audit sample is one workspace -> the change is justified by the missing mechanism, not by the
  exact rate; the suggestion stays conservative.

## Migration Plan

1. Add the config field and the listener split (pre-step and shell observation when enabled, close
   gate behind `automation`); keep the default `false`.
2. Add the signal and the suggestion to the composer, and pass the abort signal through the steer.
3. Set the setup default to `true`, run `pnpm gen`, and commit the regenerated patch.
4. Update the docs and specs.
5. Rollback: set `checkpoint.periodic: false`; the close gate is unaffected.
