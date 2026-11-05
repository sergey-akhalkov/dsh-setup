# Proposal

## Why

Every DeepSeek Harness update currently requires a repository edit and a release: `dsh.json` carries an
exact `supportedVersions` list, `install.ps1` embeds the same list, and both CI workflows derive their
matrix from it. When the desktop app moved to DSH 0.2.2-rc.1 the setup's plugins still mounted and ran
in a throwaway profile, but the installer refused the version because the list had not been edited.
The published packages already declare the real compatibility contract in `engines.dsh`, and DSH
itself refuses packages installed outside that range; the exact list is a second, stale copy that adds
maintenance without adding safety.

## What Changes

- Remove `dsh.json` → `supportedVersions`. The `enginesDsh` range stays the single source of truth.
- The installer accepts every DSH version inside `engines.dsh`, using a Windows PowerShell 5.1-safe
  SemVer range check, and its refusal names the range instead of a version list.
- The CI matrix no longer reads a list: one script resolves the range floor, the runtime, and the
  newest published version satisfying the range at run time, so a newly published 0.2.x is tested
  without a repository edit.
- `validate:repo` replaces the exact-list sync check with an embedded-range equality check; the docs
  and AGENTS describe the range as the contract.

## Capabilities

### Modified Capabilities

- `portable-setup`: the "Compatibility declaration and release gate" requirement makes the engines
  range the only allowlist and the release gate follow the range's floor plus the newest published
  matching version.

## Impact

- `install.ps1`, `dsh.json`, `scripts/lib/workspace.ts`, new `scripts/ci-versions.ts`,
  `scripts/validate-repo.ts`, `scripts/validate-installer.ts`, both workflows, `AGENTS.md`,
  `docs/contributing.md`, `docs/releasing.md`, `docs/install.md`.
- No plugin code, bundle row, profile contract, or runtime dependency changes. Releases 0.26.1.
