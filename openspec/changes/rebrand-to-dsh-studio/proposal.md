# Proposal

## Why

The project is being rebranded from `dsh-setup` to `dsh-studio`, but the old name is persisted
in four places with different blast radii: the public repository and market URLs, the package
scope, the composition row ids, and the prompt section ids. A piecemeal rename would leave a
mixed identity and force more than one breaking reinstall, so the rename ships as one planned
major release with an explicit migration.

## What Changes

- **BREAKING** The GitHub repository, its Pages market URL, the documented installer URL, and
  every install example move from `sergey-akhalkov/dsh-setup` to
  `sergey-akhalkov/dsh-studio`. The old URLs are allowed to return 404.
- **BREAKING** The package scope moves from `@dsh-setup/*` to `@dsh-studio/*` for all 19
  packages; the setup bundle becomes `@dsh-studio/setup`.
- **BREAKING** Every composition row id moves from `dsh-setup-*` to `dsh-studio-*`; the four
  guidance prompt sections move from `dsh-setup:*` to `dsh-studio:*`.
- Server-derived identifiers that embed the package name (skill providers, HTTP routes, client
  slot ids, command definition ids) follow the package rename.
- The installer detects a profile that still depends on or selects `@dsh-setup/setup`, refuses
  before writing, and names the removal-and-rerun action. It never installs the new setup beside
  the legacy one and never rewrites the profile patch.
- The release is `1.0.0`, tagged `v1.0.0`, after the repository rename and the new Pages check.
- Historical artifacts keep their old spelling: archived changes, historical status notes,
  review records, and the retired adapter row ids that old profile patches target.
- The checkout directory and the local runtime keep `~/.dsh-setup/workflows-host.key`, so existing
  workflow approvals, runs, and receipts stay verifiable; the installer backup directory is renamed.

## Capabilities

### New Capabilities

None. This change renames identity only and introduces no new behavior beyond the migration
guard.

### Modified Capabilities

- `portable-setup`: adds the project identity and row-namespace requirement and the legacy
  installation migration requirement, and renames the lazy MCP row in the defaults requirement.
- `codex-subagent`: the setup delivery scenario names the renamed row id.
- `delegation-rules`: the row id and the sibling-bundle scope in the removal and setup-delivery
  requirements are renamed.
- `hindsight-memory`: the opt-out and export requirements name the renamed row id.
- `lazy-mcp`: the shipped lazy MCP requirement names the renamed row id.
- `observability`: the guidance readiness scenario names the renamed prompt section.
- `openspec-apply-picker`: the bundle integration requirement names the renamed package.
- `openspec-panel`: the bundle integration requirement names the renamed package.
- `session-guidance`: the independent-packs and RTK-boundary requirements name the renamed
  package scope.
- `workflow-observability`: the read-only surface requirement names the renamed row id.
- `workflows`: the installed-definitions requirement names the renamed OpenSpec package.

## Impact

- 19 package manifests, 18 composition fragments, `packages/setup/defaults.yml`, and the
  generator constants in `scripts/lib`.
- `install.ps1` defaults, examples, setup marker, installed-package path, and a new legacy
  detection guard; `setup-hindsight.ps1` URLs.
- `dsh.json` repository; README and the install, release, contributing, plugin, setup-composition,
  Hindsight, Serena, Ponytail, RTK, principles, verification-gate, answer-page, Rust, and
  OpenSpec documentation.
- Repository tests and validators for generation, fragments, market, installer, composition,
  dogfood, and plugin wiring.
- Installed profiles: one reinstall after removing the legacy setup; profile patches that target
  old row ids must be updated by their owner.
- Machine-local state: the checkout directory and the workflow host-key path are kept, so the
  Hindsight bank id and existing workflow runs, approvals, and receipts stay valid; no machine-local
  migration is needed.
