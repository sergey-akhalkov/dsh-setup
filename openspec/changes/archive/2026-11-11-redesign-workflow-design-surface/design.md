# Design

## Context

See `proposal.md` — Why. The current page is the right-sidebar `Workflow design` tab. `DesignPageBody` measures its own width and always renders `DesignMode` first and then the read-only `DefinitionsTable`, `TriggersTable`, and `ReceiptsList`. `DesignMode` owns the editor state machine; when no document is open it renders a plain library list, and the canvas only appears after `Open definition` or `New definition`. Below the 720px narrow-width threshold it defaults to the list surface. The canvas is React Flow; `graph.ts` projects a definition into nodes and edges; `overlay.ts` maps a run onto the same graph; the layout sidecar is editor-only. The definition validator is a closed schema in `src/host/definitions.ts`; the API summary and the editor entries do not carry a description today.

The session `Workflows` view is a conversation tab with a trigger-grouped overview and a per-workflow page. That page shows facts, a step table, runs, and evaluation history, but no graph and no description. The user chose to keep the workbench in the right sidebar (option a), not a full-width conversation tab.

## Goals / Non-Goals

**Goals:**

- The design page opens as a workbench: workflow rail and blocks on the left, canvas in the center, inspector beside it; the canvas is the default surface when a workflow is available.
- Existing workflows are inspectable at a glance: name, description, trigger, step count, source, last run in the rail; description and steps on the session workflow page.
- A read-only canvas of a definition with a selected-run overlay (latest by default) is available where runs are inspected.
- The same editor state machine, host save path, approval store, layout sidecar, and narrow list fallback are reused.
- A definition carries an optional bounded description.

**Non-Goals:**

- Moving definitions to feature plugins (separate change).
- A full-width page, a second tab, a new diagram component, sub-workflow nodes, or new trigger kinds.
- Persisting the last opened workflow; the page opens the selected workflow or the first installed one.
- Changing runs, gates, approvals, receipts, or the API's existing fields.

## Decisions

### Keep the right-sidebar page and the existing React Flow canvas

The user chose option (a). The page already measures its width and has a tested list fallback; a new full-width surface would add a second entry point and reverse the 2026-11-10 decision to keep authoring out of the session view. The workbench is a presentation change inside `design.tsx` / `design-page.tsx`, not a new page. The alternative — a full-width conversation tab — is the documented fallback if the pane proves too narrow in daily use.

### Workbench layout: rail, canvas, inspector, diagnostics

