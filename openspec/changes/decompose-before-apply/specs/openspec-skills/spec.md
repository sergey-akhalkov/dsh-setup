# Spec Delta

## MODIFIED Requirements

### Requirement: Task-lane guidance addendum

The bundle SHALL append plugin-owned task-lane guidance to the loaded bodies of the propose,
update-change, and apply-change skills, after the vendored body and before the adapter note. The
addendum MUST be a plugin asset outside `assets/openspec`; it MUST NOT change the vendored bytes,
the lock, the catalog descriptions, or the idle prompt, and it MUST survive the pinned update step.

#### Scenario: Loaded task skills carry the addendum

- **WHEN** the model or a user loads `openspec-propose`, `openspec-update-change`, or
  `openspec-apply-change`
- **THEN** the loaded body contains the plugin-owned task-lane guidance before the adapter note

#### Scenario: Other packaged skills stay unchanged

- **WHEN** the model or a user loads `openspec-explore`, `openspec-sync-specs`, or
  `openspec-archive-change`
- **THEN** the loaded body contains no task-lane guidance

#### Scenario: Catalog and idle prompt stay clean

- **WHEN** the skill catalog is listed or the idle prompt is assembled
- **THEN** neither contains the task-lane guidance text

#### Scenario: Guidance defines an executable lane

- **WHEN** an implementer reads the guidance
- **THEN** it defines a lane as a top-level task group with disjoint owned paths and no dependency
  on another group except the serial integration tail, requires either a lane cut with the owned
  paths named in each heading or one explicit single-lane reason about the work (shared hot file,
  generated output, or serial gate), rejects a review or archive process as a single-lane reason,
  and directs independent lanes to parallel writers in separate worktrees with a serial final lane

#### Scenario: Apply starts with a lane check

- **WHEN** the model starts applying a change whose plan has at least two independent lanes
- **THEN** the guidance directs one lane check before the first implementation task: assign each
  independent lane to a worker or record a per-lane serial decision, without a new tool or state

#### Scenario: Pinned refresh preserves the addendum

- **WHEN** the pinned update step regenerates the vendored assets and the lock
- **THEN** the task-lane guidance asset remains in the package outside the regenerated directory and
  the vendored bytes still match the lock
