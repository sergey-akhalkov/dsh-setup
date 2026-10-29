# Design

## Context

See `proposal.md` — Why. The engine has two input definitions today, and they disagree:

- The recorded digest uses git (`worktreeDigest`, `specDigest`), so the worktree part covers tracked
  files plus untracked-not-ignored files and skips exactly `.dsh/` and `.tmp/` (`ignoredForDigest`).
  `specDigest` reads every artifact of the reviewed change regardless of git ignore rules.
- The mutation guard (`reviewedInputs` → `inputSignature`) walks the whole repository root and skips
  seven hardcoded directory names (`.git`, `.dsh`, `.tmp`, `node_modules`, `market`, `coverage`,
  `.serena`). There is no `.gitignore` awareness, so `target/**` counts — and tracked trees such as
  this repository's `packages/setup/node_modules` are skipped even though the digest covers them.

`prepareReview` records the stat signature and the digest, starts the target, and
`completeReviewRun` re-reads the signature before publishing. A difference discards the verdict and
writes an `ERROR` record. Constraints: the guard must keep detecting edit-read-restore (spec
`Stable review inputs`), the digest formats (`worktree-v1`, `task-review-v1`) and record reuse must
not change, no new configuration surface, and the existing tests drive the engine through a
`FakeGit` seam.

## Goals / Non-Goals

Goals: one input set for the digest and the mutation guard in each review scope; ignored build output
never invalidates a code review; the failure report says what changed and what to do.

Non-goals: immutable worktree snapshots, per-repository exclude configuration, isolated
`CARGO_TARGET_DIR`, reviewer sandbox changes, and any change to what a whole-spec review watches.

## Decisions

**D1 — Reviewed worktree inputs come from git, not from the filesystem.** The guard enumerates
`git ls-files -z --cached --others --exclude-standard` from the repository root and stats exactly
those paths. `--cached` covers tracked files, `--others --exclude-standard` covers new files and
honours `.gitignore`, `.git/info/exclude`, and core excludes.

The only remaining exclusions are the root `.dsh/` and `.tmp/` prefixes — the same pair
`ignoredForDigest` removes from `worktreeDigest`. Every other name in `WORKTREE_INPUT_EXCLUDES` is
dropped: `node_modules`, `market`, `coverage`, and `.serena` are git-visible in some checkouts
(this repository tracks `packages/setup/node_modules`) and a digest-covered file must never change
unobserved.

Alternatives rejected: an immutable worktree copy (copies multi-hundred-MB worktrees, symlink and
Windows path costs, and buys nothing the stat signature does not already give); keeping the old
name list for speed (silently unguarded digest inputs, the defect this change fixes); hardcoded
`target`/`build`/`dist` excludes (repo-specific, endless, and diverges from the digest again the
first time a new tool is used); a second git call for ignored directories plus prefix pruning in the
walk (more code, still walks ignored trees); configurable excludes (new surface that can drift from
the digest, and no user asked for it).

**D2 — Keep per-file stat precision.** A signature entry stays `size:mtimeNs:ctimeNs`, so an
edit-read-restore still changes the signature even though the digest would match. A path from the
git list that cannot be stat'ed is stored as `[missing]` instead of failing the run: a deleted
tracked file and a later reappearance are then both reported as changes.

**D3 — A task-scoped review guards the union of worktree and change artifacts.** The task digest is
`hash(task, specDigest(change), worktreeDigest)`, and `specDigest` reads the change directory
regardless of git ignore rules. The guard therefore merges the git-visible worktree signature with
an artifact walk of the reviewed change directory (excluding `.openspec.yaml`, as `specDigest` does),
keyed by root plus relative path so an artifact that is both tracked and walked is one entry. Without
the merge, a gitignored change artifact could change during a task review and the verdict would still
publish.

**D4 — Whole-spec and implementation-complete scopes keep their single input set.** A whole-spec
review watches exactly the change artifacts (its digest is `specDigest`); an implementation-complete
review watches exactly the git-visible worktree (its digest is `worktreeDigest`). Both already match
their digest, so each keeps one walk. An edit inside the watched set during a review is a real
change and keeps discarding the verdict; the remedy is sequencing (finish the edits, then delegate),
which the docs get a line about.

**D5 — No digest or record format change.** The digest stays git-based and the recorded `digest` /
`worktreeDigest` keep their current shape, so existing records remain comparable and a passing
record is still reused. The signature is an in-memory per-run value and is never persisted.

**D6 — Report, not gate, change.** The discarded-verdict message gains the number of changed inputs,
their paths (truncated sample), the cause ("a write inside the reviewed scope happened during the
run"), and the next action ("finish the writes, then re-run"). Gate matching stays PASS/ERROR based.

**D7 — Test seam and what the tests must prove.** `FakeGit` answers `ls-files` from a new `files`
field; the existing edit-read-restore test declares the file it mutates. New cases: an ignored
build-output write publishes `PASS`; the worktree digest is identical before and after that write
(asserted through an implementation-complete review, whose reuse requires a matching digest, with a
visible source change as the control); a git-visible file under a formerly excluded directory
(`market/`, `node_modules/`) still discards the verdict; an ignored change artifact edited during a
task review discards it. Task PASS reuse alone is not evidence — it deliberately ignores the digest —
so digest equality is asserted on the implementation-complete path. A real temporary git
repository case (with `.gitignore` covering `target/`) proves the ignored-path filtering with actual
git rather than the fake.

## Risks / Trade-offs

- A repository that does not gitignore its build output → the worktree digest itself churns on every
  build, so whole-worktree reviews stay unstable. Mitigation: documented precondition ("build output
  must be gitignored") plus the troubleshooting row; such a repository is already breaking the digest.
- A tracked dependency or vendor tree (`node_modules`, `vendor`) is now stat'ed on every review →
  more stats per run than the old name list. Mitigation: it is exactly what the digest hashes, and a
  git-enumerated list replaces a full directory walk, so ignored trees cost nothing at all.
- An ignored file that a team wants reviewed → it leaves the worktree set. Mitigation: documented
  rule for worktree inputs, plus the change-artifact union that keeps ignored review artifacts
  guarded when their digest participates.
- A non-git workspace → code-scoped reviews already fail on the digest, so the new listing fails in
  the same place; whole-spec reviews are unaffected.
- Signature and digest could drift again later → both now derive from git, the task scope merges the
  artifact walk, and the "Digest and mutation check agree" scenario pins the digest equality.

## Migration Plan

No state migration. Rebuild the Host output, regenerate the vendored setup copy, release the setup,
and install it on the affected machine (or link the checkout and restart the Harness fully). The
existing failed task's re-run publishes `PASS`; the following call reuses it without a new run.
Rollback is a revert of the commit plus a rebuild and re-release; records written before and after
are read by the same code.

## Open Questions

- Whether a future change should let a repository declare extra reviewed-input excludes (for
  generated sources it deliberately ignores). Deferrable: no spec or task depends on it.
