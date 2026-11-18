# Spec Delta

## ADDED Requirements

### Requirement: Spec-less change intake

When a change's `.openspec.yaml` sets `skip_specs: true`, the contributed `change-intake` definition
SHALL accept the change without a `specs/**/spec.md` file, SHALL run `openspec validate <change>
--strict`, and SHALL still run the whole-spec review on the proposal, design, and tasks. A change
with neither a spec file nor `skip_specs: true` MUST be refused at the spec step.

#### Scenario: Spec-less change completes intake

- **WHEN** a change has proposal.md, design.md, tasks.md, and `skip_specs: true`, with no spec file
- **THEN** the spec step passes, validation passes, the whole-spec review runs on the plan, approval completes, and the intake run completes

#### Scenario: Spec-bearing change is unchanged

- **WHEN** a change has at least one file matching `specs/**/spec.md`
- **THEN** the existing seven-step intake path is unchanged

#### Scenario: Missing spec and marker is refused

- **WHEN** a change has neither a spec file nor `skip_specs: true`
- **THEN** the spec step refuses and names the missing spec or the marker
