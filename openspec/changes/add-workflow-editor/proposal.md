# Proposal

## Why

The obligation engine stores definitions as JSON and the Workflows view lists them, but the owner asked to design workflows visually: triggers on the left, steps chained into a graph, branches and loops visible, and the current run highlighted on the same picture. A JSON-only workflow is inspectable but not designable by a human who wants to see the shape of the process. React Flow is MIT-licensed, mature, and the client build already bundles non-DSH dependencies, so the canvas can ship inside the existing conversation view without a new shell.

## What Changes

- Add a Design mode to the Workflows view with a React Flow canvas, a left palette of triggers and step types, a property panel, and edges for the step sequence.
- Support create, edit, duplicate, delete, rename, version bump, and template-based creation of local definitions. Shipped definitions stay read-only; a copy creates a local definition.
- Validate the graph against the same closed definition schema the engine uses; an invalid graph cannot be saved, and the host remains authoritative.
- Keep layout in a sidecar (`.dsh/workflows/layout/<id>.json`), not in the runtime definition; the engine ignores layout.
- Overlay the latest or selected run for the definition on the canvas: node state, structured evidence, failure class, and violation; no execution from the canvas.
- Add keyboard navigation, focus, labels, and a list fallback when the canvas cannot render.
- Add the host write API for local definitions and layout, with the same auth and path checks as the read API, create-only and revision-checked saves, and separate definition and layout revisions.
- The engine's decisions, gates, executors, and definition schema are unchanged; the editor writes the same JSON the engine already loads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: adds the visual definition editor, the local definition lifecycle, the layout sidecar, the run overlay, the accessibility contract, the fallback, and the editor trust boundary. The capability is created by `add-workflow-obligations`; this change modifies it after that change's specs are synced.

## Impact

- `packages/plugin-workflows/src/client/**` (canvas, palette, property panel, graph conversion, run overlay), `src/host/**` (definition write API, template listing, layout store), tests, docs, locale, and icon.
- Add `@xyflow/react` to the plugin dependencies; the client build statically bundles it into `lib/client.js`, so no profile install, install script, or chunk split is added. Confirm the whole client bundle size and the license notice.
- Requires producer contract extensions in `add-workflow-observability` (`RunView` fields and a definition-filtered run route) and `add-workflow-obligations` (run-record definition id/name/version, per-step evidence and failure class, violations). Those changes own the edits; this change consumes and verifies the contract.
- No new DSH version, bundle row, engine behavior, or tracked data. Layout and local definitions live under `.dsh/workflows/`.
- Out of scope: new executors, changing the gates, retiring legacy gates, a model-authored active definition, real-time collaboration, a second shell or main panel, and client chunk splitting or a separate canvas artifact.
