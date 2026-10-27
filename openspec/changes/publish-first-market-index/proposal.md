# Proposal

## Why

The documented market index URL (`https://sergey-akhalkov.github.io/dsh-setup/index.json`) returns 404: GitHub Pages has never served a deployment, so the Discover path described in the README and docs is unusable and the one-line installer only works through its tag fallback. The v0.4.0 release failed on a flaky delegation-rules test before publication, and the fixes that address it landed on `main` after the tag, so no released tag contains them.

## What Changes

- Cut one new release, v0.5.0, from the current green `main` commit: bump every package, regenerate the setup bundle, build, and run the local gate.
- Commit and tag `v0.5.0`, push the tag, and let the existing release workflow validate the tagged commit and deploy the first market index to GitHub Pages.
- Verify the published index (direct 200, format 1, setup 0.5.0 pinned to the tag commit, plugin entries and icons) and the installer's index resolution.
- Do not re-run or move v0.4.0; it remains unlisted.
- No application code or requirement behavior changes: this is the release that fulfills the existing `plugin-market` requirements.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The `plugin-market` capability already requires a published, directly reachable format-1 index and immutable version pinning; this change only performs the release that satisfies those requirements, so it creates no spec delta and sets `skip_specs: true`.

## Impact

- Version fields in the root, plugin, and setup manifests; regenerated `packages/setup` manifest, patch, and vendored tree.
- A new `v0.5.0` tag and a Pages deployment; the public index URL starts answering 200.
- The one-line installer resolves through the index instead of the tag fallback; v0.4.0 stays unlisted and the GitHub Releases page stays empty by design.
- No runtime code, API, dependency, or DSH-version change.
- Out of scope: re-running v0.4.0, GitHub Release objects, post-deploy verification hardening, and guarding the first-release 404 tolerance for later releases.
