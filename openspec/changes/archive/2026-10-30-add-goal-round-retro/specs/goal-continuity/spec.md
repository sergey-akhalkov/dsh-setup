# Spec Delta

## ADDED Requirements

### Requirement: Goal-round speed review

For a completed goal round that meets the configured cost threshold, the plugin SHALL start at most one
bounded, read-only review child, require one strict JSON verdict with either one bottleneck and one action or
`no-action`, and write one local record. A failed, timed-out, malformed, or duplicate review MUST NOT block the
goal or start another child for that round.

#### Scenario: Threshold met

- **WHEN** a goal round ends and its measured cost crosses the configured threshold
- **THEN** the plugin starts one read-only review child and writes one record for that round

#### Scenario: Threshold not met

- **WHEN** a goal round ends below every configured threshold
- **THEN** the plugin starts no review child

#### Scenario: No action

- **WHEN** the review returns `no-action`
- **THEN** the record says `no-action` and no action brief or follow-through gate is created

#### Scenario: Duplicate round end

- **WHEN** the same goal round ends more than once or the plugin resumes mid-round
- **THEN** an existing record is reused and no second child is started for that round

#### Scenario: Review failure

- **WHEN** the child times out, fails, or returns a malformed verdict
- **THEN** the goal continues, the round is not blocked, and no second child is started for that round

#### Scenario: Per-goal bound

- **WHEN** the goal has reached its configured speed-review bound
- **THEN** no further review child starts for that goal

### Requirement: Round cost metrics

The review input SHALL include bounded, redacted metrics for the completed round: start-to-end wall time,
tool-call count, error count, worker starts, the slowest tool calls with durations, and approximate non-tool
time. The metrics MUST come from session events observed by the plugin and MUST NOT contain machine paths or
credentials.

#### Scenario: Slow call is reported

- **WHEN** a round contains a tool call that dominates its measured time
- **THEN** the review input names that call, its duration, and a bounded argument or result summary

#### Scenario: Worker starts are counted

- **WHEN** the round started one or more subagents, teammates, workflows, or reviews
- **THEN** the metrics report the count and the tool names without exposing their full prompts

#### Scenario: No round start

- **WHEN** the plugin did not observe the round start and cannot measure its wall time
- **THEN** it starts no review for that round

#### Scenario: Redaction

- **WHEN** the metrics and evidence are written to the prompt or the record
- **THEN** machine paths and obvious credentials are redacted and every field is bounded

### Requirement: Speed review brief

When the speed-review brief is enabled, at the start of a goal round the plugin SHALL inject one bounded,
non-waking brief carrying the speed policy and, when a review recorded an action, the bottleneck, action
summary, `speedup-id`, record path, the start-a-worker-or-decline instruction, and the exact `task_progress`
call when the decline path is available. The brief MUST NOT start a turn or change the goal.

#### Scenario: Pending action brief

- **WHEN** a new goal round starts after a review recorded an action that is not started or declined
- **THEN** the brief names the action, its `speedup-id`, its record path, and the exact follow-through choice

#### Scenario: No pending action

- **WHEN** a new goal round starts with no pending action
- **THEN** the brief carries the speed policy and no action id

#### Scenario: No goal round

- **WHEN** a turn is not a goal round
- **THEN** the brief is not injected

#### Scenario: Brief disabled

- **WHEN** the speed-review brief is disabled
- **THEN** no brief is injected and a pending action is still enforced by the follow-through gate

#### Scenario: Exact decline call

- **WHEN** the decline path is available and the brief carries a pending action
- **THEN** the brief contains the exact `task_progress` call with the action id

#### Scenario: Late result

- **WHEN** the speed-review brief is enabled and the review child finishes after the next goal round starts
- **THEN** the plugin injects the action as a bounded non-waking notice during that round

#### Scenario: Brief never wakes an idle agent

- **WHEN** the brief is delivered while the agent is idle
- **THEN** the agent remains idle and no model turn starts

### Requirement: Speedup follow-through gate

