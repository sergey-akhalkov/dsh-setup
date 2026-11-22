# Design

## Context

`huashu-design` is a DSH bundle published at `github.com/alchaincyf/huashu-design` (MIT, 3.5.0). Its
`cordis.patch.yml` inserts one row that mounts `@deepseek-ai/dsh-skill-filesystem` with a
`bundledSkillDir` resolved from `baseUrl`, so the package's own root is the skill root and the skill
body may reference `references/`, `assets/`, and `scripts/` relative to it. The package is 47 MB
(mostly media: style specimens, sound effects, music, prototype vendor libraries), and it declares
three runtime dependencies (`playwright`, `pptxgenjs`, `pdf-lib`).

A trial install into a throwaway `DSH_HOME` confirmed `dsh plugin add github:...#<commit>` installs
the package and its dependencies in about ten seconds, appends `huashu-design` to
`dsh.profile.bundles`, and composes the row.

## Decisions

### Install the upstream bundle instead of vendoring it

The repository's usual third-party delivery is a vendored `@dsh-setup/plugin-*` package with a
provenance lock (Ponytail, OpenSpec). That was rejected here:

- **Volume.** The vendored copy would be committed twice — once in the package and once in the
  generated `packages/setup/node_modules` tree — growing a 41 MB repository by roughly 94 MB, and
  every install would download that tree.
- **Ownership.** Vendoring means reimplementing the skill provider (catalog entry, resource base,
  adapter note) and adding a refresh script plus byte-pinning tests, for a package that already ships
  a working DSH patch and keeps its own dependencies current.
- **Churn.** Updating a pin is one line; re-vendoring 470 files with fresh hashes is not.

The trade accepted: the installer now performs one extra fetch from GitHub. It is the same host and
the same mechanism the installer already uses for the setup bundle itself.

### A third declared list, not a special case

`dsh.json` already declares `installBundles.shipped` (enabled by selection) and
`installBundles.registry` (installed as `name@version`). A third list, `installBundles.git`, holds
`{ name, spec }` pairs because a git spec does not carry the profile selection name: the spec names a
repository, the profile selects the package.

The installer copies the pairs into `$GitBundles` as `'<name>=<spec>'`, the same way it copies the
other two lists, and `validate:repo` compares them. Validation additionally rejects a spec whose
reference is not a 40-hex commit, and a declared name that does not match the last path segment of
the spec — that name is what the installer selects, so a mismatch would leave a dead selection.

### Selection before the setup bundle

The git bundles are installed in the existing "bundles the setup expects" step, before the setup
bundle is added and reordered last. The setup defaults therefore keep their precedence over every
earlier layer, including this one.

The CLI can add a dependency without selecting its bundle, so the installer asserts the selection
itself after a successful add — the same precaution the setup bundle already gets.

### Failure isolation and verification

A failed fetch warns and continues: the profile is complete without the skill, and a rerun retries
it. Verification demands the selection only for a bundle present in the profile's dependencies, so a
skipped fetch cannot fail an otherwise good installation, while an installed-but-unselected bundle
does fail it.

### No opt-out switch

Removal is the existing one: `dsh plugin --profile <name> remove huashu-design` with the app closed
drops both the dependency and the selection. A flag to skip the download would duplicate that.

## Risks

- The pin fixes a moment in an active upstream repository. Moving it means re-checking that the
  package still ships the same skill root and that its dependencies still install cleanly.
- The third-party package's row id (`huashu-design-skill`) is not in this repository's `dsh-setup-*`
  namespace. It is not our fragment; validation only inspects this repository's packages.
- A machine without network still gets the setup bundle, without the skill, plus a warning.
