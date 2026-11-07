# Spec Delta

## ADDED Requirements

### Requirement: Gate-only retirement switch

The checkpoint provider SHALL support `automation: false`, which keeps the `work_checkpoint` tool, its local record, and the lane schema, while disabling the close gate, the parallel gate, the remedy gate, the bottleneck-age gate, and the periodic request. When automation is false, the `retro` workflow definition SHALL be the enforcing path and MUST be `own`; a `defer` definition beside the disabled automation MUST be refused because no enabled legacy source remains.

#### Scenario: Tool remains available

- **WHEN** `automation` is false
- **THEN** `work_checkpoint` still accepts a call, writes its record, and returns the decision summary

#### Scenario: Gates are silent

- **WHEN** `automation` is false and a turn stops without a checkpoint
- **THEN** the checkpoint provider does not steer or refuse the close

#### Scenario: Workflow owns the close

- **WHEN** `automation` is false and the `retro` definition is `own`
- **THEN** the workflow requests the checkpoint and refuses the close until a fresh record exists

#### Scenario: Defer is refused without automation

- **WHEN** `automation` is false and the `retro` definition is `defer`
- **THEN** the definition is refused and neither owner is silently left without an enforcing checkpoint

#### Scenario: Rollback

- **WHEN** `automation` is true again
- **THEN** the checkpoint provider's gates steer again and the `retro` definition MUST return to `defer`
## MODIFIED Requirements

### Requirement: Close gate

After a substantial pause the plugin SHALL refuse the turn close until a successful checkpoint
younger than `stepInterval` steps exists for the turn, steering the request on each refusal. It
SHALL also refuse a close whose checkpoint names a bottleneck whose remedy is not executed or whose
bottleneck reached `bottleneckAge`. It SHALL allow at most `maxBlocks` refusals per turn and then
allow the close with a visible UNCHECKED notice that is not a pass. It MUST fail open on an internal
state error and MUST NOT evaluate a subagent turn. When `checkpoint.automation` is false, this close gate MUST report nothing and MUST NOT steer or refuse a close; the `retro` workflow definition owns the checkpoint request.

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

#### Scenario: Automation off is silent

- **WHEN** `automation` is false and the turn closes after a substantial pause with no checkpoint
- **THEN** the checkpoint provider does not refuse or steer the close

### Requirement: Parallel-action gate

When the plugin computes parallel remaining work from the checkpoint's lane plan, it SHALL require a
successful worker start whose arguments contain the checkpoint id before the turn closes, or a later
checkpoint in the same turn whose lane plan removes the parallel work. Two lanes are parallel when
both are runnable, they have different owners, and their scopes do not overlap, compared by path
components so `src` and `src2` are disjoint. A failed or untagged worker start MUST NOT satisfy the
gate. When `checkpoint.automation` is false, the gate MUST report nothing and require no worker start.

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

#### Scenario: Automation off requires no worker

- **WHEN** `automation` is false and the checkpoint computed parallel lanes
- **THEN** the gate reports nothing and the turn may close

### Requirement: Parallel gate refusal and cap

The plugin SHALL steer on each unsatisfied parallel-gate close with the checkpoint id, share the
`maxBlocks` budget with the close gate, and after the cap allow the close with a visible UNCHECKED
notice. When no worker-start tool is registered, `enforceParallel` is false, or the checkpoint
outcome is `done`, the gate SHALL report nothing. When `checkpoint.automation` is false, the gate SHALL report nothing.

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

#### Scenario: Automation off parallel refusal is silent

- **WHEN** `automation` is false and the turn closes after a computed parallel plan with no tagged worker start
- **THEN** the gate reports nothing and the turn may close

### Requirement: Periodic mid-turn checkpoint

The plugin SHALL steer one bounded checkpoint request when a root turn reaches `stepInterval` steps
(default 40) since the turn start or the latest checkpoint, provided the turn has at least one
successful write or worker start (or `requireWrite` is false) and the last tool call is not
`ask_user_question`. It MUST NOT steer within `stepInterval` steps of a successful checkpoint and
MUST NOT start an idle agent. When `checkpoint.automation` is false, the plugin MUST NOT steer a periodic request.

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

#### Scenario: Automation off sends no request

- **WHEN** `automation` is false and a root turn reaches the interval boundary
- **THEN** the plugin steers no checkpoint request

### Requirement: Executed bottleneck remedy

A `continue` checkpoint SHALL carry a bottleneck with an id, an owner, an action of
`worker_start`, `lead_action`, or `user_decision`, the blocking lane ids, and, for `lead_action`,
the target paths. The plugin MUST refuse the close until a later tool call matches the action: a
successful worker start carrying the checkpoint id and the bottleneck id, a successful edit or write
at a declared target for a lead-owned bottleneck, or a question to the user. When the bottleneck
owner is not `lead`, the action MUST be `worker_start` or `user_decision`; `lead_action` MUST be
refused. When no worker-start tool is visible, the owner rule MUST fail open and accept a
`lead_action` with targets. When `checkpoint.automation` is false, the remedy MUST NOT refuse the close; the checkpoint record still carries the bottleneck unchanged.

#### Scenario: Worker start remedy

- **WHEN** the checkpoint names `worker_start` and a later worker start that the plugin's classifier
  counts carries both the checkpoint id and the bottleneck id
- **THEN** the gate passes

#### Scenario: Lead-owned lead action

- **WHEN** the checkpoint names `lead_action` with owner `lead` and a later `edit` or `write`
  completes successfully at a declared target
- **THEN** the gate passes

#### Scenario: Worker-owned lead action is refused

- **WHEN** the checkpoint names `lead_action` with an owner other than `lead`
- **THEN** the close is refused and the steer names `worker_start` or `user_decision`

#### Scenario: Worker start without the bottleneck id

- **WHEN** the checkpoint names `worker_start` and the later worker start carries only the
  checkpoint id
- **THEN** the gate does not pass

#### Scenario: No worker tool

- **WHEN** no worker-start tool is visible and the checkpoint names `lead_action` with a declared
  target
- **THEN** the owner rule does not block the targeted edit/write

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

- **WHEN** a worker starts without both the checkpoint id and the bottleneck id
- **THEN** the gate does not pass

#### Scenario: Done outcome

- **WHEN** the checkpoint outcome is `done`
- **THEN** the remedy gate reports nothing

#### Scenario: Automation off does not refuse the remedy

- **WHEN** `automation` is false and the checkpoint names a remedy that was not executed
- **THEN** the plugin does not refuse the close and the record still names the remedy

### Requirement: Bottleneck age

The plugin SHALL read the previous checkpoint record of the same session and count consecutive
checkpoints whose bottleneck names the same owner and the same set of blocking lane ids. At
`bottleneckAge` such checkpoints (default 2) it MUST refuse the close until the owner changes, a
blocking lane changes state, or a `user_decision` question was asked. It MUST NOT count a record
from another session or one without a bottleneck. When `checkpoint.automation` is false, no age refusal applies.

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

#### Scenario: Automation off does not age

- **WHEN** `automation` is false and consecutive checkpoints name the same bottleneck
- **THEN** the plugin does not refuse the close for bottleneck age
