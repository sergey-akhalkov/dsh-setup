# Design

## Context

A change is archived before the release that ships it, and the archive is frozen: `tasks.md` cannot
carry a post-release action. `openspec validate --archived` requires every task checked, and the
archive gate requires a task-review `PASS` for every checked task, so a "close the issue after the
release" task would have to be ticked before the release exists. The release workflow is the only
place that knows the tag.

The GitHub Release itself is not created by the current workflow: the separately planned
`add-releases-and-discover-screenshot` change adds the `release` job that creates it. This change
consumes that job rather than assuming it, and its comment names the Release URL that job produces.

## Goals

- One machine-readable link from a change to the issues it fixes.
- One close action per issue, with enough context to be useful without opening the repository.
- A closeout that runs only after the release published and is safe to re-run.
- A preview while the change is still writable.

## Non-Goals

- No label taxonomy, Projects board, or issue-body rewriting.
- No triage of the existing backlog; that is `add-issue-triage-skill`.
- No change to the archive gate.
- No creation of the GitHub Release; the prerequisite change owns it.

## Decisions

- **The link lives in `proposal.md`.** The proposal already states why, is archived immutably, is
  greppable with `git grep`, and `Fixes` is GitHub-native vocabulary. A metadata file would need a
  schema, a validator, and a doc.
- **The release workflow owns the close.** The archive precedes the release; only the release event
  knows the tag and the archived change together.
- **The closeout depends on the Release job, not on `publish` alone.** A release that deployed Pages
  but failed to create its GitHub Release has no Release URL to name, so the job declares
  `needs: [publish, release]` and never closes an issue on a partial release. If the `release` job is
  absent, the assertion test fails rather than the job silently following `publish`.
- **The window is previous tag .. tag.** "All archived changes" would close an issue that a later
  change only partially fixed. `--version <tag>` fixes both the upper bound and the default previous
  tag, and the proposal text is read at that revision rather than the worktree, so replaying an older
  release from a newer checkout plans only what that release shipped.
- **Plan by default, `--apply` to write.** The planner is pure and unit-testable and needs no `gh`;
  only the apply path touches GitHub.
- **The plan is idempotent by state and marker.** A closed issue is skipped; a comment carries
  `<!-- dsh-setup:closed-by=<tag> -->` so a rerun cannot post twice.
- **Owner decisions stand.** An issue labelled `wontfix` or `invalid` is skipped, never closed by the
  pipeline.

## Rejected Alternatives

- `Fixes #` in a commit message: GitHub closes issues on PR merge, not on a direct commit to `main`.
- A `tasks.md` item that closes after the release: uncheckable by construction.
- Closing at archive time: an archive is not a release.
- A third-party action: an unpinned dependency for a twenty-line API call.
- Building the Release in this change: it duplicates an open change's job and two jobs would race to
  create the same Release.

## Risks / Trade-offs

- A wrong `Fixes` line closes a live issue. Mitigated by the pre-archive preview, the dry run before
  the tag, and a comment that asks the reader to reopen.
- The job fails after publication: the workflow is red while the release is out; re-running the job
  is safe and never moves the tag.
- The prerequisite changes the workflow shape; the assertion test names both required jobs, so a
  rebase that drops either one fails the suite instead of shipping a partial closeout.
- A repository rename changes the URL; it is built from `GITHUB_REPOSITORY` at run time.

## Open Questions

None.
