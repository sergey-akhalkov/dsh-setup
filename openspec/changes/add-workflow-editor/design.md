# Design

## Context

See `proposal.md` - Why. The pieces this design builds on:

- `add-workflow-observability` owns the Workflows `conversation.view`, the authenticated read API, pagination, and the list/run detail. The editor is a new mode inside that view, not a second shell; the run projection and run route need the overlay fields and per-definition filter described in Decision 5.
- `add-workflow-obligations` owns the closed definition schema, the local definitions directory, the templates, the write validation, and the run records. The run record gains the definition id/name/version and per-step failure class the overlay reads; the editor writes exactly that definition JSON.
- The client build (`scripts/build.ts`) bundles every dependency except React and the modules listed in `dsh.client.external`. `@xyflow/react` is therefore bundled into `lib/client.js`; the profile does not install it, and no install-time script is added.
- The full-width `conversation.view` has enough room for a three-pane editor; the right sidebar does not.

## Goals / Non-Goals

**Goals:**

- A trigger-first canvas that makes the definition shape obvious: trigger, ordered steps, branch labels, loop body/exit, and the latest run for that definition.
- Edit the same JSON the engine loads, with the host as the validation authority and explicit create-only and update revisions.
- Keep the editor usable without a pointer and without the canvas.
- Keep a completed run readable after its definition is renamed, version-bumped, or deleted.
- Add no engine behavior and no new data store beyond the layout sidecar.

**Non-Goals:**

- A general node editor with arbitrary code nodes, custom scripts, or a plugin SDK.
- Multi-user collaboration, presence, or a server-side draft workflow.
- Editing a shipped definition in place; a shipped definition is a template, a local copy is the editable object.
- A second main panel, a standalone window, or a separate route.
- A separate client artifact or lazy canvas chunk; the canvas shares the single client bundle.
- Running a workflow from the editor; the run action is a normal start with the model/user rules from `add-workflow-obligations`.

## Decisions

### 1. React Flow is bundled and pinned

- Add `@xyflow/react` as a dependency of `packages/plugin-workflows`; keep `dsh.client.external` limited to DSH-provided modules. The esbuild client bundle includes React Flow.
- Pin the exact version (the same discipline as the DSH dev dependencies) and keep the MIT license notice in the package and docs.
- The canvas is a static import in the single client artifact; the current build emits one client artifact and has no chunk splitting, so there is no lazy chunk and no payload isolation to measure. A separate canvas artifact is a build change this change does not make. The whole client bundle budget is 250 KB uncompressed; a larger bundle needs a documented reason.
- No React Flow CSS is imported from a CDN; the needed styles are copied into the plugin's client style block or a local CSS module, and theme tokens override the defaults.

Alternatives: a list-only builder is cheaper but does not answer the requested visual design. A separate standalone editor would need its own shell, auth, and navigation. Drawing the canvas by hand would duplicate React Flow's pan/zoom/selection/edge work.

### 2. The graph is a projection of the definition, never a second source of truth

```
definition.steps[] --(graph.ts)--> nodes[] + edges[]
layout/<id>.json   --(positions)--> node.position
run.steps[]        --(overlay)----> node.data.runState
```

- The trigger is one node of type `trigger`, rendered first.
- A `step` node's handles: one output for `next`; a `branch` node has `true` and `false` outputs; a `loop` node has `body` and `exit`; a `human` node has `next`; an `end` node has no output.
- The reverse conversion reads node ids and edge labels and writes the definition fields. Unknown node data is refused, not copied.
- Layout is a sidecar: `{ v: 1, id, positions: { [stepId]: { x, y } } }`. The definition never carries coordinates. The engine ignores the sidecar, so a missing or stale layout cannot change a run.
- A missing layout uses a deterministic layered layout: trigger at column 0, each `next` edge increases the column, branch/loop children sit one row below the parent, and ties are ordered by step id. The result is stable across reloads and tests.

### 3. Every write carries a revision; create-only is explicit

