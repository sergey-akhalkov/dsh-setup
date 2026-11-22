## ADDED Requirements

### Requirement: English catalog adapter for a Chinese-only third-party skill

The repository SHALL provide an adapter bundle that presents the pinned `huashu-design` skill with an
English catalog description and English trigger words, and that loads the installed upstream body
unchanged, byte for byte, followed by a clearly separated English directive to talk to the user in the
user's own language and to write the deliverable's own copy in English unless asked otherwise. The
adapter MUST NOT ship upstream bytes, MUST NOT contact the network, and MUST list nothing while the
upstream package is absent from the profile. Its catalog entry MUST rank lower than a project or user
skill of the same name and higher than the filesystem provider's bundled root, so a local override
continues to win. The adapter's documentation and display metadata MUST name the upstream project,
author, license, and pinned version, and MUST state that the upstream manual stays Chinese.

#### Scenario: English catalog line

- **WHEN** the skills list is read with the upstream bundle installed
- **THEN** the `huashu-design` entry carries an English description with English trigger words and no
  Chinese text

#### Scenario: Local override still wins

- **WHEN** a project or user skill named `huashu-design` exists
- **THEN** the catalog resolves that local definition instead of the adapter entry

#### Scenario: Upstream absent

- **WHEN** the upstream package is not installed in the profile
- **THEN** the adapter lists no candidate, loads nothing, and reports no error

#### Scenario: Body and directive on load

- **WHEN** the adapter entry is loaded
- **THEN** the content is the installed upstream body with its frontmatter removed, unchanged
  otherwise, followed by the separated English language directive, and the resource base is the
  installed package directory

#### Scenario: Pin bump

- **WHEN** the pinned upstream version changes the skill's scope, triggers, or name
- **THEN** the adapter's description and name are re-synced with that version in the same release
