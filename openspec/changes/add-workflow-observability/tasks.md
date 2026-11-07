# Tasks

Lane 1 (package and Host recorder) and lane 2 (Client view) own disjoint files. Lane 3 is the serial integration tail that generates the setup tree, updates docs, and runs the full checks. All lanes are owned by the implementer; no parallel worker is required for this change because the Client depends on the Host API shape.

## 1. Package and bundle wiring (lane 1, owns `packages/plugin-workflows/package.json`, `packages/plugin-workflows/cordis.fragment.yml`, `packages/plugin-workflows/tsconfig.json`, `packages/plugin-workflows/src/host/index.ts`, `packages/plugin-workflows/src/client/index.tsx`, `packages/plugin-workflows/locale/en.json`, `packages/plugin-workflows/icon.svg`, `packages/setup/defaults.yml`)

- [x] 1.1 Create the package from the `plugin-observability` shape with the Host entry, the Client entry, `cordis.fragment.yml` row `dsh-setup-workflows`, `dsh.client.platform: web`, the conversation UI injection, the primitives external, locale, icon, and the `>=0.2.2-rc.1 <0.3.0` engine range; verify with `pnpm install --frozen-lockfile=false`, `pnpm build`, and `pnpm gen:check` after the next generation step.
- [ ] 1.2 Add the default row to `packages/setup/defaults.yml` and the plugin documentation rows; run `pnpm gen` and verify the generated setup tree contains the row and the vendored plugin files.

## 2. Host recorder, journal, and health (lane 1, owns `packages/plugin-workflows/src/host/journal.ts`, `packages/plugin-workflows/src/host/redact.ts`, `packages/plugin-workflows/src/host/health.ts`, `packages/plugin-workflows/src/host/fs-change.ts`, `packages/plugin-workflows/test/journal.test.ts`, `packages/plugin-workflows/test/redact.test.ts`, `packages/plugin-workflows/test/health.test.ts`, `packages/plugin-workflows/test/fs-change.test.ts`)

- [x] 2.1 Implement the event recorder for `agent/pre-step`, `agent/turn-stopping`, `tools/result`, `subagent/start`, and `subagent/end`; write one bounded JSONL record per event under `.dsh/workflows/events/<sessionId>.jsonl`; verify with a fake host that emits each event and asserts the record fields, ordering, a gate-refused stop attempt that leaves the turn running, and that a thrown listener is contained.
- [x] 2.2 Implement redaction for secret-shaped keys, bearer tokens, and private-key blocks, plus the per-record 4 KB cap and truncation marker; verify with unit tests for a token, a password, an authorization header, a private key block, and an oversized payload.
- [x] 2.3 Implement the per-session and workspace retention policy (30 days or 50 MB, tested with a small injected limit), the atomic append path, and the non-blocking prune; verify that a write over the limit removes the oldest file and that a failed write leaves the previous records intact.
- [x] 2.4 Implement `health.json` with listener count, last event time, journal writability, trigger count, and last error; verify the three health states and the 60-second self-check with a fake clock.
- [x] 2.5 Implement the `fs.watch` source for `openspec/changes/**` with a 250 ms debounce, workspace/session attribution, a rescan on a watcher error, and disposal on unload; verify a real file create and modify, a watcher failure, and that unloading disposes the watcher.

## 3. Shadow triggers and Why-not (lane 1, owns `packages/plugin-workflows/src/host/triggers.ts`, `packages/plugin-workflows/src/host/evaluate.ts`, `packages/plugin-workflows/assets/triggers/*.json`, `packages/plugin-workflows/test/triggers.test.ts`, `packages/plugin-workflows/test/evaluate.test.ts`)

- [x] 3.1 Define the shipped shadow trigger catalog for turn start, turn stop, tool result, subagent start/end, and OpenSpec file changes; validate id, event kind, filter, mode, and dedupe at load; verify a valid catalog loads and an invalid trigger fails with the field name.
- [ ] 3.2 Implement the pure evaluator returning `matched` plus the fixed reason vocabulary; verify one test per reason, including `would-fire`, event mismatch, path filter mismatch, debounce dedupe, disabled mode, and an internal error.
- [ ] 3.3 Wire the evaluator into the journal so every event stores its trigger evaluations and the Why-not page can read them; verify a duplicate file event produces one `matched` row and one `dedupe` row and no action.

## 4. Run projection (lane 1, owns `packages/plugin-workflows/src/host/projection.ts`, `packages/plugin-workflows/test/projection.test.ts`, `packages/plugin-workflows/test/fixtures/**`)

