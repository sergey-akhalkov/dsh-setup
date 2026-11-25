# goal-continuity delta

## MODIFIED Requirements

### Requirement: Continuity supervision boundary

The continuity supervisor SHALL supervise only a root agent's current goal and SHALL use only the
DSH goal service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block
an active goal with a terminal reason, and inject a notice. It MAY observe the session's own log and
the workspace's local checkpoint records as evidence for a continuation decision; such an
observation MUST NOT start, continue, or cancel a turn. The continuity supervisor MUST NOT call the
model, start or cancel a turn, spawn a session, or use a waking delivery. The block-review gate is a
separate responsibility of the same plugin: for one proposed `blocked` update it MAY start one
bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or
cancel a turn or change the goal. The same gate also reviews a root agent's `ask_user_question` call
in an open goal round of an active goal: it MAY start one bounded, read-only subagent and deny or
allow that tool call, and it MUST NOT start, continue, or cancel a turn, and MUST NOT block, pause,
resume, or complete the goal. The work-checkpoint capability is a separate responsibility of the
same plugin: it MAY steer one checkpoint request at the configured step interval and at a
substantial turn close and record the checkpoint, and it MUST NOT start an idle agent, continue a
goal, revive a stopped turn, or change it.

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
- **THEN** the gate starts at most one review subagent and returns a tool-call decision, and no model
  turn or goal continuation starts from the review

#### Scenario: Question review is not continuation

- **WHEN** a root agent asks a question in an open goal round and the gate reviews it
- **THEN** the gate starts at most one review subagent and returns a tool-call decision, and no model
  turn, goal phase, or goal continuation starts from the review

#### Scenario: Speed review is not continuation

- **WHEN** a profile carries the removed `speedReview` configuration
- **THEN** no review child starts and no root model turn or goal continuation starts from that
  configuration

#### Scenario: Checkpoint is not continuation

- **WHEN** a substantial turn close is checkpointed
- **THEN** the plugin does not start an idle agent and does not change the goal, and the goal driver
  may continue only after the turn closes

#### Scenario: Mid-turn request is not continuity

- **WHEN** the work-checkpoint capability steers a periodic checkpoint request
- **THEN** the supervisor does not start, continue, cancel, or change a goal

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row and a read-only reviewer preset
declaration in the same bundle fragment. The preset SHALL expose only read-only tools; the gate
SHALL apply the reviewer-scoped allowlist through the reviewer child's own scope. The preset SHALL
be selected only by the block review. A disabled row or `enabled: false` MUST restore stock DSH
behavior with no disarm, resume, cap extension, block, suppression, notice, block review, question
review, or work checkpoint, including its periodic request, from the plugin; the preset declaration
remains installed but is selected only by the reviews. The shipped defaults SHALL be enabled,
`resumeAfterRestart: false`, `resumeAfterUserStop: never`, `blockReview.enabled: true`,
`blockReview.reviewQuestions: true`, `checkpoint.enabled: true`, and `checkpoint.periodic: true`; a
profile MAY override them. A legacy `speedReview` object MUST be accepted and ignored with a warning.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, a user Stop
  suppresses continuation, a proposed block is reviewed, a goal-round question is reviewed, a
  substantial pause is checkpointed, a mid-turn request is steered at the configured interval, and
  the gate selects the `goal-reviewer` preset

#### Scenario: Shipped periodic default

- **WHEN** the setup is installed
- **THEN** the goal-continuity row has `checkpoint.periodic: true` and `checkpoint.automation: false`

#### Scenario: Default Stop policy

- **WHEN** a profile mounts the row without setting `resumeAfterUserStop`
- **THEN** the effective policy is `never` and the generated patch records that value

#### Scenario: Preset declaration is installed

- **WHEN** the setup is installed
- **THEN** the composed profile contains the `preset-goal-reviewer` declaration, the preset exposes
  only read-only tools, and the reviews apply the reviewer-scoped allowlist to the child

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, notice, block
  review, question review, or checkpoint request, and the unused preset changes nothing

#### Scenario: Legacy speed review configuration

- **WHEN** a profile still sets a `speedReview` object
- **THEN** the plugin loads, reports one warning, and runs no speed review