- The left rail has two sections: `Workflows` (the editor's installed list, each row with name, description, trigger, step count, source, and the last run when the API supplies it) and `Blocks` (the trigger kinds and step executors).
- The center is the existing `DesignCanvas`; the right or bottom inspector is the existing `PropertyPanel`.
- The read-only definitions table is removed because the rail and the workflow page already show the definitions. `TriggersTable` and `ReceiptsList` move into a `Diagnostics` disclosure (the existing `DisclosureRow` primitive), closed by default; the page no longer renders them on its default surface.
- The `New definition`, template, draft, reload, and delete controls move into the rail or a `More` menu; the top bar keeps the page title, dirty state, save, canvas/list toggle, and run overlay selector. The redundant `Open definition` select is removed because the rail is the picker.
- When the page opens and no workflow has been selected, it opens the first installed workflow (the editor list is already ordered: shipped first, then local by id). With no installed workflows it shows the rail and a start affordance on an empty canvas-sized surface; `New definition` starts a blank document. The page does not persist a last-opened id because no verified per-page storage seam exists; this is a follow-up if needed.
- Choosing a workflow while the document is dirty uses the existing `guard` / `leaveEditor` confirmation, so switching never silently discards edits.
- The narrow-width list surface keeps the existing list editor and the `PaletteMenu` menu; the rail and inspector collapse there.

### Blocks are engine vocabulary, not workflows

The block palette lists the deterministic trigger kinds (`turn.stopping`, `tool.pre-execute`, `tool.result`, `fs.change`, `subagent.end`, `review.record`) and the six executors (`main`, `tool`, `subagent`, `human`, `branch`, `loop`). A trigger block patches `trigger.kind` and selects the trigger node; an executor block adds a step with that executor. The palette action reuses `addStep` and `normalizeExecutor` so a new node carries the required executor fields. A tool block additionally needs a saveable shape: it sets the `tool` spec, a declaration evidence with `nonCritical: true`, and appends the tool name to `settings.allowTools` (the host rejects a tool step whose name is not allowlisted or whose evidence is missing). Whole workflows are not nodes; they are selected from the rail. A host-exposed block catalog is intentionally not added: the vocabulary is engine-owned and stable, and a contributed trigger catalog is the separate registry change.

Alternative: make the palette a host endpoint. Rejected for now — it adds an API for a fixed list and the plugin-contributed blocks are not in scope.

### Description is definition data

Add an optional `description?: string` to the definition interface and the closed key set, validated as a non-empty string of at most 500 characters when present. It is part of the definition document and the editor's save payload; the host API summary, the editor list entry, and the document route include it. The editor adds a workflow-level name/description field to the inspector. Empty input is sent as `undefined`, so a definition without a description stays byte-identical.

Add a description to the four shipped definitions and regenerate `assets/parity/retire-legacy-gates.json`, because the parity report covers the template hashes of the shipped definitions and a content edit changes those hashes. This is a data-only edit; the parity replay is re-run, not changed.

Alternative: a sidecar metadata file. Rejected — it creates a second source for one displayed string and complicates the editor, the API, and the parity report.

### Read-only canvas on the session workflow page

Add a `readOnly` mode to `DesignCanvas`: no drag, no connect, no layout write, selection still allowed for inspection. The session workflow page builds the graph from the definition document with `definitionToGraph` and no layout positions (the deterministic auto-layout), so it does not read or write the editor's layout sidecar. Above the canvas it offers a run selector for the overlay (the latest run of that definition by default) that is independent of the page's run-detail navigation; choosing an older run changes only the overlay and does not replace the page with the run detail. The overlay uses the existing `overlayFor`. The ordered step table stays below the canvas as the accessible fallback and as the surface when the canvas cannot render. The page keeps its description/version/risk/gate/trigger facts, runs, and evaluation history.

Alternative: reuse the editor's layout sidecar. Rejected — the session view must not depend on an editor write path, and the auto-layout is deterministic.

### Diagnostics stays read-only

The trigger catalog and receipts are observability facts; they move behind the `Diagnostics` disclosure and keep their current read-only components. The read-only definitions table is removed; the rail and the workflow page remain the definition surfaces. The receipts stay on the design page (not the session view), preserving the split between authoring/diagnostics and session runs.

### Tests and assets

- Extend the definition validator/API tests for the optional description and its bound.
- Extend the client harness tests for the workbench default (rail, canvas, inspector), the diagnostics disclosure (catalog and receipts only), the first-installed selection, and the read-only canvas on the workflow page, including an older-run overlay selection that does not open the run detail.
- Keep the locale dictionary guard green for the new rail/inspector/diagnostics/description labels.
- Re-run `pnpm workflows:parity --check` after adding descriptions; build the updated validator first (the parity script imports `lib`) and regenerate the report if a covered hash changes.
- No dependency, DSH version, bundle row, or installer change.

## Risks / Trade-offs

- **Narrow right sidebar** → The canvas is usable only when the pane is wide; the list fallback and collapsible rail/inspector cover narrow widths. A full-width page is the documented follow-up if the pane is too small in daily use.
- **Growing `design.tsx`** → The workbench adds rail and inspector state. Split the rail and block palette into their own modules and keep the state machine in `editor.ts`; the existing editor tests stay the behavioral contract.
- **Description changes shipped hashes** → The parity check fails until the report is regenerated. Run `pnpm build` first (the parity script imports `lib`), then the parity check, in the same task as the covered definition edits and commit the regenerated report.
- **Read-only canvas accidentally mutating** → Pass no-op move/connect handlers and disable drag/connect; assert in the client test that opening the workflow page performs no layout/definition write.
- **Default workflow selection** → Opening the first installed definition may differ from the user's last edit. The rail makes switching one click; persisting the last opened id is a follow-up only if a verified storage seam exists.
- **Block palette changes** → Adding an executor-aware palette action must reuse `normalizeExecutor`; a tool block must also add its tool name to `settings.allowTools` and carry saveable evidence, or the host refuses it. Test each added executor, including a tool block on a blank definition, through the host validator and save path.
