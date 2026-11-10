# Design

## Context

See `proposal.md` for the motivation. The current plugin contributes a single `conversation.view` (`id: workflows`, order 30) whose body renders, in order, a health banner, a definitions table, a trigger table, a receipts list, the session journal, the run list, then a run detail block below the list (`packages/plugin-workflows/src/client/view.tsx`). The editor is a mode of that same body, opened by a button at the top. The host already exposes everything the view needs through `/api/workflows/*`; the projection in `packages/plugin-workflows/src/host/projection.ts` builds each run but drops the recorded trigger, exposes no terminal time, and gives every engine run the title `` `<definitionId> intake` ``.

Two shipped constraints shape everything below:

- The conversation tab strip is the only conversation-scoped seat; a plugin cannot open a full-window main panel. The right sidebar is the shipped surface for plugin pages: a tab type registered with `ctx.sidebarRightTabs.register`, a body registered in `sidebar.right.pane.tab`, and a card on the guide (Start) page. The OpenSpec panel is the working precedent in this repository (`packages/plugin-openspec/src/client/index.tsx`).
- The right sidebar is a column, not a window: its normal presentation is roughly 600 px wide and it has its own fullscreen presentation. The editor already has a narrow-width rule (`NARROW_WIDTH = 720` in `client/a11y.ts`).

## Goals / Non-Goals

**Goals:**

- One question answered first in the session tab: which workflows ran, when, by which trigger, and how they ended; the newest run on the first page and the detail of one run on its own page.
- Authoring out of the read-only surface and into the shipped sidebar page seat.
- Every rendered fact true: definition name, subject, trigger, a stable terminal time, no raw locale key.
- The visual grammar of the rest of DSH through shipped primitives and `--dsw-*` tokens.

**Non-Goals:**

- No engine, gate, evidence, or run-record change; no new trigger or step type.
- No push channel: refresh is request/response.
- No new full-window surface or main panel.
- No change to the editor's save/approve/revision contract.
- No new dependency.

## Decisions

### 1. Two surfaces, one host API

The session tab keeps its registration and becomes a run history. A new page type is registered for the design page:

```
conversation.view id=workflows (order 30, session)     sidebarRightTabs page kind=workflows-design
  status line -> runs list -> run detail page           guide card -> definitions | editor | triggers | receipts
```

