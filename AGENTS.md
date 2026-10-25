# AGENTS.md

Operating guide for coding agents in **dsh-setup**: a portable, installable DeepSeek Harness (DSH)
setup. It is the source of truth for one setup bundle, the individual plugin bundles it contains, a
static plugin-market index, and the one-command installer.

This file is the fast path: read it before touching the repo. For user-facing detail, the docs are
authoritative: [docs/plugins.md](docs/plugins.md), [docs/setup-composition.md](docs/setup-composition.md),
[docs/install.md](docs/install.md), [docs/releasing.md](docs/releasing.md). The OpenSpec artifacts are
the requirements source of truth: [openspec/changes/add-portable-dsh-setup](openspec/changes/add-portable-dsh-setup).

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
Repo package version (all packages move together): **0.1.6**.

## 2. First commands

```sh
pnpm install

pnpm check        # typecheck -> lint -> build -> test
pnpm gen:check    # generated YAML/manifest/vendored tree matches its sources
pnpm validate:repo
pnpm dogfood      # Windows: verify install.ps1 against a copy of the live desktop profile
```

Full local gate (closest to CI; takes longer, needs network and the DSH CLI):

```sh
pnpm build
git diff --exit-code          # committed lib/ and client bundles match a fresh build
pnpm gen:check
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:repo
pnpm validate:composition     # throwaway profile + published DSH CLI
pnpm validate:installer       # Windows only; exercises install.ps1 end to end
```

`pnpm validate` is `check && gen:check && validate:repo && validate:composition && validate:installer`.
It does **not** include `git diff --exit-code` and does **not** generate the market artifact.

Scripts under `scripts/` are TypeScript executed directly by Node 24: relative imports must carry the
`.ts` extension (`from './lib/workspace.ts'`).

## 3. Repository map: handwritten vs generated

