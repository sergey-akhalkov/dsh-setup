# Design

## Context

`main` is green at `eba0e15`, but the only v0.4.0 tag points at `d8c998f`, which predates the delegation-rules flake fix, the one-line installer changes, the composer-clock removal, and the MIT licensing. The release workflow runs from the tag: `versions` → `validate` (full gate) → `publish` (fetch previous index, generate the market artifact, deploy Pages last). The `github-pages` environment now allows `v*` tags, but no deployment has ever succeeded; the one-line installer therefore resolves the latest tag as a fallback.

Constraints:

- A tag is immutable and the workflow definition comes from the tagged commit.
- Publication must follow a successful validation of that commit (`plugin-market` publication gate).
- All packages share one version, and the tag must be exactly `v<version>`.
- The first published index has no previous document to merge; later releases rely on the previous index for version accumulation.
- The one-line installer uses the index when reachable and falls back to the highest `v*` tag otherwise.

## Goals / Non-Goals

**Goals:**

- Publish a first, valid market index from a release that contains the current `main`.
- Keep the existing release workflow and its publication gate unchanged.
- Prove the index is directly reachable and that the installer resolves through it.
- Leave v0.4.0 unlisted and untouched.
- Document the live Discover path in the README.

**Non-Goals:**

- Re-running or moving v0.4.0.
- Creating GitHub Release objects; the tag and Pages index are the release.
- Adding post-deploy index verification, a second-release 404 guard, or other workflow hardening.
- Changing runtime behavior, dependencies, or the supported DSH versions.

## Decisions

1. **Cut a new tag from current `main` instead of re-running v0.4.0.** v0.4.0's commit contains the flaky test and the stale plugin set, and the tag cannot be moved. A new tag is the only route that both passes the gate and publishes current code. Alternative: re-run v0.4.0; rejected as a lottery that would still publish stale content.
2. **Release v0.5.0.** Since v0.4.0 the set loses the composer-clock plugin and ships the one-line installer metadata, so a minor bump is appropriate; v0.4.1 would be an acceptable recovery number but less accurate. The tag must be exactly `v0.5.0`.
3. **Use the existing `release.yml` unchanged.** The failure was in the tagged test code, not the workflow; the current workflow already implements the required gate and deploys last. A manual Pages deploy or a new dispatch path would bypass the gate and add code for no need.
4. **Verify with the published artifact, not a new tool.** Check the index URL with a direct `curl` (no redirects), parse `format`, the setup version, the tag commit, and the icon references; run `install.ps1 -DryRun -SetupVersion 0.5.0` from the checkout so it reads the index instead of the local setup. The Discover UI check stays an owner smoke test; no new script.
5. **Local gate before the tag, CI gate at the tag.** Run `pnpm release:prepare`, `pnpm build`, `pnpm validate`, `pnpm gen:check`, and the post-commit clean-build check locally; the release workflow repeats the full gate on the tag. If the local environment cannot run the composition/installer checks, the release workflow remains the authority, but the tag is not pushed until the local failures are understood.

6. **Document the now-live path in the README.** Add the published URL and the Discover steps to the README, and leave `docs/install.md` unchanged because it already owns the detailed manual-install procedure. Alternative: only update `docs/install.md`; rejected because the README is the first install entry point and the user-facing switch to the index was the missing context.

## Risks / Trade-offs

- **The first Pages deployment has never succeeded** → watch the `publish` job; an environment/settings failure is fixed and the failed job is re-run on the same tag, while a workflow or code failure requires a new tag (the tag's workflow is frozen).
- **The flake is fixed but the release gate re-runs the whole suite** → the fix replaced the polling timeout; if a failure still occurs, re-run the failed job on the same tag once and treat a repeat as a real blocker, not as a reason to move the tag.
- **The first index lists only 0.5.0** → v0.4.0 never passed the gate and stays unlisted; users who installed it through the fallback can pin it by tag but lose composer-clock when they update. Accepted.
- **v0.4.0 remains a public tag without an index entry** → `-SetupVersion 0.4.0` still falls back to the tag; the market does not advertise it. Accepted.
- **A later 404 on the previous index would be treated as a first release** → out of scope; the next release must confirm the index exists before publishing. Recorded as a follow-up, not a blocker for this release.
- **The release commit includes planning artifacts** → the tag contains the change and the version bump; task ticks and the archive land in later commits, which does not affect the published index.

## Migration Plan

1. Prepare the release tree on `main`: bump every package to 0.5.0, regenerate, build, and run the local gate.
2. Commit the change artifacts, the bump, and the regenerated files; confirm a fresh build leaves no diff.
3. Tag `v0.5.0` and push `main` and the tag; record the release run.
4. Watch `versions` → `validate` → `publish`; the publish job fetches the previous index (404 is expected for the first release), generates the index from the tag commit, and deploys Pages last.
5. Verify the index URL, the setup entry, the tag commit, the icons, and the installer's index resolution; the owner confirms the index source in Discover.
6. Update the README to state that the index is live, include the URL and the Discover steps, and run `pnpm lint`.
7. Archive the change after the release, the owner check, and the README update.

**Rollback:** before deployment, a failed job leaves no index; fix and re-run the publish job, or cut a new tag if the workflow/code must change. After deployment, replace the artifact with a new release; do not move or delete the tag. There is no previous index to restore for this first publication.
