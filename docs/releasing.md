# Releasing

Each release publishes one artifact: the static plugin market directory (`index.json` plus icons)
that the Discover tab reads. GitHub Pages serves it from the tagged commit, and every listed version
is pinned to that commit. The release also publishes the one-command installer at
`https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1`.

## Prerequisites

- The repository's **Settings → Pages** source is **GitHub Actions**.
- Repository Actions permissions allow the workflow to deploy Pages (`pages: write`, `id-token:
  write` are declared in the workflow).
- The `github-pages` environment's deployment branch and tag rules allow tags matching `v*`. Without
  that rule the deploy step is rejected before it starts.
- The release workflow validates every version in `dsh.json` → `supportedVersions`; the matrix is
  generated from that file, not duplicated in the workflow.

## One set, one version

All plugin packages and the setup bundle share one version, and the tag must be exactly
`v<version>`. The release workflow refuses a tag that does not match `packages/setup/package.json`,
so a stale version cannot be published under a new tag.

The installer resolves the newest version from the published index at run time, so it needs no
per-release edit. Its standalone copy of the supported versions and bundle list is checked against
`dsh.json` by `pnpm validate:repo`; a release therefore cannot ship a stale installer.

## Procedure

1. Start from a clean, up-to-date `main`.
2. Bump every package at once:

   ```sh
   pnpm release:prepare --version X.Y.Z
   ```

3. Build and validate, then confirm the working tree is clean after the build (CI enforces the same
   two checks):

   ```sh
   pnpm build
   pnpm validate
   git diff --exit-code
   pnpm gen:check
   ```

4. Commit the version bump together with the regenerated `packages/setup` manifest and vendored
   copies.
5. Push the commit, tag it, and push the tag:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

6. Read the release workflow result. Validation runs for every supported DSH version, including the
   installer exercise, before the publish job starts. The publish job fetches the previously
   published index, merges the new version into it, generates the market directory, and deploys that
   directory. The deployment step is last: any earlier failure leaves the previously published index
   untouched.
7. Verify the published index responds with a direct `200` over HTTPS, lists the setup bundle and
   the plugin bundles, and retains the previous versions:

   ```sh
   curl -sS -o index.json -w '%{http_code}\n' https://sergey-akhalkov.github.io/dsh-setup/index.json
   ```

   Then add the URL in Discover and confirm the entries and their source commits.

## Version accumulation

The index is regenerated from the tagged commit, so the previously deployed document is the only
record of older releases. The publish job downloads it with `scripts/fetch-previous-index.ts` and
passes it to `scripts/generate-market.ts --previous`. The generator keeps every earlier version of
each currently published package — preserving its commit, publish time, and engine range — and adds
the version being released. A missing previous document is the expected first release; an unreadable
or invalid one fails the job so the previous deployment stays in place.

## Rollback

The Pages artifact of an earlier successful run still names its own tag. Re-run that release run
from the Actions history to redeploy its artifact; do not move or reuse a tag for a different commit.

## When DSH changes

1. Update `dsh.json`: `runtime`, `enginesDsh`, `supportedVersions`, and the `installBundles` lists
   when the shipped optional bundles change.
2. Update `install.ps1`'s standalone `SupportedDshVersions`, `ShippedBundles`, and `RegistryBundles`
   arrays to match; `pnpm validate:repo` fails while they differ.
3. Update the `engines.dsh` range in every plugin manifest; both must stay identical (repository
   validation enforces it).
4. Fix any composition drift the validation reports, then release a new set version.

The validate and release workflows derive their DSH matrix from `dsh.json`, so no workflow edit is
needed for a supported version bump.

Never patch an already-published tag to follow a DSH update: publish a new version. If a user pinned
an older set, DSH refuses it on an incompatible runtime by design.