| Path                                                        | Role                                                                          | Hand-edit?                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/plugin-*/src/**`, `test/**`                       | Plugin Host/Client sources and unit tests                                     | yes                                                     |
| `packages/plugin-*/package.json`                            | Plugin manifest (`dsh.bundle`, `dsh.client`, `engines.dsh`, exports, peers)   | yes                                                     |
| `packages/plugin-*/cordis.fragment.yml`                     | Row ids the plugin mounts (input to generation)                               | yes                                                     |
| `packages/plugin-*/locale/en.json`, `icon.svg`              | Market title/description and card icon                                        | yes                                                     |
| `packages/plugin-*/tsconfig.json`                           | Composite Host project (`src/host` -> `lib`)                                  | yes                                                     |
| `packages/plugin-*/cordis.patch.yml`                        | Generated bundle patch                                                        | **no** (`pnpm gen`)                                     |
| `packages/plugin-*/lib/index.js`, `lib/index.d.ts`          | Generated Host runtime (tsc)                                                  | **no** (`pnpm build`)                                   |
| `packages/plugin-*/lib/client.js`                           | Generated Client bundle (esbuild + loader wrapper)                            | **no** (`pnpm build`)                                   |
| `packages/plugin-ponytail/assets/**`, `ponytail.lock.json`  | Vendored upstream prompt, license, and provenance lock                        | **no** (`pnpm ponytail:update`)                         |
| `packages/setup/defaults.yml`, `locale/en.json`, `icon.svg` | Owner defaults and setup card metadata                                        | yes                                                     |
| `packages/setup/package.json`                               | Generated setup manifest (deps, `bundleDependencies`)                         | **no** (`pnpm gen`; version only via `release:prepare`) |
| `packages/setup/cordis.patch.yml`                           | Generated aggregated setup patch                                              | **no** (`pnpm gen`)                                     |
| `packages/setup/node_modules/@dsh-setup/**`                 | Generated vendored plugin copies; tracked despite `.gitignore`                | **no** (`pnpm gen`)                                     |
| `scripts/**`                                                | Build, generation, market, validation, release helpers                        | yes                                                     |
| `install.ps1`                                               | Standalone installer (duplicates `dsh.json` metadata on purpose)              | yes, carefully                                          |
| `dsh.json`                                                  | Supported DSH versions, engines range, installer bundle lists, repository URL | yes                                                     |
| `docs/**`, `README.md`                                      | User documentation                                                            | yes                                                     |
| `openspec/**`                                               | Requirements: proposal, design, delta specs, tasks                            | yes (see §11)                                           |
| `market/**`                                                 | Generated Pages artifact (`index.json` + `icons/`); gitignored                | **no** (CI release only)                                |
| `.tmp/`, `.dsh/`, `*.tsbuildinfo`, `coverage/`              | Local scratch/state                                                           | not committed                                           |

Consequences of "generated files are committed": after changing sources you must run the generator
and/or build and commit the result; CI rejects a commit whose generated files differ from a fresh
rebuild (`git diff --exit-code` after `pnpm build`, plus `pnpm gen:check`).

## 4. Commands reference

| Command                                       | Effect                                                                                                                                | Run after                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm gen`                                    | Rewrites per-plugin `cordis.patch.yml`, `packages/setup/{package.json,cordis.patch.yml}`, vendored tree; removes stale vendored files | fragment, plugin manifest/`files`, `defaults.yml`, or `dsh.json` engines change |
| `pnpm gen:check`                              | Byte-compares generated files and reports missing/changed/unexpected; exits 1 on drift                                                | before committing                                                               |
| `pnpm ponytail:update --version X.Y.Z`        | Refreshes the vendored Ponytail prompt and lock from a pinned upstream release                                                        | updating the vendored prompt                                                    |
| `pnpm build`                                  | `tsc -b` Host output + esbuild Client bundles                                                                                         | any `src/**` change                                                             |
| `pnpm build:watch`                            | Rebuild Host (tsc watch) and Client bundles on change                                                                                 | plugin development loop                                                         |
| `pnpm typecheck`                              | `tsc -p tsconfig.check.json` (packages src+test, scripts, DOM/react libs)                                                             | any TS change                                                                   |
| `pnpm lint` / `pnpm lint:fix` / `pnpm format` | Biome check / autofix / format                                                                                                        | before commit                                                                   |
| `pnpm test`                                   | Vitest (all `packages/*/test/**` and `scripts/test/**`)                                                                               | any change                                                                      |
| `pnpm exec vitest run <file>`                 | One test file                                                                                                                         | focused work                                                                    |
| `pnpm exec vitest run -t "<name>"`            | One test by name                                                                                                                      | focused work                                                                    |
| `pnpm validate:repo`                          | Static manifests, fragments, defaults, installer metadata copy, machine-path/secret scan                                              | before commit                                                                   |
| `pnpm validate:composition`                   | Installs `packages/setup` into a throwaway `ci` profile with the published DSH CLI and checks the composed `--dump-config`            | setup/plugin composition change                                                 |
| `pnpm validate:installer`                     | Runs `install.ps1` against a throwaway profile (Windows only; skipped elsewhere)                                                      | installer or composition change                                                 |
| `pnpm dogfood`                                | Runs `install.ps1` against a throwaway copy of the live `desktop` profile and proves the live profile is unchanged (Windows only)     | installer/composition change; before installing live on the owner machine       |
| `pnpm generate:market`                        | Builds the gitignored `market/` artifact from HEAD (or `--commit`/`--timestamp`); needs a git commit                                  | verifying release output                                                        |
| `pnpm release:prepare --version X.Y.Z`        | Sets one version in root, every plugin, setup, then runs `pnpm gen`                                                                   | starting a release                                                              |

Useful environment variables: `DSH_CLI` (CLI command to use instead of `pnpm dlx @deepseek-ai/dsh@<runtime>`),
`DSH_KEEP=1` (keep throwaway Harness homes), `DSH_VERSION` (`validate:installer` DSH version),
`DSH_HOME`/`DSH_PROFILE` (owner profile `pnpm dogfood` copies), `PWSH` (PowerShell executable for
`validate:installer` and `dogfood`), `MARKET_INDEX_URL` (`fetch-previous-index.ts`).

## 5. Create a new plugin package (the main task)

Name it `packages/plugin-<name>`, package name `@dsh-setup/plugin-<name>`; copy
`packages/plugin-composer-clock` as the template. Checklist:

1. **Manifest** `packages/plugin-<name>/package.json`
   - `name`, `version` (equal to the repo version), `description`, `icon: "./icon.svg"`,
     `type: "module"`, `main: "lib/index.js"`, `types: "lib/index.d.ts"`.
   - `exports`: `"."` -> `{ "types": "./lib/index.d.ts", "default": "./lib/index.js" }`;
     `"./client": "./lib/client.js"` **only if a Client half exists** (validator requires it then);
     `"./cordis.patch.yml"`, `"./cordis.fragment.yml"`, `"./locale/*.json"`, `"./icon"`,
     `"./package.json"`.
   - `files`: must list `icon.svg`, `locale/*.json`, `lib/index.js`, `lib/index.d.ts`,
     `lib/client.js`, `cordis.patch.yml`, `cordis.fragment.yml`. This list is exactly what the setup
     bundle vendors; a declared file that does not exist fails generation. Additional exact asset
     paths (for example a vendored upstream prompt) are allowed and vendored the same way.
   - `engines.dsh` must be **byte-identical** to `dsh.json` -> `enginesDsh`
     (`>=0.2.1-rc.3 <0.3.0` today). `validate:repo` rejects any mismatch.
   - `peerDependencies` pin shared DSH packages (`@deepseek-ai/cordis: "~4.0.5"`); repeat the same
     versions in `devDependencies` for type checking. Add the DSH client packages you import as
     devDependencies pinned to `0.2.1-rc.3`. After adding or changing dependencies, run
     `pnpm install` and commit the updated `pnpm-lock.yaml`.
   - `dsh.bundle.patch: "./cordis.patch.yml"`.
   - `dsh.client` only for a Client half: `{ "platform": "web", "immediately": true, "inject": ["<client package that declares the slot>"], "external": ["<non-baseline imports>"] }`.
     `dsh.client.inject` orders packages; the Client module's own `inject` lists services (e.g.
     `['slots']`).
   - No `prepare`, `preinstall`, `install`, or `postinstall` scripts. Git installs cannot run them,
     and validation rejects them.
2. **Fragment** `cordis.fragment.yml`:

   ```yaml
   rows:
     - id: dsh-setup-<slug>
   ```

   Only `rows` at top level, only `id`/optional `config` per row. `id` must match
   `^dsh-setup-[a-z0-9]+(?:-[a-z0-9]+)*$` and be globally unique. Never write `name:` — the module
   specifier is derived from the owning package.
3. **Host half** `src/host/index.ts`: export `name` (equal to the package name) and
   `apply(ctx: Context)`; no module-scope side effects. An inert `apply` is correct when all behavior
   is Client-side.
4. **Client half** (optional) `src/client/index.tsx`: export `inject` (services) and `apply(ctx)`;
   register into an existing slot, e.g.

   ```ts
   export const inject = ['slots']
   export function apply(ctx: Context): void {
     ctx.slots.inject('conversation.composer.dock', () =>
       ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-setup-<slug>', order: 50 }, Component),
     )
   }
   ```

   Imports outside the browser module table must be declared in `dsh.client.external`. React,
   `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime` are baseline
   externals and are never bundled. Verify slot names/props against the running Harness (Client
   `Slots` provider via the inspector) and route visible text through the Client locale service.
5. **Metadata**: `locale/en.json` (`meta.title`, `meta.description` — the market card source; no
   other metadata is read) and `icon.svg` (`.svg` only for market publication).
6. **TypeScript project**: `tsconfig.json` extends `../../tsconfig.base.json` with
   `composite: true`, `declaration: true`, `rootDir: "src/host"`, `outDir: "lib"`,
   `include: ["src/host/**/*.ts"]`. Add `{ "path": "./packages/plugin-<name>" }` to root
   `tsconfig.json` `references`, or `pnpm build` emits nothing for the package. Client `.tsx` is
   type-checked only by `tsconfig.check.json` (`pnpm typecheck`), not by the package project.
