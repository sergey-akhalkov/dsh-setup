# Spec Delta

## ADDED Requirements

### Requirement: Plan lane shape in whole-spec review

The bundled whole-spec review instruction SHALL check the plan's work lanes before implementation.
It MUST report a P1 finding when `tasks.md` has more than one level-2 task group and no heading
names owned paths, or when the stated single-lane reason is the review or archive process instead
of a work constraint. The finding MUST name the groups or the reason to change.

#### Scenario: Several groups without owned paths

- **WHEN** a change's `tasks.md` has two or more level-2 task groups and no heading contains a
  backticked owned path
- **THEN** the whole-spec review reports a P1 finding that names the groups and asks for owned
  paths or one work-constraint single-lane reason

#### Scenario: Single-lane reason about the work

- **WHEN** a change's `tasks.md` states that the work is one lane because a shared hot file,
  generated output, or a serial gate prevents independent writers
- **THEN** the whole-spec review does not report the lane shape as a finding

#### Scenario: Process used as the single-lane reason

- **WHEN** the only stated single-lane reason is the task-review or archive process
- **THEN** the whole-spec review reports a P1 finding and names the work-level reason it needs

### Requirement: Review overlap in the apply loop

The documented apply loop SHALL start a task review as soon as the task is checked. It SHALL allow
the next independent task only when the review runs on a frozen snapshot; when the run falls back
to live worktree inputs, a write invalidates the verdict, so the guidance MUST require restoring
snapshot support and re-running or deferring writes until settlement without a blocking sleep. The
record MUST still be collected before the turn closes and before archive.

#### Scenario: Next task proceeds during a snapshot review

- **WHEN** the run reports a frozen snapshot and another task in the change does not depend on its
  verdict
- **THEN** the apply guidance permits implementing that task while the review runs

#### Scenario: Live-worktree fallback

- **WHEN** the run falls back to the live worktree because a review snapshot cannot be built
- **THEN** the apply guidance requires restoring snapshot support and re-running or deferring writes
  until the run settles, and does not prescribe a blocking sleep

#### Scenario: Record still required before close

- **WHEN** the turn closes while a checked task has no task-review record
- **THEN** the existing turn-close gate still refuses the close until the record exists

#### Scenario: No blocking wait prescribed

- **WHEN** the agent waits for a task-review verdict
- **THEN** the apply guidance does not prescribe a blocking sleep or an immediate synchronous wait
