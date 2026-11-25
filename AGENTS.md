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
the shipped-bundle selections a third-party bundle cannot do and installs the setup last.

Supported DSH today: the `enginesDsh` range **>=0.2.2-rc.2 <0.3.0** (`dsh.json`); anything
outside it is refused. Toolchain: Node **>=24.18.0 <25**, pnpm **11.28.5**.
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
[docs/contributing.md](docs/contributing.md#commands-reference).

## 3. Repository map: handwritten vs generated

- **Handwritten**: plugin sources and metadata, `scripts/**`, `docs/**`, `README.md`, `dsh.json`,
  `openspec/**`, and `install.ps1` (carefully).
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

When task review is owned, the unit is the lane: a `tasks.md` level-2 section with any checked task
lacking a current `PASS` is one run over every checked task; a task outside a section is per-task.
Every due lane starts in one pass, in parallel. One thread owns a unit; the prompt's `- Review key:`
and a stable snapshot path resume it. Only a current `PASS` ends a unit (no round cap). A spec review
binds the plan artifacts, not the worktree, so parallel work cannot stale it;
`integration-review` is required for the agent archive. On a live-worktree run, restore snapshots or
defer writes; no blocking sleep. A user stop wins over every gate: a stopped turn starts no review
and revokes its gate messages. Stop mid-task with a `workflows` `note`, not a tick. The gate refuses
a code-changing turn without the record; see [docs/workflows.md](docs/workflows.md).

**Review and gate ownership.** `workflows` is the only review and gate owner: its definitions own the
checkpoint (`retro`), task-review, and verification closes, while `goal-continuity` and
`verification-gate` keep their rows and legacy sources. A legacy behavior moves
to `own` only after the tracked parity report
(`packages/plugin-workflows/assets/parity/retire-legacy-gates.json`) passes; `--check` must be wired
into the release gate. Rollback is a version downgrade to the previous release; a profile that still
configures the removed delegation row, its `rules`/`targets`, or `delegation.gates` fails at load and
migrates to `reviewers` and the shipped definitions
([migration](docs/workflows.md#migration-and-rollback)).

A checked task is approved only by a committed `openspec/changes/<change>/reviews/<taskId>.json`
task-review PASS. When `openspec/review-approval.json` sets `archiveGate: true`, the engine refuses
`openspec archive` and `mv`/`Move-Item`/`git mv` into `changes/archive/` until every checked task has
one; the audit prints the remedy
`workflows(action: "start", definitionId: "task-review", change: "<change>", task: "<taskId>")`. Run
`pnpm reviews:check --change <name>` before archiving and `pnpm reviews:check --all` before
release. Install the pre-push hook once per clone with `pnpm hooks:install` (it runs
`pnpm reviews:check --push`); both CI workflows run `--all` with full history. See
[docs/review-approval.md](docs/review-approval.md) and
[docs/contributing.md](docs/contributing.md#review-approval-and-the-archive-gate).

## 6. Change owner defaults

Edit `packages/setup/defaults.yml`, then `pnpm gen`, commit the regenerated
`packages/setup/cordis.patch.yml`, and run `pnpm validate:repo`. A patch replaces the whole `config`
object, so restate every option; machine-local values belong in the profile patch, never in this
repo. Detail: [docs/contributing.md](docs/contributing.md#change-owner-defaults).

## 7. Change DSH support

Bump `enginesDsh` in `dsh.json`, `install.ps1`'s `$DshEngineRange`, every plugin's `engines.dsh`, and
the client devDependencies together, then `pnpm gen`, `pnpm check`, and release. The range is the
installer's only allowlist; CI derives its matrix at run time (range floor + runtime + newest
published matching version), so a DSH update inside the range needs no `dsh.json`/`install.ps1`
edit. Detail: [docs/contributing.md](docs/contributing.md#change-dsh-support).

## 8. Release

**An archived change or a push to `main` is the owner's standing request for a release: ship it in
the same turn, without asking again.** One version identifies the whole set and the tag must be
exactly `v<version>`: `pnpm release:prepare --version X.Y.Z`, `pnpm build`, `pnpm validate`,
`git diff --exit-code`, `pnpm gen:check`, commit the version bump with regenerated files, tag, push.
Detail: [docs/releasing.md](docs/releasing.md) and
[docs/contributing.md](docs/contributing.md#release).

## 9. Tests

Vitest covers `packages/*/test/**` and `scripts/test/**`: `pnpm test`, or
`pnpm exec vitest run <file>` / `-t "<name>"` for one file or test. Tests that load built `lib/**`
output need `pnpm build` first. A live acceptance runs locally in a throwaway `DSH_HOME` with a fake
change; never ask the owner to drive it. Use the Nuphus MCP browser for the Workflows view (load the
`nuphus-discipline` skill first) instead of reporting a visual check as unavailable.
Detail: [docs/contributing.md](docs/contributing.md#tests).

## 10. CI gate

`.github/workflows/validate.yml` runs on `windows-latest` (Node 24, pnpm 11.28.5, one matrix entry
per version the `versions` job resolves from `dsh.json` -> `enginesDsh`) through build, generation
drift, typecheck, lint, tests, and the three validators. Any failing step blocks the merge, and
`release.yml` repeats the gate on tags. Step list and local reproduction:
[docs/contributing.md](docs/contributing.md#ci-gate-what-blocks-a-merge).

## 11. Hard rules and gotchas

- **Never clear the Harness home**: no delete, move, or recursive reset of `~/.dsh`, `~/.pg0`,
  `~/.hindsight`, or the `desktop` profile; no recursive delete, `git clean -fdx`, or `/MIR`
  outside the workspace; rename instead. A clean-state test uses a throwaway `DSH_HOME`; live data
  needs the owner's approval plus a backup. Two incidents (2026-10-29, 2026-11-25) wiped every
  session: [docs/session-safety.md](docs/session-safety.md).
- **Capture what you are not fixing now**: a bug or improvement idea in this setup that surfaces
  mid-task is filed as an issue in this repo before the task continues (`gh issue create`,
  `bug`/`enhancement`, no machine paths, credentials, or session dumps). Procedure and body template:
  [docs/contributing.md](docs/contributing.md#capture-out-of-scope-bugs-and-ideas).
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
- **`engines.dsh` must be byte-identical to `dsh.json` -> `enginesDsh`**, and `install.ps1`'s
  `$DshEngineRange` plus both bundle lists stay in sync with `dsh.json`; `validate:repo` enforces it.
  The engines range is the installer's only version allowlist.
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
- **A file the owner must open never goes in `.tmp/`**: scripts use it as scratch. Write it to
  `.dsh/design/` and name the full path in the reply.
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
  restart/reload it from an agent session** — a reload or a hosted-shell install kills the session.
  Use `pnpm dogfood`; the owner installs from an external PowerShell with the app closed.
- **Develop in the Web dev host** (`pnpm dev`): plugin edits apply live and the dev profile mirrors the
  Desktop one, so verify there; never restart or reload that host from a session.
- **Do not combine** the setup bundle with an individual plugin bundle for the same plugin.
- On Windows the DSH CLI is usually a `.cmd` shim; `DSH_CLI` is a command line, and child stdin is not
  interactive.

## 12. Where to look

| Need                                    | File                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Add/change a plugin, Client slots, HMR  | [docs/plugins.md](docs/plugins.md), `packages/plugin-rust/**` (package shape)                  |
| Setup patch/manifest/vendor generation  | [docs/setup-composition.md](docs/setup-composition.md), `scripts/lib/generate.ts`              |
| Installer, manual install, dogfood      | [docs/install.md](docs/install.md), `install.ps1`, `scripts/dogfood.ts`                        |
| Release, Pages, version accumulation    | [docs/releasing.md](docs/releasing.md), `.github/workflows/release.yml`                        |
| Requirements, history, owner follow-ups | `openspec/specs/*/spec.md`, [docs/openspec-status.md](docs/openspec-status.md)                 |
| Reviews, Codex fork                     | [docs/workflows.md](docs/workflows.md), [docs/codex-subagent.md](docs/codex-subagent.md)       |
| Validation assertions                   | `scripts/validate-repo.ts`, `scripts/validate-composition.ts`, `scripts/validate-installer.ts` |
| DSH API types                           | `node_modules/@deepseek-ai/cordis`, `node_modules/@deepseek-ai/dsh-client-ui-*`                |

Troubleshooting and the full reference table:
[docs/contributing.md](docs/contributing.md#troubleshooting).
