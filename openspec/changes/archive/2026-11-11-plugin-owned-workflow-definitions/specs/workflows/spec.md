# Spec Delta

## ADDED Requirements

### Requirement: Definition registry

The workflows plugin SHALL provide a host registry service that an installed plugin uses to contribute read-only definitions and shadow triggers. The engine SHALL validate every contribution with the closed definition and trigger schemas, refuse a duplicate definition or trigger id naming both sources, and expose the contributing plugin as the source. The engine MUST NOT discover contributions by reading plugin package files, scanning package directories, or accepting a profile path list.

#### Scenario: Valid contribution loads

- **WHEN** an installed plugin registers a valid definition and trigger while the registry service is available
- **THEN** the engine lists them, the definition can start, and the client shows the plugin as the source

#### Scenario: Duplicate id is refused

- **WHEN** two sources register the same definition id or trigger id
- **THEN** the later contribution is refused naming both sources and no duplicate is active

#### Scenario: Invalid contribution is refused

- **WHEN** a contribution has an unknown field, a duplicate step id, an invalid edge, or an invalid trigger filter
- **THEN** the contribution is refused with the definition or trigger and the field, and no part of it is registered

#### Scenario: No package scan

- **WHEN** the engine loads a workspace without a registry contribution
- **THEN** it does not discover a definition from a plugin package directory or a profile path list

### Requirement: Optional contribution

The contribution SHALL be optional on both sides. A feature plugin MUST remain functional and register nothing when the engine or registry service is absent; an engine without a contributor MUST load the remaining definitions and the generic trigger catalog unchanged. A contribution SHALL be removed when its plugin is disposed; its existing runs MUST remain readable.

#### Scenario: Plugin without the engine

- **WHEN** a feature plugin loads in a profile that does not install the workflows engine
- **THEN** it registers nothing and its own surfaces keep working without an error

#### Scenario: Engine without a contributor

- **WHEN** the engine loads a profile in which no installed plugin contributes definitions or triggers
- **THEN** the remaining definitions and the generic trigger catalog load unchanged

#### Scenario: Contribution is removed on dispose

- **WHEN** a contributing plugin is disposed
- **THEN** its definitions and triggers are no longer listed and the runs it recorded remain readable

### Requirement: Trigger captures

A deterministic trigger MAY declare one named `{name}` capture in a `match.command` template or in an `fs.change` `match.path` glob. The engine SHALL validate the placeholder, extract the captured value into the run context as `name`, and MUST NOT require a product-specific allowlist or path regex for trigger matching. A trigger without a capture SHALL behave as before.

#### Scenario: Command template captures the name

- **WHEN** a shell command matches a declared template such as `openspec new change {name}`
- **THEN** the run context carries the captured name and no engine command allowlist is consulted

#### Scenario: Path glob captures the name

- **WHEN** a file change matches a declared path such as `openspec/changes/{name}/**`
- **THEN** the run context carries the captured name and the engine does not use a product path regex

#### Scenario: Non-product template works

- **WHEN** a contributed definition declares `acme deploy {name}` as its command template
- **THEN** it matches and captures the name without an engine change

#### Scenario: Invalid capture is refused

- **WHEN** a template contains an empty, repeated, or unclosed capture
- **THEN** the definition fails validation with the definition and the field

### Requirement: Command normalization

Before a `match.command` template match the engine SHALL normalize the documented `rtk` and `pnpm exec` invocation prefixes, whitespace, and one symmetric quote pair around the captured name, and MUST reject a compound command. A normalized command that matches the template SHALL yield the unquoted, validated name; the gate behavior SHALL be unchanged for the supported invocation forms.

#### Scenario: Prefixed command captures the name

- **WHEN** the shell command is `rtk openspec new change auth` or `pnpm exec openspec new change auth` and the template is `openspec new change {name}`
- **THEN** the capture is `auth` and the intake gate applies as it does for the bare form

#### Scenario: Quoted name captures the name

- **WHEN** the matched command quotes the name such as `openspec new change "auth"`
- **THEN** the capture is the unquoted, validated `auth`

#### Scenario: Compound command does not match

- **WHEN** the command carries a shell control, substitution, or a second command
- **THEN** the template does not match and no run or gate decision is made for it

