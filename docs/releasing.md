# Releasing

Each release publishes one artifact: the static plugin market directory (`index.json` plus icons)
that the Discover tab reads. GitHub Pages serves it from the tagged commit, and every listed version
is pinned to that commit.

## Prerequisites

- The repository's **Settings → Pages** source is **GitHub Actions**.
- Repository Actions permissions allow the workflow to deploy Pages (`pages: write`, `id-token:
  write` are declared in the workflow).
- The release workflow's `DSH_RUNTIME_VERSION` repository variable may pin the DSH version used for
  the composition check; it defaults to the version recorded in `dsh.json`.

## One set, one version

All plugin packages and the setup bundle share one version, and the tag must be exactly
`v<version>`. The release workflow refuses a tag that does not match `packages/setup/package.json`,
so a stale version cannot be published under a new tag.

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

6. Read the release workflow result. The deployment step is last: any earlier failure (tag/version
   mismatch, committed runtime drift, generated drift, type-check, lint, tests, repository scans,
   composition validation) leaves the previously published index untouched.
7. Verify the published index responds with a direct `200` over HTTPS and lists both the setup
   bundle and the plugin bundles:

   ```sh
   curl -sS -o index.json -w '%{http_code}\n' https://sergey-akhalkov.github.io/dsh-setup/index.json
   ```

   Then add the URL in Discover and confirm the entries and their source commits.

## Rollback

The Pages artifact of an earlier successful run still names its own tag. Re-run that release run
from the Actions history to redeploy its artifact; do not move or reuse a tag for a different commit.

## When DSH changes

1. Update `dsh.json` (`runtime`, `enginesDsh`, `supportedVersions`) and the `engines.dsh` range in
   every plugin manifest; both must stay identical (repository validation enforces it).
2. Extend the validate workflow's matrix with the new supported version.
3. Fix any composition drift the validation reports, then release a new set version.

Never patch an already-published tag to follow a DSH update: publish a new version. If a user pinned
an older set, DSH refuses it on an incompatible runtime by design.
