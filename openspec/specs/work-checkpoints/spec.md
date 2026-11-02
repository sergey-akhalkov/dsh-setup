# work-checkpoints Specification

## Purpose
Defines a substantial-pause work checkpoint that requires a verified, parallel-or-serial decision before an agent's working turn can close.

## Requirements

### Requirement: Substantial-pause trigger

The plugin SHALL require one work checkpoint when a root agent's turn closes after at least
`minToolCalls` tool calls (default 4) and, when `requireWrite` is true (the default), at least one
successful `edit`/`write` or worker start. It MUST NOT trigger for a subagent turn, an aborted turn,
a turn whose last tool call is `ask_user_question`, or a turn whose latest checkpoint is younger
than `stepInterval` steps. A turn MUST trigger at most one checkpoint per `stepInterval`.

#### Scenario: Working turn

- **WHEN** a root agent's turn closes with four tool calls and one successful write
- **THEN** the plugin requires one checkpoint

#### Scenario: Read-only turn

- **WHEN** a turn closes with four read-only calls and no write or worker start
- **THEN** no checkpoint is required

#### Scenario: Read-only turn when writes are not required

- **WHEN** `requireWrite` is false and a turn closes with four read-only calls
- **THEN** one checkpoint is required

#### Scenario: Trivial turn

- **WHEN** a turn closes with two tool calls and one successful write
- **THEN** no checkpoint is required

#### Scenario: Awaiting user answer

- **WHEN** the last tool call of the turn is `ask_user_question`
- **THEN** no checkpoint is required

#### Scenario: Subagent turn

- **WHEN** a subagent turn closes after substantial work
- **THEN** no checkpoint is required

#### Scenario: Aborted turn

- **WHEN** a turn is aborted before its close
- **THEN** no checkpoint is required

#### Scenario: One checkpoint per turn

- **WHEN** a turn already contains a checkpoint younger than `stepInterval` steps
- **THEN** no further checkpoint is required for that turn

#### Scenario: Stale checkpoint

- **WHEN** the latest checkpoint in the turn is `stepInterval` or more steps old and the turn closes
- **THEN** one new checkpoint is required

### Requirement: Checkpoint request

The plugin SHALL inject one bounded checkpoint request before the close and when the step interval
is reached. The request SHALL name the tool-call count, the step count and interval, up to a bounded
number of written paths, the last shell command and its exit state, the last failed tool result,
each lane whose state did not change for `laneStaleCheckpoints` checkpoints, the age of the current
bottleneck, and worker starts, when observed. It SHALL ask for the lane plan, the bottleneck and its
remedy, and the next action. It MUST be attributed to `goal-continuity` and stay within
`maxMessageChars`.

#### Scenario: Evidence is named

- **WHEN** a substantial turn closes
- **THEN** the request names the tool-call count, the written paths, and any worker start

#### Scenario: Shell result is named

- **WHEN** a shell command ran during the turn
- **THEN** the request names that command and its exit state

#### Scenario: Failed result is named

- **WHEN** a tool result failed during the turn
- **THEN** the request names the failed tool without its full output

#### Scenario: Interval request names the step count

- **WHEN** the request is steered at the step interval
- **THEN** it names the step count and the interval

#### Scenario: Lane plan is asked

- **WHEN** the request is injected
- **THEN** it asks for the lanes, their owners and scopes, and their states

#### Scenario: Bottleneck is asked

- **WHEN** the request is injected
- **THEN** it asks for the current bottleneck, its owner, its blocking lanes, and the action that
  removes it

#### Scenario: Stale lane is named

- **WHEN** a lane's state did not change for `laneStaleCheckpoints` checkpoints
- **THEN** the request names that lane and its age

#### Scenario: Bottleneck age is named

- **WHEN** the current bottleneck persists across checkpoints
- **THEN** the request names its age

#### Scenario: Redaction

- **WHEN** the observed evidence contains a machine path or an obvious credential
- **THEN** the request redacts it before injection

#### Scenario: Message bound

- **WHEN** the observed evidence is longer than `maxMessageChars`
- **THEN** the request is truncated to the bound

#### Scenario: Attribution

- **WHEN** the request is injected
- **THEN** its source is `goal-continuity` so the shipped row counts it

### Requirement: Checkpoint tool and record

The plugin SHALL register a `work_checkpoint` tool that accepts the outcome `done` or `continue`,
verified facts, the lane plan, the bottleneck and its remedy, and the next action. A successful call
SHALL write one atomic, bounded, redacted local record under
`.dsh/work-checkpoints/<session>/<turn>.json`, return a short summary, and be reused for the same
turn; a later call in the same turn replaces the record with the latest decision. The record MUST
NOT be tracked.