### Requirement: Gate declaration

The engine SHALL select a pre-execute gate from a definition's declared gate policy rather than from the definition id. A contributed or locally approved definition that declares the intake gate SHALL receive the intake gate, and the gate's running, resumable, and completed-run lookups SHALL use the selected definition id; a definition without the declaration MUST NOT receive it. The engine MUST NOT key a pre-execute gate on a definition id.

#### Scenario: Declared gate runs

- **WHEN** a contributed definition declares the intake gate and its trigger matches the create command
- **THEN** the intake gate runs with the captured name under the existing refusal and run rules

#### Scenario: No declaration means no gate

- **WHEN** a definition does not declare the intake gate
- **THEN** the intake gate does not run for it, even when its trigger matches the create command

#### Scenario: Gate survives an id change

- **WHEN** the definition is renamed or a local copy of it has another id
- **THEN** the declared intake gate still applies, and the running, resumable, and completed-run checks use the new id instead of a fixed id

#### Scenario: Repeated calls use the selected id

- **WHEN** a definition with another id has started an intake run and the create command is called again, resumed, or completed
- **THEN** the gate finds the run by the selected id and does not create a duplicate or redirect to adoption

### Requirement: Gate-preserving override

A local definition that shadows an installed definition MUST NOT remove or weaken a declared pre-execute gate. The engine SHALL refuse such an override with a reapproval remedy, and the installed definition SHALL remain the effective one. An override that preserves the gate SHALL load through the normal approval flow.

#### Scenario: Old intake override is refused

- **WHEN** a previously approved local override of the installed intake lacks the gate declaration and uses the retired `<name>` token
- **THEN** the engine refuses it with the reapproval remedy and the installed intake stays effective

#### Scenario: No silent bypass

- **WHEN** the refused override is present and the create command is called
- **THEN** the installed gate still refuses the command until a completed intake run exists

#### Scenario: Reapproved override loads

- **WHEN** the user saves a local copy from the installed template with the gate declaration and approves it
- **THEN** the override loads and the intake gate applies

#### Scenario: Non-shadowing local definition is unaffected

- **WHEN** a local definition does not shadow an installed gated definition
- **THEN** it loads without a gate declaration

### Requirement: Installed definitions

The plugin SHALL NOT ship new product-specific definitions. `change-intake` SHALL be contributed by `@dsh-setup/plugin-openspec`. The engine continues to ship `task-review`, `retro`, and `verify` as the remaining legacy-retirement exceptions with their current `own` gate ownership and legacy source references, while the setup keeps the corresponding legacy switches off. A contributed definition MUST run from the generic schema and MUST NOT require a new id-specific engine behavior.

#### Scenario: Engine-shipped exceptions

- **WHEN** a fresh installation loads the engine definitions
- **THEN** `task-review`, `retro`, and `verify` load with their current `own` ownership and the setup's legacy switches stay off

#### Scenario: Contributed intake loads

- **WHEN** the OpenSpec plugin registers `change-intake` while the engine, delegation-rules, and the strict `spec-review` signal are available
- **THEN** it loads with the requirements, architecture, interface, create-change, spec, spec-review, and approval steps, and the spec-review step stays deferred

#### Scenario: No new engine content

- **WHEN** a plugin contributes a definition
- **THEN** the engine lists and runs it without an engine release that names or hard-codes that definition id

## MODIFIED Requirements

### Requirement: Workflow definition

The plugin SHALL load workflow definitions from `.dsh/workflows/definitions/*.json`, the approved local overrides, the engine's own shipped definitions, and the definitions registered by installed plugins through the host registry service. A definition SHALL carry an id, name, version, trigger, an ordered step list, and settings; it MUST be data, not executable code. A plugin-contributed definition SHALL be read-only and SHALL name its contributing plugin as its source. The engine MUST NOT read a plugin's package files, scan package directories, or accept a config path list. An unknown field, a missing step id, a duplicate step, or an invalid edge SHALL fail load with the definition and field.

#### Scenario: Valid definition loads

- **WHEN** a definition has a known schema, unique step ids, and valid edges
- **THEN** it is listed and can be started

