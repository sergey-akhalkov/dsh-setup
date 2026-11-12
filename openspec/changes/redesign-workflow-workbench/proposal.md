# Proposal

## Why

The right-sidebar `Workflow design` page was turned into a workbench in
`redesign-workflow-design-surface`, but the live page does not look or behave like one: the
inspector is a disclosure below the canvas, the React Flow container has no usable height on the
live page, the building blocks are text-only ghost buttons with raw engine names, the workflow
library is a stack of five-line cards in a 200 px column, and the header is a pile of unrelated
controls. The workbench was never checked in a live session (open follow-up 4.5): the owner now
reports that authoring a workflow there is not usable. This change finishes that design instead of
reopening it.

## What Changes

- The page becomes a three-pane workbench at wide widths: a left column with icon block bricks over
  a compact workflow library, a center canvas that fills its column, and a right inspector that
  follows the node selection.
- The canvas gains a real height contract, a dot grid, zoom/fit controls, icon node cards with run
  decoration, and quiet edge labels; the start state is an explicit affordance.
- Step bricks add a step on click and on drag-and-drop at the drop position; trigger bricks set the
  trigger kind as a single choice. The click path stays the keyboard and screen-reader path.
- The header is reduced to one primary action (`Save`), the dirty/version state, a compact run
  overlay control, and an overflow menu for the lifecycle actions; delete asks in an in-page
  confirmation.
- The inspector moves beside the canvas at `>= 980` px, becomes a drawer at `720-979` px, and the
  existing list editor stays the surface below 720 px with the canvas one control away.
- The docs that describe the workbench are updated; no host route, definition field, API, or
  engine behavior changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: the `Visual canvas` requirement is refined to pin the inspector beside the canvas at
  wide widths and as a drawer at medium widths, the canvas height/zoom/empty-state contract, the
  click-or-drag palette, and the header's single primary action with the list toggle in the
  overflow menu.

## Impact

- Code: `packages/plugin-workflows/src/client/{design,rail,canvas,properties,styles,locale}.tsx`,
  `a11y.ts`, a new pure `bricks.ts`, and the workflow client tests plus the test harness stubs.
- Docs: `docs/workflows.md`, `docs/plugins.md`, `docs/openspec-status.md`.
- Generated: `pnpm build` output and the vendored `packages/setup/node_modules/@dsh-setup/plugin-workflows`
  tree via `pnpm gen`; no dependency, bundle-row, DSH-version, or installer change.
- Behavior: the design page only. The session `Workflows` view, runs, gates, receipts, approvals,
  and stored definitions are untouched.