#### Scenario: Continue with a lane plan and remedy

- **WHEN** the outcome is `continue` and the call carries a valid lane plan, a bottleneck with a
  remedy, and a next action
- **THEN** the call succeeds and the record is written

#### Scenario: Missing lane plan

- **WHEN** the outcome is `continue` and `lanes` is empty or absent
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Missing bottleneck

- **WHEN** the outcome is `continue` and the bottleneck or its action is empty or absent
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Continue with a serial reason

- **WHEN** a `continue` call carries `parallel: false`, a serial reason, and no lane plan
- **THEN** the call is rejected with a field diagnostic naming the removed fields and the missing
  lane plan

#### Scenario: Missing serial reason

- **WHEN** a `continue` call omits both the lane plan and a serial reason
- **THEN** the call is rejected with a field diagnostic naming `lanes` as required

#### Scenario: Parallel declaration

- **WHEN** a `continue` call carries `parallel: true` and a bottleneck but no lane plan
- **THEN** the call is rejected with a field diagnostic naming `parallel` as removed

#### Scenario: Done without a plan

- **WHEN** the outcome is `done` and the call omits `lanes` and the bottleneck
- **THEN** the call succeeds and the record states completion

#### Scenario: Invalid field

- **WHEN** the call carries an unknown field, an unknown outcome, or a missing next action
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Record is local

- **WHEN** the record is written
- **THEN** it is under `.dsh/work-checkpoints/`, bounded, redacted, and not a tracked file

#### Scenario: Record reuse

- **WHEN** the same turn calls `work_checkpoint` more than once
- **THEN** the latest call replaces the record and no duplicate record is created

#### Scenario: Latest decision wins

- **WHEN** the turn closes after more than one checkpoint
- **THEN** the close gate reads the latest decision

#### Scenario: Summary returned

- **WHEN** the call succeeds
- **THEN** the result contains the record path and a bounded summary of the decision

### Requirement: Record write failure

A checkpoint call SHALL count as a successful checkpoint for the close gate when the local record cannot be written. The tool SHALL return the decision with a bounded warning naming the record failure and MUST NOT claim a record exists.

#### Scenario: Record cannot be written

- **WHEN** the local record cannot be written
- **THEN** the call succeeds with a warning and the close gate counts the checkpoint

### Requirement: Close gate

After a substantial pause the plugin SHALL refuse the turn close until a successful checkpoint
younger than `stepInterval` steps exists for the turn, steering the request on each refusal. It
SHALL also refuse a close whose checkpoint names a bottleneck whose remedy is not executed or whose
bottleneck reached `bottleneckAge`. It SHALL allow at most `maxBlocks` refusals per turn and then
allow the close with a visible UNCHECKED notice that is not a pass. It MUST fail open on an internal
state error and MUST NOT evaluate a subagent turn.

#### Scenario: Missing checkpoint

- **WHEN** the turn closes after a substantial pause with no successful checkpoint
- **THEN** the close is refused and the checkpoint request is steered

#### Scenario: Checkpoint satisfies

- **WHEN** a successful checkpoint younger than `stepInterval` steps exists for the turn
- **THEN** the close is allowed

#### Scenario: Stale checkpoint

- **WHEN** the latest checkpoint in the turn is `stepInterval` or more steps old and the turn closes
- **THEN** the close is refused and a new checkpoint request is steered

#### Scenario: Two-step checkpoint

- **WHEN** a checkpoint was recorded 2 steps before the close and `stepInterval` is 40
- **THEN** the close is allowed without another request

#### Scenario: Remedy outstanding

- **WHEN** the checkpoint names a remedy that no later call executed
- **THEN** the close is refused and the steer names the missing evidence

#### Scenario: Aged bottleneck

- **WHEN** the checkpoint's bottleneck reached `bottleneckAge` and no escape applies
- **THEN** the close is refused and the steer requires a route change

#### Scenario: Cap reached

- **WHEN** the turn has reached `maxBlocks` refusals
- **THEN** the close is allowed with a visible UNCHECKED notice and no checkpoint is claimed

#### Scenario: Fail open

- **WHEN** the plugin cannot read its own state
- **THEN** the close is allowed and no verification or checkpoint is claimed

#### Scenario: Subagent turn

- **WHEN** the turn belongs to a subagent
- **THEN** the close gate does not evaluate it

