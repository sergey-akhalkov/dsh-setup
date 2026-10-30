# Design

## Context

See `proposal.md` - Why. The current mechanics, and the review findings that shaped this revision:

- `prepareReview` computes the task digest from the change-artifact digest and the **live worktree
  digest**, and `reviewedInputs` tracks the Git-visible worktree set plus the change artifacts. A
  background run re-reads that set on completion and discards its verdict if anything changed. A
  pending task review therefore owns the whole worktree, and a `tasks.md` tick (a change-artifact write)
  is enough to discard it.
- The engine already supports concurrent reviews (the queue key is change + task), runs the patch
  contract in a detached `git worktree`, and reuses an unchanged task `FINDINGS` record when the digest
  matches (`beginReviewRun`; `engine.test.ts` covers it). The new digest must therefore be stable for
  unchanged content.
- `timeouts.review` is configurable to any positive integer (`validateConfig`) and `finishTarget` uses
  the configured value, so a review's age cannot prove that its snapshot is dead.
- Measured on the local `.dsh` history: 174 task reviews with a measured duration (p50 1.1 min, p90 4.1
  min, max 8.2 min), 225 records (213 PASS, 7 FINDINGS, 5 ERROR), and 56 failed runs of which 50 were
  "reviewed inputs changed during the run" - 43 of them task reviews.
- Constraints: portable across any Git repository, model-agnostic, the review target stays read-only, no
  new configuration surface, Windows file locking, `.dsh/` is workspace scratch and is Git-ignored in
  this repository.
- Disk facts: 923 tracked files / 6.0 MB, the untracked change directory is 34 KB, `.dsh/` is 446 KB.

## Goals / Non-Goals

**Goals:**

- A task review's evidence is immutable and self-consistent: the source tree and the change artifacts
  the reviewer reads are exactly what the digest covers, and a write after the run starts cannot
  invalidate the verdict.
- Keep the review record, portable record, turn gate, archive gate, targets, and concurrency model
  unchanged.
- Bounded disk: every snapshot is removed when its run settles, and leftovers from a crashed or failed
  process are swept automatically without ever touching a live run's snapshot.
- Fail safe: when a snapshot cannot be built, review the live worktree exactly as today.

**Non-Goals:**

- Running tests, typecheck, or builds in the snapshot; a write-capable review target; a `prepare`
  command; a verification rule. The reviewer remains inspection-only.
- Letting a pending run satisfy the turn-stopping gate (a separate, riskier decision).
- Snapshotting whole-scope reviews (spec and integration reviews keep reviewing live inputs).
- A new tool, row, target, config field, or model-facing tool description.
- Pruning the small local run/record files: they are the audit trail and are kilobytes.

## Decisions

### D1: Snapshot construction

Build the snapshot from the repository root with a **temporary Git index holding exactly the review input
set**, then check it out into a detached worktree:

```
paths = git ls-files -z --cached --others --exclude-standard   # tracked + untracked non-ignored
        filter out .dsh/, .tmp/, <change-dir>, and paths missing from the worktree
GIT_INDEX_FILE=scratch  git update-index --add -z --stdin      < paths   # working-tree content
GIT_INDEX_FILE=scratch  git write-tree                         -> source tree (stable content identity)
                        git -c user.name=... -c user.email=... commit-tree <tree> [-p HEAD] -m "..."
                        git worktree add --detach <cwd>/.dsh/delegation/snapshots/<runId> <commit>
                        copy the live change directory into <snapshot>/<change-dir>
```

Building the index from the input set is what makes the snapshot match the review contract exactly:
tracked membership comes from the real index (so a path staged with `git add -f` is included even when it
is absent from `HEAD` and matches an ignore rule), untracked files follow `--exclude-standard`, and every
listed path is staged from its working-tree content. A copied index would carry `assume-unchanged` and
`skip-worktree` flags and could publish stale content; a `HEAD`-seeded index would omit newly staged
ignored files; an empty-index `git add -A` would drop every tracked path that matches an ignore rule.
Paths deleted from the worktree are skipped, matching what a live review sees. The real index is only
read, and a repository with no commit and no index still works because the listing and a fresh temporary
index need neither.