- [ ] 4.1 Implement the checkpoint adapter for `.dsh/work-checkpoints/<sha256(session)>/<turn>.json`: hash the requesting session id with the producer's algorithm (`sha256`, first 16 hex characters), read only that directory, and attribute its records to the requesting session; map outcome, lanes, bottleneck, and next to a `RunView`; verify with a producer-generated checkpoint from `packages/plugin-goal-continuity` that the record appears in its session timeline, a different session's hash is not listed, and a missing directory and a malformed file produce their documented states.
- [ ] 4.2 Implement the delegation adapter over the `RunFile` fields (`id`, `rule`, `change`, `taskId`, `state`, `record`, `startedAt`, `detail`), the review adapter for portable `openspec/changes/*/reviews/<taskId>.json`, and the read path for settled local review records; join a settled local record to its run only when `record.runId` equals the run id; verify with fixtures captured from the real `packages/plugin-delegation-rules` harness - a pending run file, a settled run with a matching record, a record path holding another run's `runId`, a missing field, and a malformed record - and assert no file is modified or deleted.
- [ ] 4.3 Implement the merged run timeline with stable ordering and source labels; verify a session with a hashed checkpoint, a delegate, and a review returns them in time order, a started or queued delegate result observed in that session attributes its run, a duplicate `already pending` result received by another session does not take ownership of the first session's run, cross-session record reuse leaves the run's attribution and steps unchanged, a record from another workspace is excluded, two sessions in one workspace stay separate, and a delegation run or portable record without a resolvable session is labeled `unattributed`.

## 5. Read API and session scoping (lane 1, owns `packages/plugin-workflows/src/host/api.ts`, `packages/plugin-workflows/test/api.test.ts`)

- [ ] 5.1 Register the routes through the carrier-neutral `ctx.connection.fetch` pattern used by the OpenSpec panel, with the standard admission check; verify the desktop Fetch carrier and the browser both receive 200, 401/403, 405 for a non-GET, and a bounded error body.
- [ ] 5.2 Implement cursor pagination with a default 50 and a max 200 limit, and a `next` cursor; verify an oversized `limit` is clamped, an invalid cursor is a 400, and a long session is returned page by page.
- [ ] 5.3 Enforce workspace and session scoping in every route; require a session selector on the triggers and health routes, resolve its workspace, and verify two workspaces and two sessions in one workspace receive their own state and no path outside the workspace is read.

## 6. Client Workflows view (lane 2, owns `packages/plugin-workflows/src/client/view.tsx`, `packages/plugin-workflows/src/client/panel.ts`, `packages/plugin-workflows/test/client.test.tsx`)

- [ ] 6.1 Register the `conversation.view` entry with id `workflows`, order 30, and a localized label; verify it renders beside Chat/Trajectory/Observability and is inert when the conversation services are absent.
- [ ] 6.2 Render the Triggers, Session, Runs, Why-not, and Health sections from the read API with loading, empty, error, and paginated states; verify each state with a static render test and no style block that redefines shipped tokens.
- [ ] 6.3 Render a run detail with step state, time, decision summary, evidence link, and error; verify a checkpoint run, a review run, and a malformed-record error row.
- [ ] 6.4 Add the Start/command entry if the host exposes a command surface for a conversation view; if it does not, record the tab as the entry and add the limitation to the docs; verify the command opens the view or the limitation is documented.

## 7. Safety and inertness (lane 3, owns `packages/plugin-workflows/test/no-side-effects.test.ts`, `packages/plugin-workflows/test/inert.test.ts`, `packages/plugin-workflows/test/live-harness.test.ts`)

- [ ] 7.1 Add a harness test that dispatches a turn start, a tool result, a subagent start/end, and a turn stop; assert zero `agent.steer`, zero `agent.inject`, zero `tools/pre-execute` registrations, and no write outside `.dsh/workflows/`.
- [ ] 7.2 Add an inert-host test for missing conversation, resources, locale, and filesystem services; assert no registration, one bounded diagnostic, and no thrown host boot error.
- [ ] 7.3 Add a live-harness check with a real session: open the Workflows view, run one turn with a checkpoint and a delegate, and confirm the timeline, the Why-not reason, and the health state; record the exact steps and result in the change.

## 8. Documentation and generated output (lane 3, owns `docs/plugins.md`, `README.md`, `packages/setup/cordis.patch.yml`, `packages/setup/package.json`, `packages/setup/node_modules/@dsh-setup/**`, `packages/plugin-workflows/cordis.patch.yml`)

- [ ] 8.1 Document the Workflows view, the shadow trigger catalog, the journal path, the read-only boundary, the retention limits, and the health states; verify the documented paths and commands match the implementation.
- [ ] 8.2 Run `pnpm gen`, `pnpm build`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, and `openspec validate add-workflow-observability --strict`; verify all pass and the generated tree contains the vendored package.

## Workflow follow-up

- Install the generated setup in a throwaway profile and open the Workflows view in a live session; verify the shadow triggers never steer.
- Archive the change after the project's review requirements are satisfied and the live check is recorded.
