# Spec Delta

## ADDED Requirements

### Requirement: Task-lane guidance addendum

The bundle SHALL append plugin-owned task-lane guidance to the loaded bodies of the propose,
update-change, and apply-change skills, after the vendored body and before the adapter note. The
addendum MUST be a plugin asset outside `assets/openspec`; it MUST NOT change the vendored bytes,
the lock, the catalog descriptions, or the idle prompt, and it MUST survive the pinned update step.

#### Scenario: Loaded task skills carry the addendum

- **WHEN** the model or a user loads `openspec-propose`, `openspec-update-change`, or `openspec-apply-change`
- **THEN** the loaded body contains the plugin-owned task-lane guidance before the adapter note

#### Scenario: Other packaged skills stay unchanged

- **WHEN** the model or a user loads `openspec-explore`, `openspec-sync-specs`, or `openspec-archive-change`
- **THEN** the loaded body contains no task-lane guidance

#### Scenario: Catalog and idle prompt stay clean

- **WHEN** the skill catalog is listed or the idle prompt is assembled
- **THEN** neither contains the task-lane guidance text

#### Scenario: Guidance defines an executable lane

- **WHEN** an implementer reads the guidance
- **THEN** it defines a lane as a top-level task group with disjoint owned paths and no dependency on another group except the serial integration tail, requires either a lane cut with named paths or a one-line single-lane reason, and directs independent lanes to parallel writers in separate worktrees with a serial final lane

#### Scenario: Pinned refresh preserves the addendum

- **WHEN** the pinned update step regenerates the vendored assets and the lock
- **THEN** the task-lane guidance asset remains in the package outside the regenerated directory and the vendored bytes still match the lock

## MODIFIED Requirements

### Requirement: Release-pinned update contract

Moving to a newer OpenSpec version SHALL be an explicit repository release: regenerate the six core
skills and license from the new pin, rewrite the lock, regenerate the setup bundle, and publish a new
set version. The running plugin MUST NOT replace or extend its vendored upstream content; it MAY
append its adapter note and plugin-owned task-lane guidance to a loaded skill body at runtime.

#### Scenario: New upstream version

- **WHEN** a release pins a newer OpenSpec version
- **THEN** the market lists the new plugin version alongside previously published versions and all assets come from the new pin

#### Scenario: No self-update

- **WHEN** the plugin runs
- **THEN** it never fetches or writes replacement skill content

#### Scenario: Plugin-owned runtime additions

- **WHEN** a packaged skill is loaded
- **THEN** the plugin may append its adapter note and the task-lane guidance to the loaded body while the vendored upstream files and the lock stay unchanged
