# Proposal

## Why

The workflows engine ships all four definitions (`change-intake`, `task-review`, `retro`, `verify`) and knows OpenSpec in code: the command allowlist, the `openspec/changes/<name>` extraction, the OpenSpec shadow trigger entries, and two definition-id special cases. A feature plugin cannot own the process it introduces, disabling a plugin leaves its workflows installed, and every product workflow change edits the engine. The owner wants the engine to be the runtime and the feature plugins to ship their ready workflows, without a second plugin system, a package scan, or a new dependency.

## What Changes

- Add a host registry service provided by the workflows plugin. An installed plugin registers its read-only definitions and shadow triggers after the service is available; the engine validates them with the existing closed schema, refuses a duplicate id or trigger naming both sources, and exposes the contributing plugin as the definition source.
- Load the engine's definitions from the registry plus the approved workspace-local overrides. The engine MUST NOT read plugin package files, scan package directories, or take a config path list.
- Make the trigger contract content-agnostic: replace the fixed `openspec new change <name>` and `openspec archive <name>` trigger allowlist with a validated command template that carries one `{name}` capture, normalize the documented `rtk` and `pnpm exec` prefixes, whitespace, and quoted names, reject compound commands, and support the same `{name}` capture in the `fs.change` path filter. The intake trigger and the file-change context no longer come from an OpenSpec allowlist or path regex; the archive gate and its OpenSpec archive/move parser remain the documented exception until the archive/receipt behavior moves with the remaining definitions.
- Move `change-intake` and the four OpenSpec shadow trigger entries to `@dsh-setup/plugin-openspec` as the pilot. The OpenSpec plugin registers them only when the workflows registry service is available and works unchanged without it. `change-intake` keeps its steps and its `spec-review` defer.
- Keep `task-review`, `retro`, and `verify` engine-shipped in this change. They are the remaining legacy-retirement exceptions and move to their behavior owners after `retire-legacy-gates` completes. The engine gains no new id-keyed behavior; a contributed definition runs from the generic schema.
- Move the editor/API source from `shipped | local` to `shipped | plugin + plugin name | local`, keep plugin definitions read-only, and keep the local copy and approval flow unchanged. The template list includes contributed definitions.
- Keep a local override from silently dropping the intake gate: an approved copy that shadows the installed intake without the gate declaration is refused with a reapproval remedy, the installed definition stays effective, and the user re-saves a copy from the new template.
- The parity report does not cover `change-intake` (its `spec-review` step is a retained gate), but the `task-review` path capture changes a covered template, so the report is regenerated after the build; the report path and release check are unchanged.
- Move the OpenSpec shadow triggers out of the engine catalog; the engine catalog keeps the generic entries and merges contributed ones.

Out of scope: moving `task-review`/`retro`/`verify`, deleting the legacy plugins, the `verify` command configuration, and a new trigger kind.

## Capabilities

### New Capabilities

- `openspec-workflows`: the OpenSpec plugin contributes its change-intake definition and OpenSpec shadow triggers when the workflows engine is installed, and remains fully functional without it.

### Modified Capabilities

- `workflows`: definitions load from a plugin registry plus approved local overrides; contributed definitions are read-only and carry a source; the trigger command and path captures are generic; the template list follows the registry; the remaining engine-shipped definitions are a tracked exception.
- `workflow-observability`: the shadow trigger catalog merges contributed triggers and the design page's catalog names their source.

## Impact

- Engine: `packages/plugin-workflows/src/host/{definitions,triggers,command-parse,approval-store,editor-api,api,index}.ts`, the host entry that provides the service, and the trigger catalog/definition assets.
- OpenSpec plugin: a host registration module, new `assets/workflows/` data, the package `files` list, and tests; the existing panel and skill behavior is unchanged.
- Setup generation: the vendored tree and the aggregated setup patch are regenerated (`pnpm gen`); `docs/workflows.md`, `docs/plugins.md`, and the workflow/observability docs are updated.
- The registry is a host-only Cordis service; no DSH version, dependency, bundle row, install script, or installer change. Local approvals, runs, gates, and receipts keep their current format.
