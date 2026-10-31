# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
is reached. The request SHALL name the tool-call count, the step count and interval, up to a
bounded number of written paths, the last shell command and its exit state, the last failed tool
result, and worker starts, when observed. It SHALL ask whether the work is done, what is verified,
what remains, whether the remainder has independent parallel lanes, what the current bottleneck is,
and the next action. It MUST be attributed to `goal-continuity` and stay within `maxMessageChars`.

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

#### Scenario: Bottleneck is asked

- **WHEN** the request is injected
- **THEN** it asks for the current bottleneck and the next action that removes it

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
verified facts, remaining items, a parallel flag, a serial reason required when the outcome is
`continue` and parallel is false, a bottleneck required when the outcome is `continue`, the next
action, and an optional speedup. A successful call SHALL write one atomic, bounded, redacted local
record under `.dsh/work-checkpoints/<session>/<turn>.json`, return a short summary, and be reused for
the same turn; a later call in the same turn replaces the record with the latest decision. The
record MUST NOT be tracked.

#### Scenario: Continue with a serial reason

- **WHEN** the outcome is `continue`, parallel is false, the serial reason is non-empty, and the
  bottleneck is non-empty
- **THEN** the call succeeds and the record is written

#### Scenario: Missing serial reason

- **WHEN** the outcome is `continue`, parallel is false, and the serial reason is empty or absent
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Missing bottleneck

- **WHEN** the outcome is `continue` and the bottleneck is empty or absent
- **THEN** the call is rejected with a field diagnostic

#### Scenario: Parallel declaration

- **WHEN** the outcome is `continue`, parallel is true, and the bottleneck is non-empty
- **THEN** the call succeeds without a serial reason

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

### Requirement: Close gate

After a substantial pause the plugin SHALL refuse the turn close until a successful checkpoint
younger than `stepInterval` steps exists for the turn, steering the request on each refusal. It
SHALL allow at most `maxBlocks` refusals per turn and then allow the close with a visible UNCHECKED
notice that is not a pass. It MUST fail open on an internal state error and MUST NOT evaluate a
subagent turn.

#### Scenario: Missing checkpoint

- **WHEN** the turn closes after a substantial pause with no successful checkpoint
- **THEN** the close is refused and the checkpoint request is steered

#### Scenario: Checkpoint satisfies

- **WHEN** a successful checkpoint younger than `stepInterval` steps exists for the turn
- **THEN** the close is allowed

#### Scenario: Stale checkpoint

- **WHEN** the latest checkpoint is `stepInterval` or more steps old at the close
- **THEN** the close is refused and a new checkpoint request is steered

#### Scenario: Two-step checkpoint

- **WHEN** a checkpoint was recorded 2 steps before the close and `stepInterval` is 40
- **THEN** the close is allowed without another request

#### Scenario: Cap reached

- **WHEN** the turn has reached `maxBlocks` refusals
- **THEN** the close is allowed with a visible UNCHECKED notice and no checkpoint is claimed

#### Scenario: Fail open

- **WHEN** the plugin cannot read its own state
- **THEN** the close is allowed and no verification or checkpoint is claimed

#### Scenario: Subagent turn

- **WHEN** the turn belongs to a subagent
- **THEN** the close gate does not evaluate it

### Requirement: Configuration and off switch

The checkpoint SHALL be enabled by default with `minToolCalls`, `requireWrite`, `maxBlocks`,
`enforceParallel`, `maxMessageChars`, and `stepInterval` (default 40), validated fail-loud; unknown
or out-of-range fields SHALL fail plugin load with a field diagnostic. `checkpoint.enabled: false`
SHALL disable only the checkpoint; disabling the plugin row or `enabled: false` SHALL disable it
with the rest of the bundle.

#### Scenario: Default configuration

- **WHEN** a profile mounts the row with default configuration
- **THEN** the checkpoint is enabled with the documented defaults, including `stepInterval: 40`

#### Scenario: Configurable interval

- **WHEN** the profile sets `stepInterval` to 25
- **THEN** the mid-turn trigger uses 25 steps

#### Scenario: Invalid step interval

- **WHEN** `stepInterval` is zero, negative, or not an integer
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
