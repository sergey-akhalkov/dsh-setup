# work-checkpoints delta

## MODIFIED Requirements

### Requirement: Checkpoint request

The plugin SHALL inject one bounded checkpoint request before the close and when the step interval
is reached. The request SHALL name the tool-call count, the step count and interval, up to a bounded
number of written paths, the last shell command and its exit state, the last failed tool result,
each lane whose state did not change for `laneStaleCheckpoints` checkpoints, the age of the current
bottleneck, worker starts, the steps since the last successful worker start, and the distinct
first-path-component groups of the written paths, when observed. It SHALL ask for the lane plan, the
bottleneck and its remedy, and the next action, and SHALL include the advisory sentence defined by
**Mid-turn serial suggestion** when that requirement's conditions hold. It MUST be attributed to
`goal-continuity` and stay within `maxMessageChars`.

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

#### Scenario: Worker signal is named

- **WHEN** a successful worker start was observed in the turn
- **THEN** the request names the steps since that start and the worker starts

#### Scenario: Written groups are named

- **WHEN** the turn wrote paths under at least two distinct first path components
- **THEN** the request names the groups, bounded to three

#### Scenario: Redaction

- **WHEN** the observed evidence contains a machine path or an obvious credential
- **THEN** the request redacts it before injection

#### Scenario: Message bound

- **WHEN** the observed evidence is longer than `maxMessageChars`
- **THEN** the request is truncated to the bound

#### Scenario: Attribution

- **WHEN** the request is injected
- **THEN** its source is `goal-continuity` so the shipped row counts it

### Requirement: Periodic mid-turn checkpoint

The plugin SHALL steer one bounded checkpoint request when a root turn reaches `stepInterval` steps
(default 40) since the turn start or the latest checkpoint, provided the turn has at least one
successful write or worker start (or `requireWrite` is false) and the last tool call is not
`ask_user_question`. It MUST NOT steer within `stepInterval` steps of a successful checkpoint and
MUST NOT start an idle agent. The pre-step listener SHALL receive the turn's abort signal, MUST NOT
submit a request after that signal is set, and SHALL remove a request it submitted when the turn
aborts. When `checkpoint.automation` and `checkpoint.periodic` are both false, the plugin MUST NOT
steer a periodic request.

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

#### Scenario: Stopped before the interval

- **WHEN** the turn's abort signal is set before the interval boundary is evaluated
- **THEN** no periodic request is submitted

#### Scenario: Queued request is removed on stop

- **WHEN** a periodic request was submitted and the turn's abort signal aborts before the request is claimed
- **THEN** the request is removed from the agent inbox and no new turn starts from it

#### Scenario: Automation off sends no request

- **WHEN** `automation` is false, `periodic` is false, and a root turn reaches the interval boundary
- **THEN** the plugin steers no checkpoint request

#### Scenario: Periodic notice with the gate retired

- **WHEN** `automation` is false, `periodic` is true, and a root turn reaches the interval boundary
- **THEN** the plugin steers the request and no close, parallel, remedy, or age gate is enabled

### Requirement: Configuration and off switch

The checkpoint SHALL be enabled by default with `minToolCalls`, `requireWrite`, `maxBlocks`,
`enforceParallel`, `maxMessageChars`, `stepInterval` (default 40), `bottleneckAge` (default 2),
`laneStaleCheckpoints` (default 2), and `periodic` (default false), validated fail-loud; unknown or
out-of-range fields SHALL fail plugin load with a field diagnostic. `checkpoint.enabled: false`
SHALL disable only the checkpoint; disabling the plugin row or `enabled: false` SHALL disable it
with the rest of the bundle.

#### Scenario: Default configuration

- **WHEN** a profile mounts the row with default configuration
- **THEN** the checkpoint is enabled with the documented defaults, including `stepInterval: 40`,
  `bottleneckAge: 2`, `laneStaleCheckpoints: 2`, and `periodic: false`

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

#### Scenario: Invalid periodic switch

- **WHEN** `periodic` is not a boolean
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

### Requirement: Gate-only retirement switch

The checkpoint provider SHALL support `automation: false`, which keeps the `work_checkpoint` tool,
its local record, and the lane schema, while disabling the close gate, the parallel gate, the
remedy gate, and the bottleneck-age gate. The periodic request SHALL follow `checkpoint.periodic`
independently, so a notice may still be steered while every gate is retired. When automation is
false, the `retro` workflow definition SHALL be the enforcing path and MUST be `own`; a `defer`
definition beside the disabled automation MUST be refused because no enabled legacy source remains.

#### Scenario: Tool remains available

- **WHEN** `automation` is false
- **THEN** `work_checkpoint` still accepts a call, writes its record, and returns the decision summary

#### Scenario: Gates are silent

- **WHEN** `automation` is false and a turn stops without a checkpoint
- **THEN** the checkpoint provider does not steer or refuse the close

#### Scenario: Workflow owns the close

- **WHEN** `automation` is false and the `retro` definition is `own`
- **THEN** the workflow requests the checkpoint and refuses the close until a fresh record exists

#### Scenario: Notice with the gate retired

- **WHEN** `automation` is false and `periodic` is true and the step interval is reached
- **THEN** the request is steered and no close gate is enabled

#### Scenario: Defer is refused without automation

- **WHEN** `automation` is false and the `retro` definition is `defer`
- **THEN** the definition is refused and neither owner is silently left without an enforcing checkpoint

#### Scenario: Rollback

- **WHEN** `automation` is true again
- **THEN** the checkpoint provider's gates steer again and the `retro` definition MUST return to `defer`

## ADDED Requirements

### Requirement: Mid-turn serial suggestion

The plugin SHALL add at most one advisory sentence to the periodic checkpoint request when no
successful worker start occurred since the previous checkpoint or turn start and at least two
distinct first-path-component groups were written. The sentence SHALL name the first two groups and
offer a worker for one only "if they are independent"; it MUST say to keep the plan serial
otherwise. A worker start, fewer than two groups, or no write MUST NOT receive a suggestion.

#### Scenario: Two groups without a worker

- **WHEN** no worker started in the interval and two distinct written groups exist
- **THEN** the request names both groups and carries one advisory split sentence

#### Scenario: Worker already started

- **WHEN** a successful worker start occurred in the interval
- **THEN** the request carries no split suggestion

#### Scenario: One group

- **WHEN** every written path in the turn shares one first path component
- **THEN** the request carries no split suggestion and makes no serial claim

#### Scenario: No write

- **WHEN** the turn has no observed write
- **THEN** the request carries no split suggestion

### Requirement: Suggestion is advisory and bounded

The suggestion MUST NOT claim that the groups are independent and MUST NOT require a tool call or
refuse a close. Under `maxMessageChars` pressure it SHALL be dropped before the evidence body, and
the questions tail SHALL survive.

#### Scenario: Advice is not an obligation

- **WHEN** the suggestion is injected and the agent keeps the plan serial
- **THEN** the close is not refused for that choice and the existing lane and remedy rules decide

#### Scenario: Budget pressure

- **WHEN** the request with the suggestion would exceed `maxMessageChars`
- **THEN** the suggestion is dropped first and the evidence and the questions tail fit the bound
