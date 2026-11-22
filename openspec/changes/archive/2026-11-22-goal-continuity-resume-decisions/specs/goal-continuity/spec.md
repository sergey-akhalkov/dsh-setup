# Spec Delta

## MODIFIED Requirements

### Requirement: Continuity supervision boundary

The continuity supervisor SHALL supervise only a root agent's current goal and SHALL use only the DSH goal service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block an active goal with a terminal reason, and inject a notice. It MAY observe the session's own log and the workspace's local checkpoint records as evidence for a continuation decision; such an observation MUST NOT start, continue, or cancel a turn. The continuity supervisor MUST NOT call the model, start or cancel a turn, spawn a session, or use a waking delivery. The block-review gate is a separate responsibility of the same plugin: for one proposed `blocked` update it MAY start one bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or cancel a turn or change the goal. The same gate also reviews a root agent's `ask_user_question` call in an open goal round of an active goal: it MAY start one bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or cancel a turn, and MUST NOT block, pause, resume, or complete the goal. The work-checkpoint capability is a separate responsibility of the same plugin: it MAY steer one checkpoint step at a substantial turn close and record the checkpoint, and it MUST NOT start an idle agent, continue a goal, or change it.

#### Scenario: Root agent is supervised

- **WHEN** a root agent has a current goal
- **THEN** the supervisor may act on that goal under the requirements below

#### Scenario: Fork and subagent are excluded

- **WHEN** a forked or subagent session has a current goal
- **THEN** the supervisor acts on nothing and delivers no notice for that session

#### Scenario: Notice delivery never starts a turn

- **WHEN** the supervisor delivers a notice to an idle agent
- **THEN** the agent remains idle and no model turn starts

#### Scenario: Evidence read is not continuation

- **WHEN** the supervisor reads the session log or a checkpoint record to decide a continuation
- **THEN** the read starts no turn, calls no model, and changes no goal phase or activation

#### Scenario: Block review is not continuation

- **WHEN** a root agent proposes a block and the block-review gate reviews it
- **THEN** the gate starts at most one review subagent and returns a tool-call decision, and no model turn or goal continuation starts from the review

#### Scenario: Question review is not continuation

- **WHEN** a root agent asks a question in an open goal round and the gate reviews it
- **THEN** the gate starts at most one review subagent and returns a tool-call decision, and no model turn, goal phase, or goal continuation starts from the review

#### Scenario: Speed review is not continuation

- **WHEN** a profile carries the removed `speedReview` configuration
- **THEN** no review child starts and no root model turn or goal continuation starts from that configuration

#### Scenario: Checkpoint is not continuation

- **WHEN** a substantial turn close is checkpointed
- **THEN** the plugin does not start an idle agent and does not change the goal, and the goal driver may continue only after the turn closes

### Requirement: Active disarmed goal reconciliation

When the row is enabled and a root agent is settled with a current goal in phase `active` and activation `disarmed`, the supervisor SHALL resume it, unless a suppression, a restart policy, an exhausted budget, the checkpoint-evidenced continuation rule, the no-effect round rule, or a pending retry delay applies. A stale goal reference MUST NOT fail the session; the supervisor re-reads the current goal.

#### Scenario: Non-goal turn aborted by a recoverable cause

- **WHEN** a non-goal turn is aborted by a recoverable hook cause and the turn settles with the goal active and disarmed and no withholding rule applies
- **THEN** the supervisor resumes the goal and records one notice

#### Scenario: Evidence withholds the resume

- **WHEN** a settled turn leaves the goal active and disarmed and the recorded evidence withholds continuation
- **THEN** the supervisor does not resume the goal, records one notice naming that evidence, and leaves the goal active and disarmed

#### Scenario: Stale goal reference

- **WHEN** the goal revision changed between the read and the resume
- **THEN** the supervisor reads the current goal again and does not throw

### Requirement: User abort policy

A user abort of a goal round MUST suppress automatic resumes until the next direct user message. Under the default `resumeAfterUserStop` policy `never`, a user abort of a turn that is not a goal round MUST also suppress automatic resumes until the next direct user message, MUST disarm an armed goal so it cannot continue on its own, and SHALL record one notice. With `resumeAfterUserStop` set to `non-goal`, the supervisor MAY re-arm the goal once that turn settles, and it MUST apply the checkpoint-evidenced continuation rule and the no-effect round rule first. A user abort MUST NOT be read as evidence that the goal is incomplete or that work remains.

#### Scenario: Stop during a goal round is respected

