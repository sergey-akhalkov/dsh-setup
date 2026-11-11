# Tasks

## 1. Engine registry, captures, and intake gate (lane 1, owns `packages/plugin-workflows/src/**`, `packages/plugin-workflows/test/**`, `packages/plugin-workflows/assets/**`, `docs/workflows.md`)

- [x] 1.1 Add the `workflowsDefinitions` host service (register, source, disposer, revision, closed-schema validation, duplicate id refusal) to the engine host and provide it before the feature plugins load; verify with a new host test and `pnpm exec vitest run packages/plugin-workflows/test/definitions.test.ts`.
- [x] 1.2 Seed the registry with the engine's remaining shipped definitions and switch the workspace definition load, the editor list/document, the template list, and the definitions API to the merged registry plus approved local overrides, invalidating the cached workspace load on a registry revision; verify with `editor-api.test.ts`, `definitions.test.ts`, and a new registry test.
- [x] 1.3 Add `shipped | plugin | local` with the plugin name to the editor/API source and show it in the design rail and the session workflow page; verify with the client tests and the API test.
- [x] 1.4 Add a test that a disposed contribution removes its definitions and triggers while the runs it recorded stay readable; verify with the registry lifecycle test.
- [x] 1.5 Replace the `TriggerCommand` allowlist with a validated `match.command` template carrying one `{name}`; normalize the documented `rtk` and `pnpm exec` prefixes, whitespace, and one quoted name, reject a compound command, carry the raw command in the observed event, capture the name in the matcher, and pass it to the run start and the `name` dedupe key; verify with the trigger tests and `command-parse.test.ts`, including prefixed, quoted, and compound commands, and a gate-level test that `rtk openspec new change auth` and `pnpm exec openspec new change auth` are refused without a completed run.
- [x] 1.6 Support the `{name}` capture in the `fs.change` `match.path` glob, remove the `openspec/changes/` regex from `definitionEventsOf`, and update the engine's `task-review` path to `openspec/changes/{name}/tasks.md`; verify with the trigger tests and the tasks/intake tests, and note that the task-review template hash changes for the parity report.
- [x] 1.7 Move the create-command normalization into the generic matcher and keep the archive gate's `parseArchiveCommand`/`parseOpenspecCommand` behavior as the documented exception; verify the archive gate tests still pass.
- [x] 1.8 Document the command/path captures, the command normalization, the archive-gate exception, and the reapproval remedy in `docs/workflows.md`; verify the documented examples match the validator.
- [x] 1.9 Add the optional closed `settings.gate: 'intake'` to the definition schema, set it on `change-intake`, select the intake gate from the matched definition's declaration instead of `definition.id === 'change-intake'`, and make the gate's running, resumable, and completed-run lookups use the selected definition id; preserve the concurrent-run, run-limit, and host-key behavior; verify with `intake.test.ts` and `gates.test.ts`.
- [x] 1.10 Add a regression test that a definition with another id declares the intake gate, starts an intake run, and the repeated, resumed, and completed calls find that run by the selected id without a duplicate or an adoption redirect; verify with the new gate test.
- [x] 1.11 Add the gate-preserving override check: a local definition that shadows an installed gated definition and drops the gate is refused with the reapproval remedy while the installed definition stays effective; verify an old approved intake override is refused, the installed gate still refuses the command, and a reapproved copy loads.

## 2. OpenSpec plugin contribution (lane 2, owns `packages/plugin-openspec/src/**`, `packages/plugin-openspec/test/**`, `packages/plugin-openspec/assets/workflows/**`, `packages/plugin-openspec/package.json`, `docs/plugins.md`)

- [x] 2.1 Add the `change-intake` asset and the four OpenSpec shadow trigger entries under the plugin's `assets/workflows/` (copied from the engine for the pilot), add the host registration through `ctx.inject(['workflowsDefinitions'], ...)`, validate the assets at registration, and skip registration when the service is absent; verify with a new plugin test and the existing panel/skill tests.
- [x] 2.2 Document the OpenSpec contribution, the optional engine dependency, and the plugin source in `docs/plugins.md`; verify the documented examples match the registered assets.

## 3. Serial tail: content switch, generated output, and full gate (serial, owns `packages/plugin-workflows/assets/definitions/**`, `packages/plugin-workflows/assets/triggers/**`, `packages/plugin-workflows/package.json`, `packages/plugin-openspec/package.json`, `packages/plugin-workflows/lib/**`, `packages/plugin-openspec/lib/**`, `packages/setup/**`, `packages/plugin-workflows/cordis.patch.yml`, `packages/plugin-openspec/cordis.patch.yml`)

- [x] 3.1 Remove the copied `change-intake` definition and OpenSpec catalog entries from the engine assets, update both packages' `files` lists, and verify the engine no longer ships them while the plugin registers the same ids.
- [x] 3.2 Run `pnpm build`, commit the regenerated `lib/**`, regenerate the parity report with `pnpm workflows:parity` because the task-review path changed its template hash, run `pnpm workflows:parity --check`, and commit the report.
- [x] 3.3 Run `pnpm gen` after the build and parity report, commit the regenerated setup vendored tree and patch, and verify `pnpm gen:check`.
- [x] 3.4 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm workflows:parity --check`; verify all pass.
- [x] 3.5 Run `pnpm validate` and record the result; fix any failure before the change is proposed for archive.

## Workflow follow-up

- After `retire-legacy-gates` completes, move `task-review`, `retro`, and `verify` to their behavior owners and remove the remaining id-keyed engine policies.
- Move the archive gate and its OpenSpec archive/move parser once the archive/receipt behavior has a generic declaration.
- Run the task-scoped review for every checked task, sync the deltas, and archive the change after the review/approval gate passes.

## 4. Post-release archive follow-up

- [x] 4.1 Confirm that `add-change-card-actions` is released and installed; once this readiness check is checked, the change is complete again and the OpenSpec panel's Archive button can archive it (the click authorizes the adoption receipt and runs the archive gate).
- After the archive, record the archive and the 0.31.8 release in `docs/openspec-status.md`. This is a follow-up instruction, not a counted task, so it cannot block the Archive button.


