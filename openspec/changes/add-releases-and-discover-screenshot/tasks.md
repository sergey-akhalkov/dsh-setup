# Tasks

**Single serial lane:** one owner runs the workflow change, the one-time backfill, and the docs
together. The workflow change must be on `main` before the backfill command is documented as the
current procedure.

## 1. Release workflow `.github/workflows/release.yml`

- [x] 1.1 Add the `release` job after `publish` with `needs: publish`, `runs-on: ubuntu-latest`, job-level `permissions: { contents: write }`, no checkout, and one step with `GH_TOKEN: ${{ github.token }}`, `GH_REPO: ${{ github.repository }}` and `TAG: ${{ github.ref_name }}`; verify the step declares `GH_REPO` so both `gh release view` and `gh release create` resolve the repository without a checkout, the workflow-level permissions still declare `contents: read`, and no other job gains write.
- [x] 1.2 Make the step rerunnable: `gh release view "$TAG"` reports an existing Release and leaves it unchanged, otherwise `gh release create "$TAG" --generate-notes --verify-tag` creates it; verify the workflow YAML parses with the installed `yaml` package and the command contains `--verify-tag`.
- [x] 1.3 Update `docs/releasing.md`: the procedure names the Release as the last publication step (after the deployed index), its generated notes, the `contents: write` scope, and the one-time backfill command; verify `pnpm lint`.
- [x] 1.4 Verify the job graph structurally from the file (`release` needs `publish`, `publish` needs `validate`) so a failed gate cannot reach the Release step; record the assertion beside the parse check.

## 2. One-time backfill

- [x] 2.1 Run `gh release create v0.57.1 --generate-notes --verify-tag` (the latest tag when the
      change was written; the release job landed with v0.58.0 and created that Release itself) from
      an authenticated checkout after the workflow change is on `main`; verify
      `gh release view v0.57.1` shows generated notes while the newer `v0.59.0` stays the `Latest`
      release, because a newly published Release would otherwise take the `Latest` badge.
- [x] 2.2 Confirm only the one tag that predates the job is backfilled: no tag older than `v0.57.1`
      gets a Release, and no tag or existing Release is edited or moved; verify with
      `gh release list --repo sergey-akhalkov/dsh-setup`.

## 3. Screenshot and docs

- [x] 3.1 Capture `docs/images/discover-market.png` in a throwaway Harness profile (never the live desktop profile): enable **Custom plugin markets**, open **Discover**, add `https://sergey-akhalkov.github.io/dsh-setup/index.json`, and show the `dsh-setup` market with its entries; verify the PNG contains no user name, avatar, machine path, session title, or token.
- [x] 3.2 Embed the image in `docs/install.md` under Manual install with descriptive alt text and keep the numbered toggle/tab/URL/entry steps intact; verify the relative link `images/discover-market.png` resolves and `pnpm lint` passes.
- [x] 3.3 Embed the same image with the same alt text in `README.md` under "Install individual plugins from Discover", using the README-relative path `docs/images/discover-market.png`; verify the rendered README shows the image and alt text.
- [x] 3.4 Inspect the tracked PNG at full size and scan the docs additions for machine data; verify `pnpm validate:repo` exits 0 with the new file tracked.

## 4. Validation and release-gate consequence

- [x] 4.1 Run `openspec validate add-releases-and-discover-screenshot --strict`; verify exit 0 with both added requirements accepted.
- [x] 4.2 Run `pnpm validate:repo`; verify exit 0 and that the Markdown/YAML scans report no machine path or credential.
- [x] 4.3 Run `pnpm lint` (after `pnpm lint:fix` for the Markdown changes); verify exit 0.
- [x] 4.4 Confirm the release-gate consequence from the job graph: a failed `validate` or `publish` leaves the `release` job unrun, so no Release is created, and the Release step only starts after the Pages deployment; do not force a failure on the real repository.

## Workflow follow-up

- Sync the `plugin-market` delta into the main spec, then archive the change after the task-review
  and spec-review PASS.
- Run `pnpm reviews:check --change add-releases-and-discover-screenshot` before archiving.
- Cut the next release through the normal process; its Release is the end-to-end proof that the new
  job works and that the previous index stayed live until the deploy succeeded.