- **WHEN** the user aborts a goal round
- **THEN** the supervisor suppresses resumes until the next direct user message

#### Scenario: Stop on a non-goal turn does not kill the goal

- **WHEN** the user aborts a turn that is not a goal round
- **THEN** the goal keeps its phase under either policy and is never paused, blocked, or completed, so a later direct user message or an explicit resume still applies, and no resume follows from the abort alone

#### Scenario: Strict stop policy

- **WHEN** the user aborts a turn that is not a goal round and `resumeAfterUserStop` is `never`
- **THEN** the supervisor suppresses resumes until the next direct user message, resumes nothing, records one notice, and this is the shipped default

#### Scenario: Opt-in non-goal Stop is evidenced

- **WHEN** the user aborts a turn that is not a goal round, `resumeAfterUserStop` is `non-goal`, and the recorded evidence withholds continuation
- **THEN** the supervisor does not resume the goal and records one notice naming that evidence

#### Scenario: Stop is not evidence of remaining work

- **WHEN** the user aborts any turn
- **THEN** the plugin does not treat the abort itself as proof that the objective has unfinished work

### Requirement: Visible bounded notices

Every automatic resume or cap extension SHALL deliver one bounded non-waking notice through the agent inbox; it MUST NOT start a turn. Every terminal refusal SHALL leave a visible record: a `continuity-stopped` block on the active goal, or the native `round-limit` block when the goal is already blocked for that reason. It SHALL inject one bounded non-waking notice naming the cause, the remaining budget, and the next action. A resume notice SHALL name the next action itself, and a notice that names no next action MUST NOT be delivered. A withheld resume SHALL inject one bounded non-waking notice naming the evidence it read and the user action that clears the suppression.

#### Scenario: Automatic action is explained

- **WHEN** the supervisor resumes a goal after a recoverable abort
- **THEN** one bounded notice names the cause, the retry count, and the next action, and an idle agent stays idle

#### Scenario: Resume notice carries the next action

- **WHEN** the supervisor resumes from a plan whose next action is readable
- **THEN** the notice carries that next action instead of a generic instruction to continue the objective

#### Scenario: Stopped continuation is visible

- **WHEN** the supervisor stops automatic continuation
- **THEN** one bounded non-waking notice names the evidence and the user action, and no model turn starts

#### Scenario: Terminal refusal is visible without a turn

- **WHEN** a terminal stop or an exhausted budget ends automatic continuation
- **THEN** the goal carries a `continuity-stopped` or native `round-limit` visible record with the reason, and no model turn starts

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row and a read-only reviewer preset declaration in the same bundle fragment. The preset SHALL expose only read-only tools; the gate SHALL apply the reviewer-scoped allowlist through the reviewer child's own scope. The preset SHALL be selected only by the block review. A disabled row or `enabled: false` MUST restore stock DSH behavior with no disarm, resume, cap extension, block, suppression, notice, block review, question review, or work checkpoint from the plugin; the preset declaration remains installed but is selected only by the reviews. The shipped defaults SHALL be enabled, `resumeAfterRestart: false`, `resumeAfterUserStop: never`, `blockReview.enabled: true`, `blockReview.reviewQuestions: true`, and `checkpoint.enabled: true`; a profile MAY override them. A legacy `speedReview` object MUST be accepted and ignored with a warning.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, a user Stop suppresses continuation, a proposed block is reviewed, a goal-round question is reviewed, a substantial pause is checkpointed, and the gate selects the `goal-reviewer` preset

#### Scenario: Default Stop policy

- **WHEN** a profile mounts the row without setting `resumeAfterUserStop`
- **THEN** the effective policy is `never` and the generated patch records that value

#### Scenario: Preset declaration is installed

- **WHEN** the setup is installed
- **THEN** the composed profile contains the `preset-goal-reviewer` declaration, the preset exposes only read-only tools, and the reviews apply the reviewer-scoped allowlist to the child

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, notice, block review, question review, or checkpoint, and the unused preset changes nothing

#### Scenario: Legacy speed review configuration

- **WHEN** a profile still sets a `speedReview` object
- **THEN** the plugin loads, reports one warning, and runs no speed review

### Requirement: Recoverable reset continuation

After the pause prevention, the supervisor SHALL resume the active disarmed goal once within the resume budget, unless the checkpoint-evidenced continuation rule or the no-effect round rule stops it first. It MUST NOT resume a `paused` goal, so a pause is reserved for the user abort policy.

#### Scenario: Guard reset is translated into continuation

