# Tasks

## 1. Workflows engine: review executor, condition, record store (lane 1, owns `packages/plugin-workflows/src/host/**`)

- [x] 1.1 Add the `review` executor: resolve `reviewers.<target>`, start the reviewer through the registered provider with the profile's model/effort, render the bundled instruction with the change name, task id and text, and the prepared digest, accept exactly one fenced JSON verdict that echoes the digest, validate the severity set, write the record, settle the step from its own evidence, and time the run out with an `ERROR`. Verify `pnpm exec vitest run packages/plugin-workflows/test` covers a PASS, a FINDINGS, an invalid verdict, a digest mismatch, and a missing provider.
- [x] 1.2 Add the trigger `condition`: a bounded JSONLogic predicate over the event, the change's checked and unchecked tasks and lanes, the current whole-spec and task records with their digests, the current spec and worktree digests, and the session's involvement; evaluate it at every turn close and refuse an unknown field, a non-JSONLogic predicate, or a path in the context. Verify tests cover each context field, a true and a false predicate, and a malformed predicate that fails load with the field.
- [x] 1.3 Add the record store `.dsh/workflows/records/<definition>/<change>/<phase>.json` and `.../tasks/<taskId>.json`, keep the committed `openspec/changes/<change>/reviews/<taskId>.json` byte-compatible, write it before the local record, and turn a failed committed write into an `ERROR` record. Verify `pnpm exec vitest run packages/plugin-workflows/test` covers the write order, the sanitized field set, and the failed-publication case, and that `pnpm reviews:check --all` is unchanged.
- [x] 1.4 Move the review queue and the task-scope snapshot into the engine: concurrency, `maxQueued`, `maxAttempts`, backoff, `waitTimeoutMs`, dedupe by rule plus change plus task plus digest plus reviewer, a frozen `.dsh/workflows/snapshots/<runId>` checkout, the live-input guard for whole scope, and the stale-snapshot sweep. Verify the queue and snapshot tests move with the code and pass.
- [x] 1.5 Add `reviewers`, `reviewQueue`, and `timeouts.review` to the row config with fail-loud validation; reject `model`/`reasoningEffort` for a provider without `agentOptions` support, and report a missing provider at run time instead of at load. Verify a config test covers each default, each range, and the unsupported-option rejection.
- [ ] 1.6 Add the engine-owned gates: the `note` action and the work-progress gate (digest-bound, stale note refused, task-review evidence read from the active review owner's record store), the lane-assignment gate with the tagged worker and serial-note satisfaction, and the goal-complete guard moved from the delegation listener to the workflows gate listener. Each engine-owned gate SHALL resolve ownership per signal: it is active only while its legacy switch (`gates.taskProgress`, `gates.laneFanout`) is false, and re-enabling that switch disables its workflow counterpart with a refused split state. Verify tests cover an unassigned lane, a tagged worker start, a serial note, a stale note, a refused goal completion, a native PASS read by the legacy progress gate when only `taskProgress` is enabled, and a composed-profile rollback of each engine gate with every unrelated gate still active.
- [ ] 1.7 Keep `delegate`, `task_progress`, and `delegation_status` as deprecated aliases for one release and route them by effective owner: while a signal is owned, `delegate` starts the matching definition run and `task_progress` calls `note`; while its legacy signal is enabled, `delegate` runs the legacy rule and `task_progress` writes the legacy note path. A `task_progress` or `note` call SHALL also update the active lane owner's serial state, so a mixed ownership combination satisfies both gates. `delegation_status` returns the workflows status summary with a deprecation line. Verify a test asserts both routing modes, the legacy state paths, the mixed-ownership note, and that the deprecation line prints once.
- [ ] 1.8 Wire the review run into the subagent catalog as the existing external child `delegation:<rule>` with a settlement notification, and keep in-process providers unchanged. Verify the catalog test and the settlement test pass.
- [ ] 1.9 Extend the parity runtime binding in `src/host/parity.ts` to the retired `spec-review`, `integrationReview`, work-progress, and lane gates, and make a missing evaluator or a decision mismatch fail certification instead of passing. Verify a test asserts that a mismatch and an absent evaluator each fail `node scripts/workflows-parity.ts --check` and the matching ownership gate.

## 2. Runtime assets, shipped definitions, and parity (lane 2, owns `packages/plugin-workflows/assets/**`, `packages/plugin-openspec/assets/workflows/**`, `packages/plugin-workflows/test/parity-fixtures.ts`, `scripts/workflows-parity.ts`)

- [x] 2.1 Copy the bundled review instructions (`review-spec`, `review-task`, `review-integration`) from `packages/plugin-delegation-rules/assets/**` into the workflows assets byte-identically, keep the legacy copies until Release B, and keep the finding `class` vocabulary and the P0/P1 severity request. Verify an assets test asserts the shipped instruction ids, the byte-equality of both copies, and that a legacy `bundled:` instruction still resolves.
- [x] 2.2 Ship `spec-review`, `task-review`, and `integration-review` as engine definitions on the review executor: whole scope with `condition` on the spec digest and record, task scope per checked task with the snapshot, and integration scope as a blocking step with `maxBlocks: 1` that reproduces the legacy once-only refusal, records the declared violation, and settles as `completed-soft` on budget exhaustion so the run keeps no open required step and never counts as a pass; declare `settings.gate: "review"` and the gate identity. Verify a definition test loads each one, asserts the executor and evidence shape, the integration refusal sequence, the `completed-soft` settlement, and refuses a local copy that drops the review step.
- [x] 2.3 Keep the delegation fragment's rules — including a dormant `implementation-work` note rule for the progress gate — and its `codex` target configured for rollback, and set `gates: { workflowOwned: false, specReview: false, integrationReview: false, taskProgress: false, laneFanout: false }`; the shipped `codex` model/effort is also copied to `reviewers.codex` in the setup defaults. Verify a fragment test parses the file, asserts the rule and target lists and the five switch values, and a composed-profile test asserts no legacy steer and no double review.
- [x] 2.4 Extend the parity machinery, not only the report: add executable legacy and workflow fixtures for `spec-review`, `integrationReview`, work-progress, and lane in `packages/plugin-workflows/test/parity-fixtures.ts`, make `scripts/workflows-parity.ts` replay each retained case, compare the per-turn decision sequence for the `soft` integration signal, and fail on a decision mismatch or a missing evaluator, extend `assets/parity/retire-legacy-gates.json` with the replay counts, the declared violation difference, and the new template hashes for `spec-review`, `task-review`, and `integration-review`. Add the archive case: a pending integration run after budget exhaustion MUST NOT block an otherwise authorized archive. Verify `node scripts/workflows-parity.ts --check` passes, fails when one template hash is edited, fails on a decision mismatch, fails when an evaluator is absent, and fails when the exhausted soft run blocks the archive.
- [x] 2.5 Flip the contributed `change-intake` `spec-review` step to `own` on the review executor, keep its other steps unchanged, and update the OpenSpec plugin tests. Verify the intake test asserts the owned step and that a missing whole-spec record steers the review instead of reading a legacy path.

## 3. Contract surface in the client (lane 3, owns `packages/plugin-workflows/src/client/**`)

- [x] 3.1 Render a review step's contract in the inspector: the instruction id and prompt summary, the scope and phase, the digest scope, the verdict schema, the reuse policy, and the record path; keep the canvas read-only and the ordered step table as the accessible fallback. Verify the client test asserts the card for a review step and the absence of an editable verdict field.
- [x] 3.2 Render each engine-owned gate as a read-only contract card (trigger condition, evidence, record path, steer payload) in the Workflows surface, and never as a definition node. Verify the test asserts a card per gate and that no gate appears in the definition rail.
- [x] 3.3 Update the locale strings, the screen-reader summary, and the bundle budget record for the added card text. Verify `pnpm exec vitest run packages/plugin-workflows/test` passes and the canvas budget test still passes.

## 4. Legacy switches and the retained-gate steers (lane 4, owns `packages/plugin-delegation-rules/src/host/**`, `packages/plugin-delegation-rules/test/**`)

- [x] 4.1 Replace `gates.workflowOwned` with the per-signal map
  `{ workflowOwned, specReview, integrationReview, taskProgress, laneFanout }`, defaulting each to
  `true` for an existing profile, and keep an unknown key a load error naming the accepted keys.
  Verify a config test covers the defaults, each false value, and the unknown-key rejection.
- [x] 4.2 Make each false switch disable exactly its steer: `specReview` the whole-spec rule,
  `integrationReview` the `implementation-complete` rule, `taskProgress` the progress gate plus its
  dormant `implementation-work` rule, `laneFanout` the lane triggers, and `workflowOwned` the
  task-review rule and the archive gate; keep the tools, records, queue, and notes readable in every
  combination. When the review signal is owned, the legacy progress branch SHALL read task-review
  evidence from the active review owner's record store. Verify a gate test asserts one disabled steer
  and every other steer still active per switch, and the native-record read.
- [x] 4.3 Extend the per-signal ownership check in both engines: the shipped definitions resolve
  their effective ownership from the switch (legacy signal enabled means effective `defer`), an
  explicit local override that contradicts the switch is refused, and a `defer` beside a disabled
  signal or an `own` beside an enabled one is refused with the switch name and the remedy. Verify the
  split-state and contradiction tests cover all five signals in both directions.
- [x] 4.4 Update the delegation tests to the dormant shipped set and the five switches, keeping every
  queue, record, approval, and snapshot case that moved. Verify
  `pnpm exec vitest run packages/plugin-delegation-rules/test` passes.
- [x] 4.5 Add rollback tests from the exact shipped Release A configuration: flip one switch, run the
  call the restored steer prints (`delegate` or `task_progress`), and prove the restored gate is
  satisfied through the legacy runtime and its state; cover the mixed ownership combinations
  (progress owned with a legacy lane gate and the converse) through the printed serial-note
  alternative; cover the `taskProgress`-only case where the final task was checked and reviewed
  natively; run a legacy task review to a PASS and prove the committed approval satisfies completion
  and archive; complete a task list with every switch off and prove only the native integration
  review acts. Verify each test fails when its switch is left off and passes when it is on.

## 5. Serial integration (serial, owns `packages/setup/**`, `packages/plugin-delegation-rules/cordis.fragment.yml`, `docs/**`)

- [ ] 5.1 Update `packages/setup/defaults.yml`: `reviewers.codex`, `reviewQueue`, `timeouts.review` on the workflows row; the delegation row keeps its rules (including the dormant `implementation-work` note rule) and target and carries the five false switches. Run `pnpm build` and then `pnpm gen`, and commit the regenerated setup manifest, patch, and vendored tree. Verify `pnpm gen:check` passes and a composed-profile test asserts the legacy rules are still configured while no legacy steer installs and no review runs twice.
- [ ] 5.2 Update `docs/workflows.md`, `docs/delegation-rules.md`, `docs/plugins.md`, and `docs/openspec-status.md`: the review executor, `condition`, reviewers, records, engine gate cards, the per-signal switches, and the Release B plan. Verify `pnpm lint:fix` leaves the files unchanged.
- [ ] 5.3 Run `pnpm build && git diff --exit-code`, `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`, and `node scripts/workflows-parity.ts --check`. Verify every command exits 0.
- [ ] 5.4 Run a live acceptance in a throwaway profile: one task review through the engine (record plus committed approval), one whole-spec review, one refused close with a missing record, and one lane fan-out steer. Verify each run appears in the Workflows view with its evidence and the approval matches the current format.

## 6. Release handoff (serial, owns `openspec/changes/**`)

- [ ] 6.1 Create the Release B change `retire-delegation-rules` through the intake flow, with proposal, design, tasks, and delta specs scoped to deletion only: removing the plugin, folding its 70 requirements into `workflows` and `review-approval`, and removing the row, docs, skill, observability row, legacy prompt copies, and bundle entries. Verify `openspec validate retire-delegation-rules --strict` exits 0 and its tasks name the deletion with no new behavior.
- [ ] 6.2 Link the Release B change from this change's proposal and design, and confirm it starts only after this change's live profile has run a native review. Verify a reader of either change sees the two-release order and the rollback flips.

## Workflow follow-up

- Archive this change after `pnpm reviews:check --change move-review-runtime-into-workflows` reports every checked task approved.
- After the owner installs the Release A build, confirm in the installed profile that the workflow definitions own the review, the engine gate cards render, the delegation row ships no rule, and one review record plus its committed approval are produced.
- Release B starts only after that confirmation; it is the change created by task 6.1.
