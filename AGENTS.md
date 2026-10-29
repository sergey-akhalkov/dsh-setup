# AGENTS.md

Operating guide for coding agents in **dsh-setup**: a portable, installable DeepSeek Harness (DSH)
setup. It is the source of truth for one setup bundle, the individual plugin bundles it contains, a
static plugin-market index, and the one-command installer.

This file is the fast path, not the manual: it is capped at 16,000 bytes and injected on every
request. Repository detail lives in [docs/contributing.md](docs/contributing.md) (repository map,
commands, plugin checklist, CI gate, hard rules, troubleshooting); change history and owner
follow-ups live in [docs/openspec-status.md](docs/openspec-status.md). User-facing behavior:
[docs/plugins.md](docs/plugins.md), [docs/install.md](docs/install.md) (installation, updates,
dogfood), [docs/releasing.md](docs/releasing.md); bundle composition:
[docs/setup-composition.md](docs/setup-composition.md).
Accepted requirements live in `openspec/specs/`; the parent change is archived at
[openspec/changes/archive/2026-10-26-add-portable-dsh-setup](openspec/changes/archive/2026-10-26-add-portable-dsh-setup).
Read this file, then open only the page the task needs.

## 1. One-paragraph mental model

A DSH **profile** is `package.json` (with an ordered `dsh.profile.bundles` list) plus
`cordis.patch.yml`. Only **directly selected** bundles contribute a patch layer; transitive bundle
dependencies are never applied. A **bundle** is a package that declares `dsh.bundle.patch`;
installing it means adding the package dependency **and** appending its name to
`dsh.profile.bundles` (what `dsh plugin --profile <name> add <spec>` does). This repo ships
`@dsh-setup/setup`: a generated meta-bundle whose patch inserts every plugin row and then applies
owner defaults, and which vendors every plugin's publishable files under
`packages/setup/node_modules` so one git install delivers all code. Individual
`@dsh-setup/plugin-*` packages are ordinary bundles installable on their own. `install.ps1` performs
the shipped-bundle selections a third-party bundle cannot do and installs the setup last. The release
workflow generates the static format-1 market index pinned to the tagged commit and deploys it to
GitHub Pages.

Supported DSH today: **0.2.1-rc.3** (`dsh.json`). Toolchain: Node **>=24.18.0 <25**, pnpm **11.28.5**.
Repo package version: one version for all packages; `pnpm release:prepare` sets it and
`package.json` is authoritative.

## 2. First commands

```sh
pnpm install

pnpm check        # typecheck -> lint -> build -> test
pnpm gen:check    # generated YAML/manifest/vendored tree matches its sources
pnpm validate:repo
pnpm dogfood      # Windows: verify install.ps1 against a copy of the live desktop profile
```

