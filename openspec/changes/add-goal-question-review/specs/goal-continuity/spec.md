# Spec Delta

## MODIFIED Requirements

### Requirement: Continuity supervision boundary

The continuity supervisor SHALL supervise only a root agent's current goal and SHALL use only the DSH goal service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block an active goal with a terminal reason, and inject a notice. The continuity supervisor MUST NOT call the model, start or cancel a turn, spawn a session, or use a waking delivery. The block-review gate is a separate responsibility of the same plugin: for one proposed `blocked` update it MAY start one bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or cancel a turn or change the goal. The same gate also reviews a root agent's `ask_user_question` call in an open goal round of an active goal: it MAY start one bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or cancel a turn, and MUST NOT block, pause, resume, or complete the goal. The work-checkpoint capability is a separate responsibility of the same plugin: it MAY steer one checkpoint step at a substantial turn close and record the checkpoint, and it MUST NOT start an idle agent, continue a goal, or change it.

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

#### Scenario: Question review is not continuation

- **WHEN** a root agent asks a question in an open goal round and the gate reviews it
- **THEN** the gate starts at most one review subagent and returns a tool-call decision, and no model turn, goal phase, or goal continuation starts from the review

#### Scenario: Speed review is not continuation

- **WHEN** a profile carries the removed `speedReview` configuration
- **THEN** no review child starts and no root model turn or goal continuation starts from that configuration

#### Scenario: Checkpoint is not continuation

- **WHEN** a substantial turn close is checkpointed
- **THEN** the plugin does not start an idle agent and does not change the goal, and the goal driver may continue only after the turn closes

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row and a read-only reviewer preset declaration in the same bundle fragment. The preset SHALL expose only read-only tools; the gate SHALL apply the reviewer-scoped allowlist through the reviewer child's own scope. The preset SHALL be selected only by the block review. A disabled row or `enabled: false` MUST restore stock DSH behavior with no disarm, resume, cap extension, block, suppression, notice, block review, question review, or work checkpoint from the plugin; the preset declaration remains installed but is selected only by the reviews. The shipped defaults SHALL be enabled, `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`, `blockReview.enabled: true`, `blockReview.reviewQuestions: true`, and `checkpoint.enabled: true`; a profile MAY override them. A legacy `speedReview` object MUST be accepted and ignored with a warning.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, a non-goal user stop re-arms the goal, a proposed block is reviewed, a goal-round question is reviewed, a substantial pause is checkpointed, and the gate selects the `goal-reviewer` preset

#### Scenario: Preset declaration is installed

- **WHEN** the setup is installed
- **THEN** the composed profile contains the `preset-goal-reviewer` declaration, the preset exposes only read-only tools, and the reviews apply the reviewer-scoped allowlist to the child

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, notice, block review, question review, or checkpoint, and the unused preset changes nothing

#### Scenario: Legacy speed review configuration

- **WHEN** a profile still sets a `speedReview` object
- **THEN** the plugin loads, reports one warning, and runs no speed review

### Requirement: Block review configuration and off switch

The block review SHALL be enabled by default with a documented provider, model, reasoning effort, reviewer preset, effective `blockedAfterConsecutiveRounds`, question-review switch, timeout, per-goal review bound, error policy, unavailable policy, and exhausted policy. `blockReview.enabled: false` SHALL disable both review subjects and leave continuity supervision unchanged. `blockReview.reviewQuestions: false` SHALL disable only the question subject and leave block review unchanged. Disabling the plugin row or `enabled: false` SHALL remove both subjects and the work-checkpoint capability and restore stock behavior.

#### Scenario: Default configuration

- **WHEN** a profile mounts the row with default configuration
- **THEN** a proposed block is reviewed with the `goal-reviewer` preset before it takes effect, and a goal-round question is reviewed before it reaches the user

#### Scenario: Gate disabled

- **WHEN** `blockReview.enabled` is false
- **THEN** no block and no question is reviewed and continuity supervision still runs

#### Scenario: Question review disabled

- **WHEN** `blockReview.reviewQuestions` is false
- **THEN** a goal-round question reaches the user unreviewed and the block review still runs

