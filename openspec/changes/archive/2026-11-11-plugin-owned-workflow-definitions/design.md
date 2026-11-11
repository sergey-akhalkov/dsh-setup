# Design

## Context

See `proposal.md` — Why. The engine currently calls `loadShippedDefinitions()` at plugin load, merges the shipped set with the approved local overrides in `loadApprovedDefinitions()`, and serves the same set through the editor routes and the definitions API. The four definitions and the OpenSpec shadow trigger entries live in `packages/plugin-workflows/assets/`. The trigger contract is a fixed `TriggerCommand` union (`openspec new change <name>`, `openspec archive <name>`); `definitionEventsOf` normalizes a pre-execute event with `parseOpenspecCommand` and extracts the OpenSpec change name from an `openspec/changes/` path with a regex. The pre-execute listener applies the intake gate only when `definition.id === 'change-intake'`, and the archive gate parses the OpenSpec archive/move commands. The editor source is `shipped | local`.

The platform's integration seam is a Cordis service: feature plugins already provide `delegationRulesStatus`, `goalContinuityStatus`, and `verificationGateStatus`, and the engine reads them with `ctx.get`. The OpenSpec plugin has a host half with `inject = ['skills']` and uses `ctx.inject([...], cb)` for optional services; it can wait for the registry without becoming inert.

## Goals / Non-Goals

**Goals:**

- A small host registry service through which an installed plugin contributes its read-only definitions and shadow triggers, with no package scan and no config path list.
- A content-agnostic trigger contract for the moved `change-intake`: a command template and a path glob with one `{name}` capture.
- The engine runs a contributed definition from the generic schema, with the intake gate selected by a definition declaration rather than by the definition id.
- The OpenSpec plugin owns the `change-intake` asset and the four OpenSpec shadow trigger entries, and works unchanged without the engine.
- The editor/API distinguish `shipped`, `plugin:<name>`, and `local`; a plugin definition is read-only and a local copy shadows it.
- The remaining engine-shipped `task-review`, `retro`, and `verify` stay functionally unchanged and become the documented retirement exceptions.

**Non-Goals:**

- Moving `task-review`, `retro`, or `verify`; that follows `retire-legacy-gates`.
- Moving the archive gate and its OpenSpec archive/move parser; it stays the documented engine exception until the archive/receipt behavior moves.
- Generalizing the `task-review` per-checked-task run policy or the `retro` checkpoint context; both remain id-keyed temporary exceptions.
- A new trigger kind, a new plugin package, a new bundle row, or a dependency change.

## Decisions

### One registry service, not a package scan

The engine provides a host service (working name `workflowsDefinitions`) with:

- `register(contribution): () => void`, where a contribution is `{ source, definitions, triggers }`;
- the contributing plugin's package name as `source`;
- a disposer that removes the contribution when the plugin is disposed;
- validation of every definition and trigger with the same closed schema and the same trigger validator the engine uses for its own assets;
- refusal of a duplicate definition id or trigger id, naming both sources;
- a revision counter the engine uses to invalidate per-workspace definition loads.

The feature plugin waits for the service with `ctx.inject(['workflowsDefinitions'], cb)` and never adds it to `inject`; without the service the plugin registers nothing and keeps working. The engine seeds the same registry with its own remaining shipped definitions (`task-review`, `retro`, `verify`) as the `shipped` source, so every read path has one merged catalog; `loadShippedDefinitions` remains only the engine-internal asset loader that seeds that registration. The engine reads the registry at definition load time and on every editor/API read; it does not scan `node_modules`, `packages/`, or a profile path list. Local approved definitions still shadow a contributed or shipped definition by id.

Alternative: scan the installed packages for a conventional `assets/workflows/` directory. Rejected — it makes the engine know the install layout, bypasses explicit lifecycle, and gives no plugin a place to report a validation error.

Alternative: a profile config list of definition paths. Rejected — every plugin install would edit the profile and the engine would trust arbitrary paths.

The registry is static after plugin load in the normal case; the revision check covers a plugin that registers after a workspace's definitions were first read. An open workspace-scoped load is re-run when the revision changes.

### Trigger captures replace the product allowlist

