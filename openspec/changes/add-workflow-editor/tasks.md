# Tasks

The editor is a Client feature with a small Host write API. Lanes 1-2 own disjoint Client modules; lane 3 owns the Host write API; lane 4 owns the run overlay and the accessibility/fallback tail; lane 5 is the serial security, docs, and integration tail. The run overlay tasks depend on the producer contract in task 6.0.

## 1. Dependency and canvas shell (lane 1, owns `packages/plugin-workflows/package.json`, `src/client/canvas.tsx`, `src/client/styles.ts`, `test/canvas-budget.test.ts`)

- [ ] 1.1 Add and pin `@xyflow/react`, keep it out of `dsh.client.external`, and import the canvas statically so the client build bundles it into the single `lib/client.js`; verify `pnpm install`, `pnpm build`, no install script, no dynamic canvas import, and a license notice in the package.
- [ ] 1.2 Add the canvas entry, the error boundary, and the `Canvas | List` mode switch; the build remains one client artifact with no lazy chunk, so verify the list mode renders when the canvas render throws and the Workflows view stays usable.
- [ ] 1.3 Map the canvas surface colours to theme tokens and record the whole built client bundle size; verify the 250 KB uncompressed budget and that no global stylesheet is injected.

## 2. Graph conversion and layout (lane 1, owns `src/client/graph.ts`, `src/client/layout.ts`, `test/graph.test.ts`, `test/layout.test.ts`)

- [ ] 2.1 Implement definition-to-nodes/edges for trigger, step, branch, loop, human, and end; map `next`, branch `true`/`false`, loop `body`/`exit`, and the trigger entry. Verify a linear definition, a branch, a loop, and a dangling edge.
- [ ] 2.2 Implement nodes/edges-to-definition, refusing unknown node data and preserving every non-positional field; verify a round trip is byte-identical for the three templates and a hand-built graph.
- [ ] 2.3 Implement the layout sidecar read/write and the deterministic layered auto-layout; verify saved positions survive reload, a missing layout is stable across two renders, and the engine ignores the sidecar.

## 3. Editor state and lifecycle (lane 2, owns `src/client/editor.ts`, `src/client/properties.tsx`, `test/editor.test.ts`)

- [ ] 3.1 Implement create, copy-from-shipped, duplicate, rename, delete, and version bump; verify a new local id, a shipped definition unchanged, a rename keeping the id, delete refused while a run is active, and a colliding copy id surfaces the 409 and the next free id.
- [ ] 3.2 Implement draft state, dirty tracking, unsaved-change warning, save, and save-as-copy; verify a save bumps the version and a cancel leaves the file unchanged.
- [ ] 3.3 Implement the revision contract from design Decision 3: `expectedRevision: null` for create, the revision returned by the last read or create for update and delete, `409` handling, and reload/next-id/save-as-copy actions; verify a conflicting save changes nothing, a create collision writes nothing, a second save after create uses the returned revision, a first layout save uses `null`, and a layout conflict does not block a definition save.
- [ ] 3.4 Implement the client-side structural pre-check (dangling edge, duplicate id, missing next) and the host error mapping to nodes/fields; verify a client-caught and a host-caught invalid save.

## 4. Host write API and templates (lane 3, owns `src/host/editor-api.ts`, `test/editor-api.test.ts`)

- [ ] 4.1 Add `GET /api/workflows/definitions`, `GET /api/workflows/templates`, `GET /api/workflows/definitions/<id>`, and the layout read route with auth and workspace scoping; each definition and layout read returns the document with its revision. Verify a list, a shipped template, a local definition, a missing id, a 401, and the revision returned for a local definition and a layout.
- [ ] 4.2 Add `PUT`/`DELETE` for local definitions and `PUT` for layout with the revision contract from design Decision 3: `expectedRevision: null` creates only through an exclusive create and returns 409 on collision, a matching hash updates or deletes only the loaded resource, and definition and layout revisions are independent. Verify a valid create, a valid update, an invalid schema, a create collision with no write, an update 409 with the current revision, a first layout save with `null`, a layout 409, a delete in use, and a path escape refusal.
- [ ] 4.3 Add the draft-install path: a model draft under `.dsh/workflows/drafts/` is readable but not active; installing it requires a create-only `PUT` from the editor with the user's save. Verify the draft is not loaded by the engine, the install creates a local definition with `version: 1`, a colliding id returns 409 without installing, and the next save uses the created revision.

