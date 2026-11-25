# Proposal

## Why

Nothing owns the step between "change archived" and "issue closed". The archive is frozen before a
release exists, so a change cannot carry a post-release action; `.github/workflows/release.yml`
publishes the market and never touches issues; and no change records an issue in a machine-readable
form. The backlog shows the gap: the fix archived for issue #9 is documented in `docs/workflows.md`
while #9 stays open, #16 and #17 are the same defect, #1 is tracked only in prose, and
`docs/openspec-status.md` has drifted into a second, manually maintained tracker.

## What Changes

- A change that fixes issues lists each one in `proposal.md` as `Fixes #<n>`; `Refs #<n>` marks an
  issue the change only informs.
- `openspec/config.yaml` gains per-artifact rules: `proposal` carries the `Fixes`/`Refs` rule, and
  `tasks` carries the closeout dry-run rule.
- New `scripts/close-issues.ts`: an offline planner plus `--apply`; `--change <name>` previews one
  active change, and the window defaults to the previous tag.
- A `close-issues` job in `release.yml` runs after the Pages publish and after the `release` job that
  creates the GitHub Release, with job-level `issues: write`; it comments the tag, the Release URL,
  and the archived change path, then closes the issue.
- `docs/releasing.md` and the release preparation output name the closeout.
- New capability `issue-tracking`.

## Capabilities

### New Capabilities

- `issue-tracking`: the issue-to-change link and the release closeout that closes a fixed issue with
  its tag, release URL, and archived change.

### Modified Capabilities

None.

## Impact

- `openspec/config.yaml`; new `openspec/specs/issue-tracking/spec.md`.
- New `scripts/close-issues.ts` with a test, and an `issues:close` script in `package.json`.
- `.github/workflows/release.yml`: one job and its job-level permission.
- `docs/releasing.md`.
- **Prerequisite:** `add-releases-and-discover-screenshot` adds the `release` job that creates the
  GitHub Release. This change consumes that job (`needs: [publish, release]`) and must not ship a
  closeout that assumes it; until that job exists, the closeout job is not wired.
- No runtime, installer, market-format, or plugin change.
