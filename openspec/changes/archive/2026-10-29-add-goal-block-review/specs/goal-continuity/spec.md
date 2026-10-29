# Spec Delta

## MODIFIED Requirements

### Requirement: Continuity supervision boundary

The continuity supervisor SHALL supervise only a root agent's current goal and SHALL use only the DSH goal service plus non-waking agent delivery. It MAY disarm, resume, extend the round cap, block an active goal with a terminal reason, and inject a notice. The continuity supervisor MUST NOT call the model, start or cancel a turn, spawn a session, or use a waking delivery. The block-review gate is a separate responsibility of the same plugin: for one proposed `blocked` update it MAY start one bounded, read-only subagent and deny or allow that tool call, and it MUST NOT start, continue, or cancel a turn or change the goal.

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

### Requirement: Composition and off switch

The capability SHALL be delivered as a Host-only composition row and a read-only reviewer preset declaration in the same bundle fragment. The preset SHALL expose only read-only tools; the gate SHALL apply the reviewer-scoped allowlist through the reviewer child's own scope. A disabled row or `enabled: false` MUST restore stock DSH behavior with no disarm, resume, cap extension, block, suppression, notice, or block review from the plugin; the preset declaration remains installed but is selected only by the gate. The shipped defaults SHALL be enabled, `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`, and `blockReview.enabled: true`; a profile MAY override them.

#### Scenario: Default composition

- **WHEN** a default profile mounts the row
- **THEN** recoverable in-session stops are translated, restart resume stays off, a non-goal user stop re-arms the goal, a proposed block is reviewed, and the gate selects the `goal-reviewer` preset

#### Scenario: Preset declaration is installed

- **WHEN** the setup is installed
- **THEN** the composed profile contains the `preset-goal-reviewer` declaration, the preset exposes only read-only tools, and the gate applies the reviewer-scoped allowlist to the child

#### Scenario: Disabled row restores stock behavior

- **WHEN** the row is disabled or `enabled` is false
- **THEN** the plugin performs no disarm, resume, extension, block, suppression, notice, or block review, and the unused preset changes nothing

## ADDED Requirements

### Requirement: Block review gate

The plugin SHALL register a pre-execute gate for a root agent's `update_goal` call with `action: "blocked"` on an active goal. The gate SHALL deny the call when an independent review finds an authorized non-user route, and SHALL allow it only when the review confirms a user-only blocker or a configured policy explicitly allows an unverified block. The gate MUST NOT review a subagent call, a non-block action, or a stale revision.

#### Scenario: Authorized code route

- **WHEN** the block reason names a library, sibling-repository, test, or testability change that the agent is authorized to make
- **THEN** the gate denies the call with that route as the next action and the goal stays active

#### Scenario: User-only blocker

- **WHEN** the review confirms an action or knowledge that only the user has
- **THEN** the gate allows the block and the exact user-only action becomes visible to the user

#### Scenario: Unverified policy allow

- **WHEN** the configured unavailable or exhausted policy allows an unverified block
- **THEN** the gate allows the call, marks the record unverified, and injects a visible notice

#### Scenario: Non-block update

- **WHEN** a root agent updates a goal with an action other than `blocked`
- **THEN** the gate does not review the call

#### Scenario: Subagent update

- **WHEN** a subagent calls `update_goal` with `action: "blocked"`
- **THEN** the gate does not review the call

#### Scenario: Stale goal reference

- **WHEN** the call's goal id or revision is not the current goal
- **THEN** the gate does not review it and the goal tool's own validation applies

### Requirement: Block review eligibility

The gate SHALL skip a call below the effective `blockedAfterConsecutiveRounds` threshold only when the call is a goal-round call. A direct user message that does not explicitly request the block SHALL be reviewed regardless of the threshold. An explicit block request in the open turn SHALL bypass the review.

#### Scenario: Premature goal-round call

- **WHEN** a goal-round call proposes a block below the effective threshold
- **THEN** the gate starts no review, charges no review budget, and the goal tool's own rejection applies

#### Scenario: Direct-human continue

- **WHEN** a direct user message asks to continue and the goal is below the threshold, and the model proposes a block
- **THEN** the gate reviews the block instead of applying the threshold bypass

#### Scenario: Explicit block request

- **WHEN** the user explicitly asks for the block in the open turn
- **THEN** the gate does not review the call

### Requirement: Read-only review execution

The gate SHALL apply a reviewer-scoped tool allowlist through the reviewer child's own scope after the preset is mounted and before its first execution, when the preset tools are inherited and restrictable. The allowlist admits only read-only tools and filters inherited global mutation tools. A preset-scope restriction fails because it sees its own tools as current registrations. The gate MUST NOT rely on the session sandbox; a failed restriction makes the review unavailable.

#### Scenario: Allowlist is applied

- **WHEN** the reviewer starts
- **THEN** its effective tool surface is the read-only allowlist and `mcp_call`, `delegate`, `edit`, `write`, `pwsh`, and the goal tools are inaccessible

#### Scenario: Preset-only tools remain valid

- **WHEN** `read`, `grep`, and `glob` are registered only in the preset and not globally
- **THEN** the child-scope allowlist accepts them, keeps them, and does not throw

#### Scenario: Mutation attempt is denied

- **WHEN** the reviewer attempts a mutation route
- **THEN** the tool is unknown or denied, and the review continues

#### Scenario: Sandbox independence

- **WHEN** the parent has an explicit `danger-full-access` override
- **THEN** the reviewer's effective tool surface is still the read-only allowlist, because the allowlist and not the sandbox is the enforcement

#### Scenario: Restriction fails

- **WHEN** the child-scope restriction cannot be applied or does not produce the allowlist
- **THEN** the gate treats the review as unavailable and follows the unavailable policy