When a review recorded a speedup action and both a decline path and a worker-start tool are available, the next
goal round MUST start a successful worker whose arguments contain the `speedup-id`, or record a matching
`task_progress` decline, before the turn closes. The gate MUST steer once with the action id and record path,
MUST accept either evidence, and MUST fail open on a missing or unreadable record.

#### Scenario: Worker start satisfies

- **WHEN** the next goal round successfully starts a subagent, teammate, workflow, or delegated worker whose
  arguments contain the `speedup-id`
- **THEN** the action is marked started and the gate does not steer for it

#### Scenario: Decline satisfies

- **WHEN** the next goal round records a successful `task_progress` note whose reason contains the
  `speedup-id`
- **THEN** the action is marked declined and the gate does not steer for it

#### Scenario: Neither evidence

- **WHEN** the next goal round reaches turn close with neither a tagged worker start nor a matching decline
- **THEN** the gate steers with the action id and record path and the turn does not close for this gate

#### Scenario: Late delivery in the current round

- **WHEN** the action notice is delivered after the next goal round starts and before it closes
- **THEN** the gate applies at that round's close

#### Scenario: Delivery between rounds

- **WHEN** the action notice is delivered between goal rounds
- **THEN** the next goal round's close enforces it

#### Scenario: No action

- **WHEN** the review returned `no-action` or no review ran
- **THEN** the gate reports nothing

#### Scenario: Unreadable record

- **WHEN** the local action record is missing or cannot be read
- **THEN** the gate reports nothing and the goal continues

#### Scenario: Subagent turn

- **WHEN** the turn belongs to a subagent
- **THEN** the gate does not evaluate it

### Requirement: Speedup gate availability

The follow-through gate SHALL require both a usable decline path and a registered worker-start tool. It MUST
report nothing when `task_progress` is unavailable, no active change has an eligible unchecked task, or no
`subagent`, `subagent_fork`, `spawn_teammate`, `workflow`, or `delegate` tool is registered; the action remains
unenforced and the goal continues.

#### Scenario: Decline tool unavailable

- **WHEN** `task_progress` is not registered
- **THEN** the gate reports nothing and the goal continues

#### Scenario: No eligible task

- **WHEN** no active change has an unchecked task for a decline note
- **THEN** the gate reports nothing and the goal continues

#### Scenario: No worker-start tool

- **WHEN** no worker-start tool is registered
- **THEN** the gate reports nothing and the goal continues

#### Scenario: Both paths available

- **WHEN** `task_progress` has an eligible task and a worker-start tool is registered
- **THEN** the core follow-through gate applies

### Requirement: Speed review record and status

The plugin SHALL write one atomic local record per reviewed round under `.dsh/goal-continuity/retro/` with the
metrics, verdict, action, `speedup-id`, status, target, and review duration. The record MUST be redacted, MUST
NOT be a tracked file, and MUST be reused instead of starting a second review for the same round.

#### Scenario: Record precedes the brief

- **WHEN** a review returns a valid action
- **THEN** the record is written before the brief or gate can use the action

#### Scenario: Status transition

- **WHEN** the follow-through gate observes a worker start or a decline
- **THEN** the record changes from pending to started or declined

#### Scenario: Record reuse

- **WHEN** a record already exists for the goal and round
- **THEN** no second review starts and the existing verdict is used

#### Scenario: Redacted local state

- **WHEN** the record is read
- **THEN** it contains no machine path, credential, or tracked project artifact

#### Scenario: Record write fails

- **WHEN** the record cannot be written
- **THEN** no brief or follow-through gate is created and the goal continues

### Requirement: Speed review configuration and off switch

The speed review SHALL be enabled by default with a documented provider, model, reasoning effort, shared
reviewer preset, thresholds, timeout, per-goal bound, and brief toggle. `speedReview.enabled: false` MUST
disable only the speed review; disabling the plugin row or `enabled: false` MUST remove both reviews and the
brief.

#### Scenario: Default configuration

- **WHEN** a profile mounts the row with default configuration
- **THEN** the speed review is enabled with the documented provider, model, effort, shared preset, thresholds,
  timeout, per-goal bound, and brief

#### Scenario: Speed review disabled

