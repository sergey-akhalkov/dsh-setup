# openspec-workflows Specification

## Purpose

Defines how the OpenSpec plugin contributes its change-intake workflow and OpenSpec-specific shadow triggers to the workflows engine, and how the plugin behaves when the engine is absent.

## Requirements

### Requirement: Change-intake contribution

When the workflows registry service is available, the OpenSpec plugin SHALL register the `change-intake` definition from its own read-only asset. The definition SHALL keep the requirements, architecture, interface, create-change, spec, spec-review, and approval steps; the `spec-review` step SHALL be owned by the review executor and carry no legacy source. The plugin MUST NOT register it when the service is absent.

#### Scenario: Engine present

- **WHEN** the workflows registry service is available
- **THEN** the definition is listed with the OpenSpec plugin as its source, with the seven steps and the owned spec-review step

#### Scenario: Engine absent

- **WHEN** the workflows engine or its registry service is not installed
- **THEN** the plugin registers nothing and its panel and skill surfaces keep working

#### Scenario: Engine refuses the definition

- **WHEN** the engine refuses a contributed definition
- **THEN** the engine reports its existing remedy and the OpenSpec plugin still loads

### Requirement: OpenSpec shadow triggers

When the workflows registry service is available, the OpenSpec plugin SHALL contribute the OpenSpec shadow trigger entries for tasks checked, review recorded, change created, and change archived from its own read-only assets. The entries SHALL name the plugin as their source and MUST NOT be registered when the service is absent.

#### Scenario: Triggers are contributed

- **WHEN** the workflows registry service is available
- **THEN** the design page catalog lists the four OpenSpec entries with the plugin source and the generic entries are unchanged

#### Scenario: Triggers are absent without the engine

- **WHEN** the workflows engine or its registry service is not installed
- **THEN** no OpenSpec trigger is registered and the plugin keeps working

#### Scenario: Malformed trigger asset is refused

- **WHEN** a contributed trigger has an unknown event kind, an empty id, or an invalid filter
- **THEN** the contribution is refused with the trigger, the source, and the field, and no partial catalog is added

### Requirement: Read-only contribution

The contributed definition and triggers SHALL be read-only plugin assets. Editing the definition SHALL create a workspace-local copy through the engine's editor and approval flow; the plugin MUST NOT write `.dsh/workflows/` itself and MUST NOT require the engine to ship or own its content.

#### Scenario: Editing creates a local copy

- **WHEN** the user edits the contributed `change-intake` definition
- **THEN** a workspace-local copy is created through the approval flow and the plugin asset is unchanged

#### Scenario: The plugin writes nothing

- **WHEN** the plugin registers its contribution
- **THEN** no file under `.dsh/workflows/` is written by the plugin

#### Scenario: The engine ships no OpenSpec content

- **WHEN** the engine loads its own definition and trigger assets
- **THEN** `change-intake` and the OpenSpec shadow trigger entries are not among them

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