7. **Tests** under `test/` (Vitest). At minimum cover the Client bundle: load `lib/client.js` with a
   fake `window.__ModuleLoader__` and a fake module table, assert `id === package name`, `inject`, and
   the registration(s) from `apply`.
8. **Regenerate and verify**:

   ```sh
   pnpm gen          # writes the plugin patch, setup patch/manifest, vendored copy
   pnpm build        # writes lib/index.js, lib/index.d.ts, lib/client.js
   pnpm check
   pnpm validate:repo
   ```

   Then commit sources **and** generated output (`cordis.patch.yml`, `lib/**`,
   `packages/setup/{package.json,cordis.patch.yml}`, `packages/setup/node_modules/**`). The vendored
   copies are tracked; `pnpm gen:check` flags stale or unexpected ones, so a removed plugin cannot
   leave dead files behind.

The Client build emits `window.__ModuleLoader__.load({ id: <package name>, factory: (require) => ... })`
automatically; never hand-write or edit `lib/client.js`. Entry candidates in order:
`src/client/index.tsx`, `index.ts`, `index.jsx`, `index.js`.

Definition of done for a plugin change: `pnpm build` leaves `git diff` clean after committing,
`pnpm gen:check` passes, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm validate:repo` pass,
new behavior is covered by a test, and `locale/en.json` describes the plugin for the market card.

## 6. Plugin development loop (link a workspace package)

```sh
dsh --profile dev --from-default-profile web
dsh plugin --profile dev add link:<absolute path to packages/plugin-<name>>
pnpm build:watch
```

Observed behavior on DSH 0.2.1-rc.3 (documented in [docs/plugins.md](docs/plugins.md)): editing
`src/client/index.tsx` rewrites `lib/client.js` and the Web transport's `rebuilt` frame hot-swaps the
Client half without a page reload; Host edits (`src/host/index.ts`) apply only on profile
recomposition (profile patch change) or a Harness restart; the Desktop app picks up rebuilt Client
bundles only after reopening/restarting. Do not assume both halves hot-reload.

Manual install of a released bundle (app fully quit):

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/setup"
```