- **WHEN** `speedReview.enabled` is false
- **THEN** no review, brief, or follow-through gate runs and continuity and block review still run

#### Scenario: Row disabled

- **WHEN** the plugin row is disabled or `enabled` is false
- **THEN** neither review, the brief, nor the gate runs and the preset remains installed but unused

#### Scenario: Invalid speed review configuration

- **WHEN** a speed review field is unknown, mistyped, or outside its range
- **THEN** plugin load fails with a field diagnostic

### Requirement: Speed review reviewer scope

The speed review SHALL use the same fresh-context, read-only reviewer preset as the block review and the same
child-scope allowlist: read, grep, and glob only. It MUST NOT expose write, edit, shell, delegation, MCP, or
goal tools, and an unavailable provider or preset MUST make the review unavailable without blocking the goal.

#### Scenario: Read-only child scope

- **WHEN** the review child is created
- **THEN** its own scope allows only read, grep, and glob

#### Scenario: No mutation tools

- **WHEN** the child attempts a write, edit, shell, delegation, MCP, or goal tool
- **THEN** the tool is not available in its scope

#### Scenario: Reviewer unavailable

- **WHEN** the provider, preset, or fresh-context capability is unavailable
- **THEN** no review runs, no action is created, and the goal continues

## MODIFIED Requirements

### Requirement: Continuity supervision boundary

The continuity supervisor SHALL supervise only a root agent's current goal and SHALL use only the DSH goal
service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block an active goal with a
terminal reason, and inject a notice. The continuity supervisor MUST NOT call the model, start or cancel a
turn, spawn a session, or use a waking delivery. The block-review gate is a separate responsibility of the
same plugin: for one proposed `blocked` update it MAY start one bounded, read-only subagent and deny or allow
that tool call, and it MUST NOT start, continue, or cancel a turn or change the goal. The speed-review loop is
also a separate responsibility of the same plugin: it MAY start one bounded, read-only child per reviewed goal
round, write a local record, inject a bounded non-waking brief, and steer a turn close when a recorded action
lacks follow-through evidence, and it MUST NOT start, continue, or cancel a turn or change the goal.

#### Scenario: Root agent is supervised

- **WHEN** a root agent has a current goal
- **THEN** the supervisor may act on that goal under the requirements below

#### Scenario: Fork and subagent are excluded

- **WHEN** a forked or subagent session has a current goal
- **THEN** the supervisor acts on nothing and delivers no notice for that session

#### Scenario: Notice delivery never starts a turn

- **WHEN** the supervisor delivers a notice to an idle agent
- **THEN** the agent remains idle and no model turn starts

#### Scenario: Block review is not continuation

- **WHEN** a root agent proposes a block and the block-review gate reviews it
- **THEN** the gate starts at most one review subagent and returns a tool-call decision, and no model turn or goal continuation starts from the review

#### Scenario: Speed review is not continuation

- **WHEN** a completed goal round is reviewed for cost
- **THEN** the plugin starts at most one read-only review child and writes a record, and no root model turn or goal continuation starts from the review

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row and a read-only reviewer preset declaration
in the same bundle fragment. The preset SHALL expose only read-only tools; the gate SHALL apply the
reviewer-scoped allowlist through the reviewer child's own scope. The preset SHALL be selected only by the
block review and the speed review. A disabled row or `enabled: false` MUST restore stock DSH behavior with no
disarm, resume, cap extension, block, suppression, notice, block review, or speed review from the plugin; the
preset declaration remains installed but is selected only by those reviews. The shipped defaults SHALL be
enabled, `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`, `blockReview.enabled: true`, and
`speedReview.enabled: true`; a profile MAY override them.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, a non-goal user stop re-arms the goal, a proposed block is reviewed, a completed goal round can be reviewed for cost, and the gate selects the `goal-reviewer` preset

#### Scenario: Preset declaration is installed

- **WHEN** the setup is installed
- **THEN** the composed profile contains the `preset-goal-reviewer` declaration, the preset exposes only read-only tools, and both reviews apply the reviewer-scoped allowlist to the child

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, notice, block review, or speed review, and the unused preset changes nothing