- The editor assembles a candidate definition and calls `PUT /api/workflows/definitions/<id>` with `{ definition, expectedRevision }`. It calls `PUT /api/workflows/layout/<id>` with `{ layout, expectedRevision }`, and `DELETE /api/workflows/definitions/<id>` with `{ expectedRevision }`.
- `expectedRevision` has two valid forms:
  - `null` is create-only: the destination must not exist. The host performs the existence check and the create as one atomic filesystem operation and returns `409` with the current revision, writing nothing, when the destination already exists. Blank creation, template copy, duplicate, and draft installation all use this form.
  - A SHA-256 string is the revision of the exact bytes of the target file. A read returns it with the document, and the editor sends it back on update or delete. A mismatch returns `409` with the current revision and writes nothing; the editor offers reload or save-as-copy. A template or draft hash never authorizes a different resource.
- Definitions and layouts have independent revisions. The first layout save sends `null` even when the definition already exists; later layout saves send the layout revision. A layout save never requires or changes the definition revision, and a definition save never requires the layout revision.
- A successful create returns the new revision. The next save sends that revision, never `null` again. A `409` carries the current revision for the resource, or `null` when the existing resource is unreadable.
- The host runs the same `loadDefinition` validator used by the engine. On failure it returns `400` with `{ errors: [{ path, message }] }`; the editor marks the node or field without losing the draft.
- The host serializes writes to the same resource and replaces the file atomically after the revision check, so a successful response means the saved candidate is on disk and its revision is current.
- On a create collision the editor offers the next free id for a copy and keeps the draft; on an update conflict it offers reload or save-as-copy. This is the same conflict rule for local definitions, not a git merge.
- The client also checks the local graph for dangling edges, duplicate ids, and a missing `next` before the request; that is UX, not a second schema. A definition that passes the client but fails the host is the normal validation path.

### 4. Local lifecycle and templates

- The Definitions list shows shipped and local entries. A shipped entry has a `copy` action; the copy gets a new id (suffix `-copy`, then `-2`, …) and is immediately local and editable.
- Create starts from a blank definition or a template; a new definition starts at `version: 1`. Duplicate copies a local definition with a new id and `version: 1`.
- Rename changes `name`, not `id`; the id is immutable after creation so runs and layout keep pointing at it.
- Delete refuses while an active run references the definition; it returns the run ids and the next action. A completed run keeps the recorded name and version in its record, so deletion does not break history.
- Save bumps `version` by one and sends the revision from the last successful read or create. The editor shows the new revision after the host confirms.

### 5. The run overlay reads a producer-owned run contract

- The overlay is a projection of the run record; it never infers a definition or a failure. Two prerequisite changes own the contract:
  - `add-workflow-obligations` SHALL record `definition: { id, name, version }` at run creation, with the values in effect when the run started. It SHALL also record each step's `evidence` object, a `failureClass` for a blocked or failed step, and `violations` as `{ stepId, at, reason }`. The name and version are copied, not looked up, so a later rename, version bump, or deletion does not rewrite history. No workflow run has shipped, so this is the initial record format; no migration is needed.
  - `add-workflow-observability` SHALL extend `RunView` with the same `definition`, per-step `evidence { kind, ref, at? }` and `failureClass`, and `violations`. Its run route SHALL accept `definition=<id>` and `source=workflow` filters and return newest first, so the editor can request the latest run for one definition without paging the session.
- The producer owns the `failureClass` vocabulary. The editor renders the value verbatim - for example `missing-file`, `record-mismatch`, `no-call`, `check-failed`, `no-answer`, `rejected-answer`, or an executor failure kind - and never derives a class from a message.
- The view requests the latest run for the definition (`source=workflow&definition=<id>&limit=1`); the run selector lists only that definition's runs. The header shows the run's recorded definition name and version and marks when they differ from the open definition.
- A run step whose id is not in the open definition is an `orphan`: it is listed from the run record and never drawn as a new node. A definition step missing from the run shows no run state. A violation naming an unknown step id is shown as a run-level notice.
- The overlay maps `step.state` to the node tone and badge, `step.evidence` to a read-only link, `step.failureClass` to the failure label, and `run.violations` to the matching node. It does not rewrite the definition or the run.
- A completed run remains readable after the definition is deleted: the run detail shows the recorded name, version, step states, evidence, failure classes, and violations. The canvas overlay is unavailable because the definition no longer exists; the run detail is the historical surface.
- The "Run" button in the toolbar calls the normal start API. It is disabled while a save is pending and requires the same `risk: high` confirmation as the model start. The canvas itself has no run control.

