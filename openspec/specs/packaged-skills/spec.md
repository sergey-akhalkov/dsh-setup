# packaged-skills Specification

## Purpose

Defines how the setup distributes third-party prompt content as installable plugin context: immutable upstream pinning, verbatim vendoring with attribution, an on-demand skill, a default-on always-on ruleset with a documented opt-out, local override precedence, and the boundary between packaged third-party content and machine-local user skills.

## Requirements


### Requirement: Packaged prompt delivery

The repository SHALL ship provenance-pinned third-party content inside a plugin bundle. Installing that bundle MUST register the on-demand skill in the DSH agent skill catalog and MUST make any packaged always-on ruleset active by default unless configuration disables it; a package that ships no ruleset contributes no always-on text. No manual file copying into user directories is permitted.

#### Scenario: Installation through the native bundle mechanism

- **WHEN** a user installs the plugin bundle through the market, a commit-pinned git specification, or the setup bundle
- **THEN** the running profile's skill catalog lists the packaged skill and, when the package ships a ruleset, that contribution is active by default

#### Scenario: No manual file placement

- **WHEN** a user installs only through the native bundle mechanism
- **THEN** the plugin writes no files into `~/.agents`, the Harness home, or the workspace.

### Requirement: On-demand skill body

The full skill body MUST load only when the model or user invokes the skill. Installing the plugin MUST NOT place the full body in the prompt or require the user to invoke it; the skill MUST stay loadable in later sessions while the row remains active.

#### Scenario: Catalog entry only

- **WHEN** a session starts after installation and the skill is not invoked
- **THEN** the catalog advertises the skill's description and the full skill body is absent from the assembled prompt.

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes the packaged skill
- **THEN** its body is rendered as skill content for that session.

#### Scenario: Disabled row

- **WHEN** the profile patch disables the plugin's row
- **THEN** the skill is absent from the catalog.

### Requirement: Default-on always-on ruleset

When a package ships an always-on ruleset, the plugin SHALL register that packaged compact ruleset as a system-prompt contribution by default, so sessions started while the row is active receive it without invoking the skill. A configuration switch MUST disable the always-on contribution while keeping the on-demand skill available; disabling or uninstalling the row MUST disable every contribution the package has. A package that ships no ruleset adds no system-prompt contribution.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where the plugin row is active with default configuration
- **THEN** the assembled system prompt contains the packaged ruleset when the package ships one, and carries no contribution from that row when it does not

#### Scenario: Configuration opt-out

- **WHEN** the profile patch sets the plugin's `alwaysOn` configuration to false
- **THEN** the assembled prompt omits the ruleset, and the skill remains cataloged and loadable

#### Scenario: Suspend in conversation

- **WHEN** the user asks to stop Ponytail or return to normal mode
- **THEN** the adapter text directs the agent to suspend the ruleset for the rest of the session

#### Scenario: Row removal

- **WHEN** the row is disabled or the plugin is uninstalled
- **THEN** neither the ruleset nor the skill is present

### Requirement: Immutable upstream pin and provenance

Every vendored file MUST come from an immutable upstream source recorded in a committed provenance document: repository, version, tag, 40-hex-digit commit, per-file size, and SHA-256. Refreshing the same version MUST reproduce byte-identical files and provenance.

#### Scenario: Pin record

- **WHEN** the repository is inspected
- **THEN** the provenance document names the upstream tag, commit, and hash for every vendored file, and each file's size and hash match.

#### Scenario: Reproducible refresh

- **WHEN** the update step runs again for the already pinned version
- **THEN** it leaves the working tree unchanged, including the current number of vendored files.

#### Scenario: Immutable fetch

- **WHEN** the update step downloads upstream content
- **THEN** it fetches by commit SHA rather than by a mutable branch or tag reference.

### Requirement: Verbatim content and attribution

The vendored skill prompt, its referenced assets, any executable runtime it invokes, and the license MUST be byte-identical to the upstream files at the pinned commit, and the license text MUST ship with the plugin. The repository SHALL credit the upstream author, link the source, and name the upstream version in documentation and display metadata; no committed transformation may alter vendored files, apart from clearly separated adapter text appended when the skill or ruleset is presented at runtime.

#### Scenario: Byte identity

- **WHEN** offline provenance validation runs
- **THEN** every vendored file, including the runtime script, matches the size and SHA-256 recorded in the provenance document

#### Scenario: Attribution visible

- **WHEN** a user reads the plugin's market card or documentation
- **THEN** the upstream project, author, version, license, and source link are named

#### Scenario: Runtime adapter text

- **WHEN** the skill body is presented
- **THEN** the vendored bytes appear unchanged and the adapter text is clearly separated after them

### Requirement: Precedence and local override

A project or user skill with the same name SHALL take precedence over the packaged skill, so a local copy overrides it without uninstalling the plugin. When the package ships an always-on ruleset, that ruleset MUST remain governed by the plugin's configuration, not by skill-name precedence.

#### Scenario: Local skill override

- **WHEN** a project or user skill with the same name exists
- **THEN** the catalog resolves the local definition instead of the packaged one

#### Scenario: Independent opt-out

- **WHEN** the always-on mode is disabled by configuration
- **THEN** the catalog and loading behavior of the packaged skill are unchanged

### Requirement: Offline installation and runtime

The plugin MUST NOT require network access at installation or at runtime. Installation, catalog listing, prompt assembly, and skill loading MUST work offline from the vendored files; upstream access happens only in the explicit update step.

#### Scenario: Offline operation

- **WHEN** the machine has no network access after installation
- **THEN** the ruleset participates in prompt assembly, the skill lists, and the skill loads normally.

#### Scenario: No implicit fetch

- **WHEN** installation or a session runs without the explicit update step
- **THEN** the plugin makes no request to the upstream repository.

### Requirement: Update release contract

Moving to a newer upstream version SHALL be an explicit repository release: refresh the pin and every vendored file together (the skill prompt, any rules file, the executable runtime, and the license), regenerate the setup bundle, bump the set version, and publish through the market. Older listed versions MUST remain installable after a newer release.

#### Scenario: New upstream version

- **WHEN** a release pins a newer upstream version
- **THEN** the market lists the new plugin version alongside the previously published versions, and every vendored file comes from the same pin

#### Scenario: No self-update

- **WHEN** an installed plugin runs
- **THEN** it never replaces or extends its vendored content at runtime

### Requirement: Repository skill-content boundary

The repository MAY ship provenance-pinned third-party prompt content inside plugin bundles. It MUST NOT ship machine-local user skills, instructions, credentials, session data, or other user state.

#### Scenario: Packaged content accepted

- **WHEN** repository validation inspects a vendored upstream prompt whose provenance and license checks pass
- **THEN** it accepts the content.

#### Scenario: User state rejected

- **WHEN** repository validation finds credentials, session data, machine-specific absolute paths, or copies of a user's own skills or instructions
- **THEN** it fails.
