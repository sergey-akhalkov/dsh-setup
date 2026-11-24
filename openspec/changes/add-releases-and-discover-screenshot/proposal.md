# Proposal

## Why

GitHub issue #1: the repository has tags through `v0.57.1` but the Releases sidebar is empty, so it
looks unreleased at a glance and there is no changelog to check before rerunning the installer. The
same report finds the "install individual plugins from Discover" route described only in prose, with
no screenshot showing what Discover should look like. The release workflow already gates publication
on the full DSH matrix and pins every index entry to a reviewed commit; what is missing is the
human-facing Release that names the tag, and the image the install guide needs.

Fixes #1

## What Changes

- Add a `release` job to `.github/workflows/release.yml`, after the `publish` job, that creates a
  GitHub Release for the pushed tag with `gh release create "$TAG" --generate-notes --verify-tag`.
  The workflow's default permissions stay `contents: read`; only this job gets `contents: write`.
- The Release is created last: a failed validation or Pages deployment publishes no Release, and a
  rerun leaves an existing Release and its notes untouched.
- Backfill the latest existing tag once when the job lands (`v0.57.1` at the time of writing):
  `gh release create v0.57.1 --generate-notes --verify-tag`, run by a maintainer. Older tags stay
  unreleased.
- Commit `docs/images/discover-market.png`, a screenshot of Discover with the `dsh-setup` index
  added, and embed it with descriptive alt text in `docs/install.md` (Manual install) and the README
  Discover section; the numbered text steps stay complete.
- Name the Release step and the backfill in `docs/releasing.md`.
- The screenshot is documentation only: no product behavior, installer, index format, or plugin
  changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-market`: publication adds a tag-scoped GitHub Release that is created only after the tagged
  index is live, and the install guide must show the Discover route with the setup market index
  added, including an accessible screenshot.

## Impact

- `.github/workflows/release.yml`: one new job and its job-level permission.
- A GitHub Release for the latest existing tag (`v0.57.1`) and for every future tag that passes the
  release gate.
- `docs/releasing.md`, `docs/install.md`, `README.md`, and a new `docs/images/discover-market.png`.
- `plugin-market` spec delta with two added requirements.
- No source, plugin, installer, market-format, or dependency change; the Pages deployment order is
  unchanged.
