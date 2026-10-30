# Spec Delta

## ADDED Requirements

### Requirement: Task review snapshot

A task-scoped review SHALL review a detached worktree snapshot built from the repository root whose
temporary Git index holds exactly the review input set: tracked paths from the real index (including a path
staged with `git add -f`), plus untracked non-ignored files. The snapshot commit MUST be parented to `HEAD`
when one exists, and building it MUST NOT modify the real index or working tree. When it cannot be
produced, the review MUST fall back to the live worktree.

#### Scenario: Tracked path matching an ignore rule

- **WHEN** a tracked file matches an ignore rule at the time of a task review
- **THEN** the snapshot contains that file, because tracked membership comes from the real index

#### Scenario: Newly staged ignored file

- **WHEN** a file matching an ignore rule was staged with `git add -f` and is absent from `HEAD`
- **THEN** the snapshot contains its working-tree content, because tracked membership comes from the real index

#### Scenario: Index flags do not stale the snapshot

- **WHEN** the real index marks a path `assume-unchanged` or `skip-worktree` and the working-tree file differs
- **THEN** the snapshot contains the working-tree content, because the temporary index is built from the input set rather than copied

#### Scenario: Unborn without an index

- **WHEN** the repository has no commit and no index yet
- **THEN** the snapshot still builds from the untracked non-ignored files and the review runs on it

#### Scenario: Empty input set

- **WHEN** the review input set is empty
- **THEN** the snapshot is a commit with an empty tree and the review still runs on it

#### Scenario: Untracked file included

- **WHEN** the worktree contains an untracked file that is not ignored
- **THEN** the snapshot contains it

#### Scenario: Real index untouched

- **WHEN** the worktree has staged and unstaged changes and a snapshot is built
- **THEN** the real index and working tree are unchanged and the snapshot contains the working-tree content

#### Scenario: No commit yet

- **WHEN** the repository has no commit yet
- **THEN** the snapshot is a root commit and the review still runs on it

#### Scenario: Snapshot unavailable

- **WHEN** the repository root, the ignored `.dsh/` scratch directory, or the snapshot commit cannot be used, or the repository has unmerged index entries
- **THEN** the task review reviews the live worktree under the mutation guard instead

### Requirement: Snapshot exclusions

Before the source tree is written, `.dsh/`, `.tmp/`, and the change directory MUST be excluded from the
review input set, so a committed version of any of them cannot enter the snapshot. The change directory is
supplied by the frozen copy.

#### Scenario: Ignored scratch excluded

- **WHEN** the worktree contains ignored files such as `.dsh/`, `node_modules/`, or build output, or an unignored `.tmp/`
- **THEN** the snapshot does not contain those paths

#### Scenario: Committed scratch files excluded

- **WHEN** `.dsh/` or `.tmp/` paths are tracked in the repository
- **THEN** those paths are absent from the input set and from the snapshot

#### Scenario: Committed change directory not restored

- **WHEN** the change directory is committed and a file was deleted from its live version
- **THEN** the snapshot's change directory contains only the live files, because the input set excludes it and the live directory is copied onto an absent destination

### Requirement: Frozen change artifacts

The change directory MUST be removed from the source tree and copied from the live workspace into the
snapshot after checkout, onto a destination that does not exist in the checkout. That copy MUST be the
source of the task lookup and of the change-artifact digest, so the record describes exactly the artifacts
the reviewer reads. An artifact that matches an ignore rule MUST still be present. When the change
directory lies outside the repository root, the snapshot MUST NOT be used.

#### Scenario: Individually ignored artifact

- **WHEN** one artifact inside the change directory matches an ignore rule
- **THEN** the snapshot's copy still contains it

#### Scenario: Artifact digest from the frozen copy

- **WHEN** a live artifact is edited after the copy is made and before the digest is computed
- **THEN** the digest describes the captured version, which is what the reviewer reads

#### Scenario: Task lookup in the frozen copy

- **WHEN** the reviewed task is not checked in the frozen `tasks.md`
- **THEN** the run fails with a message naming the change and the task instead of reviewing an inconsistent state

#### Scenario: Change directory outside the repository

- **WHEN** the change directory does not lie inside the repository root
- **THEN** no snapshot is used and the live review runs

### Requirement: Snapshot cleanup on settle

A task review's snapshot worktree, lease, and temporary index MUST be removed when the run settles on every
path, including PASS, FINDINGS, ERROR, timeout, a discarded verdict, and reusing an existing record. A failed
removal MUST NOT change the verdict or record, and the expired lease lets a later sweep retry it.

#### Scenario: Settle removes the checkout

- **WHEN** a task review publishes a verdict
- **THEN** its snapshot directory, lease, and temporary index are gone

#### Scenario: Failure path removes the checkout

- **WHEN** the target fails, times out, or the verdict is discarded
- **THEN** the same cleanup runs and no snapshot directory is left behind

#### Scenario: Reused record removes the checkout

- **WHEN** an existing matching record makes the review return without starting a target
- **THEN** the snapshot and lease created for that attempt are removed

#### Scenario: Removal failure does not change the record

- **WHEN** removing a snapshot fails, for example because a file is locked on Windows
- **THEN** the verdict and record are unchanged, the lease expires, and a later sweep retries the removal

### Requirement: Stale snapshot sweep

A per-workspace sweep MUST run before a snapshot, throttled in time. It MUST remove a snapshot whose lease
has expired, and a snapshot with no lease older than a grace period, and MUST prune stale worktree metadata.
It MUST NOT remove a snapshot with a valid lease, MUST be best-effort, and MUST NOT run a repository-wide
`gc` or `prune`.

#### Scenario: Crash leftover swept

- **WHEN** a snapshot's lease has expired, for example after a crashed or failed Host
- **THEN** a later throttled sweep in that workspace removes it and prunes its stale worktree metadata

