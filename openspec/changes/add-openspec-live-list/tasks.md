# Tasks

## 1. Host row fact — `packages/plugin-openspec/src/host/change-list.ts`, `packages/plugin-openspec/test/change-list.test.ts`

- [x] 1.1 Add `deltaCapabilities: readonly string[]` to `WorkspaceChange` and fill it from the same
      `deltaSpecFiles` result that already produces `presence.specs` and `requirementCount` (one walk,
      no second pass); keep it on active and archived rows and additive on the wire. Verify
      `change-list.test.ts` covers a change with two delta specs (one nested id such as `identity/auth`),
      a change with none, and an archived row, asserting the field and the unchanged existing row shape.

## 2. Client watch wiring — `packages/plugin-openspec/src/client/panel.ts`, `packages/plugin-openspec/src/client/index.tsx`, `packages/plugin-openspec/test/panel.test.ts`

- [x] 2.1 Add the optional `deltaCapabilities` field to `ChangeRow` and use it to build the root's watch
      addresses through the existing `changeWatchPaths` and `fileAddress` helpers. Verify a unit test
      shows a row with two delta specs yields the proposal, design, tasks, and two delta addresses, while
      a row missing the field (older host) yields only the three fixed artifacts.
- [x] 2.2 Pass `useResource` from `OpenSpecTab` into `RootBody`; retain the last ready row set in a ref
      and render a Changes-only observation component as a sibling of the read content — never inside the
      ready branch — that owns `useLiveReload(changes.reload)` plus `useObservation` and one hidden
      `FileWatch` per address of the active rows, with archived rows contributing no address. A list
      re-read's loading render must not unmount or restart the observer; leaving Changes disposes the
      batch and cancels a pending debounce. Verify component tests assert the mounted watch set for a
      mixed active and archived response, no watch on the Specs and Archive segments, and that a
      loading re-render keeps the same observation alive.
- [x] 2.3 Cover the live loop in `panel.test.ts`: a version bump on one row's `tasks.md` schedules exactly
      one list re-read after the 300 ms debounce, an unchanged version schedules none, the first
      settlement of the initial set schedules one reconciliation read, an absent-then-live transition
      re-reads, leaving Changes with a pending debounce cancels the read, returning to Changes with an
      unchanged address set schedules exactly one reconciliation read, unmount clears the pending timer
      and subscriptions, and no polling timer is started. Verify the file passes with
      `pnpm exec vitest run packages/plugin-openspec/test/panel.test.ts`.

## 3. Documentation and generated tree — `docs/plugins.md`, `packages/setup`

- [ ] 3.1 Update the panel's live-update section in `docs/plugins.md`: the Changes segment follows the
      files of its active rows, the 300 ms debounce, archived rows and the Archive segment stay manual,
      a newly created change needs the native refresh, and no polling or plugin-owned watcher exists.
      Verify `pnpm lint` and `pnpm validate:repo` pass.
- [ ] 3.2 Run `pnpm build` first, then `pnpm gen` — the generator vendors the package's declared
      publishable files, so generating before building would copy the previous `lib/**` into
      `packages/setup` — then commit the emitted `lib/**` and the regenerated vendored tree. Verify
      `pnpm gen:check` passes, the vendored `plugin-openspec/lib/client.js` carries the list
      observation, and the vendored `lib/change-list.js` carries `deltaCapabilities`.

## 4. Integration gate

- [ ] 4.1 Run `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm build && git diff --exit-code`;
      verify every command exits zero and the build produces no drift.

## Workflow follow-up

- Owner smoke on the installed setup, from an external PowerShell with the desktop app closed (never
  from an agent session): open the panel's Changes segment, tick a task in an active change and confirm
  the card's counts and last-modified fact update without touching the tab; archive a change and confirm
  the row leaves; create a change and confirm it needs the native refresh; confirm no polling requests.
- Sync the delta into `openspec/specs/openspec-panel/spec.md` and add the change's row plus a
  results/follow-up section to `docs/openspec-status.md`.
- Archive only after `pnpm reviews:check --change add-openspec-live-list` reports every checked task
  approved.
