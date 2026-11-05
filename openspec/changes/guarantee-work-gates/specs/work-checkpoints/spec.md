# Spec Delta

## MODIFIED Requirements

### Requirement: Executed bottleneck remedy

A `continue` checkpoint SHALL carry a bottleneck with an id, an owner, an action of
`worker_start`, `lead_action`, or `user_decision`, the blocking lane ids, and, for `lead_action`,
the target paths. The plugin MUST refuse the close until a later tool call matches the action: a
successful worker start carrying the checkpoint id and the bottleneck id, a successful edit or write
at a declared target for a lead-owned bottleneck, or a question to the user. When the bottleneck
owner is not `lead`, the action MUST be `worker_start` or `user_decision`; `lead_action` MUST be
refused. When no worker-start tool is visible, the owner rule MUST fail open and accept a
`lead_action` with targets.

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
