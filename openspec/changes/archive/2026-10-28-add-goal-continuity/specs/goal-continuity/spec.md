# Spec Delta

## Purpose

Keeps an existing DSH goal alive across recoverable harness stops while leaving real blockers and explicit user intent untouched.

## ADDED Requirements

### Requirement: Continuity supervision boundary

The supervisor SHALL supervise only a root agent's current goal and SHALL use only the DSH goal service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block an active goal with a terminal reason, and inject a notice. It MUST NOT call the model, start or cancel a turn, spawn a session, or use a waking delivery.

#### Scenario: Root agent is supervised

- **WHEN** a root agent has a current goal
- **THEN** the supervisor may act on that goal under the requirements below

#### Scenario: Fork and subagent are excluded

- **WHEN** a forked or subagent session has a current goal
- **THEN** the supervisor acts on nothing and delivers no notice for that session

#### Scenario: Notice delivery never starts a turn

- **WHEN** the supervisor delivers a notice to an idle agent
- **THEN** the agent remains idle and no model turn starts

### Requirement: Active disarmed goal reconciliation

When the row is enabled and a root agent is settled with a current goal in phase `active` and activation `disarmed`, the supervisor SHALL resume it, unless a suppression, a restart policy, an exhausted budget, or a pending retry delay applies. A stale goal reference MUST NOT fail the session; the supervisor re-reads the current goal.

#### Scenario: Non-goal turn aborted by a recoverable cause

- **WHEN** a non-goal turn is aborted by a recoverable hook cause and the turn settles with the goal active and disarmed
- **THEN** the supervisor resumes the goal and records one notice

#### Scenario: Stale goal reference

- **WHEN** the goal revision changed between the read and the resume
- **THEN** the supervisor reads the current goal again and does not throw

### Requirement: Restart policy

The supervisor SHALL treat the first observation of an agent after process start as a restart. When `resumeAfterRestart` is false it MUST NOT resume an active disarmed goal on that observation; when true it SHALL resume it once. A disarm observed later in the same process SHALL follow the reconciliation requirement.

#### Scenario: Restart does not revive work by default

- **WHEN** the process starts with an active disarmed goal and `resumeAfterRestart` is false
- **THEN** the supervisor leaves the goal disarmed until a later in-process event or a user action

#### Scenario: Opt-in restart resume

- **WHEN** the process starts with an active disarmed goal and `resumeAfterRestart` is true
- **THEN** the supervisor resumes the goal once and records one notice

### Requirement: Goal-round hook abort pause prevention

When a goal-round `turn/end` carries a hook cause, the supervisor SHALL disarm the goal before the driver's idle settlement, so the driver does not record a pause for the cancelled goal round. The rule covers `loop-guard:reset:`, `loop-guard:final:`, and an unrecognized hook cause. It MUST NOT change the phase of a goal that is already `paused`, and it MUST NOT disarm for a user abort.

#### Scenario: Reset does not become a pause

- **WHEN** a goal round ends with a reset cause
- **THEN** the supervisor disarms the goal before the idle settlement and the driver records no pause

#### Scenario: Final stop does not become a pause

- **WHEN** a goal round ends with a final cause
- **THEN** the supervisor disarms the goal before the idle settlement and the driver records no pause

#### Scenario: Unrecognized hook cause does not become a pause

- **WHEN** a goal round ends with an unrecognized hook cause
- **THEN** the supervisor disarms the goal before the idle settlement and the driver records no pause

#### Scenario: User pause is untouched

- **WHEN** the goal is already paused by the user
- **THEN** the supervisor changes no phase

#### Scenario: User abort keeps its pause

- **WHEN** the user aborts a goal round rather than a hook cause
- **THEN** the supervisor does not disarm the goal and the driver's pause remains the user's stop

### Requirement: Recoverable reset continuation

After the pause prevention, the supervisor SHALL resume the active disarmed goal once within the resume budget. It MUST NOT resume a `paused` goal, so a pause is reserved for the user abort policy.

#### Scenario: Guard reset is translated into continuation

- **WHEN** a goal round is aborted by a loop-guard reset and the goal is active and disarmed
- **THEN** the supervisor resumes the goal and records one notice naming the retry budget

#### Scenario: Paused goal is never resumed

- **WHEN** the goal is paused
- **THEN** the supervisor does not resume it

### Requirement: Reset at the round cap

When the active disarmed goal has `roundsStarted` at or above `maxGoalRounds`, the supervisor SHALL extend `maxGoalRounds` by the configured extension under the per-goal extension budget before resuming. When the extension budget or the hard total cap is exhausted it MUST NOT resume and SHALL block the goal with `continuity-stopped` and a bounded reason.

#### Scenario: Reset on the last permitted round

- **WHEN** a recoverable reset leaves an active disarmed goal that already spent its round budget and the extension budget is available
- **THEN** the supervisor extends the cap, resumes the goal, and records one notice

#### Scenario: No extension capacity at the cap

- **WHEN** a recoverable reset leaves an active disarmed goal at its cap and the extension budget or the hard total cap is exhausted
- **THEN** the supervisor blocks the goal with `continuity-stopped` and the reason

### Requirement: Bounded round-cap extension

