# Design

## Context

The `Workflow design` page is the right-sidebar authoring surface of the Workflows plugin. It
already measures its own pane width (`design-page.tsx`), opens in the list editor below the shipped
720 px threshold (`a11y.ts`), and owns one editor state machine (`editor.ts`) whose save path
validates and installs through the host. The canvas is a static React Flow import inside the single
`lib/client.js`; the page currently mounts `PropertyPanel` in a `DisclosureRow` below the canvas
and the workbench grid is `rail | main` with no height chain to the canvas. The previous change
(`redesign-workflow-design-surface`) archived with its live visual check open (follow-up 4.5), so
the composition was never judged on a real screen.

## Goals / Non-Goals

**Goals:**

- The n8n-like workbench: bricks and the installed-workflow library on the left, a canvas that fills
  the center, an inspector that follows the selection on the right.
- Creation by click and by drag from the palette; trigger kinds as a single choice.
- One primary action in the header; lifecycle actions in one overflow menu.
- The right sidebar's width range is designed for: three columns, drawer, or list.
- Keep the existing editor state machine, save/reload/conflict path, layout sidecar, read-only
  fallback, diagnostics disclosure, accessibility contract, and bundle budget.

**Non-Goals:**

- A new page location, route, schema field, trigger, executor, or engine behavior.
- A minimap, palette search, auto-connect, sub-workflow nodes, or a drag-drop dependency.
- Reworking the session `Workflows` view, the runs feed, the OpenSpec panel, or stored definitions.
- Persisting the last opened definition or pane widths.

## Decisions

### The inspector is the third column, and a drawer below 980 px

`PropertyPanel` moves out of the disclosure and into an `.dsh-wf-inspector` column placed right of
the canvas. A pure helper in `a11y.ts`, `inspectorPlacement(width): 'column' | 'drawer'` with
`WIDE_WIDTH = 980`, decides the placement from the pane width the page already measures; the
drawer is `position: absolute` over the canvas column and follows `selected !== undefined`, with a
header toggle to open it for the definition-level fields. At `< 720` px the list editor keeps its
inline property form. Alternative: keep the bottom disclosure (it is the reported defect);
alternative: a modal inspector (hides the node it edits). The helper keeps the breakpoints testable
without a DOM.

### The canvas gets a real height chain, a dot grid, and zoom/fit controls

The page becomes a flex column that does not scroll as a whole: `.dsh-wf-page` fills the pane,
`DesignMode` and the workbench fill the remaining height, and `min-height: 0` is set down to the
canvas, which gets an explicit bounded height and a `100%` React Flow child. `Background` (dots)
and `Controls` from the already-installed `@xyflow/react` render inside the canvas; their colors
ride the existing `--xy-*` token mapping. Alternative: a fixed `vh` canvas (wrong inside a
resizable sidebar); alternative: custom zoom chrome (reimplements shipped behavior). The bundle
budget test records the measured size; the ceilings move only with a measured value.

### Bricks are engine vocabulary with click and drag

One brick per trigger kind and one per executor, rendered as an icon tile with a friendly label and
a one-line tooltip; the engine value stays the action argument. Click adds/sets and selects the
node. Step bricks are `draggable`; the rail writes `trigger:<kind>` or `step:<executor>` under a
private MIME type (`application/x-dsh-wf-brick`), the canvas converts the drop with
`screenToFlowPosition`, and `design.tsx` composes `addStepForExecutor` with `moveStep` so the new
node keeps the drop position. A malformed payload is ignored. Trigger bricks are a single choice,
so they are not draggable. Alternative: add a dnd dependency (new dependency for one interaction);
alternative: click only (loses point placement, the n8n affordance the user asked for). Keyboard
and screen-reader users keep the button path and the existing accessible names.

### One primary action and one overflow menu

`Save` is the only primary button. The header keeps the definition name, the trigger/source tags,
the dirty state and version, and a compact run-overlay select; an overflow `Menu` (primitives)
holds `New definition`, `From template`, `Open draft`, `Reload`, `List view`/`Canvas view`, and
`Delete`. Delete confirms in an in-page banner instead of a native dialog because the menu closes
on selection and the page owns its banner area. The rail keeps its picker role and loses the
lifecycle block. Alternative: the current rail `More` disclosure (the current clutter); alternative:
native `window.confirm` (unstyled, blocks the page). The list surface stays reachable from the menu,
so the narrow-width requirement keeps its "one control away" behavior.

### The library becomes a compact row list

Each installed definition is one row: name on the first line; `trigger · N steps · source` with a
`Tag` and, when loaded, a `StateDot` latest-run state on the second; the open row is marked with a
selected background and an accent edge. This replaces the five-line cards while keeping the fields
the spec names (description via tooltip and the session/workflow pages). Alternative: keep the
cards (unreadable at 200 px); alternative: a table (the previous change removed it deliberately).

### Reuse the editor state machine and keep the test hooks

No editor behavior changes: add, connect, patch, rename, delete, save, reload, copy, conflict, and
the layout sidecar stay in `editor.ts`. The rail keeps `data-block` and `data-definition`; the
inspector keeps every `aria-label` and field. Tests update only what pins the old layout: the
harness stubs gain the new primitives/icons and React Flow members, and the assertions on the
bottom inspector, workbench classes, and the List/Canvas segmented control move to the new
column/drawer and menu contract. Pure additions (`inspectorPlacement`, the brick catalog, payload
parse) get direct unit tests.

### Docs and generated artifacts

`docs/workflows.md` and `docs/plugins.md` currently state that the inspector is below the editor;
both are corrected. `docs/openspec-status.md` gains the change entry. The client build updates
`lib/**` and `pnpm gen` rewrites the vendored `packages/setup/node_modules/@dsh-setup/plugin-workflows`
tree; both are committed, never hand-edited.

## Risks / Trade-offs

- **Right-sidebar width** → below 720 px the page is still the list editor; the drawer and compact
  rail make the canvas usable from about 720 px up. A wider pane stays the user's choice.
- **Bundle size** → `Background` and `Controls` add code to the single client artifact; the budget
  test's measured numbers and ceilings are updated with the measurement, never raised blindly.
- **Drag-only accessibility** → drag is an enhancement; click, keyboard, and screen-reader paths
  stay first-class and are covered by the existing palette tests.
- **Test churn** → several client tests pin structure. Hooks are preserved where possible; the
  changed assertions are part of the same tasks as the components they cover.
- **Live visual acceptance** → the desktop profile cannot be installed or reloaded from an agent
  session. The change ends at a built, generated, tested tree; the owner installs it to close the
  same visual-check follow-up. This is a known limit, not an untested claim of visual quality.
- **Sticky height chain** → if an ancestor stops providing a height, the canvas min-height keeps it
  visible but the page may need to scroll; the list fallback and the inspector scroll remain
  reachable.