### Requirement: Independent blocker review

The gate SHALL run one fresh-context subagent with the goal objective, the block reason, the last three goal rounds' tool calls and results, the user messages and standing grants, the runtime permission policy, and the workspace. The review MUST default to `not-blocker` when a non-user route exists and MUST NOT treat the block reason's conclusion as evidence.

#### Scenario: Sibling-repository incident

- **WHEN** the block asks for approval to edit a sibling repository while the runtime grants full file access
- **THEN** the review returns `not-blocker` with that edit as the next action

#### Scenario: Restart incident

- **WHEN** the block requires restarting the application or harness
- **THEN** the review returns `blocker` with the restart as the user-only action

#### Scenario: Changed obstacle

- **WHEN** the last three rounds show different obstacles rather than the same checkable condition
- **THEN** the review returns `not-blocker`

#### Scenario: Testability route

- **WHEN** the block needs a test-only activation, accessibility hook, or instrumentation change
- **THEN** the review returns `not-blocker` with that change as the next action

### Requirement: Block review verdict

The review SHALL return exactly one strict verdict: `blocker` with the exact user-only action, or `not-blocker` with one concrete next action. A verdict that is missing, ambiguous, or lacks its required field SHALL be treated as a review error, not as a blocker.

#### Scenario: Not-blocker verdict

- **WHEN** the review finds a non-user route
- **THEN** the verdict is `not-blocker` and names the next action

#### Scenario: Blocker verdict

- **WHEN** the review can prove no non-user route exists
- **THEN** the verdict is `blocker` and names the user-only action

#### Scenario: Malformed verdict

- **WHEN** the target returns prose, several verdicts, or a verdict without the required field
- **THEN** the gate treats it as a review error and follows the error policy

### Requirement: Block review record and reuse

The gate SHALL write an atomic, digest-bound record of each review with the goal id and revision, verdict, next action or user action, evidence summary, target identity, time, session, and whether the verdict is verified or an unverified policy allow. It SHALL reuse a matching verdict for the same digest and keep the record under the workspace's local state rather than a tracked file.

#### Scenario: Matching verdict is reused

- **WHEN** the same goal, block reason, and evidence digest are proposed again
- **THEN** the gate reuses the recorded verdict without a second subagent run

#### Scenario: Record is written

- **WHEN** a review completes
- **THEN** the local record names the verdict, target identity, goal revision, time, and verification state

#### Scenario: Unverified record

- **WHEN** a configured policy allows an unverified block
- **THEN** the record marks it unverified and the notice names the policy

### Requirement: Block review exhaustion

When the per-goal review bound is reached, the gate SHALL apply the configured exhausted policy. `deny` (default) SHALL leave the goal active and deny every further block proposal for that goal with a visible reason; `allow` SHALL allow the unverified block with a visible notice and an unverified record. A new proposal with different evidence SHALL NOT reset the bound; only raising `maxReviewsPerGoal` permits another review.

#### Scenario: Deny on exhaustion

- **WHEN** the goal reaches the review bound with the default `deny` policy
- **THEN** the gate denies further proposals, leaves the goal active, and names the exhausted budget

#### Scenario: Allow on exhaustion

- **WHEN** the goal reaches the review bound with the `allow` policy
- **THEN** the gate allows the unverified block with a visible notice and an unverified record

#### Scenario: New evidence does not reset the bound

- **WHEN** a new block proposal carries different evidence after the bound
- **THEN** the gate does not start another review and applies the exhausted policy

### Requirement: Standing grant recognition

The review SHALL include the workspace `AGENTS.md` and the machine-local standing-grant record in its evidence. A dated grant that covers the proposed action SHALL be treated as authorization, and the gate SHALL deny a permission block for a covered action. A grant SHALL NOT authorize a new product requirement, a destructive action, a credential, or a publication unless it names it.

#### Scenario: Covered action

- **WHEN** the user has granted a sibling-repository or testability change and the block asks for permission for that action
- **THEN** the gate denies the block as a permission blocker

#### Scenario: Scope limit

- **WHEN** the grant covers code changes but not a destructive action, credential, or publication
- **THEN** the out-of-scope action remains a user decision

#### Scenario: Runtime permission is independent

- **WHEN** no standing grant exists but the runtime grants full file access
- **THEN** a code edit is still not a permission blocker

### Requirement: Block review failure policy

By default a review that does not confirm a blocker leaves the goal active. The configured `allow` policy is an explicit exception: it SHALL allow the unverified block, mark the record unverified, and inject a visible notice. The default unavailable policy is `allow`; the default error and exhausted policies are `deny`. The gate MUST NOT fail the session.

#### Scenario: Target is unavailable with default allow

- **WHEN** no review provider is registered and the unavailable policy is the default
- **THEN** the gate allows the unverified block, marks the record unverified, and injects a visible notice

#### Scenario: Target is unavailable with deny

- **WHEN** the unavailable policy is `deny`
- **THEN** the gate leaves the goal active and records the reason

#### Scenario: Review error with default deny

- **WHEN** the target errors, times out, or returns an invalid verdict and the error policy is the default
- **THEN** the gate leaves the goal active and records the failure

#### Scenario: Review error with allow

- **WHEN** the error policy is `allow`
- **THEN** the gate allows the unverified block, marks the record unverified, and injects a visible notice

### Requirement: Block review configuration and off switch

The block review SHALL be enabled by default with a documented provider, model, reasoning effort, reviewer preset, effective `blockedAfterConsecutiveRounds`, timeout, per-goal review bound, error policy, unavailable policy, and exhausted policy. `blockReview.enabled: false` SHALL disable only the gate and leave continuity supervision unchanged. Disabling the plugin row or `enabled: false` SHALL remove the gate and restore stock behavior.

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