## 5. Canvas UI (lane 2, owns `src/client/palette.tsx`, `src/client/properties.tsx`, `src/client/edges.ts`, `test/palette.test.tsx`)

- [ ] 5.1 Render the trigger node, step nodes, branch/loop handles, and labelled edges; verify the trigger is first, a branch edge is labelled `true`/`false`, and a loop has `body`/`exit`.
- [ ] 5.2 Implement the left palette, node selection, the property panel, and add/connect/delete; verify a new node, a connection, a field edit, and a delete update the definition.
- [ ] 5.3 Implement the list mode with every field and edge editable; verify the list can create the same definitions as the canvas and shares the save path.

## 6. Run overlay (lane 4, owns `src/client/overlay.ts`, `test/overlay.test.tsx`)

- [ ] 6.0 Producer prerequisite (owned by `add-workflow-obligations` for the run record and `add-workflow-observability` for `RunView` and the run route): persist `definition: { id, name, version }` at run creation, per-step `evidence { kind, ref, at? }` and `failureClass`, and `violations [{ stepId, at, reason }]`; expose the same fields on `RunView`, and accept `definition=<id>` and `source=workflow` on the runs route newest-first. Verify the latest run for one definition is selected, a run keeps its recorded version after the definition changes, and a completed run's name, version, evidence, failure class, and violations remain readable after the definition is deleted. The overlay tasks below start only after this contract lands.
- [ ] 6.1 Overlay the latest run for the definition on the graph with node state, structured evidence, failure class, and violations; verify running, blocked, completed, failed, and violated nodes, and that a blocked node shows its `failureClass` and violation.
- [ ] 6.2 Add the run selector and the orphan badge for a run step missing from the definition; verify the selector lists only runs for the definition, switching runs changes only the overlay, an orphan is marked and not drawn as a node, a definition step missing from the run shows no state, and an unknown violation step id is a run-level notice.
- [ ] 6.3 Verify the overlay is read-only: a node click opens the property panel, no run starts, no tool is called, and the run file is unchanged.

## 7. Accessibility and fallback (lane 4, owns `src/client/a11y.ts`, `src/client/list.tsx`, `test/a11y.test.tsx`)

- [ ] 7.1 Add keyboard add/connect, focusable nodes and edges, labels, and visible focus; verify keyboard-only creation of a two-step definition and a tab order through the palette, canvas, and properties.
- [ ] 7.2 Add the screen-reader summary, the `Canvas | List` toggle, and the narrow-window default to List; verify the summary updates on selection and the narrow mode is editable.
- [ ] 7.3 Verify a canvas render failure switches to List with a bounded notice and the host and runs are unaffected; record that a client-module evaluation failure is reported by the Harness loader and is outside the in-view fallback.

## 8. Security, docs, and integration (lane 5, owns `test/editor-security.test.ts`, `docs/workflows.md`, `docs/plugins.md`, `packages/setup/**`, `packages/plugin-workflows/lib/**`)

- [ ] 8.1 Add security tests for a path escape, a cross-workspace write, a credential-shaped definition, a model draft install without a save, and a JSONLogic condition that is never evaluated in the client; verify each is refused or stored as data.
- [ ] 8.2 Document the Design mode, the palette and list modes, templates, the layout sidecar, the create-only and revision conflict rules, the run overlay, and the accessibility fallback in `docs/workflows.md`; verify the documented actions match the UI.
- [ ] 8.3 Run `pnpm gen`, `pnpm build`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, and `openspec validate add-workflow-editor --strict`; verify all pass and record the whole client bundle size.
- [ ] 8.4 Run a live visual check: open Design, create a two-step definition from a template, save, connect a branch, reload, open the latest run overlay, switch to List, and confirm the saved JSON matches the engine schema.

## Workflow follow-up

- Install the generated setup in a throwaway profile, open the Workflows view, and confirm the Design mode loads with the shipped templates and the run overlay.
- Archive the change after the project's review requirements are satisfied; do not change the engine, gates, or definitions in this change.
