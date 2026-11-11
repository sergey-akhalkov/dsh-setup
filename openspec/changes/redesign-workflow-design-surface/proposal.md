# Proposal

## Why

The `Workflow design` page opens on a read-only card list and always renders the definitions, trigger catalog, and receipts tables below the editor; the canvas appears only after a definition is opened, and the narrow sidebar hides it behind the list surface. The owner reviewed the page on 2026-11-11 and rejected it as a not usable n8n-like workbench: the canvas and the building blocks must be visible by default, existing workflows must be viewable at a glance, and a definition must carry a human description. The session workflow page also shows only a step table, so the shape of a running process cannot be understood visually.

## What Changes

- Turn the design page into a workbench: a left rail with the installed workflow list (name, description, trigger, step count, source, last run) and the building blocks (trigger kinds and step executors), a center canvas, and an inspector. The page opens on the canvas of the selected or last opened workflow and shows a blank canvas with the rail when none is selected.
- Make the block palette a persistent left rail in wide mode (a menu in the narrow list surface). Choosing a trigger block sets the workflow trigger; choosing a step block adds a step.
- Remove the read-only definitions table (the rail and the workflow page replace it) and move the trigger catalog and the receipts into a secondary `Diagnostics` disclosure, so the page no longer duplicates the workflow list as a table.
- Add an optional bounded `description` to the workflow definition schema. The editor edits it, and the workflow list, inspector, and session workflow page show it.
- Render the session workflow page's ordered steps as the same node canvas in read-only mode with the selected run overlay; keep the ordered step table as the accessible fallback.
- Keep the right-sidebar entry (guide card), the narrow-width list fallback, and the existing canvas. No new page, tab, diagram library, or host command.
- Add descriptions to the shipped definitions and regenerate the release-bound parity report if a shipped definition file changes.

Out of scope: moving definitions to the owning plugins, new trigger kinds, sub-workflow nesting, and replacing the right sidebar with a full-width page.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: the workbench layout, default canvas, persistent block rail, definition-description field, and the design-page entry behavior; the editor and visual-canvas requirements change.
- `workflow-observability`: the design page's sections move to diagnostics, and the session workflow page gains a read-only canvas of the definition with the run overlay while keeping the ordered-step table as the fallback.

## Impact

- Client: `packages/plugin-workflows/src/client/{design-page,design,canvas,palette,properties,list,overview,view,panel,locale,index}.tsx`, new rail/inspector modules, and their tests.
- Host/API: `packages/plugin-workflows/src/host/{definitions,api,editor-api}.ts` for the optional `description` and the editor/API document; no route is removed and no response field is dropped.
- Assets: the four shipped definitions gain descriptions; `packages/plugin-workflows/assets/parity/retire-legacy-gates.json` is regenerated when a covered template hash changes.
- Docs and locale: `docs/workflows.md`, `docs/plugins.md`, the locale dictionary, and its guard test.
- No dependency, DSH version, bundle row, or installer change; the engine, approvals, runs, and gates are unchanged.
