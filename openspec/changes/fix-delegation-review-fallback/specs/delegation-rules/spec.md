# Spec Delta

## ADDED Requirements

### Requirement: Review fallback visibility

When a task-scoped review cannot use its frozen snapshot and falls back to the live worktree, the
engine SHALL record a bounded reason on the run while it runs and after it settles, alongside any
verdict or error. When the cause is the missing Git ignore rule for the `.dsh/` scratch directory, the
reason MUST name that cause and the next action.

#### Scenario: Snapshot skipped because `.dsh` is not ignored

- **WHEN** a task review cannot build its snapshot because `.dsh/` is not Git-ignored
- **THEN** the run detail says the review is on the live worktree and names the missing `.dsh/` ignore rule and its fix, both while the run is live and after it settles, instead of only `live worktree`

#### Scenario: Snapshot skipped for another reason

- **WHEN** a task review cannot build its snapshot because the repository or change path cannot be resolved, the change lies outside the repository, or the index has unmerged entries
- **THEN** the run detail names that cause in a bounded form and still reports the live-worktree review, including after settlement

## MODIFIED Requirements

### Requirement: Reviewed worktree input set

A whole-scope code review MUST take its reviewed worktree inputs from git: tracked files plus untracked
files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two the worktree digest skips;
VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path the digest covers MUST also be
guarded, except the change's `reviews/` approval directory. A task-scoped review MUST review exactly that
set in its snapshot, so later writes MUST NOT invalidate it.

#### Scenario: Ignored build output changes during a review

- **WHEN** a build, test, or editor process writes under a VCS-ignored path in the worktree while a whole-scope code review runs
- **THEN** the review publishes its verdict, because no reviewed input changed

#### Scenario: Reviewed file changes during a review

- **WHEN** a tracked or untracked-not-ignored file is edited while a whole-scope review runs, even when its content is restored before the run completes
- **THEN** no `PASS` is published for that digest and the run reports that the reviewed inputs changed

#### Scenario: A previously excluded directory is reviewed

- **WHEN** a Git-visible file under a directory the engine used to skip (`node_modules`, `market`, `coverage`, `.serena`) is edited while a whole-scope review runs
- **THEN** no `PASS` is published, because the digest covers that file

#### Scenario: A tracked file disappears or appears

- **WHEN** a tracked file is deleted, or a new untracked non-ignored file is created, while a whole-scope review runs
- **THEN** the change is reported as a changed reviewed input instead of failing the run to read the workspace

#### Scenario: Digest and mutation check agree

- **WHEN** the worktree contains ignored build output and an implementation-complete review is requested twice without a source change
- **THEN** both runs bind to the same worktree digest and the second request reuses the first `PASS` record, while a visible source change in between requires a new run

#### Scenario: Task snapshot carries the same set

- **WHEN** a task review starts with a tracked change, a tracked file matching an ignore rule, an untracked non-ignored file, and ignored output in the worktree
- **THEN** the snapshot contains the tracked change, the tracked-but-ignored file, and the untracked file, not the ignored output, and later writes to any of them do not invalidate the run

#### Scenario: Portable approval record written during a review

- **WHEN** a portable `reviews/<taskId>.json` approval record is written while a live review, including a fallback task review, runs
- **THEN** the review is not invalidated, because the approval directory is engine output and not a reviewed input