Full local gate, the command reference, environment variables, and the CI sequence:
[docs/contributing.md](docs/contributing.md#commands-reference). Scripts under `scripts/` are
TypeScript executed directly by Node 24: relative imports must carry the `.ts` extension
(`from './lib/workspace.ts'`).

## 3. Repository map: handwritten vs generated

- **Handwritten**: `packages/plugin-*/{src,test}/**`, `package.json`, `cordis.fragment.yml`,
  `locale/en.json`, `icon.svg`, `tsconfig.json`; `scripts/**`; `docs/**`; `README.md`; `dsh.json`;
  `openspec/**`; `install.ps1` (carefully).
- **Generated, never hand-edited**: plugin `cordis.patch.yml` (`pnpm gen`), `lib/**` (`pnpm build`),
  `packages/setup/{package.json,cordis.patch.yml,node_modules/@dsh-setup/**}` (`pnpm gen`),
  `market/**` (CI release), vendored Ponytail/OpenSpec assets (their update scripts).
- Generated output is committed: after a source change, run the generator and/or build, then commit
  the result. CI rejects drift (`pnpm build && git diff --exit-code`, `pnpm gen:check`).

The full path-by-path table:
[docs/contributing.md](docs/contributing.md#repository-map-handwritten-vs-generated).

## 4. Create a new plugin package

Name it `packages/plugin-<name>`, package name `@dsh-setup/plugin-<name>`. Start from the closest
existing package shape (`packages/plugin-rust` is Host-only); a bundle that only connects an external
MCP server can skip the TypeScript project. The full checklist — manifest, fragment, Host/Client
halves, metadata, tsconfig reference, tests, regeneration, README row, definition of done — is
[docs/contributing.md](docs/contributing.md#create-a-new-plugin-package-the-main-task).

## 5. OpenSpec workflow (requirements are spec-driven)

`openspec/config.yaml` requires **English** for all artifacts. Accepted requirements are the main
specs in `openspec/specs/`; a change lives in `openspec/changes/<name>/` as `proposal.md`, `design.md`,
delta specs, and `tasks.md`, and is archived under `openspec/changes/archive/<date>-<name>/`.

Flow: **propose** (proposal -> design -> delta specs -> tasks) -> **apply** (implement and tick
tasks) -> **sync** deltas into main specs -> **archive**. Use the packaged OpenSpec skills
(`openspec-propose`, `openspec-explore`, `openspec-apply-change`, `openspec-update-change`,
`openspec-sync-specs`, `openspec-archive-change`, shipped by `@dsh-setup/plugin-openspec`) when
available, otherwise follow the same flow manually. A behavior change that touches a documented
requirement updates its delta spec and design rationale in the same change.

When delegation-rules is active, apply is task-by-task: mark a task `[x]` only when complete, then
immediately run its task-scoped review before the next task; stop mid-task with `task_progress`
instead of ticking. The gate refuses a code-changing turn without that; see
[docs/delegation-rules.md](docs/delegation-rules.md).

Change history, archived task counts, and open owner follow-ups:
[docs/openspec-status.md](docs/openspec-status.md).

## 6. Change owner defaults

Edit `packages/setup/defaults.yml`, then `pnpm gen`, commit the regenerated
`packages/setup/cordis.patch.yml`, and run `pnpm validate:repo`. A patch replaces the whole `config`
object, so restate every option; machine-local values belong in the profile patch, never in this
repo. Detail: [docs/contributing.md](docs/contributing.md#change-owner-defaults).

## 7. Change DSH support

Bump `dsh.json`, `install.ps1`'s version/bundle arrays, every plugin's `engines.dsh`, and the client
devDependencies together, then `pnpm gen`, `pnpm check`, and release. The CI matrix derives from
`dsh.json`; the installer gate is exact `supportedVersions` membership. Detail:
[docs/contributing.md](docs/contributing.md#change-dsh-support).

## 8. Release

One version identifies the whole set and the tag must be exactly `v<version>`:
`pnpm release:prepare --version X.Y.Z`, `pnpm build`, `pnpm validate`, `git diff --exit-code`,
`pnpm gen:check`, commit the version bump with regenerated files, tag, push. The release workflow
validates, builds the market index pinned to the tag, and deploys Pages last. Detail:
[docs/releasing.md](docs/releasing.md) and [docs/contributing.md](docs/contributing.md#release).

## 9. Tests

Vitest covers `packages/*/test/**` and `scripts/test/**`: `pnpm test`, or
`pnpm exec vitest run <file>` / `-t "<name>"` for one file or test. Tests that load built `lib/**`
output need `pnpm build` first. Detail: [docs/contributing.md](docs/contributing.md#tests).

## 10. CI gate

`.github/workflows/validate.yml` runs on `windows-latest` (Node 24, pnpm 11.28.5, one matrix entry
per `dsh.json` -> `supportedVersions`) in this order: `pnpm install --frozen-lockfile`, `pnpm build`,
`git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`. Any failing step blocks
the merge; `release.yml` repeats the gate on tags. Detail and local reproduction:
[docs/contributing.md](docs/contributing.md#ci-gate-what-blocks-a-merge).

## 11. Hard rules and gotchas

- **Never hand-edit generated files** (`packages/*/cordis.patch.yml`, `packages/*/lib/**`,
  `packages/setup/{package.json,cordis.patch.yml,node_modules/**}`). Run `pnpm gen` and/or
  `pnpm build` and commit the result. `pnpm check` does not run `gen:check`. The one exception is
  `packages/plugin-codex-subagent/lib/**`: change it only through the fork README patch/rebase
  procedure, never with `pnpm gen`/`pnpm build`.
- **Vendored Ponytail and OpenSpec assets are generated**
  (`packages/plugin-{ponytail,openspec}/assets/**`, their `*.lock.json`). Refresh with
  `pnpm ponytail:update` / `pnpm openspec:update --version X.Y.Z`, never by hand; the offline
  provenance tests pin sizes and SHA-256.
- **`packages/setup` is outside the pnpm workspace on purpose.** Never add it or run installs inside
  it: pnpm would prune the tracked vendored `node_modules` tree.
- **No install-time scripts** in any published manifest; prebuilt `lib/` ships so git installs and
  the market need no build approval.
- **`engines.dsh` must be byte-identical to `dsh.json` -> `enginesDsh`**, and `dsh.json` and
  `install.ps1` stay in sync (versions and both bundle lists); `validate:repo` enforces both. The
  installer gate is exact `supportedVersions` membership.
- **Row ids are global**, match `^dsh-setup-...$`, and are unique. A fragment mounts only its own
  package's code, except the approved `@deepseek-ai/dsh-mcp-client` adapter row; Nuphus and Serena
  are guidance-only and both servers come from `dsh-setup-mcp-lazy`.
- **A configuration patch replaces the entire `config` object** (including `defaults.yml` entries); a
  setup-row disable is folded into the row's insert entry.
- **The setup bundle stays pure**: no shipped-bundle selections and no duplicated rows;
  `install.ps1` selects (setup last) and never edits the profile's `cordis.patch.yml`.
- **Never put absolute machine paths, credentials, sessions, or private keys in tracked files**
  (including docs); `validate:repo` rejects them. It skips `openspec/`, `market/`, `node_modules`,
  `.tmp`, `.dsh`, `coverage/`, but scans the vendored `packages/setup/node_modules`.
- **LF everywhere.** `.gitattributes` forces `eol=lf` because `gen:check` compares bytes.
- **Markdown is Biome-checked and formatted**; run `pnpm lint:fix` after editing docs (tables get
  padded).
- **NodeNext + strict TypeScript**: scripts import with `.ts` extensions; emitted packages do not get
  `allowImportingTsExtensions`.
- **`install.ps1` runs through `Invoke-Expression`**: no bare `exit` (the documented `irm | iex` form
  would terminate the user's shell); `validate:repo` rejects it.
- **`pnpm validate` is not the full release check**: it misses stale committed build output; run
  `pnpm build && git diff --exit-code` and `pnpm gen:check` before committing.
- **`market/` is generated and gitignored**; never commit it; the artifact is exactly `index.json` +
  `icons/` with `.svg` files only.
- **Desktop profile is Electron-owned**: the CLI cannot boot or dump it. **Never install into or
  restart/reload it from an agent session** — a page reload kills the Host, and a hosted-shell
  install would kill the session. Use `pnpm dogfood`; the owner installs from an external PowerShell
  with the app closed.
- **Do not combine** the setup bundle with an individual plugin bundle for the same plugin.
- On Windows the DSH CLI is usually a `.cmd` shim; `DSH_CLI` is a command line, and child stdin is not
  interactive.

## 12. Where to look

| Need                                    | File                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Add/change a plugin, Client slots, HMR  | [docs/plugins.md](docs/plugins.md), `packages/plugin-rust/**` (package shape)                          |
| Setup patch/manifest/vendor generation  | [docs/setup-composition.md](docs/setup-composition.md), `scripts/lib/generate.ts`                      |
| Installer, manual install, dogfood      | [docs/install.md](docs/install.md), `install.ps1`, `scripts/dogfood.ts`                                |
| Release, Pages, version accumulation    | [docs/releasing.md](docs/releasing.md), `.github/workflows/release.yml`                                |
| Requirements, history, owner follow-ups | `openspec/specs/*/spec.md`, [docs/openspec-status.md](docs/openspec-status.md)                         |
| Delegation, Codex fork                  | [docs/delegation-rules.md](docs/delegation-rules.md), [docs/codex-subagent.md](docs/codex-subagent.md) |
| Validation assertions                   | `scripts/validate-repo.ts`, `scripts/validate-composition.ts`, `scripts/validate-installer.ts`         |
| DSH API types                           | `node_modules/@deepseek-ai/cordis`, `node_modules/@deepseek-ai/dsh-client-ui-*`                        |

Troubleshooting and the full reference table:
[docs/contributing.md](docs/contributing.md#troubleshooting).