When the current goal is `blocked` with `blockedReason.code` exactly `round-limit`, the supervisor SHALL raise `maxGoalRounds` by the configured extension and resume the goal, within the per-goal extension budget and the hard total cap. On exhaustion it MUST keep the goal blocked and inject one non-waking notice. It MUST NOT change a block whose code is `model-reported`.

#### Scenario: Round limit is extended

- **WHEN** the goal is blocked with code `round-limit` and the extension budget is available
- **THEN** the supervisor raises the cap by the configured amount, resumes the goal, and records one notice

#### Scenario: Extension budget exhausted

- **WHEN** the goal reaches `round-limit` after the per-goal extension budget is spent
- **THEN** the supervisor keeps the goal's native `round-limit` block as the visible record and injects one non-waking notice

#### Scenario: Model block is untouched

- **WHEN** the goal is blocked with code `model-reported`
- **THEN** the supervisor changes nothing and does not resume

### Requirement: User abort policy

A user abort of a goal round MUST suppress automatic resumes until the next direct user message. A user abort of a turn that is not a goal round SHALL NOT suppress when `resumeAfterUserStop` is `non-goal`; the supervisor MAY re-arm the goal once that turn settles. With `resumeAfterUserStop` set to `never` the supervisor MUST suppress until the next direct user message.

#### Scenario: Stop during a goal round is respected

- **WHEN** the user aborts a goal round
- **THEN** the supervisor suppresses resumes until the next direct user message

#### Scenario: Stop on a non-goal turn does not kill the goal

- **WHEN** the user aborts a turn that is not a goal round and `resumeAfterUserStop` is `non-goal`
- **THEN** the supervisor may re-arm the goal after that turn settles and records one notice

#### Scenario: Strict stop policy

- **WHEN** the user aborts a turn that is not a goal round and `resumeAfterUserStop` is `never`
- **THEN** the supervisor suppresses resumes until the next direct user message

### Requirement: Terminal hook and infrastructure stop suppression

The supervisor MUST NOT resume a goal after a `loop-guard:final:` or unrecognized hook cause, a `max-tokens` turn end, or an agent error. It SHALL block the active goal with `continuity-stopped` and a bounded reason; a goal already paused by the user SHALL stay paused. It SHALL suppress automatic resumes until the next direct user message.

#### Scenario: Final hook stop on a goal round

- **WHEN** a goal round ends with a final cause and the pause was prevented
- **THEN** the supervisor blocks the active goal with `continuity-stopped` and the reason

#### Scenario: Final hook stop on a non-goal turn

- **WHEN** a non-goal turn ends with a final or unrecognized hook cause and the goal is active and disarmed
- **THEN** the supervisor blocks the goal with `continuity-stopped` and does not resume it

#### Scenario: Infrastructure stop

- **WHEN** a turn ends with `max-tokens` or the agent reports an error
- **THEN** the supervisor blocks an active goal with the reason and waits for a direct user message

#### Scenario: User pause is preserved

- **WHEN** the goal is already paused by the user
- **THEN** the supervisor leaves the phase and reason unchanged

### Requirement: Explicit user and model stop preservation

The supervisor MUST NOT resume a goal after a user pause, clear or complete, or a `model-reported` block, and MUST NOT change those states. It SHALL suppress automatic resumes until the next direct user message.

#### Scenario: User pause stays paused

- **WHEN** the user pauses the goal
- **THEN** the supervisor never resumes it automatically

#### Scenario: Model block is preserved

- **WHEN** the goal is blocked with code `model-reported`
- **THEN** the supervisor leaves the phase and reason unchanged

### Requirement: Visible bounded notices

Every automatic resume or cap extension SHALL deliver one bounded non-waking notice through the agent inbox; it MUST NOT start a turn. Every terminal refusal SHALL leave a visible record: a `continuity-stopped` block on the active goal, or the native `round-limit` block when the goal is already blocked for that reason. It SHALL inject one bounded non-waking notice naming the cause, the remaining budget, and the next action.

#### Scenario: Automatic action is explained

- **WHEN** the supervisor resumes a goal after a recoverable abort
- **THEN** one bounded notice names the cause, the retry count and the next action, and an idle agent stays idle

#### Scenario: Terminal refusal is visible without a turn

- **WHEN** a terminal stop or an exhausted budget ends automatic continuation
- **THEN** the goal carries a `continuity-stopped` or native `round-limit` visible record with the reason, and no model turn starts

### Requirement: Bounded automatic continuation

The supervisor SHALL enforce a per-session resume budget, a per-goal round-extension budget, and a hard total round cap. A completed goal round MUST NOT refill the resume budget. When any budget is exhausted the supervisor MUST stop automatic continuation and report instead of retrying.

#### Scenario: Resume budget is exhausted

- **WHEN** the per-session resume budget is spent and another recoverable abort arrives
- **THEN** the supervisor does not resume and records the exhausted budget

#### Scenario: Hard total cap is enforced

- **WHEN** a round-cap extension would exceed the hard total cap
- **THEN** the supervisor leaves the goal blocked and records the cap

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row. A disabled row or `enabled: false` MUST restore stock DSH behavior with no disarm, resume, cap extension, block, suppression, or notice from the plugin. The shipped defaults SHALL be enabled, `resumeAfterRestart: false`, and `resumeAfterUserStop: non-goal`; a profile MAY override them.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, and a non-goal user stop re-arms the goal

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, or notice