Excluding `.dsh/`, `.tmp/`, and the change directory happens in the input list, so a committed version of
any of them cannot enter the source tree; the live change directory is then copied onto a destination that
does not exist in the checkout, so a committed version cannot restore files deleted from the live copy.

`GitRunner` gains optional `env` and `stdin` parameters: `env` carries `GIT_INDEX_FILE`, and `stdin`
carries the NUL-delimited path list that `update-index --add -z --stdin` reads; `defaultGit` writes the
payload, closes the child's stdin, and surfaces a stdin failure instead of letting the child wait. The
commit identity is passed with `-c` so a repository without `user.name` configured still works. The real
index and working tree are never modified. The commit is parented to `HEAD` when one exists; an unborn
repository yields a root commit.

Guards: the snapshot is taken only when `.dsh` is Git-ignored, the change directory lies inside the
repository root (a snapshot cannot carry a path outside its worktree), and there are no unmerged index
entries (a conflicted repository cannot be staged); otherwise the live review runs.

Alternatives rejected: a copied real index (inherits `assume-unchanged`/`skip-worktree` and can publish
stale content); `read-tree HEAD` (omits newly staged ignored files and loses tracked-ignored files); an
empty-index `add -A` (loses every tracked-ignored path, includes an unignored `.tmp/`); `git stash create`
(no untracked files); a commit per task (history noise and writer discipline); copying the worktree (6 MB+
and dependency directories are the wrong subject); reviewing the live tree (the current problem); a diff
in the prompt (weaker evidence, and the reviewer reads a moving tree).

### D2: Digest uses the content tree, not the commit

- `digest = hashParts(['task-review-v2', task.id, task.text, frozenSpecDigest, treeSha])`
- `worktreeDigest = hashParts(['task-review-snapshot-v1', treeSha])`

The tree SHA from `write-tree` is a stable content identity: two snapshots with identical source
content produce the same digest even at different times. The commit SHA is not in the digest because
Git commit identity includes timestamps, so an unchanged task would produce a different digest and the
existing unchanged-`FINDINGS` reuse would break (`engine.test.ts` covers that reuse). The commit is only
the vehicle for the detached worktree; the artifact digest is computed from the frozen change-directory
copy (D1).

Both digest fields stay 64-hex, so the local `parseRecord` and the portable parser accept them. The
portable parser rejects unknown fields, so **no new field is added**. Existing v1 records remain valid:
the task gate ignores the digest, a PASS is reused, and the archive audit checks rule/change/task
id/verdict only.

### D3: Read-only target, no provisioning

The snapshot has no installed dependencies, and the review target stays `codex-subagent` (read-only).
Running tests is explicitly a separate change. The prompt gets one line injected by the prompt builder
(not the bundled asset, which is shared with the fallback): "Reviewed state: frozen worktree snapshot
taken when the review started; later writes are not in it." No tool description or system-prompt section
changes.

### D4: Fallback to the live review

Any snapshot failure (not a Git checkout, `.dsh` not ignored, change directory outside the root,
`git worktree add` failure, disk full) falls back to the existing live-worktree review with the mutation
guard and the v1 digest. The behavior is never worse than today, and no configuration is needed.

### D5: Disk lifecycle and cleanup

- **Lease.** Each snapshot gets a lease file `<snapshots>/<runId>.lease` written before the worktree is
  created: `{ runId, expiresAt }`, with a five-minute validity refreshed every 30 seconds while the run
  is pending. The lease is the ownership signal; it is independent of the configured review timeout.
- **On settle, always.** The snapshot worktree, the lease, and the temporary index are removed on every
  path: PASS, FINDINGS, ERROR, timeout, discarded verdict, target-start failure, and the reuse path that
  returns an existing record. Removal is best-effort; a failure never changes the verdict or record.