#### Scenario: Long review preserved

- **WHEN** a review runs longer than the default timeout and its lease is valid
- **THEN** the sweep leaves its snapshot in place, because ownership is the lease and not a timeout

#### Scenario: Recent lease-less snapshot preserved

- **WHEN** a snapshot has no lease and is younger than the grace period
- **THEN** the sweep leaves it, and a later throttled sweep removes it once it ages past the grace period

#### Scenario: Retry after failed removal

- **WHEN** a settle removal failed and its lease has since expired
- **THEN** a later throttled sweep removes the leftover

#### Scenario: Sweep failure

- **WHEN** the sweep itself fails, for example because Git is unavailable
- **THEN** the review still runs and the leftover is retried on a later sweep

#### Scenario: No repository-wide prune

- **WHEN** snapshots are cleaned up
- **THEN** the engine runs no `git gc` or `git prune`, because unreachable snapshot objects are content-addressed and collected by the repository's own garbage collection

## MODIFIED Requirements

### Requirement: Task-scoped review

A task-scoped review SHALL be driven by a checked task, key the record by a stable hash of the normalized
task text, and review an immutable snapshot of the session worktree taken when the run starts, including
the frozen change artifacts. The record MUST remain a historical task snapshot: a write after the run
starts and later tasks MUST NOT invalidate it, and the optional integration review MUST use the current
whole-worktree digest. Unchanged content MUST produce the same digest.

#### Scenario: Checked task reviewed

- **WHEN** a checked task has no matching task-review record
- **THEN** the engine requires a task-scoped review of a snapshot of the task's completion and writes its PASS/ERROR/FINDINGS record

#### Scenario: Task text changed

- **WHEN** a task's normalized text changes after its review
- **THEN** the task id changes and a new task review is required

#### Scenario: Later task does not invalidate

- **WHEN** a later task changes the worktree after an earlier task pass
- **THEN** the earlier task record remains historical and the optional integration review covers the current whole worktree

#### Scenario: Task review staleness

- **WHEN** the same task's worktree changes before its next review
- **THEN** the review snapshots the current worktree and records that snapshot

#### Scenario: Write during a task review

- **WHEN** a reviewed file is edited while a task review runs
- **THEN** the run is not discarded, because it reviews a frozen snapshot taken at its start

#### Scenario: Fallback task review

- **WHEN** the snapshot cannot be produced
- **THEN** the task review reviews the live worktree and the mutation guard applies

#### Scenario: Unchanged contents reuse a FINDINGS record

- **WHEN** a task with a FINDINGS record is delegated again and nothing changed
- **THEN** the existing record is reused without another paid run, because the content identity is unchanged

### Requirement: Stable review inputs

A background review MUST review immutable inputs bound to its digest. A task-scoped review MUST satisfy this
with a detached worktree snapshot taken when the run starts, and its change-artifact digest MUST be computed
from the snapshot's frozen copy. A whole-scope review MUST use mutation tracking over its live inputs and
MUST NOT publish a `PASS` when any reviewed input changed at any time during the run, including when the
content is later restored; a digest re-check alone is not sufficient.

#### Scenario: Task snapshot is immutable

- **WHEN** a reviewed file is edited after a task review starts
- **THEN** the run is not discarded and its verdict is published against the snapshot's digest

#### Scenario: Inputs change during a review

- **WHEN** a live reviewed input is edited while a whole-scope review runs
- **THEN** no `PASS` is published for that digest and the run reports that the inputs changed

#### Scenario: Edit-read-restore

- **WHEN** a live reviewed file is edited, read by the target, and restored to its original content before the run completes
- **THEN** no `PASS` is published, because the target did not review the digest's contents

#### Scenario: Stable inputs

- **WHEN** the reviewed inputs stay unchanged for the run
- **THEN** the verdict is accepted for the digest computed at start

#### Scenario: Fallback inputs change

- **WHEN** the snapshot was unavailable and a live reviewed input changes during the fallback review
- **THEN** no `PASS` is published and the run reports that the inputs changed

#### Scenario: Frozen copy is the digest source

- **WHEN** a change artifact is edited while a task review runs
- **THEN** the run is not discarded and its digest still describes the frozen copy the reviewer read

### Requirement: Reviewed worktree input set

A whole-scope code review MUST take its reviewed worktree inputs from git: tracked files plus untracked
files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two the worktree digest skips;
VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path the digest covers MUST also be
guarded. A task-scoped review MUST review exactly that set in its snapshot, so later writes MUST NOT
invalidate it.

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

### Requirement: Reviewed change-artifact inputs

A whole-scope review whose digest includes the change-artifact digest MUST also track the reviewed change's
artifacts as inputs, regardless of Git ignore rules, excluding `.openspec.yaml` and the `reviews/` approval
directory; a whole-spec review tracks exactly those artifacts. A task-scoped review MUST freeze the change
directory in its snapshot and compute the digest from that copy; the live fallback tracks the union.

#### Scenario: Ignored change artifact changes during a task review

- **WHEN** a change artifact excluded by `.gitignore` is edited while a task review runs
- **THEN** the review is not invalidated, because its snapshot copy contains the artifact as it was when the run started

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** no `PASS` is published and the run reports the changed artifacts

#### Scenario: Task approval does not invalidate the spec review

- **WHEN** a portable `reviews/<taskId>.json` record is written while a whole-spec review runs
- **THEN** the review publishes, because the approval directory is excluded from the reviewed inputs

#### Scenario: Fallback tracks the union

- **WHEN** the snapshot was unavailable and a change artifact is edited while the fallback task review runs
- **THEN** no `PASS` is published, because the fallback tracks the union of the Git-visible worktree and the change artifacts
