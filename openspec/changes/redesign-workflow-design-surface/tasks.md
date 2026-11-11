# Tasks

The change is one Host/Client package with shared editor, API, and canvas files plus a serial generated-output tail; it is a single lane. Tests and docs land with the group that owns the behavior.

## 1. Definition description and API

- [x] 1.1 Add the optional bounded `description` to the definition schema/validator, the `Definition` type, the API summary/document, and the editor list entry; verify with `pnpm exec vitest run packages/plugin-workflows/test/definitions.test.ts packages/plugin-workflows/test/editor-api.test.ts`.
- [x] 1.2 Add a description to the four installed definitions under `packages/plugin-workflows/assets/definitions/`, rebuild the validator first with `pnpm build` (the parity script imports `lib`), then regenerate the parity report with `pnpm workflows:parity`; verify `pnpm workflows:parity --check` passes and the definitions still validate.
- [x] 1.3 Add the workflow-level description field to the inspector and the editor save payload (empty input sends `undefined`); document the field in `docs/workflows.md`; verify a new editor test and `pnpm exec vitest run packages/plugin-workflows/test/editor.test.ts`.
- [x] 1.4 Add the description locale keys and update the locale guard test; verify `pnpm exec vitest run packages/plugin-workflows/test/locale-guard.test.ts`.

## 2. Workbench surface

- [x] 2.1 Add the left rail with the `Workflows` list and the `Blocks` palette, open the first installed workflow by default (blank workbench when none is installed), and move `New`/templates/drafts into the rail or a `More` menu; verify with a client-harness test that the page opens on the canvas and the rail lists the definitions.
- [x] 2.2 Remove `DefinitionsTable` (the rail and the workflow page replace it) and move `TriggersTable` and `ReceiptsList` into a closed-by-default `Diagnostics` disclosure; verify the default surface has no read-only table and the disclosure renders the two retained sections.
- [x] 2.3 Add trigger blocks (patch `trigger.kind`) and executor-aware add-step that reuses `normalizeExecutor`; for a tool block set the `tool` spec, a declaration evidence with `nonCritical: true`, and append the tool name to `settings.allowTools`; verify every executor, including a tool block added to a blank definition, passes the host validator and the save path.
- [x] 2.4 Keep the narrow-width list surface and the dirty-document guard when switching workflows; verify the existing fallback test and a guard test that a declined confirmation keeps the current document.
- [x] 2.5 Document the rail, blocks, diagnostics disclosure, and default selection in `docs/workflows.md` and `docs/plugins.md`; verify the documented UI matches the rendered labels.

## 3. Read-only workflow canvas

- [x] 3.1 Add a `readOnly` mode to `DesignCanvas` (no drag, connect, or layout write; selection allowed) and render it on the session workflow page with the deterministic auto-layout, a run selector for the overlay (latest by default, independent of the run-detail navigation), and the ordered step table as the fallback; selecting an older run changes only the overlay; verify with client tests and assert that opening the page performs no definition or layout write.
- [x] 3.2 Document the read-only canvas, the overlay selector, and the table fallback in `docs/workflows.md`; verify the docs name the fallback and the older-run behavior.

## 4. Generated output and integration checks

- [x] 4.1 Run `pnpm build` and commit the regenerated `lib/**`; verify the built output is current.
- [x] 4.2 Run `pnpm gen` after the build, commit the regenerated setup vendored tree and patch, and verify `pnpm gen:check`.
- [x] 4.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm workflows:parity --check`; verify all pass.
- [x] 4.4 Run `pnpm validate` and record the result; fix any failure before the change is proposed for archive.
- [ ] 4.5 Verify the workbench at wide and narrow sidebar widths in a live session and adjust the rail, canvas, and inspector layout if needed.

## Workflow follow-up

- Run the task-scoped review for every checked task and commit the review records.
- Sync the delta specs into `openspec/specs/` and archive the change after the review/approval gate passes.
- Verify the archived change and the updated docs.
