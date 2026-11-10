# Proposal

## Why

The session Workflows tab answers plugin-health questions instead of the session's process question: listener health, workspace-global definitions, triggers, and receipts fill the first screen, while the runs the owner came to inspect sit below the fold, are titled `` `<definition> intake` `` regardless of the workflow, and open a detail block appended under the whole list. The owner reviewed the tab on 2026-11-10 and rejected it as unusable and visually foreign; the redesign must make the session's executions the first thing on the surface, move authoring out of a read-only view, and reuse the shipped DSH primitives instead of hand-rolled markup.

## What Changes

- The session Workflows tab becomes a run history: one status line, then the session's runs in time order, then a run detail page opened by selecting a row and closed by a back control. **BREAKING** — the tab no longer renders the definitions, trigger catalog, receipts, or the Design control.
- The journal becomes a second segment of the same tab: events in time order with each event's trigger evaluations inline (a match links to its run, a non-match states its reason). The separate Why-not table and the duplicated `definition:<id>` trigger rows are removed.
- The workflow editor moves to a right-sidebar page, opened from a "Workflow design" card on the guide (Start) page, exactly as the OpenSpec panel is opened today. The page carries the definition list, the editor (list and canvas), the trigger catalog, and the receipts.
- Engine runs project a real title (`<definition name> · <subject>`, where the subject is the change, the checkpoint turn, or the task) and expose the recorded trigger plus a stable terminal time derived from step settlement when the run is terminal; a missing subject renders without one.
- The session run list is newest-first, and a refresh re-reads the pages already loaded so an open run keeps its data; a run that no longer exists says so instead of showing stale detail.
- Every surface is rebuilt on `@deepseek-ai/dsh-client-ui-primitives` (`StateDot`, `DisclosureRow`, `SegmentedControl`, `Pill`, `Button`, `Menu`, `Tooltip`, `Tag`, `PathLabel`, `relativeTime`, `AnimatedRows`) and `--dsw-*` tokens; missing locale keys are fixed and a guard test fails on any literal key absent from the dictionary.
- The session surface refreshes on open, on demand, and when the window becomes visible again, keeping an open run detail by run id.

## Capabilities

### New Capabilities

None. The read-only process surface already belongs to `workflow-observability`, and the authoring surface already belongs to `workflows`; the redesign changes their requirements rather than introducing a near-duplicate capability.

### Modified Capabilities

- `workflows`: the user-interface requirement now limits the session tab to runs and the journal and places definitions, triggers, receipts, and the editor on a design page in the right sidebar; the visual-canvas requirement names that page as the canvas home and fixes the narrow-panel behavior; the fallback requirement follows the editor to the page; run provenance gains the recorded trigger, end time, and the title rule.
- `workflow-observability`: the read-only surface requirement becomes runs-first; the shadow trigger catalog is shown on the design page, not in the session view; the session timeline requirement becomes a run list plus a detail page and a journal segment with inline evaluations; listener health becomes a status line that still distinguishes the four states.

## Impact

- Code: `packages/plugin-workflows/src/client/{index,view,panel,workflows,design}.tsx` and new design-page modules; `packages/plugin-workflows/src/host/projection.ts` for `trigger`, `endedAt`, and the title rule; locale dictionary and its guard test; `packages/plugin-workflows/test/{client,client-view,projection}.test.ts`.
- Client registration: a second surface (`sidebar.right.pane.tab` + guide entry) in addition to the existing `conversation.view`; the shipped right-sidebar services are a dependency only at runtime, and their absence leaves the session tab and the host untouched.
- APIs: `/api/workflows/runs` gains two optional fields, an optional `order` query parameter, and an optional single-run lookup by id; no route is removed and no response field is dropped.
- No dependency change, no engine change, no run-record format change, no migration; existing records and definitions render as they are.
