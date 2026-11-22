# Proposal

## Why

The setup delivers one design capability: HTML-native design work (prototypes, slide decks,
infographics, App Store artwork, motion) currently depends on whatever the session happens to know.
The owner wants `huashu-design` — an MIT-licensed third-party DSH bundle that packages that skill —
present on every machine the one-command installer prepares, not installed by hand afterwards.

## What Changes

- Add a third installer bundle list, `installBundles.git` in `dsh.json`: pnpm specs for third-party
  bundles installed from a commit-pinned source. It starts with one entry, `huashu-design`.
- The installer installs each declared git bundle with `dsh plugin add <spec>` before the setup
  bundle, selects the package name the profile recorded, and reports a failed fetch as a warning so
  the rest of the installation still completes.
- Extend the repository validation, the installer acceptance run, and the dogfood check to expect
  the declared bundle, a commit-pinned spec, and a declared name that matches the package the spec
  installs.
- Document the bundle, its prerequisites, the update procedure, and its removal.
- Do not vendor the bundle, publish it, duplicate its rows, or add an opt-out switch.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `portable-setup`: the one-command installer additionally installs the declared pinned third-party
  bundle and selects it ahead of the setup bundle.

## Impact

- `dsh.json`, `install.ps1` (repository metadata block, plan, install loop, selection, verification).
- `scripts/lib/workspace.ts`, `scripts/validate-repo.ts`, `scripts/validate-installer.ts`,
  `scripts/dogfood.ts`, and two test fixtures.
- `docs/install.md` and the root `README.md`.
- The profile gains one third-party dependency and one bundle selection; the setup bundle, its
  generated files, and the market index are unchanged.
- The repository grows by no bundled content: the installed tree comes from the pinned git spec.
