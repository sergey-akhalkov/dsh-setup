# Spec Delta

## MODIFIED Requirements

### Requirement: Continuity supervision boundary

The continuity supervisor SHALL supervise only a root agent's current goal and SHALL use only the DSH goal service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block an active goal with a terminal reason, and inject a notice. The continuity supervisor MUST NOT call the model, start or cancel a turn, spawn a session, or use a waking delivery. The block-review gate is a separate responsibility of the same plugin: for one proposed `blocked` update it MAY start one bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or cancel a turn or change the goal. The work-checkpoint capability is a separate responsibility of the same plugin: it MAY steer one checkpoint step at a substantial turn close and record the checkpoint, and it MUST NOT start an idle agent, continue a goal, or change it.

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

- **WHEN** a profile carries the removed `speedReview` configuration
- **THEN** no review child starts and no root model turn or goal continuation starts from that configuration

#### Scenario: Checkpoint is not continuation

- **WHEN** a substantial turn close is checkpointed
- **THEN** the plugin does not start an idle agent and does not change the goal, and the goal driver may continue only after the turn closes

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row and a read-only reviewer preset declaration in the same bundle fragment. The preset SHALL expose only read-only tools; the gate SHALL apply the reviewer-scoped allowlist through the reviewer child's own scope. The preset SHALL be selected only by the block review. A disabled row or `enabled: false` MUST restore stock DSH behavior with no disarm, resume, cap extension, block, suppression, notice, block review, or work checkpoint from the plugin; the preset declaration remains installed but is selected only by the block review. The shipped defaults SHALL be enabled, `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`, `blockReview.enabled: true`, and `checkpoint.enabled: true`; a profile MAY override them. A legacy `speedReview` object MUST be accepted and ignored with a warning.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, a non-goal user stop re-arms the goal, a proposed block is reviewed, a substantial pause is checkpointed, and the gate selects the `goal-reviewer` preset

#### Scenario: Preset declaration is installed

- **WHEN** the setup is installed
- **THEN** the composed profile contains the `preset-goal-reviewer` declaration, the preset exposes only read-only tools, and the block review applies the reviewer-scoped allowlist to the child

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, notice, block review, or checkpoint, and the unused preset changes nothing

#### Scenario: Legacy speed review configuration

- **WHEN** a profile still sets a `speedReview` object
- **THEN** the plugin loads, reports one warning, and runs no speed review

### Requirement: Block review configuration and off switch

The block review SHALL be enabled by default with a documented provider, model, reasoning effort, reviewer preset, effective `blockedAfterConsecutiveRounds`, timeout, per-goal review bound, error policy, unavailable policy, and exhausted policy. `blockReview.enabled: false` SHALL disable only the gate and leave continuity supervision unchanged. Disabling the plugin row or `enabled: false` SHALL remove the gate and the work-checkpoint capability and restore stock behavior.

#### Scenario: Default configuration

- **WHEN** a profile mounts the row with default configuration
- **THEN** a proposed block is reviewed with the `goal-reviewer` preset before it takes effect

#### Scenario: Gate disabled

- **WHEN** `blockReview.enabled` is false
- **THEN** no block is reviewed and continuity supervision still runs

#### Scenario: Non-default block threshold

- **WHEN** the profile sets the goal tool threshold to 5 and the block review's `blockedAfterConsecutiveRounds` to 5
- **THEN** a goal-round proposal at round 4 starts no review, and a goal-round proposal at round 5 is reviewed

#### Scenario: Invalid block review configuration

- **WHEN** a block review field is unknown, mistyped, or outside its range
- **THEN** plugin load fails with a field diagnostic

## REMOVED Requirements

### Requirement: Goal-round speed review

**Reason**: Replaced by the `work-checkpoints` capability: every substantial pause gets a checkpoint instead of only an expensive goal round crossing a cost threshold.

**Migration**: Remove the `speedReview` section from the profile. The section is accepted but ignored with a warning; the `work_checkpoint` tool and the turn-close gate provide the decision.

### Requirement: Round cost metrics

**Reason**: The review child that consumed round metrics is removed; the checkpoint request carries its own bounded turn evidence.

**Migration**: No profile change. The checkpoint request names the turn tool-call count, written paths, the last shell result, failures, and worker starts.

### Requirement: Speed review brief

**Reason**: The static speed policy is replaced by the checkpoint request, which asks about the current remainder instead of restating a policy at the next round.

**Migration**: No profile change. The parallel/speed policy moves to the always-on work-checkpoint guidance.

### Requirement: Speedup follow-through gate

**Reason**: Replaced by the checkpoint parallel-action gate, which requires a tagged worker start when the checkpoint declares parallel remaining work.

**Migration**: Remove the `speedReview` section. A pending speedup record is no longer produced; the checkpoint id is the follow-through tag.

### Requirement: Speedup gate availability

**Reason**: The checkpoint gate reads the registered worker-start tools at the turn close and has no separate `task_progress` decline path.

**Migration**: No profile change. The checkpoint serial reason replaces the decline note.

### Requirement: Speed review record and status

**Reason**: The retro record under `.dsh/goal-continuity/retro/` is replaced by the checkpoint record under `.dsh/work-checkpoints/`.

**Migration**: Old retro records are local scratch and may be deleted; no profile change.

### Requirement: Speed review configuration and off switch

**Reason**: The `speedReview` configuration is removed; `checkpoint.enabled` is the replacement off switch.

**Migration**: Remove `speedReview` from the profile. A leftover section is accepted but ignored with a warning, so the profile still loads.

### Requirement: Speed review reviewer scope

**Reason**: The speed review child is removed; the shared read-only reviewer preset is now selected only by the block review.

**Migration**: No profile change. Keep `blockReview.reviewerPreset`; the preset remains installed.
