# Tasks

## 1. Planner and script (lane 1, owns `scripts/close-issues.ts`, `scripts/test/close-issues.test.ts`, `package.json`)

- [x] 1.1 Add `scripts/close-issues.ts` with the pure planner: read the archived `proposal.md` files
      in the window, match `^Fixes #(\d+)$` lines, dedupe per issue with the earliest change winning
      and the others in `alsoNamedBy`, and never include a `Refs` issue; verify a vitest fixture
      window returns the expected plan and ignores a `Refs`-only change.
- [x] 1.2 Add the CLI: `--change <name>`, `--from <tag>`, `--version <tag>`, `--apply`, `--json`;
      exit `0` for a printed plan, `1` for usage or a `gh` failure, `2` when `--apply` has no usable
      `gh`; verify `--change` prints an active change's plan and makes no network call.
- [x] 1.3 Add `--apply`: read each issue's state and labels, skip closed, `wontfix`, and `invalid`,
      post the comment once, then close with reason `completed`; verify with an injected runner that
      a rerun posts nothing and a labelled issue stays open.
- [x] 1.4 Register `issues:close` in `package.json`; verify `pnpm issues:close --change <name>`
      prints a plan.
- [x] 1.5 Bind the plan to `--version`: that tag sets the upper bound and the default previous tag,
      and the proposals are read at that revision rather than the worktree; verify a git fixture with
      archives before and inside the window, a later archive at HEAD, and an edited proposal returns
      the tagged plan, and that `--from v1.0.0 --version v2.0.0` replays only that range.

## 2. Convention and rules (lane 2, owns `openspec/config.yaml`, `openspec/changes/add-releases-and-discover-screenshot/proposal.md`)

- [x] 2.1 Add `rules.proposal` and `rules.tasks` to `openspec/config.yaml`; verify
      `openspec instructions proposal` and `openspec instructions tasks` carry them.
- [x] 2.2 Add the `Fixes #1` line to
      `openspec/changes/add-releases-and-discover-screenshot/proposal.md`; verify
      `pnpm issues:close --change add-releases-and-discover-screenshot` names issue 1.

## 3. Release wiring (lane 3, owns `.github/workflows/release.yml`, `scripts/test/release-workflow.test.ts`, `docs/releasing.md`, `scripts/release-prepare.ts`)

- [x] 3.1 Add the `close-issues` job with `needs: [publish, release]`, job-level
      `permissions: {contents: read, issues: write}`, `GH_TOKEN`, and
      `--apply --version "$GITHUB_REF_NAME"`; verify a vitest assertion parses the workflow, checks
      both `needs`, the command, and the job-level permissions, and fails when the `release` job
      that `add-releases-and-discover-screenshot` adds is absent.
- [x] 3.2 Name the closeout in `docs/releasing.md` (the pre-tag dry run, the two-job dependency, the
      rerun remedy) and in the `pnpm release:prepare` output; verify `pnpm lint` accepts the edited
      Markdown and the dry-run plan appears in the preparation output.
- [x] 3.3 Cover the preparation preview: a mocked preparation run asserts the offline plan lands in
      its stdout before the next-step line; verify with the test.

## 4. Verification (serial, owns `openspec/changes/close-issues-on-release/**`)

- [x] 4.1 Run the full gate (`pnpm build`, `git diff --exit-code`, `pnpm gen:check`,
      `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`) and record the result.
- [x] 4.2 Run `pnpm issues:close --change close-issues-on-release`; verify it prints an empty plan
      (this change fixes no issue) without calling `gh`, and record the output.

- [x] 4.3 Re-run the full gate after the review findings were fixed (the tag-bound plan, the strict
      `Fixes` parser, the git-backed window test and the workflow guard assertion) and record the
      result here.

**Recorded 2026-11-24 (re-run after the review fixes).** 4.1: `pnpm build` changed no tracked file
(status compared before and after), `pnpm gen:check` reports 696/696, `pnpm typecheck` is clean,
`pnpm lint` reports no error (21 warnings and 22 infos, all pre-existing), `pnpm test` exits 0 on the
full suite, and `pnpm validate:repo` scans 1421 files with no problems. `git diff --exit-code` is not
clean because the worktree already carried uncommitted work from other changes; nothing this change
touched appears in that output except its own new and edited files. 4.2: prints `no issues to close`
and runs no command. 4.3: the post-fix re-run is green — `pnpm test` exits 0 on the full suite,
`pnpm build` changed no tracked file, `pnpm gen:check` reports 704 generated files across 21 plugin
packages, `pnpm typecheck` is clean, and `pnpm validate:repo` scans 1438 files with no problems; the
extra package and files come from the concurrently developed `plugin-question-timeout` change in this
worktree.
