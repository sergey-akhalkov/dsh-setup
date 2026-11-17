# Spec Delta

## MODIFIED Requirements

### Requirement: Independent domain packs

A domain skill bundle MUST be usable on its own: composing or loading it SHALL NOT require another
`@dsh-studio` bundle, a shared runtime module, or a row contributed by a sibling bundle.

#### Scenario: Standalone install

- **WHEN** a user installs only a domain bundle
- **THEN** its skills list and load, and its own checks pass

#### Scenario: Absent sibling

- **WHEN** the guidance bundle is not installed
- **THEN** a domain bundle still composes and its rows mount

### Requirement: RTK guidance boundary

The RTK bundle MUST change agent guidance only: it MUST NOT patch the shell service, rewrite tool arguments, filter or replace tool results, or register a post-execute hook. It MUST remain installable without any sibling `@dsh-studio` bundle, and its always-on rule MUST name a plain-language phrase that suspends only that rule for the rest of the session.

#### Scenario: No interception

- **WHEN** the RTK bundle is active
- **THEN** it registers only a system-prompt section and a skill provider, with no shell patch, tool hook, result filter, or child process

#### Scenario: Standalone install

- **WHEN** only the RTK bundle is installed
- **THEN** its skill lists and loads and its own checks pass, without requiring any other `@dsh-studio` bundle

#### Scenario: Suspension

- **WHEN** the user asks to stop rtk routing for the rest of the session
- **THEN** the agent stops applying only that rule, the other always-on guidance remains in force, and the section names no command the Harness does not provide
