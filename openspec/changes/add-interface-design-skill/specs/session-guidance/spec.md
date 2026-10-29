# Spec Delta

## ADDED Requirements

### Requirement: Interface design skill

The guidance bundle SHALL ship an on-demand `interface-design` skill in the skill catalog, with a
description that names the trigger and the covered surfaces, and the full body MUST stay out of the
assembled prompt until the skill is invoked.

#### Scenario: Catalog entry only

- **WHEN** a session starts and the skill is not invoked
- **THEN** the catalog advertises its name and description and the body is absent from the prompt

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes `interface-design`
- **THEN** the body is rendered as skill content for that session

#### Scenario: Description matches the asset

- **WHEN** the provider lists the skill
- **THEN** its catalog description is identical to the asset's frontmatter description

#### Scenario: Offline load

- **WHEN** the machine has no network access after installation
- **THEN** the skill lists and loads from the installed package

### Requirement: Interface design content contract

The skill body SHALL state the first-time test (what this is, the one next action, what will happen,
what happened, how to recover) and SHALL apply one cost model — recall, decision, prediction,
interpretation, recovery — to client UI, CLI or installer, API or signature, code, and skill or tool
definitions. It SHALL give each surface concrete rules, red flags, and the repository patterns to
reuse.

#### Scenario: First-time test present

- **WHEN** the body is read
- **THEN** it asks what the interface is, the one next action, what will happen, what happened, and how to recover

#### Scenario: Cross-surface coverage

- **WHEN** the body is read
- **THEN** it contains a rule or check for every covered surface and does not stop at visual design

#### Scenario: Repository anchors

- **WHEN** the skill is used inside this repository
- **THEN** it points to the client primitives and tokens, the installer contract, and the skill packaging rules instead of inventing a new design system

### Requirement: Interface design review output

The skill SHALL end with a review output that rates severity and Thinking Cost and gives a one-line
problem, impact, fix, and location for each finding.

#### Scenario: Actionable review

- **WHEN** the skill is used to review an interface
- **THEN** the result rates severity and Thinking Cost and names a concrete fix and location for each finding

### Requirement: Interface design skill boundaries

The change MUST NOT add or alter an always-on contribution, so the bundle keeps exactly one
always-on section within its documented budget. Detailed references SHALL load only when read. The
skill SHALL record its sources and what was removed or rewritten, and MUST NOT present adapted text
as verbatim upstream content or carry a provenance pin.

#### Scenario: One always-on section

- **WHEN** the bundle is assembled
- **THEN** it registers one always-on section and the interface design skill contributes none

#### Scenario: Budget unchanged

- **WHEN** the always-on contract is measured
- **THEN** it stays within the documented estimated-token and byte limits

#### Scenario: References on demand

- **WHEN** the skill body is loaded
- **THEN** its reference files are not loaded until the model reads them

#### Scenario: Recorded adaptation

- **WHEN** a reader follows the skill to its source record
- **THEN** it names the sources and the removed or rewritten parts, and the skill is not described as pinned upstream content