#### Scenario: Non-default block threshold

- **WHEN** the profile sets the goal tool threshold to 5 and the block review's `blockedAfterConsecutiveRounds` to 5
- **THEN** a goal-round proposal at round 4 starts no review, and a goal-round proposal at round 5 is reviewed

#### Scenario: Invalid block review configuration

- **WHEN** a block review field, including `reviewQuestions`, is unknown, mistyped, or outside its range
- **THEN** plugin load fails with a field diagnostic

## ADDED Requirements

### Requirement: Question review gate

The plugin SHALL review a root agent's `ask_user_question` call through the pre-execute gate when the current goal is active, the open turn is a goal round, and `blockReview.reviewQuestions` is true. It SHALL deny the call when an independent review finds an authorized non-user route, and SHALL allow it only when the review confirms a user-only answer. It MUST NOT review a direct-human turn, a subagent call, or a call with no active goal, and MUST NOT change the goal.

#### Scenario: Non-user route

- **WHEN** a goal-round question offers to narrow the scope, accept a partial result, defer work, or avoid difficulty while the agent can continue the objective itself
- **THEN** the gate denies the call with one concrete next action and the goal stays active

#### Scenario: Recommended option is not evidence

- **WHEN** the question marks one option `(Recommended)` and that option is a route the agent can take itself
- **THEN** the denial names that option as the next action and the question does not reach the user

#### Scenario: User-only answer

- **WHEN** the answer requires knowledge or authority only the user has, such as a credential, a product decision, a publication, or an irreversible action
- **THEN** the gate allows the question to reach the user

#### Scenario: Direct-human turn

- **WHEN** the question is asked in a turn opened by a direct user message
- **THEN** the gate does not review it

#### Scenario: Subagent question

- **WHEN** a subagent calls `ask_user_question`
- **THEN** the gate does not review it

#### Scenario: Inactive goal

- **WHEN** there is no current goal, or its phase is not `active`
- **THEN** the gate does not review the question

### Requirement: Question review evidence and verdict

The review SHALL treat the call's JSON-normalized arguments as the question subject and SHALL include it with the same bounded, redacted evidence the block review uses. The verdict SHALL be `not-blocker` when the agent can answer or proceed itself, and `blocker` only when the answer needs knowledge or authority only the user has. A denial SHALL name one concrete next action the agent can take now.

#### Scenario: Bounded redacted subject

- **WHEN** the call carries several long questions and options
- **THEN** the subject is bounded and redacted before it leaves the process

#### Scenario: Discoverable answer

- **WHEN** the objective, the workspace instructions, a standing grant, or the recorded tool results already decide the question
- **THEN** the verdict is `not-blocker` and the next action is to act on that answer

#### Scenario: Scope-reduction question

- **WHEN** the question proposes to shrink the objective because the work is difficult, unstable, or slow
- **THEN** the verdict is `not-blocker` and the next action continues the full objective

### Requirement: Question review record, reuse, and bound

Each question review SHALL write the shared digest-bound record marked with the subject `question`, and SHALL reuse a matching verdict without a second subagent run. Question and block reviews SHALL share the per-goal review bound and the error, unavailable, and exhausted policies. When the bound is reached the gate SHALL apply the exhausted policy to the question call.

#### Scenario: Record subject

- **WHEN** a question review completes
- **THEN** the local record names the subject `question`, the verdict, the target identity, the goal revision, the time, and the verification state

#### Scenario: Matching verdict is reused

- **WHEN** the same goal, question subject, and evidence digest are proposed again
- **THEN** the gate reuses the recorded verdict without a second subagent run

#### Scenario: Shared bound

- **WHEN** the per-goal review bound is spent
- **THEN** the gate applies the exhausted policy to the next question without starting a review, and the default policy denies the question and leaves the goal active

#### Scenario: Review failure

- **WHEN** the reviewer target is unavailable, errors, times out, or returns an invalid verdict
- **THEN** the configured policy applies to the question call, and a denying policy leaves the goal active and lets the turn continue without the question