- **Sweep.** Before a snapshot, a per-workspace sweep runs at most once every ten minutes. It removes a
  snapshot whose lease has expired, and a snapshot with no lease older than ten minutes; it never
  removes a snapshot with a valid lease; it then runs `git worktree prune`. The throttle makes a failed
  removal retried within the process, and a leftover younger than the grace at startup ages past it
  during the same process. The sweep is best-effort and never fails a review.
- **No repository-wide object pruning.** After removal the snapshot commit is unreachable; unchanged
  content is shared with the repository because Git is content-addressed, and only the changed blobs are
  new (bounded by the task's uncommitted work, which is also in the working tree). The plugin never runs
  `git gc`/`git prune`: that would be invasive, slow, and could disturb concurrent Git operations.
- **Scratch location.** Everything lives under `.dsh/delegation/` (Git-ignored); no record contains a
  snapshot path or machine path.
- **Disk pressure.** A snapshot that cannot be created because the disk is full falls back to the live
  review; no run is lost.

Alternatives rejected: age-only cleanup justified by the timeout (invalid, the timeout is configurable);
a once-per-process sweep (a leftover younger than the grace at startup would never be retried in that
process); keeping snapshots for debugging (the user's disk requirement); `git gc --prune=now`
(invasive); an object-dir per snapshot (the worktree must be readable by the main repository).

### D6: Reuse path

`prepareReview` runs before the existing-record check, so a call that reuses a PASS has already built a
snapshot. The reuse branch removes the snapshot, the lease, and the scratch index before returning;
otherwise every duplicate `delegate` leaks a checkout.

### D7: Accepted cost - cold review threads

The Codex provider stores its review-thread map under `<run cwd>/.dsh/` and resumes only when the stored
`cwd` matches exactly. A per-run snapshot path therefore starts a fresh thread for every task review,
including a re-review after FINDINGS. This is an accepted trade-off; a stable path with a persistent
checkout would preserve threads but adds lifecycle complexity and stale content. The provider's session
map stops growing for reviews because entries are written inside the disposable snapshot.

### D8: Concurrency unchanged

Task reviews for different tasks stay concurrent (queue key = change + task), each with its own
snapshot. Duplicate identity, queuing, and settlement semantics are untouched.

## Risks / Trade-offs

- **Snapshot cost** - `git add -A` with a cold index hashes the whole worktree and the checkout writes
  ~6 MB here. Acceptable; a very large repository pays per review. Documented limit; no caching in this
  change.
- **Capture window** - the source tree is captured slightly before the change-directory copy. The task
  lookup and the artifact digest read the frozen copy, so the record describes what the reviewer reads;
  a source write in that window is the next task's work and is covered by the next snapshot and the
  integration review.
- **`delegate` latency** - the tool call returns after the target starts, and the snapshot is built
  before that. Seconds on this repository; measured during apply.
- **Windows removal** - `git worktree remove --force` can fail on a locked file. Best-effort removal
  plus the lease-expiry sweep; leftovers stay under Git-ignored `.dsh/`.
- **LFS / submodules** - the snapshot checks out pointers or empty submodule directories. The verdict is
  about committed source; documented.
- **Large untracked files** - an unignored build artifact is copied into the snapshot. The repository
  rule requires build output to be ignored; disk-full falls back.
- **End-of-turn wait** - the turn gate still requires every ticked task's record, so the last review is
  waited for at close. Unchanged on purpose; the per-task waits are what disappears.

## Migration Plan

- No data or configuration migration. Existing v1 task records stay valid; new runs write v2. A change
  in mid-apply continues; re-delegating an already passed task reuses its PASS.
- Rollback: revert the plugin change. V2 records are shape-compatible with the old engine (it ignores
  the task digest and reuses a PASS), so no conversion is needed.
- Verify with the plugin's tests, `pnpm gen:check`, `pnpm build && git diff --exit-code`, `pnpm check`,
  and `pnpm validate:repo`.