Alternatives rejected: a third conversation view for the editor (adds a tab to every conversation, and authoring is not session-scoped); a modal (loses the panel's fullscreen presentation and the workspace context); keeping the button (owner decision: a read-only surface must not author).

### 2. List → detail page, not inline expansion and not a split pane

Selecting a run replaces the body of the tab with a detail page; a back control restores the list and its scroll position and returns focus to the row. Inline `DisclosureRow` expansion was rejected because a long step list pushes the next runs off screen and makes "back" implicit. A two-pane split was rejected because it adds a second layout mode to a tab whose width varies with the window and because the owner asked for the Temporal execution-page shape.

### 3. Runs and journal are the whole session surface; evaluations are inline

The journal segment renders each event with the evaluations recorded on it. Only an evaluation carrying a `runId` renders a run link; `would-fire` (a shadow match that starts nothing), `run-suppressed` (an active match whose run start failed), and `not-applicable` render their recorded reason and detail without a link, because a matched evaluation does not imply a run exists. The separate Why-not table and the session copy of the trigger catalog are removed; they duplicated facts already present on the event and on the design page. The trigger catalog, definition list, and receipts move wholesale to the design page because they are workspace state, identical in every session tab.

### 4. Truth is composed by the host, not the client

`RunView` gains `trigger?: string` and `endedAt?: number`. `projection.ts` composes `title` from the recorded definition name and the recorded subject: `context.name` (the change), the checkpoint turn parsed from `context.checkpoint` (`.dsh/work-checkpoints/<hash>/<turn>.json`), and the short `taskId`; a missing subject renders without one. The editor's run overlay consumes the same projection, so composing titles in the client would give two names for one run. Legacy sources (delegation, review, checkpoint) keep their existing titles.

`endedAt` is the latest `at` of the run's recorded steps, exposed only for a terminal run, never the record's `updatedAt`: `updatedAt` moves after completion when a completed retro run records a turn block or a violation, so it is not an end time. Synthetic violation rows projected for display are excluded from the derivation. A terminal run with no settled step omits `endedAt`, and the view then shows no duration.


### 5. Only shipped primitives for the visible controls

| Region | Components |
|---|---|
| status line | `StateDot` + text + `Tooltip` details |
| list row | `DisclosureRow` or a 32 px button row; `StateDot`, `Tag`; `relativeTime()` + absolute in tooltip |
| segments (Runs/Journal, List/Canvas) | `SegmentedControl` |
| filters | `Pill` |
| actions | `Button` (`primary`/`ghost`/`outline`), `Menu` (overflow, palette, templates) |
| evidence | `PathLabel`, `JsonTree` for JSON, links with `rel="noreferrer"` |
| list movement | `AnimatedRows` |
| guide card artwork | `PluginArtworkLoop` / `GuideArtwork*` |
| errors | `role="alert"` + retry `Button`; `Toast` only for a failed background refresh |

Remaining CSS is layout only. No raw colour, no new token, no new component library.

### 6. The editor adapts to the panel; it never changes the presentation on its own

Below the narrow threshold the page opens in list mode (existing rule). The palette becomes an "Add step" `Menu`; the property panel becomes a collapsible section under the canvas or list rather than a third column. The canvas keeps its current keyboard contract (palette → canvas → properties order, connect list, fallback notice) and stays reachable from the list. The panel's own fullscreen control is the way to a wide canvas; the page does not call `layout.openRightbar` itself.

### 7. Unsaved edits are guarded at the tab close

The design page registers a close handler through the shipped sidebar seam so an explicit tab close with unsaved changes asks first. The editor's existing dirty state and revision handling are unchanged; only the close path is added. This is new behavior for a surface that never had a close control.

### 8. Newest-first paging and a refresh that keeps the open run

The runs route gains an optional `order=newest` parameter that reverses the filtered list before paging; the default order is unchanged for existing callers (the editor overlay keeps its own newest-first definition filter). The session view asks for newest-first, so the current run is on the first page. Because offset paging over a reversed list can repeat a row when a run arrives between pages, the client deduplicates appended pages by run id.

The session view loads runs and the journal on mount, on demand, and on `visibilitychange → visible`. A runs refresh re-requests the pages already loaded (bounded by how many the user opened) and resolves the selected run independently through the runs route's run-id lookup, so a new run arriving at the top cannot push the selection out of the refreshed window and make it look removed. The detail updates in place; only a lookup that reports no matching attributed run renders "no longer recorded" with the back control. The existing request-generation guard prevents a stale response from committing. No interval, no websocket.


### 9. Failure semantics stay per surface and bounded

Session view: loading line, error line with retry, empty state naming why nothing ran yet, partial load keeps rows. Design page: loading, unreadable row, save failure keeping the draft and the last revision, unsaved-changes guard. Both keep the existing bounded paging (`next` cursor) and workspace-relative evidence redaction; neither writes.

### 10. Locale keys are guarded

The dictionary gains the keys the view uses and drops the ones it no longer renders; a test scans client sources for literal `t('…')` keys and fails when one is missing from `EN`. The current `definitions.heading`, `receipts.heading`, and `reason.not-applicable` leaks would have been caught by it.

## Risks / Trade-offs

- **[Existing tests pin the old structure]** `client.test.ts`, `client-view.test.ts`, and `projection.test.ts` assert section order, the Design button, and the `X intake` titles → rewrite them with the behavior, not around it; keep the pure-render test style (`WorkflowsLoaded` and friends) so no DOM renderer is needed. Add assertions for the retro turn subject and for the fixed end time of a retro completed before a later violation.
- **[The canvas is cramped in the panel]** → list is the narrow default, palette and properties collapse, and fullscreen gives the canvas room; the first cut accepts that a very narrow panel is a list-first editor rather than inventing an automatic presentation switch. Owner reviews the installed result.
- **[The sidebar API surface has more than the guide card]** (`useTabInfo`, `tab.actions`, close handler registration) → follow the shipped `dsh-client-ui-sidebar-right` contract and copy the OpenSpec panel's registration shape; when those services are absent, register only the session view.
- **[Losing the session catalog hides the "what triggers exist" answer]** → the design page keeps it, and the journal shows every evaluation with its reason, so the session-level "what did not fire and why" answer survives where it matters.
- **[`updatedAt` moves after completion]** → `endedAt` is derived from settled step times only, never from `updatedAt`, and is omitted when no step settled; a completed retro that records a later turn block or violation must keep its reported end time.
- **[A refresh can drop a paged selection or race a page load]** → the refresh re-reads the pages already loaded (bounded), resolves the open run by id, and the generation guard drops stale responses; absence from the page window is never treated as removal, only a run-id lookup miss renders "no longer recorded".
- **[Newest-first paging can repeat a row when a run arrives between pages]** → the client deduplicates appended pages by run id; the bounded default page size is unchanged.
- **[Removal is user-visible]** → the tab loses the Design control and its catalog sections; the command text and the guide card are the discovery path, and `docs/workflows.md` records the new entry points.

## Migration Plan

No data migration: run records, definitions, layouts, and receipts are read as they are, and the two new run fields are optional. Deployment is a normal release (version bump, `pnpm build`, `pnpm gen`, install through the setup); a downgrade ignores the new fields and the sidebar page disappears, while the session tab keeps working. The previous Design button does not need a redirect because it never addressed a durable object.

## Open Questions

None that affect the specs, the approach, or the task breakdown; the visual acceptance of the installed result belongs to the owner's review after install.