Use either the full setup bundle or an individual plugin for the same plugin, never both (duplicate
row mounts).

Do not install the setup into the live `desktop` profile from a shell hosted by the running Harness
(an agent tool shell or the in-app terminal): the installer must close and restart the app for a
desktop-profile write, which kills the shell's process tree and aborts the turn. A Harness-home reset
while the app runs is worse: it can remove the running session's own file, which surfaces as
`This turn failed ENOENT`. Use `pnpm dogfood` to verify this checkout against a copy of that profile;
a real install is a command the owner runs from an external PowerShell window. `install.ps1` refuses
the hosted-shell desktop case itself, so a stray attempt fails before changing anything.

## 7. Change owner defaults

Edit `packages/setup/defaults.yml` (only `id` + `config`; the id must target a shipped row, must not
start with `dsh-setup-`, and must be unique). A patch **replaces the whole `config` object**, never
merges, so restate the complete configuration each row needs. Then `pnpm gen`, commit the regenerated
`packages/setup/cordis.patch.yml`, and run `pnpm validate:repo` (and `pnpm validate:composition` when
possible). The profile's own `cordis.patch.yml` always outranks these defaults; machine-local values
(credentials, proxy, personal model list) belong there, never in this repo.

## 8. Change DSH support

Update all of these together:

1. `dsh.json`: `runtime`, `enginesDsh`, `supportedVersions`, `installBundles` if the shipped set changed.
2. `install.ps1`: the `$SupportedDshVersions`, `$ShippedBundles`, `$RegistryBundles` arrays.
   `pnpm validate:repo` fails while they differ from `dsh.json`.
3. `engines.dsh` in **every** plugin manifest (and the generated setup manifest via `pnpm gen`).
4. Client devDependencies pinned to the new DSH client packages; refresh `pnpm-lock.yaml`.
5. Run `pnpm gen`, `pnpm check`, and the full validation; release a new set version.
   Never patch or reuse an already-published tag.

The CI matrix is derived from `dsh.json` -> `supportedVersions`; no workflow edit is needed for a
supported-version bump. The **installer gate is exact membership in `$SupportedDshVersions`**, not
the `enginesDsh` semver range.

## 9. Release

One version identifies the whole set; the tag must be exactly `v<version>`.

```sh
pnpm release:prepare --version X.Y.Z
pnpm build
pnpm validate
git diff --exit-code
pnpm gen:check
# commit version bump + regenerated setup manifest/vendored copies
git tag vX.Y.Z
git push origin main vX.Y.Z
```

The release workflow validates the full matrix on `windows-latest`, then (only if validation passes)
checks the tag, builds, fetches the previously published index with
`node scripts/fetch-previous-index.ts .tmp/previous-index.json`, runs
`node scripts/generate-market.ts --previous .tmp/previous-index.json`, uploads `market/`, and deploys
Pages **last**. Older versions are preserved by merging the previous published document; a missing
document means first release, while an unreadable/invalid one fails publication. The market URL is
`https://sergey-akhalkov.github.io/dsh-setup/index.json`; it must answer a direct HTTP 200 without
redirects.