`match.command` becomes a validated string template with at most one `{name}` placeholder. Before matching, the engine normalizes the documented `rtk` and `pnpm exec` invocation prefixes, whitespace, and one symmetric quote pair around the name, and rejects a compound command; it then matches the literal prefix/suffix and captures the unquoted, validated name. `match.path` keeps its glob syntax and accepts the same `{name}` segment; the engine captures the segment value. The observed `DefinitionEvent` carries the raw `command` and `path`; `definitionEventsOf` no longer normalizes a create command or extracts an `openspec/changes/` name. The matched capture is passed to the run start and is the `name` used by the `{name}` interpolation and the `name` dedupe policy. A trigger without a capture behaves exactly as before.

The `change-intake` definition's trigger becomes `{ "tool": "shell", "command": "openspec new change {name}" }`; the `task-review` definition's path becomes `openspec/changes/{name}/tasks.md`. The four OpenSpec shadow catalog entries move with the plugin; the engine catalog keeps the generic entries.

Alternative: keep the `TriggerCommand` union and register command names. Rejected — it keeps the product vocabulary in the engine and adds an indirection for a single captured token.

### The intake gate is selected by a declaration, not by the definition id

The pre-execute intake gate needs to know that a matched definition is the change-intake policy and use the captured name. Add an optional closed `settings.gate: 'intake'` to the definition schema and set it on `change-intake`. The pre-execute listener evaluates the loaded definitions, finds the matched `tool.pre-execute` definition whose settings declare the intake gate, and runs the existing `evaluateIntakeGate` and run-creation flow with the captured name. The gate evaluator's running, resumable, and completed-run lookups SHALL use the selected definition id instead of the hard-coded `change-intake`; the `definition.id === 'change-intake'` branch and the evaluator's fixed-id checks are removed. The behavior (refuse the create command until the intake run is complete, the concurrent-run guard, the run limit, the host-key requirement) is unchanged. A locally approved definition may declare the same gate; it then gets the same primitive without engine changes.

The archive gate is not moved: it is triggered by a shell archive/move rather than by a definition trigger, and it owns the receipt/archive policy. `parseArchiveCommand` and its OpenSpec path knowledge stay; the docs and the design name this as the remaining engine exception. The create-command normalization moves from the event path into the generic command matcher; the archive parser keeps the shared prefix/unquote helpers for the `openspec archive` form.

Alternative: a plugin-supplied gate function. Rejected for this change — it would let a plugin run code in the pre-execute path and widen the trust boundary; a closed enum declaration keeps the gate primitive engine-owned.

### A local override cannot silently drop the intake gate

An approved local copy of the current `change-intake` contains `command: "openspec new change <name>"` and no `settings.gate`; after the move it would shadow the contributed definition and silently disable intake enforcement. The loader SHALL compare a local override with the installed definition it shadows and refuse the override when it removes or weakens a declared pre-execute gate, naming the reapproval remedy; the installed definition remains effective. The user re-saves a copy from the new template through the editor's local-copy/approval path, and the gate applies again. Both the `<name>` token and the missing gate are named in the remedy.

Alternative: auto-migrate and re-sign the old file. Rejected — the approval is bound to the exact bytes and a silent rewrite would forge an approval the user did not give.

### Move the asset and the catalog entries to the OpenSpec plugin

`plugin-openspec` gets `assets/workflows/change-intake.json` and `assets/workflows/triggers.json` (the four OpenSpec shadow entries). Its host half validates the JSON at registration and calls the registry service; a malformed asset fails the plugin load with the file, the definition, and the field. The plugin adds `assets/workflows/*.json` to its `files`, and the workflows package removes `assets/definitions/change-intake.json` and the OpenSpec entries from `assets/triggers/catalog.json`. The source is `plugin:@dsh-setup/plugin-openspec`; the engine's remaining definitions are `shipped`; a local override is `local`.

The parity report does not cover `change-intake` (its `spec-review` step is a retained gate), so the move itself leaves the report untouched. The `task-review` path capture changes a covered template, though, so the serial tail regenerates the report after the build and before the vendored tree. The report path and the release check are unchanged.

Alternative: a separate process-pack package. Rejected for this change — it adds a package and a bundle row, while the OpenSpec plugin is already the behavior owner for the intake experience. The remaining three definitions stay engine-shipped until the retirement change decides their owner.

### Source, editor, and template list

