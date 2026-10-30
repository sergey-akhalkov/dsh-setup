# Tasks

## 1. Package scaffold

- [x] 1.1 Create `packages/plugin-observability` from the Host+Client package shape of `packages/plugin-admin-indicator`: manifest, tsconfig, `cordis.fragment.yml`, `locale/en.json`, `icon.svg`, `src/host/`, `src/client/`. Verify `pnpm install` links the workspace package and `pnpm build` emits `lib/index.js` and `lib/client.js` with no type errors.
- [x] 1.2 Declare the setup row id `dsh-setup-observability` in the fragment and verify `pnpm gen` folds it into `packages/setup/cordis.patch.yml`, the vendored tree, and that `pnpm gen:check` passes.

## 2. Signal model and aggregation

- [x] 2.1 Implement the row schema — id, label, kind (`signal` or `guidance`), and for a signal one predicate or an any-of list of inert predicates (event type, tool, source kind, abort prefix, command, one argument field/value) — with fail-loud validation that names an unknown field. Verify with unit tests covering an accepted signal, an any-of list, a guidance row, and each rejected form.
- [x] 2.2 Implement the built-in `activity`, `tools`, and `errors` sets. Verify with fixture events that a profile with no configuration still yields turn, step, tool, and error rows, and that an unknown tool appears under its own name.
- [x] 2.3 Implement the pure `aggregate(records, signals, range)` function with the fixed buckets (session → turns plus one outside-turn bucket, day → 24 hours, week → 7 days, month → calendar days). Verify with tests for each range, an empty window, a command-only session landing in the outside-turn bucket, error counting, source-kind attribution, abort-prefix attribution, and an unmapped tool staying visible.
- [x] 2.4 Implement the liveness comparison against the live tool registry and the four status words, including the explicit `silent` label and the exclusion of guidance rows from all four. Verify with a stub registry: a configured tool absent from the registry reports `not loaded`, a loaded signal with no traces reports `silent` with the no-traces text, and a guidance row stays guidance-only.

## 3. Host reading and route

- [x] 3.1 Implement the session reader over the Host session query service: select the workspace sessions whose events fall in the window, start each session at the `inheritedEventCount` returned by `sessionQuery.readSession` so a seeded fork prefix is not counted, include subagent child sessions, and read with bounded concurrency. Verify with a fake query service whose fixtures use the real `SessionLogSnapshot` shape (`session` header plus `inheritedEventCount` plus events) that the window filter selects the expected sessions, a child session counts, and a child seeded with a parent prefix adds no duplicate count.
- [x] 3.2 Add the bounded in-memory per-session aggregate cache keyed by session identity and modification time. Verify with a test that a repeated unchanged request does not re-read the session and that the cache never writes to disk.
- [x] 3.3 Register the Host web route that returns the report JSON for a range, with range validation and the connection admission check the other plugin routes use. Verify with route tests for a valid range, an invalid range, and an unauthorized request.

## 4. Client dashboard

- [x] 4.1 Register the Conversation view with id `observability`, order 20, and a localized label, through the slot service the other Client plugin uses. Verify the client build exports the registration and a unit test asserts the registration options.
- [x] 4.2 Extend the report with dashboard data: totals (turns, steps, tool calls, errors, records), a per-bucket activity and error series computed once from the records, a row group (`activity`, `tools`, `sources`, `aborts`, `errors`, `plugin`) and the row's last activity. Verify with host tests that totals and series do not double count overlapping rows and that every row carries its group.
- [x] 4.3 Render the dashboard: health summary, KPI strip, activity chart with axis, legend, and error layer, plugin cards grouped by attention (status pill, counts, sparkline, last activity, tool chips), tools distribution, and a collapsed blind-spots block. Verify with component fixtures for healthy, error, silent, not-loaded, and guidance states.
- [x] 4.4 Render trace detail on demand: a card expands to at most the five most recent entries with time, turn, row id, tool name, and error flag, and no message text or tool arguments. Verify with a fixture whose underlying event text contains a secret-like string and assert it never reaches the rendered output.
- [x] 4.5 Add the range selector and refetch on change, plus loading, empty, and route-error states. Owner verifies in the running GUI that the week range renders seven buckets and the day range renders 24.
- [x] 4.6 Owner verifies the dashboard in the running GUI in both light and dark themes and records the result.

## 5. Setup data

- [x] 5.1 Add the shipped plugin row map to `packages/setup/defaults.yml` — signal rows for the plugins with tools, message kinds, or aborts, and guidance rows for the prompt-only plugins — run `pnpm gen`, and verify the generated setup patch carries the map and `pnpm validate:repo` passes.
- [x] 5.2 Add a test that every tool name in the shipped map is registered by the plugin that maps it, and that every guidance row names an installed plugin that registers no tool, so a rename or a removal fails the suite instead of silently blanking a row.

## 6. Documentation

- [x] 6.1 Document the view, the status words, the blind spots, and how to add a custom signal in `docs/plugins.md`, and add the package row to the README plugin table. Verify `pnpm lint:fix` formats both files and the documented example config validates against the shipped schema.

## 7. Integration

- [x] 7.1 Run the local gate — `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm build && git diff --exit-code` — and verify all pass.
- [x] 7.2 Run `pnpm dogfood` and verify the composed profile copy contains the observability row with the shipped signal map and no other row changed.

## Workflow follow-up

- The owner installs the regenerated setup from an external PowerShell and confirms the Observability tab in the Desktop app.
- Archive the change once every checked task has its task-review PASS.
