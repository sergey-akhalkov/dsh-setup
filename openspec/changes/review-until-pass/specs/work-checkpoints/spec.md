# work-checkpoints Specification

## MODIFIED Requirements

### Requirement: Close gate

After a substantial pause the plugin SHALL refuse the turn close until a successful checkpoint
younger than `stepInterval` steps exists for the turn, steering the request on each refusal. It
SHALL also refuse a close whose checkpoint names a bottleneck whose remedy is not executed or whose
bottleneck reached `bottleneckAge`. It SHALL allow at most `maxBlocks` refusals per turn and then
allow the close with a visible UNCHECKED notice that is not a pass. It MUST fail open on an internal
state error and MUST NOT evaluate a subagent turn. When `checkpoint.automation` is false, this close
gate MUST report nothing and MUST NOT steer or refuse a close; the `retro` workflow definition owns
the checkpoint request.

A user stop SHALL win over the close gate: when the turn's abort signal is set, the plugin MUST NOT
submit a checkpoint request, and a request it already submitted SHALL be removed from the agent inbox
when that signal aborts, so a queued gate message never resumes a stopped turn.

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

#### Scenario: A stopped turn is never steered

- **WHEN** the turn's abort signal is set before the close gate submits its request
- **THEN** no checkpoint request is submitted and the stopped turn is not resumed

#### Scenario: A submitted checkpoint request does not survive a stop

- **WHEN** the close gate submitted its request and the turn's abort signal aborts before the request is claimed
- **THEN** the request is removed from the inbox and no new turn starts from it
