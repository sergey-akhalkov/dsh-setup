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

The copies are generated from the plugin packages and never edited by hand. `pnpm gen:check` also
reports stale or extra files under `packages/setup/node_modules`, so a removed plugin cannot leave a
dead copy behind.

## Layer order

The generated setup patch is applied as one bundle layer:

1. one `insert` block containing every plugin row;
2. one override entry per owner default, each targeting a shipped row by id.

A profile's own `cordis.patch.yml` is applied after the bundle layer and still wins, so local
preferences remain the user's. A patch replaces the whole `config` object rather than merging it:
every default must restate the complete configuration its row needs.

## Changing defaults

1. Edit `packages/setup/defaults.yml`.
2. Run `pnpm gen` and commit the regenerated setup patch.
3. Run `pnpm check`. The defaults must only name shipped rows (plugin row ids use the reserved
   `dsh-setup-` prefix) and must not collide with each other.

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
