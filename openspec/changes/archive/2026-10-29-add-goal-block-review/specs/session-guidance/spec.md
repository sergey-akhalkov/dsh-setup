# Spec Delta

## MODIFIED Requirements

### Requirement: Goal blocker and completion evidence

The always-on working contract SHALL state that `blocked` requires both the runtime round threshold and a user-only obstacle: a next step that only the user can perform, or knowledge only the user has. It SHALL state that difficulty, uncertainty, remaining work, a library or sibling-repository change, a testability or instrumentation change, and a permission the runtime already grants are not blockers. It SHALL state that a blocker names exactly one user-only action and that a menu containing an authorized alternative is not a blocker. It SHALL state that `complete` requires current evidence for every requirement of the objective.

#### Scenario: Premature blocker

- **WHEN** the agent considers reporting `blocked` before three consecutive rounds or with a changed obstacle
- **THEN** the contract rejects that report and keeps the goal active

#### Scenario: Completion audit

- **WHEN** the agent considers reporting `complete`
- **THEN** the contract requires each requirement of the objective to be checked against current evidence

#### Scenario: Authorized means

- **WHEN** the obstacle is a library, sibling-repository, test, or testability change within the agent's authority
- **THEN** the contract rejects the block and directs the agent to make that change

#### Scenario: Permission already granted

- **WHEN** the runtime grants full file access or a standing grant covers the action
- **THEN** the contract rejects a permission block for that action

#### Scenario: Menu of alternatives

- **WHEN** the block reason lists a code or tool option beside a user-only option
- **THEN** the contract rejects the block as a menu and selects the authorized option

#### Scenario: User-only obstacle

- **WHEN** the next step is a restart, a credential, a product decision, a publication, or data only the user has
- **THEN** the contract permits the block and requires the exact user-only action

## ADDED Requirements

### Requirement: Standing grant ledger

The always-on working contract SHALL state that a standing user grant is recorded durably in the workspace `AGENTS.md` or a machine-local grant record with its date and scope, and that the agent MUST NOT ask again for an action the grant covers. A grant SHALL cover means only and SHALL NOT authorize a new product requirement, a destructive action, a credential, or a publication unless it names it.

#### Scenario: Grant is recorded

- **WHEN** the user says not to ask for permission and to do what the goal needs
- **THEN** the agent records the dated grant and its scope in the workspace instruction file or the local grant record, then proceeds

#### Scenario: Covered action

- **WHEN** a block proposal asks for permission for an action the grant covers
- **THEN** the contract treats the action as authorized and rejects the permission block

#### Scenario: Scope limit

- **WHEN** a destructive action, credential, publication, or new product requirement is outside the grant
- **THEN** it remains a user decision

#### Scenario: Foreign or stale grant

- **WHEN** the grant belongs to another workspace, task, or an earlier scope that the user narrowed
- **THEN** the contract does not apply it

### Requirement: Means versus scope

The always-on working contract SHALL distinguish a scope change from a means. A new feature or requirement, a changed public contract, destroyed data, a changed access or credential, and a publication SHALL be user decisions. Editing another repository, adding a helper, a test harness, instrumentation, or test-only activation to achieve the requested outcome SHALL be a means that the agent performs and discloses.

#### Scenario: Sibling repository

- **WHEN** the requested outcome needs a change in a sibling repository
- **THEN** the contract treats the change as a means, performs it, and discloses it in the report

#### Scenario: Testability

- **WHEN** the requested evidence needs a test-only activation, accessibility hook, or instrumentation
- **THEN** the contract treats it as a means and prefers a test-only flag without a production behavior change

#### Scenario: Production behavior

- **WHEN** the only route changes production behavior
- **THEN** the contract treats it as a product decision

#### Scenario: New feature

- **WHEN** the proposed work adds a feature or requirement the user did not ask for
- **THEN** the contract treats it as a scope change and requires the user's decision

### Requirement: Block review guidance

The always-on working contract SHALL state that a model-proposed goal block is independently reviewed before it takes effect, that a denied block means the agent continues with the review's next action, and that an allowed block names exactly one user-only action. The contract MUST NOT present the review as a reason to ask the user for permission.

#### Scenario: Denied block

- **WHEN** the review rejects a proposed block
- **THEN** the contract directs the agent to continue with the review's next action and keep the goal active

#### Scenario: Verified block

- **WHEN** the review confirms a blocker
- **THEN** the closing message names the exact user-only action and what it unblocks

#### Scenario: No permission request

- **WHEN** the review is available
- **THEN** the contract does not turn the review into a request for the user's approval