`DefinitionSource`/`EditorDefinitionEntry.source` becomes `shipped | plugin | local` with an optional `plugin` name. The API summary and document expose the source; the session workflow page and the design rail can show it. `listEditorDefinitions`, `readEditorDefinitionDocument`, the template list, and `loadApprovedDefinitions` read the registry instead of `loadShippedDefinitions`. A shipped or plugin definition is read-only; the editor creates a local copy on edit; a local copy shadows the source by id and keeps the existing revision/approval rules. The remaining `task-review`, `retro`, and `verify` keep loading exactly as today.

### Tests, docs, and generated output

- Engine tests: a registered definition/trigger lists and runs; a duplicate id is refused; a plugin disposed removes its entries; the engine loads without a contributor; a malformed contribution is refused; the command/path captures including `rtk` and `pnpm exec` prefixes, a quoted name, and a compound command, plus a gate-level refusal for the prefixed forms; the intake gate from a declaration and its running/resumable/completed lookups under another id; an old approved intake override is refused while the installed gate still enforces, then a reapproved copy loads; the archive gate unchanged; the definition source.
- OpenSpec plugin tests: the asset validates; the registration is skipped without the service; the plugin's panel/skills still work; the source is the plugin.
- Editor/API tests: `shipped | plugin | local`; a plugin definition is read-only and copied on edit; a local override shadows.
- Docs: `docs/workflows.md` (registry, source, captures, the archive-gate exception, the reapproval remedy), `docs/plugins.md` (OpenSpec contribution).
- `pnpm build` regenerates `lib/**`; the `task-review` path capture changes a parity-covered template, so `pnpm workflows:parity` regenerates the report and `--check` passes before `pnpm gen` vendors the tree; `pnpm validate` runs the repository gate.

## Risks / Trade-offs

- **The intake-gate refactor changes a security-sensitive path** → Keep the existing `evaluateIntakeGate` behavior and tests; add a regression test that a non-`change-intake` definition with the declaration gets the gate and one without it does not. The archive gate stays untouched.
- **The archive gate still knows OpenSpec** → Documented as the remaining exception; it moves with the archive/receipt behavior in the retirement follow-up. The pilot does not claim a fully content-free engine.
- **Registration ordering and the per-workspace cache** → The registry revision invalidates the cached definition load; the engine re-reads the registry for editor/API requests. The normal load order is engine service first, contributor second via `ctx.inject`.
- **Moving the asset changes package contents and the vendored tree** → `pnpm gen` must run after the build and be committed; `pnpm gen:check` and CI catch drift. The `task-review` path capture changes its parity hash, so the report is regenerated in the serial tail before `pnpm gen`.
- **Old approved overrides** → An approved local copy without the gate declaration would shadow the installed intake. The loader refuses a shadowing override that drops a gate and keeps the installed definition effective; the user re-saves from the new template. Tests cover the refusal and the reapproval.
- **A plugin definition that defers to a legacy gate is refused at load when the gate is disabled** → The existing ownership resolution runs after registration; the OpenSpec plugin must not treat an engine refusal as its own load failure. The tests cover the refusal path.
- **Duplicate ids across plugins** → The registry refuses the later contribution naming both sources; the docs state that an id is global.
- **The remaining id-keyed policies (`task-review`, `retro`)** → They stay engine-shipped and are named as exceptions in the spec/docs; moving them is the `retire-legacy-gates` follow-up.

## Migration Plan

Apply this change after `redesign-workflow-design-surface`: that change adds the description to the four installed definitions, and this change moves the described `change-intake` asset. Applying this change first is possible but the description task must then target the OpenSpec asset instead.

1. Add the registry service, the captures, the command normalization, the gate declaration, and the gate-preserving override check to the engine; keep the current assets loading until the registry and the moved asset are in place.
2. Add the OpenSpec plugin registration and assets; switch the engine to the registry; remove the moved asset and catalog entries; update the source types.
3. Build, regenerate the parity report for the `task-review` template change, run `--check`, then regenerate the setup vendored tree, and run the full gate.
4. Handle existing approved intake overrides: the loader refuses an override that drops the gate, the installed definition stays effective, and the user re-saves a copy from the new template; no silent approval rewrite.
5. Rollback: restore the removed asset and catalog entries to the workflows package, remove the OpenSpec registration, and revert the source types; no run or approval data needs migration.