- **WHEN** a goal round is aborted by a loop-guard reset, the goal is active and disarmed, and no continuation rule stops it
- **THEN** the supervisor resumes the goal and records one notice naming the retry budget

#### Scenario: Reset is stopped by evidence

- **WHEN** a goal round is aborted by a loop-guard reset and a fresh plan declares `outcome: done` or a `user_decision` bottleneck
- **THEN** the supervisor resumes nothing and records one notice naming that plan

#### Scenario: Reset is stopped by two no-effect rounds

- **WHEN** a reset-aborted round makes the second consecutive no-effect round
- **THEN** the supervisor resumes nothing and records one notice naming the no-effect rounds

#### Scenario: Paused goal is never resumed

- **WHEN** the goal is paused
- **THEN** the supervisor does not resume it

### Requirement: Reset at the round cap

When the active disarmed goal has `roundsStarted` at or above `maxGoalRounds` and no continuation rule stops it, the supervisor SHALL extend `maxGoalRounds` by the configured extension under the per-goal extension budget before resuming. When no continuation rule stops it and the extension budget or the hard total cap is exhausted, it MUST NOT resume and SHALL block the goal with `continuity-stopped` and a bounded reason.

#### Scenario: Reset on the last permitted round

- **WHEN** a recoverable reset leaves an active disarmed goal that already spent its round budget, the extension budget is available, and no continuation rule stops it
- **THEN** the supervisor extends the cap, resumes the goal, and records one notice

#### Scenario: Withheld reset extends no cap

- **WHEN** a recoverable reset leaves an active disarmed goal at its cap and a continuation rule stops it
- **THEN** the supervisor extends no cap, resumes nothing, leaves the phase active, and records one notice naming the rule

#### Scenario: No extension capacity at the cap

- **WHEN** a recoverable reset leaves an active disarmed goal at its cap, no continuation rule stops it, and the extension budget or the hard total cap is exhausted
- **THEN** the supervisor blocks the goal with `continuity-stopped` and the reason

## ADDED Requirements

### Requirement: Continuation evidence

Before deciding continuation, the supervisor SHALL read the latest successful `work_checkpoint` plan recorded after the most recent user signal (a direct message or an answered `ask_user_question`) and at or before the settled turn, counting a plan from that turn or the one before. The decision runs at every settled turn of an active goal, whatever its activation. An older, stale, absent, or unreadable plan is no evidence, and reading it MUST NOT change the goal phase.

#### Scenario: Armed goal is decided too

- **WHEN** a goal round of an armed goal settles
- **THEN** the supervisor reads the continuation evidence for that turn before the driver can admit the next round

#### Scenario: A user answer invalidates the earlier plan

- **WHEN** the user sends a direct message and no new plan is recorded afterwards
- **THEN** a plan from before that message is not evidence for the next settled turn, and the unevidenced rule applies instead

#### Scenario: An answered question invalidates the plan that asked it

- **WHEN** a plan names a `user_decision` bottleneck and the model asks through `ask_user_question` and receives an answer
- **THEN** that plan is not evidence for the next settled turn, so the decision the user supplied cannot replay as a stop

#### Scenario: Stale plan is no evidence

- **WHEN** the latest plan is older than the turn before the settled turn
- **THEN** the supervisor treats it as absent and uses it neither to withhold nor to justify a resume

#### Scenario: Unreadable plan is no evidence

- **WHEN** the latest record cannot be parsed or lacks a required field
- **THEN** the supervisor treats it as absent and does not fail the session

#### Scenario: Evidence read changes no goal

- **WHEN** the supervisor reads the evidence for a continuation decision
- **THEN** the goal keeps its phase and activation, so a later user message or an explicit resume still applies

### Requirement: Evidence stops automatic continuation

A fresh plan that declares `outcome: done`, or that names a `user_decision` bottleneck, MUST stop automatic continuation when the settled turn ended for a recoverable reason: disarm an armed goal, resume no disarmed one, record one notice. A user-aborted goal round and a terminal end reason keep their own record instead. Nothing else stops it. The phase MUST NOT change.

#### Scenario: Terminal end reason keeps its own stop

- **WHEN** a turn with a stopping plan ends at the token limit, an agent error, or a final hook cause
- **THEN** the terminal policy delivers the single notice and record, no evidence notice is added, and the plan still counts as recorded evidence for the next settled round

#### Scenario: Done plan stops an armed goal

