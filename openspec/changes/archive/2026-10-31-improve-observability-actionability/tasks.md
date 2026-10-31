# Tasks

## 1. Failure extraction and report

- [x] 1.1 Extend the neutral record extraction in `packages/plugin-observability/src/host/records.ts`: keep `callId` on a tool call and its result, the failed result's `error.name` and `error.code`, the `turn/end` kind, and the turn failure's `LlmFailure.code`. Do not keep `error.reason`, `LlmFailure.message`, message content, or arguments beyond the predicate field. Verify with fixtures covering every turn-end kind, a failed result with and without an `error`, a result whose call is outside the read, and an assertion that the raw reason and message strings never reach a record.
- [x] 1.2 Add the failure model to `packages/plugin-observability/src/host/report.ts`: `failures` newest first with severity (`turn failure`, `turn cut`, `tool failure`), `recovered`, time, session, turn, step, tool, call id, and error name/code; uncapped `failureTotals`; a bounded rendered list; recovery resolved by turn over the session's full record set; a missing identity stays absent rather than invented. Verify with fixtures for a mixed 22-failure window, a turn closer just outside the window, a recovered and an unrecovered tool failure, a cut turn, an open turn, a window with more failures than the bound, and a failure without an error object.
- [x] 1.3 Resolve session titles for the unique failure sessions through `sessionQuery.readTitleSnapshots`, with a short-id fallback, and keep the call degradable so a query fake without titles still reports. Verify with a fake reader for a present title, an absent title, and a rejected title lookup.
- [x] 1.4 Extend the route test to assert the report JSON carries the failure fields and none of the fixture's message text, arguments, or raw failure reason; keep the route GET-only and read-only.
- [x] 1.5 Add per-tool call outcomes for the tool distribution: count in-window `tool/call` events per tool and join each call to its own failed result by session and call id, independent of the result's time, so the failing share never exceeds the call count; a call with no joined failed result is not failed. Verify with fixtures for a proportional share, a failed result whose call is outside the window, a call whose result is outside the window, a missing result, a tool with zero calls, and a repeated call id across sessions.

## 2. Readiness and configuration

- [x] 2.1 Extend the row schema in `packages/plugin-observability/src/host/rows.ts`: an optional `trigger` string on any row, and an optional `mounted` object with `section` and/or `skill` allowed on guidance rows only, at least one name, unknown fields rejected with the field named. Verify with tests for a signal with a trigger, a guidance row with a section, one with a skill, both, an empty `mounted`, `mounted` on a signal row, and an unknown key.
- [x] 2.2 Implement readiness in `packages/plugin-observability/src/host/status.ts` and the optional services in `src/host/index.ts`: the existing tool-registry check, prompt sections through `systemPrompt.assemble()` section names, skills through `skills.snapshot()` with its `complete` flag, and the words `mounted`, `not mounted`, and `readiness unknown`. Only `not mounted` joins needs-attention; an unavailable service, a throwing assembly, or an incomplete skill observation reports unknown and never a failure; guidance never becomes silent or error. Verify with fakes for a present section, an absent section, a present skill, a missing service, a throwing assembly, an incomplete catalog whose skill is absent, and an undeclared guidance row.
- [x] 2.3 Give every shipped row a `trigger` and every guidance row its `mounted` names in `packages/setup/defaults.yml`, run `pnpm gen`, and extend `test/signal-map.test.ts` to require a trigger on every row and prove each declared section and skill is actually contributed by the named plugin through captured registries. Verify `pnpm gen:check`.

## 3. Client: failure surface and actions

- [x] 3.1 Add the failure section in `packages/plugin-observability/src/client/index.tsx`: collapsed by default, severity groups, entry metadata, expand and collapse, the bound note, copy, and one pluralization helper; turn the KPI failure count into a button with `aria-expanded` that reveals the section and moves focus to it. Verify with component tests for the 22-failure fixture, recovered entries, an empty list, and the control's accessibility attributes.
- [x] 3.2 Wire the entry actions: `inspectCall(callId)` with `openView('trajectory', callId)` as fallback in the current session; `uiWorkspace.openSession(sessionId)` for another session, shown only when that optional service resolves; and "Fix in a new session" through `uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })` with a bounded self-contained prompt (time, session id and title, sequence, turn/step, tool, name/code, instructions to read the events and fix root causes), no automatic submit, and copy-only degradation when the service is absent. Verify with fake services for the call shape, append mode, no submit, the cross-session open, both degraded paths, and the prompt bound with its omission note.
- [x] 3.3 Fold the new state into the rest of the dashboard: the health verdict is the union of turn failures, turn cuts, unrecovered tool failures, not-loaded tools, and not-mounted guidance rows, and never comes from silence or recovered failures; an error card shows the last failure's tool and identity and links to the filtered failure list; silent cards become compact rows with the trigger and the window denominators, with the absence note once per section; guidance rows show their readiness word; tool bars stack the failing share from the per-tool call outcomes with its count and percentage. Verify with component fixtures per state and an assertion that every state carries its word, not only its colour.

## 4. Documentation

- [x] 4.1 Document in `docs/plugins.md` the failure taxonomy and recovery, the actions and their limits (no focus across a session boundary, the fix prompt is a draft), and the `trigger` and `mounted` row fields with a valid example; update the existing custom-signal example to carry a trigger. Verify `pnpm lint:fix` formats the file and the example validates against the shipped schema.

## 5. Integration

- [x] 5.1 Run the local gate — `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm build && git diff --exit-code` — and fix what fails.
- [x] 5.2 Run `pnpm dogfood` and verify the composed observability row carries every trigger and guidance readiness descriptor and no other row changed.
- [x] 5.3 Owner verifies in the running Desktop app after an external install: failures listed with their context, the fix control opening a prefilled draft, silent rows with triggers, guidance readiness words, proportional tool bars, in both themes.

## Workflow follow-up

- Apply task by task: mark a task `[x]` only when it is complete, then run its task-scoped review before the next one.
- Run `pnpm reviews:check --change improve-observability-actionability` before archiving; every checked task needs its committed task-review PASS.
- The owner installs the regenerated setup from an external PowerShell and keeps the app closed during the install.
