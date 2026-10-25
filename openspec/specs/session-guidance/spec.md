# session-guidance Specification

## Purpose
Defines the first-party guidance the setup delivers to sessions: bounded always-on contributions, the
on-demand skill bodies beside them, independently installable domain packs, and the adaptation and
freshness rules that keep that content honest.

## Requirements

### Requirement: Always-on ruleset contribution

Installing a guidance bundle that declares an always-on contribution SHALL register its rules as an always-on system-prompt section, so a session started while the row is active receives them without invoking any skill. A configuration switch MUST disable only that bundle's always-on contribution, while disabling or uninstalling the row MUST remove both that bundle's rules and its skills. A guidance bundle without an always-on contribution is unaffected.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where a guidance bundle with an always-on contribution is active with default configuration
- **THEN** the assembled system prompt contains that bundle's rules and the catalog lists that bundle's skills

#### Scenario: Configuration opt-out

- **WHEN** the profile patch sets a bundle's `alwaysOn` configuration to false
- **THEN** the assembled prompt omits only that bundle's rules, its skills remain cataloged and loadable, and any other bundle's always-on rules remain present

#### Scenario: Row removal

- **WHEN** the row is disabled or the plugin is uninstalled
- **THEN** neither that bundle's rules nor its skills are present in the session

#### Scenario: Two guidance bundles

- **WHEN** two guidance bundles with always-on contributions are active
- **THEN** both rulesets appear in their declared order, and disabling or removing one leaves the other in place

### Requirement: Bounded prompt cost

Each always-on contribution SHALL NOT exceed the estimated-token budget documented for it: the working-principles contract is bounded at 1500 estimated tokens and the RTK rule at 300. One estimated token is one quarter of the packaged text's UTF-8 byte count. Repository validation MUST fail when a contribution exceeds its budget, reporting the owning plugin and the measured size, so a later edit cannot silently raise the cost of every session.

#### Scenario: Within budget

- **WHEN** repository validation reads each packaged always-on contribution
- **THEN** it passes, and the plugin documentation states the measured size of each contribution

#### Scenario: Over budget

- **WHEN** an edit grows an always-on contribution past its documented budget
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

### Requirement: RTK always-on routing rule

The setup SHALL ship a Host-only guidance bundle that registers a short always-on routing rule and an on-demand `rtk` skill. The rule MUST direct the agent to run supported bulk-output shell commands through the user-installed rtk CLI, keep the `read`, `grep`, and `glob` tools for file inspection, and fall back to the native command when rtk is missing or the command has no rtk equivalent.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where the RTK bundle row is active with default configuration
- **THEN** the assembled system prompt contains the RTK routing rule and the catalog lists the `rtk` skill

#### Scenario: Supported bulky command

- **WHEN** the agent is about to run a supported bulky command such as `git diff`, a test suite, or a repo-wide search
- **THEN** the always-on rule directs it to use the rtk form, and the skill names the supported command groups

#### Scenario: Unsupported command or absent rtk

- **WHEN** rtk is not installed or a command has no rtk equivalent
- **THEN** the guidance directs the agent to run the native command and preserve its errors, and the profile still composes and starts

### Requirement: RTK skill body

The `rtk` skill body MUST load only when the model or user invokes the skill and MUST carry the supported-command groups, the native fallback, the full-output recovery route, and the security boundary for untrusted project filters. The catalog SHALL advertise only the skill's name and description until invocation.

#### Scenario: Catalog entry only

- **WHEN** a session starts and the `rtk` skill is not invoked
- **THEN** the catalog advertises its description and the skill body is absent from the assembled prompt

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes the `rtk` skill
- **THEN** its body is rendered as skill content for that session

#### Scenario: Untrusted project filters

- **WHEN** the agent works in a repository it does not trust
- **THEN** the skill directs it not to run `rtk trust` or load project-local filters and to use the built-in filters only

#### Scenario: Full detail recovery

- **WHEN** the compact output is insufficient to diagnose a failure
- **THEN** the skill names `rtk proxy <command>` for raw output and warns not to rerun a mutating command to recover detail

### Requirement: RTK external runtime

rtk SHALL remain an external, user-installed CLI. The bundle MUST NOT install, vendor, or declare a dependency on rtk, and MUST NOT spawn rtk from plugin code. The documentation MUST name the prerequisite and the install routes and MUST credit the rtk project as the source of the command contract without claiming pinned or verbatim upstream content.

#### Scenario: Not bundled

- **WHEN** the plugin package is inspected
- **THEN** it contains no rtk binary, no rtk installer, and no rtk package dependency

#### Scenario: Absent rtk

- **WHEN** rtk is not on the PATH
- **THEN** the profile still composes and starts, and the guidance directs the agent to run the native command

#### Scenario: Documentation

- **WHEN** a user reads the plugin's market card or documentation
- **THEN** it names rtk, the install routes, and the date the command guidance was checked, and credits the rtk project

### Requirement: RTK guidance boundary

The RTK bundle MUST change agent guidance only: it MUST NOT patch the shell service, rewrite tool arguments, filter or replace tool results, or register a post-execute hook. It MUST remain installable without any sibling `@dsh-setup` bundle, and its always-on rule MUST name a plain-language phrase that suspends only that rule for the rest of the session.

#### Scenario: No interception

- **WHEN** the RTK bundle is active
- **THEN** it registers only a system-prompt section and a skill provider, with no shell patch, tool hook, result filter, or child process

#### Scenario: Standalone install

- **WHEN** only the RTK bundle is installed
- **THEN** its skill lists and loads and its own checks pass, without requiring any other `@dsh-setup` bundle

#### Scenario: Suspension

- **WHEN** the user asks to stop rtk routing for the rest of the session
- **THEN** the agent stops applying only that rule, the other always-on guidance remains in force, and the section names no command the Harness does not provide