- **WHEN** a goal round leaves the goal active and armed and the latest fresh plan declares `outcome: done`
- **THEN** the supervisor disarms the goal before the driver admits another round, records one notice, and leaves the phase active

#### Scenario: Done plan withholds a disarmed resume

- **WHEN** the goal is active and disarmed and the latest fresh plan declares `outcome: done`
- **THEN** the supervisor does not resume the goal and records one notice naming the plan

#### Scenario: User-decision bottleneck stops continuation

- **WHEN** the latest fresh plan declares `outcome: continue` and names a bottleneck with `action: user_decision`
- **THEN** the supervisor disarms an armed goal or resumes nothing for a disarmed one, and records one notice naming the bottleneck and the plan's next action

#### Scenario: Resumable plan stops nothing

- **WHEN** the latest fresh plan declares `outcome: continue` with a worker-start or lead-action bottleneck
- **THEN** the plan stops nothing, an armed goal keeps running, and a disarmed goal is resumed

### Requirement: Continue plan supplies the next action

A fresh plan that withholds nothing SHALL supply the resume notice's next action, taken from the plan's own `next` text.

#### Scenario: Continue plan resumes with its next action

- **WHEN** the latest fresh plan declares `outcome: continue` without a `user_decision` bottleneck
- **THEN** the supervisor resumes the goal and the notice carries the plan's next action

### Requirement: Unevidenced resume asks for a decision

A resume with no fresh plan SHALL deliver a notice that requires the next round to either make a concrete step or record a `work_checkpoint` plan. The notice MUST NOT instruct the agent to continue the objective without naming what to do.

#### Scenario: No-evidence resume requests a decision

- **WHEN** the supervisor resumes a goal with no fresh plan
- **THEN** the notice requires a concrete step or a recorded plan, and names both outcomes

#### Scenario: Generic continuation is not delivered

- **WHEN** the supervisor resumes a goal
- **THEN** the notice does not consist of an instruction to continue the current objective

### Requirement: No-effect round stop

A goal round is no-effect when it made no successful write, no worker start, and no successful `work_checkpoint`. Every settled round counts, whatever its end reason. Two consecutive no-effect rounds MUST stop continuation the same way on a recoverable end reason. A user-aborted goal round and a terminal end reason keep their own record. An effective round or a direct message resets the count, and the phase MUST NOT change.

#### Scenario: First no-effect round is tolerated

- **WHEN** a goal round is no-effect and no earlier consecutive no-effect round applies
- **THEN** the supervisor may continue normally under the other continuation rules

#### Scenario: Second consecutive no-effect round stops

- **WHEN** two consecutive goal rounds are no-effect
- **THEN** the supervisor disarms an armed goal or resumes nothing for a disarmed one, records one notice naming the no-effect rounds, and leaves the phase active

#### Scenario: Aborted no-effect rounds count

- **WHEN** two consecutive goal rounds end through an aborted turn and neither produced a write, a worker start, or a checkpoint
- **THEN** the supervisor stops automatic continuation as it does for two completed no-effect rounds

#### Scenario: Effective round resets the count

- **WHEN** any goal round makes a write, starts a worker, or records a checkpoint
- **THEN** the no-effect count is zero and a later no-effect round is tolerated again

#### Scenario: Direct message resets the count

- **WHEN** the user sends a direct message
- **THEN** the no-effect count is zero

### Requirement: User abort outranks a continuation stop

A user abort of a goal round ends that turn through the driver's pause, which is the durable record of the user's decision. A continuation stop MUST NOT disarm such a round and MUST NOT pre-empt that pause; the evidence and the count are still recorded and the stop applies to the next settled round. A user abort of any other turn follows the configured policy: `never` disarms an armed goal and suppresses, while `non-goal` applies the continuation evidence and may continue.

#### Scenario: User Stop on a no-effect goal round keeps its pause

- **WHEN** the second consecutive no-effect round is a goal round the user aborted
- **THEN** the supervisor disarms nothing, the driver records the pause, and the count and evidence are still recorded

#### Scenario: Strict policy Stop stops an armed goal

- **WHEN** the user aborts a turn that is not a goal round, `resumeAfterUserStop` is `never`, and the goal is armed
- **THEN** the supervisor disarms the goal and suppresses the resume, and the phase stays active

#### Scenario: Opt-in policy Stop follows the evidence

- **WHEN** the user aborts a turn that is not a goal round, `resumeAfterUserStop` is `non-goal`, and a fresh plan allows continuation
- **THEN** an armed goal keeps running and a disarmed goal is resumed, so the opt-in differs from `never`
