# Adding a plugin package

Every plugin lives in `packages/plugin-<name>` and is an ordinary DeepSeek Harness plugin package
that also declares a bundle patch, so it can be installed on its own or aggregated by the setup
bundle.

## Package layout

```
packages/plugin-<name>/
├─ package.json          # identity, dsh.bundle, dsh.client, engines.dsh, exports, peers
├─ cordis.fragment.yml   # the row ids this package mounts (source of truth)
├─ cordis.patch.yml      # GENERATED bundle patch; do not edit
├─ src/
│  ├─ host/index.ts      # Host plugin module (export name + apply)
│  └─ client/index.tsx   # optional Client half, compiled into lib/client.js
├─ test/                 # unit tests (Vitest)
├─ locale/en.json        # display metadata used by Plugins and the market
├─ icon.svg              # package icon referenced from package.json
├─ lib/                  # GENERATED host output and client bundle; committed
└─ tsconfig.json         # composite project for Host compilation
```

Generated files are committed because the package is installed from git and must not need an
install-time build. CI rebuilds and rejects a commit whose generated files do not match.

A configuration-only MCP adapter omits `src/`, `lib/`, `test/`, and `tsconfig.json`; see
[Configuration-only MCP adapter](#configuration-only-mcp-adapter).

## package.json contract

- `engines.dsh` must equal the range in `dsh.json`; the manifest validator rejects a mismatch.
- `dsh.bundle.patch` points at the generated bundle patch.
- `dsh.client` is present only for packages with a Client half:
  - `platform: "web"`,
  - `inject` lists Client packages whose slots or services the plugin uses,
  - `external` lists non-baseline runtime imports that must not be bundled.
- `exports["./client"]` must exist whenever `dsh.client` exists.
- `peerDependencies` pin the shared DSH packages (`@deepseek-ai/cordis`); the same versions appear
  in `devDependencies` for type checking.
- `files` must include `lib/`, both YAML files, `locale/`, and the icon. A package may also list exact
  asset paths (for example a vendored upstream prompt); the setup generator vendors those files the
  same way.
- No `prepare`, `preinstall`, `install`, or `postinstall` scripts: git installs cannot run them.

## Composition fragment

The fragment names the row ids the package mounts. A row mounts the package itself, or names the
approved Harness-provided adapter package, currently only `@deepseek-ai/dsh-mcp-client`. One fragment
may do both: an adapter bundle can also mount its own Host module. Generation rejects any other
foreign name, so a fragment cannot mount arbitrary package code.

```yaml
rows:
  - id: dsh-setup-<name>
```

An adapter row names the approved package instead of the owning one:

```yaml
rows:
  - id: dsh-setup-<name>
    name: "@deepseek-ai/dsh-mcp-client"
```

Rules:

- Row ids start with `dsh-setup-` and are globally unique across the repository.
- Unknown fragment or row fields are errors, not warnings.
- Optional `name` is allowed only with the approved adapter target; omit it for a row that mounts
  the package itself.
- Optional `config` on a row maps to the Loader row configuration.

`pnpm gen` writes both this package's `cordis.patch.yml` and the aggregated
`packages/setup/cordis.patch.yml` from every fragment. Run it after changing a fragment.

## Source conventions

Host half: export the plugin `name` and an `apply(ctx)` function. Keep the plugin object free of
side effects at module scope.

Client half: export `inject` (services it needs) and `apply(ctx)`; register into an existing slot
through `ctx.slots.inject(...)` and `ctx.slots.register(...)`. The Client build emits the
`window.__ModuleLoader__.load({ id, factory })` format the Harness expects. React and its runtime
come from the browser module table and are never bundled.

Verify the slot name and props against the running Harness (`cordis_inspect_query` with the Client
`Slots` provider) before relying on them, and route visible text through the Client locale service.

## MCP adapter bundle

A bundle that exposes an external MCP server mounts the Harness-provided `@deepseek-ai/dsh-mcp-client`
row, so the loader never imports the package for that row. In its smallest form the package contains
`package.json`, `cordis.fragment.yml`, `locale/en.json`, and `icon.svg` and nothing else handwritten:
the manifest omits `main`, `types`, `dsh.client`, and the `./client` export, lists only those four
files plus the generated patch in `files`, and keeps the usual `engines.dsh` and `dsh.bundle.patch`.
The generated `cordis.patch.yml` is the only build artifact.

A bundle may also ship a Host module that contributes guidance for the server it connects to. It then
keeps `main`, `types`, and a TypeScript project like any other plugin, and its fragment carries two
rows. The rows are independent, so the adapter keeps working when the guidance row is disabled.
[`packages/plugin-serena`](../packages/plugin-serena) and
[`packages/plugin-nuphus-mcp`](../packages/plugin-nuphus-mcp) have this shape: an adapter row naming
the approved package, and a guidance row mounting their own module.

The adapter's configuration is static and machine-independent: it names the executable and arguments,
not a project path. Project activation happens at runtime, and the shared MCP client instance serves
the whole profile, so switching the active project in one session changes it for the others. An
adapter that needs an external runtime documents it in its locale description and
[docs/install.md](install.md) instead of installing or vendoring it; the package must ship no
install-time script, and its configuration must keep the Harness bootable when the runtime is
unavailable.

To change the configuration or turn the adapter off, override its row in the profile's own
`cordis.patch.yml`; a patch replaces the whole `config` object, so restate every field the row needs.
Disabling it takes only the row id:

```yaml
- id: dsh-setup-serena
  disabled: true
```

Do not install both the setup bundle and the individual adapter bundle: the row id would mount twice.

## Adding a package

1. Copy the shape of `packages/plugin-composer-clock` and rename the package. For an MCP adapter
   without a Host module, keep only `package.json`, `cordis.fragment.yml`, `locale/en.json`, and
   `icon.svg` and skip the TypeScript project, build, and package-test steps; `pnpm gen` and the
   repository validation still apply.
2. Update `package.json` (`name`, `description`, `icon`, fragment, Client manifest) and
   `locale/en.json`.
3. Add the package to the root `tsconfig.json` references.
4. Run `pnpm gen` and commit the generated patches.
5. Run `pnpm check`; it type-checks, lints, builds, and tests the package.
6. Add a test under `test/` for each behavior the package promises.

## Development loop

Install the workspace package into a dedicated profile as a link, so the Harness loads the
checked-out files instead of a copy:

```sh
dsh --profile dev --from-default-profile web
dsh plugin --profile dev add link:<absolute path to packages/plugin-<name>>
pnpm build --watch
```

Observed behavior on the supported Harness version (0.2.1-rc.3, Web boot of a throwaway `dev`
profile with the plugin installed as a `link:`):

- **The Client half reloads without a page reload or Host restart.** Editing
  `src/client/index.tsx` makes `pnpm build --watch` rewrite `lib/client.js`; the client-HMR transport
  then reports the new bundle revision on `/plugins/events` (a `rebuilt` frame naming the package and
  its new revision). An open Web page swaps the rebuilt bundle and remounts the plugin with fresh
  state; the page is not reloaded.
- **The Host half applies on the next profile recomposition, not when its file is written.** Editing
  `src/host/index.ts` makes the TypeScript watch rewrite `lib/index.js`, but the running Host keeps
  the loaded module. Changing the profile's `cordis.patch.yml` recomposes the profile, replaces the
  linked package's module, and runs `apply` again; restarting the Harness also applies the new code.
- **The Desktop app uses neither of these paths for the Client half.** The `rebuilt` frame is
  delivered over the Web transport; a Desktop window picks up rebuilt Client bundles only after it is
  reopened or the app is restarted.

So the Client half is the half with true hot replacement; treat Host changes as requiring a profile
recomposition (or a restart) rather than assuming both halves reload.