### Requirement: Parallel-action gate

When the plugin computes parallel remaining work from the checkpoint's lane plan, it SHALL require a
successful worker start whose arguments contain the checkpoint id before the turn closes, or a later
checkpoint in the same turn whose lane plan removes the parallel work. Two lanes are parallel when
both are runnable, they have different owners, and their scopes do not overlap, compared by path
components so `src` and `src2` are disjoint. A failed or untagged worker start MUST NOT satisfy the
gate.

#### Scenario: Worker start satisfies

- **WHEN** a worker start after the checkpoint contains the checkpoint id
- **THEN** the gate passes

#### Scenario: Plan amendment satisfies

- **WHEN** a later checkpoint in the turn changes the plan so only one lane is runnable
- **THEN** the gate passes

#### Scenario: Serial amendment

- **WHEN** a later checkpoint in the turn changes the plan so the remaining work is serial, through a
  shared scope, a single owner, or a blocked lane
- **THEN** the gate passes

#### Scenario: Textual sibling is disjoint

- **WHEN** two runnable lanes have scopes `src` and `src2`
- **THEN** the plugin computes parallel work, because neither scope contains the other by path
  component

#### Scenario: Shared scope is serial

- **WHEN** two runnable lanes share a scope entry
- **THEN** the plugin does not compute parallel work

#### Scenario: Same owner is serial

- **WHEN** two runnable lanes have the same owner
- **THEN** the plugin does not compute parallel work

#### Scenario: Blocked lane is not runnable

- **WHEN** a lane is blocked by a lane that is not `done`
- **THEN** it does not count as runnable

#### Scenario: Failed worker start

- **WHEN** a worker start fails or does not contain the checkpoint id
- **THEN** it does not satisfy the gate

#### Scenario: Untagged worker

- **WHEN** a worker start does not contain the checkpoint id
- **THEN** it does not satisfy the gate

### Requirement: Parallel gate refusal and cap

The plugin SHALL steer on each unsatisfied parallel-gate close with the checkpoint id, share the
`maxBlocks` budget with the close gate, and after the cap allow the close with a visible UNCHECKED
notice. When no worker-start tool is registered, `enforceParallel` is false, or the checkpoint
outcome is `done`, the gate SHALL report nothing.

#### Scenario: Missing worker

- **WHEN** the turn closes after a computed parallel plan with no tagged worker start and no plan
  amendment
- **THEN** the gate steers with the checkpoint id and the turn does not close for this gate

#### Scenario: Repeated close

- **WHEN** the turn closes again after an unsatisfied parallel gate and remains below the cap
- **THEN** the gate steers again and does not close for this gate

#### Scenario: Cap reached

- **WHEN** the parallel gate reaches `maxBlocks`
- **THEN** the close is allowed with a visible UNCHECKED notice and no worker start is claimed

#### Scenario: No worker tool

- **WHEN** no worker-start tool is registered
- **THEN** the gate reports nothing and the turn may close

#### Scenario: Gate disabled

- **WHEN** `enforceParallel` is false
- **THEN** the gate reports nothing and the turn may close

#### Scenario: Done outcome

- **WHEN** the checkpoint outcome is `done`
- **THEN** the gate reports nothing

### Requirement: Goal rounds

The trigger SHALL apply to a goal round's turn close through the same path. The checkpoint MUST NOT change the goal, block the goal's continuation after the turn closes, or replace the block review. The next goal round SHALL see the checkpoint through the session log.

#### Scenario: Goal round close

- **WHEN** a goal round ends after substantial work
- **THEN** the checkpoint is required before the turn closes

#### Scenario: Continuation

- **WHEN** the checkpoint is recorded and the turn closes
- **THEN** the goal driver may continue the goal

#### Scenario: Block review

- **WHEN** the same turn proposes a block
- **THEN** the block review still runs independently

#### Scenario: No separate trigger

- **WHEN** a goal round ends
- **THEN** no second goal-round-specific checkpoint is required

### Requirement: Configuration and off switch

The checkpoint SHALL be enabled by default with `minToolCalls`, `requireWrite`, `maxBlocks`,
`enforceParallel`, `maxMessageChars`, `stepInterval` (default 40), `bottleneckAge` (default 2), and
`laneStaleCheckpoints` (default 2), validated fail-loud; unknown or out-of-range fields SHALL fail
plugin load with a field diagnostic. `checkpoint.enabled: false` SHALL disable only the checkpoint;
disabling the plugin row or `enabled: false` SHALL disable it with the rest of the bundle.

