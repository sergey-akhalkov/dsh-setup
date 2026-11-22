# Design

## Context

See [proposal.md](proposal.md) for the motivation. The release path today is
`.github/workflows/release.yml`: `versions` resolves the DSH matrix, `validate` runs the full gate on
`windows-latest`, and `publish` (`needs: validate`) checks the tag against
`packages/setup/package.json`, builds, merges the previously published index, generates the market
directory, and deploys Pages as its last step. The workflow declares `contents: read` at the top
level; no job creates a GitHub Release, and `gh release list --repo sergey-akhalkov/dsh-setup` is
empty while tags exist through `v0.48.1` (the repository version is `0.48.1`). The install path
(enable **Custom plugin markets**, open **Discover**, add the index URL) is described in
`docs/install.md` and the README with no image; the repository tracks no image files under `docs/`.

## Goals / Non-Goals

**Goals:**

- Every tag `v<version>` that passes the release gate publishes one GitHub Release with
  GitHub-generated notes; a failed validation or deployment publishes none.
- The release workflow's default token stays read-only; the write permission is scoped to the one
  job that needs it.
- A rerun of the release workflow is safe and does not fail or rewrite an existing Release.
- The latest existing tag gets its Release through a documented one-time maintainer command.
- The install guide shows the Discover route with the setup index added, accessibly.

**Non-Goals:**

- Backfilling every historical tag, editing old Release notes, or creating tags from CI.
- Changing the index format, version pinning, version accumulation, or Pages deployment order.
- Changing the installer, any plugin, or any runtime behavior.
- Adding a release action, a dependency, or an automated screenshot check.
- Replacing the text steps with the screenshot.

## Decisions

**D1 — Use the runner's `gh` CLI, and scope `contents: write` to a dedicated job.** The `release`
job depends on `publish`, runs on `ubuntu-latest`, declares only `permissions: contents: write`, and
runs one step with `GH_TOKEN: ${{ github.token }}`, `GH_REPO: ${{ github.repository }}`, and
`TAG: ${{ github.ref_name }}`; it needs no checkout, and `GH_REPO` supplies the repository context
`gh` would otherwise take from a checkout. The workflow-level permissions are unchanged, so every
other job keeps `contents: read`.
Alternatives rejected: a third-party release action (a new dependency for one API call the hosted
runner already provides); adding `contents: write` to `publish` (it would widen the token of the job
that holds `pages: write` and `id-token: write`); a repository-wide write permission (violates least
privilege).

**D2 — Create the Release last, after the Pages deployment.** The human-facing claim "this version
is released" must not exist while the installable index is not live. Ordering the Release after
`publish` means a failed validation or deploy leaves both the previous index and the Releases sidebar
unchanged, preserving the existing fail-safe. If the Release step itself fails after a good deploy,
the index is live and the run is red; a rerun creates the Release without changing the index.
Alternatives rejected: Release before the deploy (a deploy failure would advertise a release whose
index never went live, or force a Release deletion); Release inside `publish` before the deploy step
(the same problem, plus privilege mixing).

**D3 — `--verify-tag` plus an explicit existence check make the job safe and rerunnable.** Without
`--verify-tag`, `gh release create <tag>` would create the tag at the default branch head when the
tag is missing, which CI must never do. Before creating, `gh release view "$TAG"` decides: an existing
Release is reported as left unchanged and the job succeeds; only a missing Release is created. The
index regeneration is deterministic for the same tag, because `mergeMarketVersions` excludes a
previous entry whose version string matches the released one before adding the tagged commit's
version, so a rerun redeploys the same document. The `publish` job already refuses a tag that does
not equal the setup version, so the release job does not repeat that check.

**D4 — Backfill only the latest existing tag, manually.** The workflow affects future tags; the
current `v0.48.1` needs a one-time command run by a maintainer with an authenticated `gh`:
`gh release create v0.48.1 --generate-notes --verify-tag`. No CI step does this, and older tags stay
unreleased: the issue asks for the latest one, and producing releases for old commits adds history
nobody needs to review. The command is documented in `docs/releasing.md` and in the change tasks.

**D5 — The screenshot is `docs/images/discover-market.png`, embedded in both Discover descriptions.**
It is captured from a throwaway Harness profile (never the live desktop profile) with **Custom plugin
markets** enabled and `https://sergey-akhalkov.github.io/dsh-setup/index.json` added as a source, and
shows the `dsh-setup` market with the setup and plugin entries. It is embedded with the same
descriptive alt text in `docs/install.md` (Manual install) and the README's "Install individual
plugins from Discover" section, using each file's relative path. The numbered steps stay as the
complete accessible description and the image is illustrative. `.gitattributes` already marks
`*.png binary`; `scripts/lib/scan.ts` scans only text extensions, so the tracked image cannot leak a
scanner-detected machine path, and the capture review must remove any visible user name, avatar,
local path, session title, or token. Alternatives rejected: a new asset pipeline or vendored bundle
asset (the docs are handwritten and the image is not shipped code); only one page (the issue asks for
the repo page with badges, and the installer guide is the required place); a text-only alt substitute
(the issue asks for the image).

**D6 — `plugin-market` owns the delta.** Publication (index and Release) and the documented consumer
route of the published index are the same capability; `portable-setup` owns installer behavior, which
does not change. The delta adds two requirements: a tag-scoped GitHub Release, and Discover-route
documentation with a screenshot.

**D7 — This is a workflow and documentation change, not a product behavior change.** The installer
keeps resolving the newest index version, the index format and pinning are untouched, and no plugin
code changes. The new spec requirement is a documentation contract for the install guide, not a new
runtime surface; the Release requirement is release-process behavior.

## Risks / Trade-offs

- [Default-token release events] A Release created with `GITHUB_TOKEN` does not trigger `on: release`
  workflows → acceptable today because no workflow listens to release events; use a PAT or
  `workflow_dispatch` only if a future workflow needs the event.
- [Release step fails after a live deploy] The index is published without a Release and the run is
  red → rerun the workflow; the release step is idempotent and the index regeneration is
  deterministic.
- [Backfill timing] Running the backfill before the workflow change is merged still works, but the
  docs and the workflow should land together → run the backfill after merge so the procedure matches
  the repository.
- [Screenshot staleness and privacy] The UI can change and the capture is manual → re-capture with
  the release that changes Discover; crop or redact machine data and verify before committing.
- [Release notes scope] GitHub-generated notes from the previous tag are not curated → the issue asks
  for generated notes; a curated changelog is a future change.

## Migration Plan

- Workflow and docs only; no data migration, no version bump required for the change itself.
- The one-time backfill is additive and can be repeated only by deleting a Release, which is not part
  of this change.
- Rollback is a revert of the workflow commit; Releases already created stay, and deleting them is a
  manual maintainer action.

## Test Plan

- `openspec validate add-releases-and-discover-screenshot --strict` passes.
- Parse `.github/workflows/release.yml` with the repository's installed `yaml` package and assert the
  job graph (`release.needs: ["publish"]`, `release.permissions.contents: "write"`, workflow-level
  `contents: read`) and that the step runs `gh release create` with `--generate-notes --verify-tag`.
- `pnpm validate:repo` and `pnpm lint` pass; the Markdown image links resolve to the tracked PNG.
- `gh release list --repo sergey-akhalkov/dsh-setup` shows `v0.48.1` after the backfill and
  `gh release view v0.48.1` shows generated notes.
- The first release after the merge is the end-to-end proof; a deliberately failed gate is not run on
  the real repository, and the fail-safe is asserted structurally from the `needs` chain.
