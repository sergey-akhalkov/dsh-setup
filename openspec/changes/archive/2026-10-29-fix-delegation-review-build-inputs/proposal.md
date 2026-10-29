# Proposal

## Why

On a Rust repository every gated review ends `ERROR: reviewed inputs changed during the run` even
though no source file changed, so no `PASS` can ever be published. The gate computes its recorded
digest from git (tracked plus untracked-not-ignored files) but checks mutation during the run with a
filesystem walk that only skips seven hardcoded directory names, so VCS-ignored build output such as
`target/flycheck0/stderr`, `target/.rustc_info.json`, and `target/debug/.fingerprint/**` counts as a
reviewed input. Any `cargo` or rust-analyzer process that builds while a review runs invalidates the
verdict — including the agent's own build queue and the IDE flycheck.

## What Changes

- The worktree mutation guard tracks exactly the paths the digest tracks: the git-visible file set
  (`git ls-files --cached --others --exclude-standard`) instead of a raw filesystem walk. Ignored
  build output and VCS-ignored scratch trees stop counting as reviewed inputs.
- Per-file stat signatures are kept (size plus nanosecond mtime/ctime), so an edit-read-restore
  during a run still discards the verdict; a tracked file that disappears or appears is recorded as
  changed rather than failing the run.
- Only `.dsh/` and `.tmp/` stay excluded, the same pair the worktree digest skips. Directories the
  old walk skipped by name (`node_modules`, `market`, `coverage`, `.serena`) are reviewed again when
  git sees them, and this repository tracks files under `packages/setup/node_modules`.
- A task-scoped review tracks the union of the git-visible worktree files and the reviewed change's
  artifacts, because its digest includes the change-artifact digest even when those artifacts are
  gitignored. A whole-spec review keeps tracking exactly the change artifacts.
- The mutation-failure message states how many inputs changed, lists them, names the plausible cause,
  and says what to do next ("finish the writes, then re-run") instead of only "re-run the review".
- Docs state the rule: reviewed worktree inputs are the git-visible files, so build output must be
  gitignored; and that a change-artifact edit during a pending review invalidates that review by
  design.
- Regression tests cover: a write under an ignored build directory during a run yields `PASS` and the
  worktree digest is unchanged across it; a write to a tracked file, to a git-visible file under a
  formerly excluded directory, or to an ignored change artifact during a run still yields no `PASS`;
  an implementation-complete review reuses its `PASS` only while the digest matches, with a visible
  source change as the control.

Non-goals: an immutable worktree copy, per-repository exclude configuration, forcing a separate
`CARGO_TARGET_DIR`, and changing the reviewer sandbox. The digest already ignores ignored paths, and
a second, configurable input set would drift from it the same way this one did.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: the `Stable review inputs` requirement defines which worktree paths are
  reviewed inputs (the git-visible set minus `.dsh/` and `.tmp/`, not every file on disk), which
  reviews also track the change artifacts their digest includes, and what the failure message must
  report.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts`: `reviewedInputs`, `inputSignature`,
  `WORKTREE_INPUT_EXCLUDES`, and the mutation-failure message in `completeReviewRun`.
- Generated output regenerated, not hand-edited: `packages/plugin-delegation-rules/lib/index.js` and
  the vendored `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/lib/index.js`.
- Tests: `packages/plugin-delegation-rules/test/engine.test.ts` and the `FakeGit` seam in
  `test/helpers.ts` (one new `ls-files` answer).
- Docs: `docs/delegation-rules.md`.
- Delivery: the fix reaches another machine only through a new setup release (or a linked checkout
  plus a full Harness restart); the Harness `app.asar` checkout is not involved.