Do not hand-edit anything under `market/`: it is a gitignored artifact generated in CI. A local
`market/index.json` may be stale (older generator output); regenerate rather than trust it.

## 10. Tests

Vitest includes `packages/*/test/**/*.test.ts` and `scripts/test/**/*.test.ts`; environment `node`;
CI additionally writes JUnit to `.tmp/junit.xml`.

```sh
pnpm test                                            # all
pnpm exec vitest run scripts/test/market.test.ts      # one file
pnpm exec vitest run -t "keeps previously listed versions"  # one test
pnpm test:watch                                      # watch
```

`scripts/test/` covers generation, fragment/manifest validation, market mapping/merging, and the
repository scans. The Client-bundle test loads the already-built `lib/client.js`, so run `pnpm build`
first (or use `pnpm check`, which builds before testing). Tests that need machine-path fixtures
compose them at runtime so `validate:repo` does not flag the test file.

## 11. OpenSpec workflow (requirements are spec-driven)

`openspec/config.yaml` requires **English** for all artifacts and keeps structural headings and
SHALL/MUST keywords in English. The active change is
`openspec/changes/add-portable-dsh-setup/` (proposal, design, delta specs `portable-setup` and
`plugin-market`, tasks). The main specs under `openspec/specs/` now hold the accepted requirements:
`portable-setup` and `plugin-market` were synced from the parent change on 2026-10-25, and the
archived `2026-10-25-add-ponytail-skill-plugin` change added `packaged-skills` plus its
`portable-setup` amendment. Cite `openspec/specs/` for accepted requirements and a change's delta
specs for pending ones.

The parent deltas were synced before it was archived so the ponytail change's MODIFIED
`portable-setup` delta could apply. Its `No secrets or machine data` requirement therefore already
exists in the main spec (with the ponytail amendment), and `openspec validate --all` reports that its
ADDED delta would refuse to archive until that requirement is reconciled (for example, restated as
MODIFIED with the current text) when the parent change is archived.

Flow: **propose** (proposal -> design -> delta specs -> tasks) -> **apply** (implement and tick
tasks) -> **sync** deltas into main specs -> **archive**. When the OpenSpec skills are installed
(`openspec-propose`, `openspec-explore`, `openspec-apply-change`, `openspec-sync-specs`,
`openspec-archive-change`), use them; otherwise follow the same flow manually. Behavior changes that
touch a documented requirement should update the corresponding delta spec and design rationale in the
same change.

`tasks.md` is 32/35 done. Open: 7.1 first published release/tag verification, 7.4 second release
update visibility, 8.1 clean-machine rehearsal. (7.2 dogfood verification, 7.3 commit-pinned
throwaway-profile install, and 9.4 the committed `pnpm dogfood` command are done.) Archive only after
those review requirements are satisfied. Keep `docs/` consistent with spec changes; the design's D8
layout is stale about the Client bundle path (actual: `lib/client.js`, not package-root `client.js`).
Trust the code and `docs/plugins.md`.

## 12. CI gate (what blocks a merge)

