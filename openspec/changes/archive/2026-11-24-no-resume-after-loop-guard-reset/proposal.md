# Proposal

## Why

A `loop-guard:reset` turn end means the loop guard stopped the model because a reasoning line kept
repeating; it is not a transient harness interruption. The supervisor today treats it as recoverable
and resumes the goal ("resumed the goal after a recoverable loop-guard reset", resumes 1 and 2 of 20
in the recorded session `session-ea02b074`), which re-arms automatic work on top of a model that is
still looping and adds notices and rounds to the cascade the user sees.

## What Changes

- **BREAKING** (for the documented reset policy): a `loop-guard:reset` turn end no longer resumes the
  goal. The supervisor keeps the existing disarm-before-idle behaviour (so the driver records no
  pause) and delivers one bounded notice naming the reset and the recovery (send a message, or
  `/goal resume` below the cap).
- The goal phase stays `active`; nothing is blocked and nothing is resumed. The next direct user
  message or an explicit `/goal resume` continues the goal, exactly as after an evidence stop. When
  the preceding continuation decision already stopped the round, its suppression and single notice
  stay, and the reset adds none.
- The generic capped-goal path is unchanged: at the reset itself nothing is extended, and after a
  direct message clears the stop the existing extension raises `maxGoalRounds` before the resume. The
  "Reset at the round cap" requirement is restated to say exactly that instead of describing a
  reset resume.
- A user Stop, a final or unrecognized hook cause, a token limit, and an agent error keep their
  current handling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-continuity`: the "Recoverable reset continuation" requirement is replaced by a
  reset-does-not-continue requirement, and the "Reset at the round cap" requirement is restated for
  the generic capped-goal path (reset at the cap extends nothing; a later user signal recovers
  through the existing extension).

## Impact

- `packages/plugin-goal-continuity/src/host/index.ts` (turn-end hook handling and the reconcile path
  that resumes a disarmed goal).
- `packages/plugin-goal-continuity/test/supervisor.test.ts` and
  `packages/plugin-goal-continuity/test/resume-evidence.test.ts`.
- `docs/plugins.md` (goal continuity: "prevents the goal driver's pause for a loop-guard reset").
- No configuration field, notice channel, or stored state changes; a profile needs no migration.
