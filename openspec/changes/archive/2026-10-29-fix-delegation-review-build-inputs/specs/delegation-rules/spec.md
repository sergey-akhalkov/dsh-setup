# Spec Delta

## ADDED Requirements

### Requirement: Reviewed worktree input set

A code-scoped review MUST take its reviewed worktree inputs from git: tracked files plus untracked
files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two the worktree digest
skips; VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path the digest covers
MUST also be guarded.

#### Scenario: Ignored build output changes during a review

- **WHEN** a build, test, or editor process writes under a VCS-ignored path in the worktree while a
  code review runs
- **THEN** the review publishes its verdict, because no reviewed input changed

#### Scenario: Reviewed file changes during a review

- **WHEN** a tracked or untracked-not-ignored file is edited while the review runs, even when its
  content is restored before the run completes
- **THEN** no `PASS` is published for that digest and the run reports that the reviewed inputs changed

#### Scenario: A previously excluded directory is reviewed

- **WHEN** a Git-visible file under a directory the engine used to skip (`node_modules`, `market`,
  `coverage`, `.serena`) is edited while a code review runs
- **THEN** no `PASS` is published, because the digest covers that file

#### Scenario: A tracked file disappears or appears

- **WHEN** a tracked file is deleted, or a new untracked non-ignored file is created, while the review
  runs
- **THEN** the change is reported as a changed reviewed input instead of failing the run to read the
  workspace

#### Scenario: Digest and mutation check agree

- **WHEN** the worktree contains ignored build output and an implementation-complete review is
  requested twice without a source change
- **THEN** both runs bind to the same worktree digest and the second request reuses the first `PASS`
  record, while a visible source change in between requires a new run

### Requirement: Reviewed change-artifact inputs

A review whose digest includes the change-artifact digest MUST also track the reviewed change's
artifacts as inputs, regardless of Git ignore rules, excluding `.openspec.yaml`; a whole-spec review
tracks exactly those artifacts. A task-scoped review therefore tracks the union of the Git-visible
worktree files and the change artifacts.

#### Scenario: Ignored change artifact changes during a task review

- **WHEN** a change artifact excluded by `.gitignore` is edited while a task review runs
- **THEN** no `PASS` is published, because that artifact is part of the task digest

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** no `PASS` is published and the run reports the changed artifacts

### Requirement: Reviewed-input change report

When a review is discarded because a reviewed input changed, the reported error MUST name how many
inputs changed, list their paths, state that a write inside the reviewed scope happened during the
run, and give the next action: finish the writes, then re-run the review.

#### Scenario: Discarded verdict explains the change

- **WHEN** a reviewed input changes during a run and the verdict is discarded
- **THEN** the error names the count and paths of the changed inputs and tells the caller to re-run
  after the writes finish