### 6. Accessibility is a first-class mode, not a best effort

- React Flow is configured with focusable nodes and edges, `aria-label`s from the step title, and a visible focus ring from the theme.
- The palette supports keyboard add: focus the palette, choose a type, press Enter; the new node is focused and the property panel opens.
- Connecting without a pointer: select the source node, press `C`, choose the target from a labelled list, press Enter. The list fallback offers the same operation as a select.
- The view has a `Canvas | List` toggle. The List mode is a form editor with the same fields, validation, and save path; every canvas operation has a list equivalent.
- A screen-reader summary above the canvas states the trigger, step count, and open run state; it updates on selection.

### 7. Fallback, error boundary, and inertness

- The canvas is statically imported by the view inside an error boundary. A React Flow render error or a missing container switches the mode to List and shows a bounded notice. A client-module evaluation failure is not caught by an error boundary; it is reported by the Harness loader and is outside this in-view fallback.
- The host is unaffected: definitions and runs are read through the same API; the fallback is a client-only state.
- If the Workflows view is not registered (missing conversation services), the editor is not registered either; the existing behavior from change 1 applies.

### 8. Trust boundary

- The editor writes only under `.dsh/workflows/definitions/` and `.dsh/workflows/layout/`; the host resolves the path, checks the workspace, and rejects an id or path escape.
- A model-written draft under `.dsh/workflows/drafts/` is not loadable and not listed as a local definition. Opening a draft in the editor and saving it installs a local definition through a create-only save; the user action is the confirmation.
- Conditions are JSONLogic strings edited as data; the editor never evaluates them in the client and never runs definition code.
- The host's `PUT` requires the same authenticated request check as the read API; no unauthenticated write path.
- A definition containing a credential-shaped field is refused by the host validator, not only by the client.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| React Flow increases the client bundle. | Bundle once with no chunk split, keep the list fallback, and measure the whole client bundle against the 250 KB budget; a regression is a review finding. |
| Canvas accessibility is weaker than a form. | A full list mode, keyboard connect, focusable nodes, labels, and a screen-reader summary; the canvas is never the only path. |
| The graph and the JSON diverge. | One projection function each way with round-trip tests; the host validator is authoritative. |
| A save overwrites another edit. | Revision hash and `409`; create-only `null` for new resources; reload, next free id, or save-as-copy; no silent overwrite. |
| A shipped definition is edited by accident. | Shipped entries are read-only and the edit action is a copy with a new id. |
| A definition changes while a run uses it. | The run records the definition id/name/version and its step ids; the overlay marks orphans instead of inventing steps and shows the recorded version. |
| A deleted definition breaks history. | Delete refuses while a run is active; the run detail keeps the recorded name, version, evidence, failure classes, and violations. |
| The producer changes do not expose the run fields the overlay needs. | Decision 5 names the exact contract and task 6.0 verifies it before the overlay UI starts; the editor never fills a missing field by inference. |
| The canvas is opened in a narrow window. | The view is full-width; below a breakpoint it defaults to List mode and keeps the canvas available. |
| React Flow CSS conflicts with the theme. | A local style block maps the canvas colours to theme tokens; no global stylesheet is injected. |
| The client build grows beyond a comfortable payload. | The change records the whole built size; a regression above the budget is a review finding. |

## Migration Plan

1. Land the producer contract extensions in `add-workflow-observability` and `add-workflow-obligations` (Decision 5); verify the definition-filtered run query and the recorded name/version before the editor work starts.
2. Add and pin `@xyflow/react`; run `pnpm install`, `pnpm build`, and record the whole client bundle size.
3. Add the canvas, graph conversion, layout, revision-checked write API, and run overlay behind the Design mode; the list mode and the engine are unchanged.
4. Ship the editor enabled; rollback is removing the Design mode or the dependency, with definitions still readable and editable as JSON.
5. The generated setup tree is rebuilt; no profile install step and no install script.

## Open Questions

None. The canvas is the requested surface; the only deferred choice is the exact React Flow minor, which is pinned at implementation time after a bundle-size check.
