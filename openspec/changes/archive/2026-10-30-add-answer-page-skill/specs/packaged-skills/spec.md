# Spec Delta

## MODIFIED Requirements

### Requirement: Packaged prompt delivery

The repository SHALL ship provenance-pinned third-party content inside a plugin bundle. Installing
that bundle MUST register the on-demand skill in the DSH agent skill catalog and MUST make any
packaged always-on ruleset active by default unless configuration disables it; a package that ships
no ruleset contributes no always-on text. No manual file copying into user directories is permitted.

#### Scenario: Installation through the native bundle mechanism

- **WHEN** a user installs the plugin bundle through the market, a commit-pinned git specification,
  or the setup bundle
- **THEN** the running profile's skill catalog lists the packaged skill and, when the package ships a
  ruleset, that contribution is active by default

#### Scenario: No manual file placement

- **WHEN** a user installs only through the native bundle mechanism
- **THEN** the plugin writes no files into `~/.agents`, the Harness home, or the workspace

### Requirement: Default-on always-on ruleset

When a package ships an always-on ruleset, the plugin SHALL register that packaged compact ruleset
as a system-prompt contribution by default, so sessions started while the row is active receive it
without invoking the skill. A configuration switch MUST disable the always-on contribution while
keeping the on-demand skill available; disabling or uninstalling the row MUST disable every
contribution the package has. A package that ships no ruleset adds no system-prompt contribution.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where the plugin row is active with default configuration
- **THEN** the assembled system prompt contains the packaged ruleset when the package ships one, and
  carries no contribution from that row when it does not

#### Scenario: Configuration opt-out

- **WHEN** the profile patch sets the plugin's `alwaysOn` configuration to false
- **THEN** the assembled prompt omits the ruleset, and the skill remains cataloged and loadable

#### Scenario: Suspend in conversation

- **WHEN** the user asks to stop Ponytail or return to normal mode
- **THEN** the adapter text directs the agent to suspend the ruleset for the rest of the session

#### Scenario: Row removal

- **WHEN** the row is disabled or the plugin is uninstalled
- **THEN** neither the ruleset nor the skill is present

### Requirement: Precedence and local override

A project or user skill with the same name SHALL take precedence over the packaged skill, so a local
copy overrides it without uninstalling the plugin. When the package ships an always-on ruleset, that
ruleset MUST remain governed by the plugin's configuration, not by skill-name precedence.

#### Scenario: Local skill override

- **WHEN** a project or user skill with the same name exists
- **THEN** the catalog resolves the local definition instead of the packaged one

#### Scenario: Independent opt-out

- **WHEN** the always-on mode is disabled by configuration
- **THEN** the catalog and loading behavior of the packaged skill are unchanged

### Requirement: Update release contract

Moving to a newer upstream version SHALL be an explicit repository release: refresh the pin and
every vendored file together (the skill prompt, any rules file, the executable runtime, and the
license), regenerate the setup bundle, bump the set version, and publish through the market. Older
listed versions MUST remain installable after a newer release.

#### Scenario: New upstream version

- **WHEN** a release pins a newer upstream version
- **THEN** the market lists the new plugin version alongside the previously published versions, and
  every vendored file comes from the same pin

#### Scenario: No self-update

- **WHEN** an installed plugin runs
- **THEN** it never replaces or extends its vendored content at runtime

### Requirement: Verbatim content and attribution

The vendored skill prompt, its referenced assets, any executable runtime it invokes, and the license
MUST be byte-identical to the upstream files at the pinned commit, and the license text MUST ship
with the plugin. The repository SHALL credit the upstream author, link the source, and name the
upstream version in documentation and display metadata; no committed transformation may alter
vendored files, apart from clearly separated adapter text appended when the skill or ruleset is
presented at runtime.

#### Scenario: Byte identity

- **WHEN** offline provenance validation runs
- **THEN** every vendored file, including the runtime script, matches the size and SHA-256 recorded
  in the provenance document

#### Scenario: Attribution visible

- **WHEN** a user reads the plugin's market card or documentation
- **THEN** the upstream project, author, version, license, and source link are named

#### Scenario: Runtime adapter text

- **WHEN** the skill body is presented
- **THEN** the vendored bytes appear unchanged and the adapter text is clearly separated after them