#### Scenario: Default configuration

- **WHEN** a profile mounts the row with default configuration
- **THEN** the checkpoint is enabled with the documented defaults, including `stepInterval: 40`,
  `bottleneckAge: 2`, and `laneStaleCheckpoints: 2`

#### Scenario: Configurable interval

- **WHEN** the profile sets `stepInterval` to 25
- **THEN** the mid-turn trigger uses 25 steps

#### Scenario: Configurable thresholds

- **WHEN** the profile sets `bottleneckAge` to 3 and `laneStaleCheckpoints` to 1
- **THEN** the age refusal and the stale-lane evidence use those values

#### Scenario: Invalid step interval

- **WHEN** `stepInterval` is zero, negative, or not an integer
- **THEN** plugin load fails with a field diagnostic

#### Scenario: Invalid threshold

- **WHEN** `bottleneckAge` or `laneStaleCheckpoints` is zero, negative, or not an integer
- **THEN** plugin load fails with a field diagnostic

#### Scenario: Section disabled

- **WHEN** `checkpoint.enabled` is false
- **THEN** no checkpoint runs and continuity supervision and the block review still run

#### Scenario: Row disabled

- **WHEN** the plugin row is disabled or `enabled` is false
- **THEN** continuity supervision, the block review, and the checkpoint do not run

#### Scenario: Invalid field

- **WHEN** a checkpoint field is unknown, mistyped, or outside its range
- **THEN** plugin load fails with a field diagnostic

### Requirement: Observable attribution

The checkpoint request, the checkpoint tool call, and the close notice SHALL be attributable to the goal-continuity observability row through the existing `goal-continuity` source kind and a `work_checkpoint` tool match. The plugin MUST NOT add a separate log, storage surface, or persisted telemetry.

#### Scenario: Request attributed

- **WHEN** the checkpoint request is injected
- **THEN** the shipped goal-continuity row can attribute it to the checkpoint request

#### Scenario: Tool counted

- **WHEN** the `work_checkpoint` tool runs
- **THEN** the shipped goal-continuity row can count it by tool name

#### Scenario: No separate log

- **WHEN** the checkpoint is recorded
- **THEN** only the local record and the session log are written, with no new log or storage surface

### Requirement: Periodic mid-turn checkpoint

The plugin SHALL steer one bounded checkpoint request when a root turn reaches `stepInterval` steps
(default 40) since the turn start or the latest checkpoint, provided the turn has at least one
successful write or worker start (or `requireWrite` is false) and the last tool call is not
`ask_user_question`. It MUST NOT steer within `stepInterval` steps of a successful checkpoint and
MUST NOT start an idle agent.

#### Scenario: Interval reached

- **WHEN** a root turn with a successful write reaches `stepInterval` steps since the turn start or
  the latest checkpoint
- **THEN** the plugin steers one bounded checkpoint request

#### Scenario: Recent checkpoint

- **WHEN** the latest checkpoint was recorded 2 steps before the next interval boundary
- **THEN** no new request is steered

#### Scenario: No write

- **WHEN** the turn has no successful write or worker start and `requireWrite` is true
- **THEN** no request is steered

#### Scenario: Awaiting user answer

- **WHEN** the last tool call of the turn is `ask_user_question`
- **THEN** no request is steered

#### Scenario: Subagent turn

- **WHEN** the turn belongs to a subagent
- **THEN** no request is steered

#### Scenario: Goal round

- **WHEN** a goal round's turn reaches the interval
- **THEN** the request is steered and the goal is unchanged

#### Scenario: No idle start

- **WHEN** no agent is running
- **THEN** the request is not injected

### Requirement: Lane plan

The work checkpoint SHALL carry the current work as lanes, each with an id, an owner, at least one
scope entry, a state of `running`, `blocked`, or `done`, and optional `blockedBy` lane ids. The
plugin MUST derive the remaining work from lanes that are not `done` and MUST reject duplicate ids,
an unknown `blockedBy`, an empty scope, or more than a bounded number of lanes.

#### Scenario: Lane plan recorded

- **WHEN** a `continue` checkpoint carries two lanes with owners, scopes, and states
- **THEN** the record stores both lanes and the derived remaining work

#### Scenario: Remaining derived

- **WHEN** one lane is `done` and another is `running`
- **THEN** the derived remaining work lists only the running lane

#### Scenario: Unknown blockedBy

- **WHEN** a lane is blocked by an id no lane defines
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Duplicate lane id

- **WHEN** two lanes share one id
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Empty scope

