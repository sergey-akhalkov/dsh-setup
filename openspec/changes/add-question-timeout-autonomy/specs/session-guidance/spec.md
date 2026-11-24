# Spec Delta

## ADDED Requirements

### Requirement: Pending question policy

The always-on working contract SHALL state that a timed `ask_user_question` result of `pending` is neither a pause nor permission: the agent continues independent work, takes the recommended option only for a reversible operational choice and records the assumption in its next checkpoint, and leaves a scope, product, release, credential, or destructive choice open for the user. The agent SHALL NOT treat `pending` as a decision.

#### Scenario: Reversible operational pending keeps the work moving

- **WHEN** a timed `ask_user_question` that offered a reversible operational choice returns `pending` and independent work remains
- **THEN** the agent continues that work instead of idling or asking the same question again

#### Scenario: Reversible operational choice takes the recommendation

- **WHEN** the pending question offered a reversible operational choice and the agent takes the `(Recommended)` option
- **THEN** the agent records that assumption in its next work checkpoint so the choice is visible and can be revised

#### Scenario: Scope decision stays open after pending

- **WHEN** a question that changes scope, product behavior, a release, a credential, or destroys data returns `pending`
- **THEN** the agent leaves the dependent action unauthorized, continues independent work, and when none remains stops and reports the pending decision; it does not re-ask, does not treat pending as permission, and the question stays answerable for a late answer

#### Scenario: Indefinite wait is chosen before the call

- **WHEN** the agent knows before asking that the decision is irreversible and no independent work can proceed
- **THEN** it asks with `timeout: -1` and waits for the answer or cancellation; an already-returned `pending` result is not converted into an indefinite wait

### Requirement: A question never ends a turn

The always-on working contract SHALL state that a question is not a way to end a turn and that the agent never asks whether to continue. The policy MUST remain in the existing working-principles section and within its documented 1 500 estimated-token budget.

#### Scenario: Continue-or-pause question is refused by the contract

- **WHEN** the agent considers asking the user whether to continue or pause
- **THEN** the contract directs it to continue, because a question is for a decision it cannot take

#### Scenario: Policy stays in the bounded contract

- **WHEN** the assembled always-on contract is measured
- **THEN** the pending policy is part of the working-principles section and the section stays within 1 500 estimated tokens

### Requirement: Configurable question wait

The setup SHALL ship a Host bundle that makes the question foreground wait configurable through a
watched profile settings file: `timed` (default on) and `timeout` in seconds (default 300). On
activation and on every save of that file it SHALL derive the `tool-ask-user` row from the installed
declaration, never from its own persisted row, and SHALL leave a preset with a different profile
override untouched. A saved value SHALL apply to the next session without a restart.

#### Scenario: Fresh installation

- **WHEN** the setup is installed in a profile and no configuration overrides the bundle
- **THEN** every preset declaration that ships a `tool-ask-user` row composes the timed tool with a 300-second wait, and the watched settings file carries `timed: true`

#### Scenario: Changed wait

- **WHEN** the owner changes `timeout` or sets `timed: false` in the watched settings file
- **THEN** the bundle re-commits the derived row and the next session uses the new value, without a Harness restart

#### Scenario: Timed off

- **WHEN** `timed` is false
- **THEN** the shipped row is restored and a new session blocks on the question as before

### Requirement: Configuration over hard-coded knobs

The always-on working contract SHALL state that a decision with real operational knobs — how long to
wait, how often to retry, which limit applies — is exposed as a configuration value with a documented
default instead of a hard-coded constant, while unrelated behavior is not made configurable.

#### Scenario: A real knob is exposed

- **WHEN** the agent implements a wait, retry, or limit whose value an operator could reasonably change
- **THEN** the contract directs it to expose that value as configuration with a default, not as a constant

#### Scenario: No knob inflation

- **WHEN** the value has no operational reason to change
- **THEN** the contract does not require a configuration option for it

#### Scenario: Rule stays bounded

- **WHEN** the assembled working contract is measured
- **THEN** the configurability rule is part of the existing section and the section stays within 1 500 estimated tokens
