# Tasks

## 1. Worktree and change-artifact input set

- [x] 1.1 Replace the worktree filesystem walk in the delegation engine's input signature with the git-enumerated path list (`git ls-files --cached --others --exclude-standard`), keeping the per-file stat signature and only the `.dsh/` and `.tmp/` exclusions. Verify the updated `engine.test.ts` passes.
- [x] 1.2 Record a git-listed path that cannot be stat'ed as `[missing]` instead of failing the run. Verify a test where a tracked file is deleted during the run reports a changed input rather than an error.
- [x] 1.3 Merge the reviewed change's artifact walk into the task-scope input signature (excluding `.openspec.yaml`, deduplicated by root plus relative path), while whole-spec and implementation-complete reviews keep their single input set. Verify a test where a gitignored change artifact is edited during a task review publishes no `PASS`.
- [x] 1.4 Extend the test `FakeGit` seam with an `ls-files` answer and declare the mutated file in the existing edit-read-restore test. Verify that test still yields `ERROR` and no `PASS`.
- [x] 1.5 Add the ignored-build-output regression: write under `target/flycheck0/` during a run and expect `PASS`; assert the worktree digest is identical across the write through an implementation-complete review whose reuse requires a matching digest, with a visible source change as the control that forces a new run. Verify the test passes.
- [x] 1.6 Add the formerly excluded directory regression: edit a git-visible file under `market/` or `node_modules/` during a run and expect `ERROR`. Verify the test fails if those exclusions are reintroduced.
- [x] 1.7 Add an integration case using a real temporary git repository with a `.gitignore` covering `target/`, mutating ignored build output during the run and expecting `PASS`. Verify the test passes with real git and fails if the ignored-path filtering is removed.

## 2. Failure report

- [x] 2.1 Extend the discarded-verdict message with the changed-input count, the cause (a write inside the reviewed scope during the run), and the next action (finish the writes, then re-run). Verify a test asserts the wording and that an `ERROR` record is still written.

## 3. Documentation

- [x] 3.1 Update `docs/delegation-rules.md`: reviewed worktree inputs are the git-visible files minus `.dsh/` and `.tmp/`, task reviews also track the change artifacts their digest includes, build output must be gitignored, change artifacts must not be edited while a review is pending, and the "reviewed inputs changed" troubleshooting row names the new failure report. Verify `pnpm lint` passes and every documented statement matches the implemented behavior.

## 4. Generated output and checks

- [x] 4.1 Run `pnpm build` and `pnpm gen`, commit the regenerated Host output and vendored setup copy. Verify `git diff --exit-code` is clean afterwards and `pnpm gen:check` passes.
- [x] 4.2 Run `pnpm check` and `pnpm validate:repo`. Verify both pass and the new regression tests are part of the run.

## Workflow follow-up

- Owner live re-acceptance on the affected machine: release the setup, install the new version, then run `delegate(rule="task-review")` twice on the Rust repository with a concurrent `cargo check` and confirm two `PASS` results, the second reported as a reused record.
- Archive the change after the project's review requirements are satisfied.