- **WHEN** a lane carries no scope entry
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Lane bound

- **WHEN** the plan carries more lanes than the configured bound
- **THEN** the call is rejected with a field diagnostic

### Requirement: Executed bottleneck remedy

A `continue` checkpoint SHALL carry a bottleneck with an id, an owner, an action of
`worker_start`, `lead_action`, or `user_decision`, the blocking lane ids, and, for `lead_action`,
the target paths. The plugin MUST refuse the close until a later tool call matches the action: a
successful worker start carrying the checkpoint id, a successful edit or write at a declared target,
or a question to the user.

#### Scenario: Worker start remedy

- **WHEN** the checkpoint names `worker_start` and a later worker start that the plugin's classifier
  counts carries the checkpoint id
- **THEN** the gate passes

#### Scenario: User decision remedy

- **WHEN** the checkpoint names `user_decision` and a later `ask_user_question` call runs
- **THEN** the gate passes and the question review still applies

#### Scenario: Missing remedy

- **WHEN** the turn closes after a `continue` checkpoint with no matching call
- **THEN** the close is refused and the steer names the action, the bottleneck id, and the missing
  evidence

#### Scenario: Non-start tool does not pass

- **WHEN** the checkpoint names `worker_start` and the only later call is `send_message` or
  `todo_write`
- **THEN** the gate does not pass

#### Scenario: Cached delegate does not pass

- **WHEN** a later `delegate` reuses an existing record instead of starting a run
- **THEN** the gate does not pass

#### Scenario: Unrelated worker

- **WHEN** a worker starts without the checkpoint id
- **THEN** the gate does not pass

#### Scenario: Done outcome

- **WHEN** the checkpoint outcome is `done`
- **THEN** the remedy gate reports nothing

### Requirement: Bottleneck remedy evidence

A remedy match SHALL require a completed successful result and, for `lead_action`, a destination path
equal to a declared target or beneath a declared directory target by path component. A failed or
pending call, a textual mention in written content or a shell command, and a textual sibling such as
`src2/file.ts` for `src` MUST NOT match.

#### Scenario: Lead action remedy

- **WHEN** the checkpoint names `lead_action` and a later `edit` or `write` completes successfully
  with a destination path equal to or beneath a declared target
- **THEN** the gate passes

#### Scenario: Wrong target

- **WHEN** the checkpoint names `lead_action` with a declared target and the later calls touch only
  other paths
- **THEN** the gate does not pass

#### Scenario: Sibling prefix does not pass

- **WHEN** the declared target is `src` and the destination is `src2/file.ts`
- **THEN** the gate does not pass

#### Scenario: Failed write does not pass

- **WHEN** the matching `edit` or `write` returns an error result
- **THEN** the gate does not pass

#### Scenario: Pending write does not pass

- **WHEN** the matching `edit` or `write` has no completed result before the close
- **THEN** the gate does not pass

#### Scenario: Content mention does not pass

- **WHEN** a write's destination is another path and its content only mentions a declared target
- **THEN** the gate does not pass

#### Scenario: Shell mention does not pass

- **WHEN** a shell command only contains a declared target in its text
- **THEN** the gate does not pass

### Requirement: Bottleneck age

The plugin SHALL read the previous checkpoint record of the same session and count consecutive
checkpoints whose bottleneck names the same owner and the same set of blocking lane ids. At
`bottleneckAge` such checkpoints (default 2) it MUST refuse the close until the owner changes, a
blocking lane changes state, or a `user_decision` question was asked. It MUST NOT count a record
from another session or one without a bottleneck.

#### Scenario: Age reached

- **WHEN** the second consecutive checkpoint names the same owner and blocking lanes, and no escape
  applies
- **THEN** the close is refused and the steer requires a route change

#### Scenario: Owner change

- **WHEN** the new checkpoint moves the bottleneck to a different owner
- **THEN** the age count resets and the close may pass

#### Scenario: Blocking lane resolved

- **WHEN** a blocking lane moves from `blocked` to `running` or `done`
- **THEN** that lane no longer counts as blocking and the age count resets

#### Scenario: User decision escape

- **WHEN** the aged checkpoint records `user_decision` and the question was asked
- **THEN** the close may pass and the decision stays in the record

#### Scenario: Legacy record

- **WHEN** the previous record predates the bottleneck object
- **THEN** no age is computed and the record is not an error

#### Scenario: Other session

- **WHEN** another session recorded a checkpoint with the same owner and blocking lanes
- **THEN** it does not count toward this session's age