`.github/workflows/validate.yml` (pull requests, pushes to `main`, manual) runs on `windows-latest`
with Node 24, pnpm 11.28.5, and one matrix entry per `dsh.json` -> `supportedVersions` (installs the
published DSH CLI once outside the repo and exports `DSH_CLI`). The pnpm version is pinned (not just
ranged) because pnpm 11.9.0 can leave an install process alive after printing `Done in ...`
([pnpm#13617](https://github.com/pnpm/pnpm/issues/13617)), which hung the installer exercise on CI;
11.28.5 is also the version DSH `0.2.1-rc.3` bundles. Steps, in order:

```sh
pnpm install --frozen-lockfile
pnpm build
git diff --exit-code
pnpm gen:check
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:repo
pnpm validate:composition
pnpm validate:installer
```

Any failing step fails the job (the merge gate when branch protection requires this check).
`release.yml` reruns the same gate on `v*` tags before publishing; its `publish` job does not repeat
the checks, so the gate must stay green. Locally, reproduce the sequence above (the last two need
network; the installer exercise needs Windows with PowerShell 7 as `pwsh`, or set `PWSH`).

## 13. Hard rules and gotchas

- **Never hand-edit generated files** (`packages/*/cordis.patch.yml`, `packages/*/lib/**`,
  `packages/setup/package.json`, `packages/setup/cordis.patch.yml`,
  `packages/setup/node_modules/**`). Run `pnpm gen` and/or `pnpm build`, then commit the result.
  `pnpm check` alone does not run `gen:check`; use `pnpm validate` or run `gen:check` explicitly.
- **Vendored Ponytail assets are generated** (`packages/plugin-ponytail/assets/**`,
  `ponytail.lock.json`). Refresh them with `pnpm ponytail:update` and never by hand; the offline
  provenance test pins their sizes and SHA-256, and Biome ignores them so hashes stay stable.
- **`packages/setup` is deliberately outside the pnpm workspace** (`pnpm-workspace.yaml` lists only
  `packages/plugin-*`). Do not add it and do not run installs inside it: pnpm would prune the tracked
  vendored `node_modules` tree. `.gitignore` deliberately re-includes
  `packages/setup/node_modules/**`.
- **No install-time scripts** in any published manifest. Prebuilt `lib/` exists so git installs and
  the market need no build approval.
- **`engines.dsh` must equal `dsh.json` -> `enginesDsh` exactly** (not merely cover it); that rule is
  enforced by `validate:repo` for every plugin.
- **Row ids are global** and match `^dsh-setup-...$`; defaults must not use the prefix or collide with
  row ids. Plugin fragments cannot mount another package's code.
- **A patch replaces the entire `config` object.** Every `defaults.yml` entry must restate the full
  config for its row.
- **The setup bundle stays pure**: it does not select shipped bundles or duplicate shipped rows.
  `install.ps1` performs the selection (setup bundle last, so its defaults outrank shipped layers) and
  never edits the profile's `cordis.patch.yml` (verified by SHA-256).
- **Never add absolute machine paths, credentials, sessions, or private keys to tracked files.**
  `validate:repo` scans `.ts/.tsx/.js/.mjs/.cjs/.json/.yml/.yaml/.md/.svg/.toml/.ps1` — including this
  file and `docs/` — and rejects Windows drive paths, UNC paths, POSIX home paths, credential
  filenames, and private-key markers. It skips `.git`, `node_modules`, `.tmp`, `market`, `coverage`,
  and `openspec/` (deliberately, so specs are not scanned), but scans the vendored
  `packages/setup/node_modules`.
- **LF everywhere.** `.gitattributes` forces `eol=lf` because `gen:check` compares bytes; a CRLF
  checkout makes a clean tree fail. `.editorconfig`: UTF-8, LF, 2 spaces.
- **Markdown is checked and formatted by Biome** (the config does not exclude `*.md`), so docs and this
  file fail `pnpm lint` when unformatted. Run `pnpm lint:fix` after editing them; tables get padded.
- **NodeNext + strict TypeScript.** `verbatimModuleSyntax`, `noUnusedLocals/Parameters`,
  `noUncheckedIndexedAccess`. Scripts import with `.ts` extensions; emitted packages do not get
  `allowImportingTsExtensions`.
- **Keep `dsh.json` and `install.ps1` in sync** (versions and both bundle lists). `install.ps1` is
  standalone by design and duplicates this metadata; `validate:repo` compares them.
- **`pnpm validate` is not the full release check.** It does not catch stale committed build output;
  run `pnpm build && git diff --exit-code` and `pnpm gen:check` before committing.
- **`market/` is generated and gitignored**; never commit it and never point `--output` at a checked-in
  directory (the generator wipes its output). The market artifact must be exactly `index.json` +
  `icons/` with `.svg` files only.
- **Desktop profile is Electron-owned**: the CLI cannot boot or dump it. CI and the installer exercise
  use throwaway `ci` profiles from the `web` template; the installer's Desktop steps require the app
  to be closed (it restarts it in `finally`). **Never run a desktop-profile install from a shell the
  running app hosts** — it would kill the session and can leave the machine looking reset; use
  `pnpm dogfood` (copy of the profile) instead. `install.ps1` refuses that combination.
- **Do not combine** the setup bundle with an individual plugin bundle for the same plugin.
- On Windows the DSH CLI is usually a `.cmd` shim; the validation scripts spawn through a shell and
  expect `DSH_CLI` to be a command line (quote paths with spaces). Package-manager prompts fail fast
  because child stdin is not interactive.

## 14. Where to look

| Need                                                   | File                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Add/change a plugin, Client slots, HMR behavior        | [docs/plugins.md](docs/plugins.md), `packages/plugin-composer-clock/**`                                                      |
| How the setup patch/manifest/vendor tree are generated | [docs/setup-composition.md](docs/setup-composition.md), `scripts/lib/generate.ts`, `scripts/lib/fragments.ts`                |
| Installer behavior, options, manual install            | [docs/install.md](docs/install.md), `install.ps1`                                                                            |
| Owner-profile dogfood without touching the live state  | [docs/install.md](docs/install.md#dogfood-on-the-current-machine), `scripts/dogfood.ts`, `scripts/lib/dogfood.ts`            |
| Release, Pages, version accumulation, DSH bump         | [docs/releasing.md](docs/releasing.md), `.github/workflows/release.yml`                                                      |
| Requirements and invariants                            | `openspec/changes/add-portable-dsh-setup/{proposal,design}.md`, `specs/*/spec.md`                                            |
| Supported versions and installer bundle lists          | `dsh.json`, `install.ps1`                                                                                                    |
| Build wrapper and client loader contract               | `scripts/build.ts`                                                                                                           |
| Market schema/pinning/merge                            | `scripts/lib/market.ts`, `scripts/generate-market.ts`                                                                        |
| Validation assertions                                  | `scripts/validate-repo.ts`, `scripts/validate-composition.ts`, `scripts/validate-installer.ts`                               |
| DSH API types                                          | `node_modules/@deepseek-ai/cordis`, `node_modules/@deepseek-ai/dsh-client-ui-*` (pinned in `packages/plugin-*/package.json`) |

## 15. Troubleshooting

| Symptom                                                        | Cause / fix                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gen:check` reports `missing`/`changed`/`unexpected`           | Run `pnpm gen` and commit the regenerated files; `unexpected` means a stale vendored file or a plugin removed without regenerating                                                                                                                                                                                                                                                                                                 |
| `git diff --exit-code` after `pnpm build` shows changes        | Committed `lib/**`/`lib/client.js` is stale; build and commit it                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm test` fails with `run pnpm build before this test`       | The Client-bundle test reads `lib/client.js`; run `pnpm build` or use `pnpm check`                                                                                                                                                                                                                                                                                                                                                 |
| A new plugin emits nothing                                     | Add it to root `tsconfig.json` `references`; confirm it has `dsh.bundle` and a `cordis.fragment.yml`                                                                                                                                                                                                                                                                                                                               |
| `validate:repo`: machine path or secret                        | Remove the absolute path/credential from the tracked file; tests build such fixtures at runtime                                                                                                                                                                                                                                                                                                                                    |
| `validate:composition` fails on network/DSH CLI                | It defaults to `pnpm dlx @deepseek-ai/dsh@<dsh.json.runtime>`; set `DSH_CLI` to an installed CLI                                                                                                                                                                                                                                                                                                                                   |
| `validate:installer` skipped                                   | It runs only on Windows; use CI or a Windows machine                                                                                                                                                                                                                                                                                                                                                                               |
| Clean tree suddenly fails `gen:check`                          | Line endings: ensure LF (`.gitattributes`/`core.autocrlf`), regenerate if needed                                                                                                                                                                                                                                                                                                                                                   |
| Installer reports unsupported DSH                              | The gate is exact `supportedVersions`; update `dsh.json` + `install.ps1` together and release                                                                                                                                                                                                                                                                                                                                      |
| Dogfood fails with `This turn failed ENOENT` on a session file | ENOENT means the session directory was removed while the app still pointed at it (the Harness has no deletion API; a clean-home/reset step or external removal did it). Never run a live `desktop` install from a shell hosted by the app either: the installer's stop/restart kills the runner under the turn. Use `pnpm dogfood`; install live only from an external PowerShell; `install.ps1` now refuses the hosted-shell case |
| `pnpm dogfood` reports a changed owner row                     | The setup layer would override a profile-patch value; inspect the failing row in the composed dump and keep the owner value in `cordis.patch.yml`                                                                                                                                                                                                                                                                                  |
| Market artifact looks wrong                                    | Regenerate with `pnpm generate:market`; never edit `market/` or trust a pre-existing local copy                                                                                                                                                                                                                                                                                                                                    |
