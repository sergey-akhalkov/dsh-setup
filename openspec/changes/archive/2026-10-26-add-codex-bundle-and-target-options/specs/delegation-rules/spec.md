# Spec Delta

## MODIFIED Requirements

### Requirement: Target resolution and model options

A target SHALL name a registered DSH subagent provider and MAY add a `model`, a `reasoningEffort`,
or provider-supported agent options. The engine MUST resolve the provider at use time, pass these
options in the subagent start request, validate them against provider capabilities, and report a
missing or incompatible target with the target id, provider name, and next action. The engine MUST
NOT silently escalate a target's permissions.

#### Scenario: Codex target with model and effort

- **WHEN** a rule targets the registered `codex-subagent` provider with `model: astra` and `reasoningEffort: xhigh`
- **THEN** the engine starts that provider with those options and the rule's instruction and context

#### Scenario: Effort-only target

- **WHEN** a target sets only `reasoningEffort` and leaves the model to the provider default
- **THEN** the engine passes the effort and the provider applies its configured/default model

#### Scenario: Codex target

- **WHEN** a rule targets the registered `codex-subagent` provider without options
- **THEN** the engine starts that provider with the rule's instruction and context

#### Scenario: Non-Codex target

- **WHEN** a rule targets a registered DSH in-process provider with another model
- **THEN** the engine uses that provider/model and the same rule contract

#### Scenario: Missing target

- **WHEN** a rule references a target whose provider is not registered
- **THEN** the tool reports the missing provider and the exact target configuration key

#### Scenario: Unsupported option

- **WHEN** a target requests a model, effort, or option the provider does not support
- **THEN** the engine rejects the target with the unsupported capability instead of ignoring it
