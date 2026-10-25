# session-guidance Specification

## Purpose
Defines the first-party guidance the setup delivers to sessions: a bounded always-on ruleset, the
on-demand skill bodies beside it, independently installable domain packs, and the adaptation and
freshness rules that keep that content honest.

## Requirements

### Requirement: Always-on ruleset contribution

Installing the guidance bundle SHALL register its ruleset as an always-on system-prompt section, so a
session started while the row is active receives it without invoking any skill. A configuration switch
MUST disable only the always-on contribution, while disabling or uninstalling the row MUST remove
both the ruleset and the skills.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where the guidance row is active with default configuration
- **THEN** the assembled system prompt contains the ruleset and the catalog lists the bundle's skills

#### Scenario: Configuration opt-out

- **WHEN** the profile patch sets the bundle's `alwaysOn` configuration to false
- **THEN** the assembled prompt omits the ruleset and the bundle's skills stay cataloged and loadable

#### Scenario: Row removal

- **WHEN** the row is disabled or the plugin is uninstalled
- **THEN** neither the ruleset nor the skills are present in the session

### Requirement: Bounded prompt cost

The always-on contribution SHALL NOT exceed 1500 estimated tokens, where one estimated token is one
quarter of the packaged text's UTF-8 byte count. Repository validation MUST fail when the text
exceeds that budget, so a later edit cannot silently raise the cost of every session.

#### Scenario: Within budget

- **WHEN** repository validation reads the packaged ruleset
- **THEN** it passes, and the plugin documentation states the measured size of the contribution

#### Scenario: Over budget

- **WHEN** an edit grows the packaged ruleset past the budget
- **THEN** validation fails and reports the owning plugin and the measured size

### Requirement: On-demand skill bodies

Skill bodies and their reference files MUST stay out of the assembled prompt until the model or user
invokes them; the catalog SHALL advertise only each skill's name and description. Installing the
bundle MUST NOT place skill files outside the bundle.

#### Scenario: Catalog entry only

- **WHEN** a session starts and no packaged skill is invoked
- **THEN** the catalog advertises the skills and their bodies are absent from the prompt

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes a packaged skill
- **THEN** its body is rendered as skill content for that session

#### Scenario: Reference on demand

- **WHEN** an invoked skill points at a reference file
- **THEN** that file loads only when it is read, not with the body

#### Scenario: Row disabled

- **WHEN** the profile patch disables the bundle's row
- **THEN** its skills are absent from the catalog

### Requirement: Independent domain packs

A domain skill bundle MUST be usable on its own: composing or loading it SHALL NOT require another
`@dsh-setup` bundle, a shared runtime module, or a row contributed by a sibling bundle.

#### Scenario: Standalone install

- **WHEN** a user installs only a domain bundle
- **THEN** its skills list and load, and its own checks pass

#### Scenario: Absent sibling

- **WHEN** the guidance bundle is not installed
- **THEN** a domain bundle still composes and its rows mount

### Requirement: Recorded adaptation of source content

Guidance adapted from another source MUST record what was removed or rewritten, and why, in the owning
change or documentation. Adapted text MUST NOT be presented as verbatim upstream content and MUST NOT
carry a provenance pin or an upstream license obligation.

#### Scenario: Adaptation record

- **WHEN** a reader follows the guideline text to its owning documentation
- **THEN** it names the source and lists the removals with their reason

#### Scenario: No verbatim claim

- **WHEN** a user reads the plugin's market card or skill text
- **THEN** the content is described as adapted for this setup, not as pinned upstream text

### Requirement: Version-sensitive content freshness

Guidance that names tool versions, the release that stabilized a language feature, or "new in
release" facts SHALL NOT assert a specific version as current; it MUST omit the version or state the
date it was checked and defer to the installed tool's own version report.

#### Scenario: Omitted versions

- **WHEN** guidance maps a newer standard feature to the code it replaces
- **THEN** the mapping names the replacement without claiming the release that introduced it

#### Scenario: Checked date

- **WHEN** guidance must name a version-sensitive fact
- **THEN** it states the date it was checked and directs the reader to query the installed tool

### Requirement: Session suspension

The always-on section SHALL state how a user suspends it for the rest of the session, and MUST NOT
direct the reader to a command the Harness does not provide.

#### Scenario: Suspend in conversation

- **WHEN** the user asks to stop the ruleset for this session
- **THEN** the agent stops applying it for the remainder of the session

#### Scenario: No phantom command

- **WHEN** a reader searches the section for an invocation the Harness does not have
- **THEN** it finds none, and the section relies on plain wording instead
