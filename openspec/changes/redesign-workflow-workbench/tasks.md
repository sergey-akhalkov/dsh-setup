# Tasks

The change is one Client package plus its tests, docs, and the generated-output tail. It is five
serial lanes with one owner because the lanes share the client files (the rail, canvas, and page
compose the same helpers) and the generated tail depends on the built client. Each heading names
the paths that lane owns.

## 1. Pure helpers and test harness — `packages/plugin-workflows/src/client/bricks.ts`, `a11y.ts`, `packages/plugin-workflows/test/client-harness.ts`

- [x] 1.1 Add `src/client/bricks.ts`: the trigger and step brick catalogs (engine value, label key, hint key, icon key), `BRICK_MIME`, and `brickPayload`/`parseBrickPayload`; verify malformed payloads parse to `undefined` with a new unit test.
- [x] 1.2 Add `inspectorPlacement(width)` and `WIDE_WIDTH` to `src/client/a11y.ts`, keeping `NARROW_WIDTH` and `defaultMode` unchanged; verify the 720/980 boundaries with a unit test.
- [x] 1.3 Extend `test/client-harness.ts` with the new primitive/icon stubs and the React Flow members the canvas will use (`Background`, `Controls`, `ReactFlowProvider`/instance access); verify the existing suite still loads.

## 2. Workbench surface — `packages/plugin-workflows/src/client/{design,rail,canvas,properties,styles,locale}.tsx`

- [x] 2.1 Rewrite the workbench CSS in `src/client/styles.ts`: three-column and drawer layout chains, page height contract, canvas dot grid/controls, brick tiles, compact library rows, inspector sections, and list-mode rules; verify no literal color in the `--xy-*` mapping and no `outline:` declaration.
- [x] 2.2 Rewrite `src/client/rail.tsx`: icon block bricks with friendly labels and drag payloads, trigger bricks as a single choice, compact workflow rows with the latest-run state, keeping `data-block`, `data-definition`, and the existing callbacks; verify the rail test.
- [x] 2.3 Extend `src/client/canvas.tsx`: dot-grid background, zoom/fit controls, icon node views with run decoration, labels only for `true`/`false`/`body`/`exit`, and the `onDropBrick` wrapper that converts the drop with `screenToFlowPosition`; verify the drop is ignored for a malformed payload.
- [x] 2.4 Restructure `src/client/properties.tsx` into the inspector with an identity header and `Identity / Behavior / Evidence / Connections / Danger` sections, keeping every `aria-label`; verify the no-selection definition view and the step/trigger views through the existing palette tests.
- [x] 2.5 Rewrite `src/client/design.tsx`: one primary `Save`, tags/dirty/version/run control, overflow menu for lifecycle actions, in-page delete confirmation, the three-pane/drawer workbench, and `addExecutor` with the drop position; remove the `Properties` disclosure and keep the guard, conflict, issues, and canvas fallback wiring.
- [x] 2.6 Add the brick/inspector/header/menu copy to `src/client/locale.ts`; verify the locale guard test.

## 3. Client test contract — `packages/plugin-workflows/test/{palette,client-view-interaction,client,canvas-budget}.test.ts`

- [x] 3.1 Update `test/palette.test.ts` and `test/client-view-interaction.test.ts` for the new rail, workbench, and drop behavior; verify the brick count, the open-first-workflow flow, and that selecting a node uses the inspector.
- [x] 3.2 Update `test/client.test.ts` for the header/menu/diagnostics surface and the no-editor state; verify the page still closes from its own control and the diagnostics disclosure stays closed by default.
- [x] 3.3 Update `test/canvas-budget.test.ts` with the newly measured bundle numbers and the recorded ceiling, only after `pnpm build`; verify the minified size stays under the documented budget.

## 4. Docs — `docs/{workflows,plugins,openspec-status}.md`

- [x] 4.1 Update `docs/workflows.md` and `docs/plugins.md`: the inspector is beside the canvas (drawer at medium width), the header primary action and overflow menu, click-or-drag bricks, the canvas chrome, and the unchanged list fallback; verify the documents name no removed control.
- [x] 4.2 Add the change entry and the owner visual-check follow-up to `docs/openspec-status.md`; verify the entry matches the implemented behavior.

## 5. Generated output and integration — `packages/plugin-workflows/lib/**`, `packages/setup/node_modules/@dsh-setup/plugin-workflows/**`

- [x] 5.1 Run `pnpm build` and commit the regenerated `lib/**`; verify `git diff` is only the built output.
- [x] 5.2 Run `pnpm gen` after the build, commit the regenerated setup vendored tree and patch, and verify `pnpm gen:check`.
- [x] 5.3 Run `pnpm check`, `pnpm validate:repo`, and `openspec validate redesign-workflow-workbench --strict`; fix failures before the change is proposed for archive.

## Workflow follow-up

- Run the task-scoped review for every checked task and commit the review records.
- Sync the delta spec into `openspec/specs/workflows/spec.md` and archive the change after the
  review/approval gate passes.
- The owner runs the live visual check after installing the build and reports any adjustment; that
  is the same follow-up 4.5 the previous change left open, not a claim this change makes.