#### Scenario: Invalid definition is refused

- **WHEN** a definition has a duplicate step id or an unknown field
- **THEN** plugin load fails with the definition id and the field

#### Scenario: Shipped defaults are read-only

- **WHEN** the user has not created a local definition
- **THEN** the installed definitions (engine-shipped or plugin-contributed) are available and cannot be edited in place

#### Scenario: Contributed definition loads

- **WHEN** an installed plugin registers a valid definition while the registry service is available
- **THEN** the definition is listed with the plugin as its source and can start under the same rules as an engine-shipped definition

### Requirement: Definition activation

A local definition or override SHALL be activated only when its content hash matches a valid host-authenticated approval record. A modification after approval SHALL change the hash and refuse the definition until re-approved. The model MUST NOT create or activate a definition; it MAY propose a draft that a user confirms, and a model write directly to the definitions directory MUST NOT be active.

#### Scenario: Model cannot activate a definition

- **WHEN** the model submits a new definition through the tool
- **THEN** it is stored only as a draft and no run can start until a user confirms it

#### Scenario: Unapproved local definition is refused

- **WHEN** a definition file appears in the definitions directory without a valid authenticated approval
- **THEN** it is not loaded and the load reports the unapproved definition

#### Scenario: Approved override loads

- **WHEN** a local definition's content hash and HMAC signature match its approval
- **THEN** it overrides the installed definition and can be listed

#### Scenario: Modification after approval is refused

- **WHEN** an approved definition file is modified
- **THEN** its hash no longer matches or its signature is invalid and the loader refuses it

### Requirement: Definition editing

The editor SHALL create, edit, duplicate, rename, delete, and version-bump local definitions, and SHALL save only after schema validation passes and only through the host's shared install/approve function. A successful save MUST persist both the definition and its matching host-signed approval record; a failed definition or approval write MUST leave both unchanged. An engine-shipped or plugin-contributed definition MUST be read-only; editing one SHALL create a local copy.

#### Scenario: Save a valid definition

- **WHEN** the user saves a valid local definition
- **THEN** the host writes it, persists the matching host-signed approval, and the version is current; the definition loads after a restart

#### Scenario: Approval failure leaves no save

- **WHEN** the definition write succeeds but the approval write fails
- **THEN** neither the definition nor the approval changes and the save reports failure

#### Scenario: Draft install is authorized

- **WHEN** the user installs a model draft through a create-only save
- **THEN** it uses the same install/approve function and loads after a restart; a colliding id leaves both files unchanged

#### Scenario: Invalid definition is refused

- **WHEN** the graph has a dangling edge, a duplicate id, or an invalid field
- **THEN** the save is refused with the node and field

#### Scenario: Shipped definition is copied

- **WHEN** the user edits a shipped definition
- **THEN** a local copy is created and the shipped asset is unchanged

#### Scenario: Contributed definition is copied

- **WHEN** the user edits a plugin-contributed definition
- **THEN** a local copy is created, the contributed asset is unchanged, and the local copy shadows it by id

### Requirement: Templates

The editor SHALL list the installed templates — the plugin-contributed definitions and any engine-shipped definition — and create a local definition from one, including the `change-intake`, `task-review`, and `retro` shapes while they are installed. A template MUST be copied, not mutated, and a contributed template MUST keep its source label.

#### Scenario: Template list

- **WHEN** the user opens the template picker
- **THEN** the installed templates are listed with their step counts and sources

#### Scenario: Template copy

- **WHEN** the user creates a definition from a template
- **THEN** a local copy is created and the template remains unchanged

#### Scenario: Contributed template is labeled

- **WHEN** the template picker lists `change-intake`
- **THEN** it names the OpenSpec plugin as the source

#### Scenario: Contributor removed

- **WHEN** a contributing plugin is disabled
- **THEN** its template is absent and an existing local copy remains listed

## REMOVED Requirements

### Requirement: Shipped definitions

**Reason**: The engine no longer ships `change-intake`, and the requirement still claimed deferred ownership while the installed `task-review` and `retro` definitions are `own` with the setup's legacy switches off.
**Migration**: The engine's remaining definitions and their ownership are described by the new `Installed definitions` requirement.


