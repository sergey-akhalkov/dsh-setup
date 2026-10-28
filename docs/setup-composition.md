# Setup composition

The setup bundle is generated, not hand-written. Its inputs are the composition fragments of every
plugin package, the owner defaults, and the supported DSH version range.

## Inputs

| Input                              | Location                                | Owner                            |
| ---------------------------------- | --------------------------------------- | -------------------------------- |
| Plugin composition fragments       | `packages/plugin-*/cordis.fragment.yml` | each plugin package, hand-edited |
| Owner defaults                     | `packages/setup/defaults.yml`           | hand-edited                      |
| Supported DSH range                | `dsh.json`                              | hand-edited                      |
| Plugin package manifests and files | `packages/plugin-*/package.json`        | each plugin package              |

## Outputs

| Output                                            | Generated content                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/plugin-*/cordis.patch.yml`              | that plugin's bundle patch                                                         |
| `packages/setup/cordis.patch.yml`                 | every plugin row, then every owner default                                         |
| `packages/setup/package.json`                     | manifest with exact plugin dependencies, `bundleDependencies`, icon, and DSH range |
| `packages/setup/node_modules/@dsh-setup/plugin-*` | vendored copy of each plugin package's publishable files                           |

All of it is committed. `pnpm gen` rewrites it; `pnpm gen:check` fails when the working tree does
not match, and CI runs the check on every pull request.

## Why the setup bundle vendors its dependencies

The setup bundle must install as one marketplace action from a git spec. Two constraints rule out
declaring the plugins as ordinary git or path dependencies:

- pnpm rejects transitive dependencies resolved through exotic sources (`blockExoticSubdeps`), so
  a setup bundle depending on `git+https://...#<commit>` plugin packages fails on a default pnpm
  configuration.
- `file:../plugin-x` dependencies do not survive a git install: pnpm materializes only the package
  directory, so its monorepo siblings are absent.

`bundleDependencies` with physically present copies is the supported way to ship a package with its
dependencies: pnpm installs the bundled copies directly, no registry or second fetch is involved.
Each plugin therefore stays independently installable, while the setup bundle remains one
self-contained package.

A plugin may itself have runtime dependencies — the vendored Codex provider depends on
`@openai/codex` for its bundled binary. pnpm does not install a bundled dependency's own
dependencies, so the generator hoists every plugin's runtime `dependencies` into the setup
manifest's regular `dependencies` (outside `bundleDependencies`). The profile install then fetches
them, including the platform-specific Codex package, from the registry.

A linked checkout skips that profile install, so its vendored copy resolves a registry-only runtime
dependency from the checkout's own root install instead. The repository therefore declares
`@modelcontextprotocol/client` (the lazy MCP bundle's runtime dependency) in its root
`devDependencies`: `pnpm install` makes it resolvable from `packages/setup/node_modules`, and no
large third-party tree is committed.

The copies are generated from the plugin packages and never edited by hand. `pnpm gen:check` also
reports stale or extra files under `packages/setup/node_modules`, so a removed plugin cannot leave a
dead copy behind.

## Layer order

The generated setup patch is applied as one bundle layer:

1. one `insert` block containing every plugin row;
2. one override entry per owner default, targeting a shipped row or a row the setup inserts.

An entry may carry `config`, `disabled`, or both. A configuration override replaces the whole
`config` object (restate every key); a setup-row disable is baked into that row's insert entry,
because the Loader ignores a `disabled` override that targets a row the same patch inserts. A
profile's own `cordis.patch.yml` is applied after the bundle layer and still wins, so local
preferences remain the user's.

## Shipping a row disabled

A plugin fragment may mark a row `disabled: true`. Generation carries the flag into the plugin patch
and the aggregated setup patch, so the row stays mounted and inactive, and a profile patch enables it
with `disabled: false` (a row override sets only that flag and does not restate the config). Use this
when a plugin stays installable but must not pay a per-request cost by default; the plugin
documentation and market card must state the default and the override.

The setup currently ships no disabled row: the Nuphus and Serena guidance rows are enabled, and both
servers come from the lazy row. A setup default may also disable a setup-contributed row; the
generator folds the flag into the row's insert entry. The shipped lazy default configures both
servers:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers:
      - serverName: nuphus-mcp
        transport: stdio
        command: nuphus-mcp
        args:
          - --confirm-write
        toolCallTimeoutMs: 120000
      - serverName: serena
        transport: stdio
        command: uvx
        args:
          - --from
          - serena-agent==1.7.0
          - serena
          - start-mcp-server
          - --context=vscode
          - --enable-web-dashboard=false
          - --enable-gui-log-window=false
        toolCallTimeoutMs: 120000
```

A profile that wants a static adapter instead inserts its own `@deepseek-ai/dsh-mcp-client` row and
removes the server from the lazy `servers` list; the lazy one-home guard fails the lazy call while
both homes exist. The setup never reads or rewrites the profile patch.

## Changing defaults

1. Edit `packages/setup/defaults.yml`.
2. Run `pnpm gen` and commit the regenerated setup patch.
3. Run `pnpm check`. An entry may target a shipped row or a row the setup inserts, and may carry
   `config`, `disabled`, or both; a `dsh-setup-*` id must name an inserted row, and ids are unique.

Defaults describe the baseline every machine receives. Machine-specific values — credentials, proxy
settings, a personal model list — stay in the profile's own patch and are never committed.

## Adding or removing a plugin

Adding a package: create `packages/plugin-<name>` with a fragment, run `pnpm gen`, commit the
generated plugin patch, setup patch, setup manifest, and vendored copy.

Removing a package: delete its directory, run `pnpm gen`, and confirm `pnpm gen:check` reports no
unexpected files under `packages/setup/node_modules`.

## Versioning

`pnpm gen` preserves the version currently recorded in `packages/setup/package.json`. Version bumps
are a release step (`docs/releasing.md`): all plugin packages and the setup bundle move together so
one tag identifies one coherent set.
