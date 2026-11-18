# Tasks

One work lane plus the serial tail: both source edits live in the same hot file
(`packages/plugin-workflows/src/host/index.ts`), their regressions in one test file, and the shipped
output is generated `lib/**` behind one repository gate, so splitting the fix from its tests would
only add handoff.

## 1. Involvement and close-gate fix (owns `packages/plugin-workflows/src/host/index.ts`, `packages/plugin-workflows/src/host/engine-gates.ts`, `packages/plugin-workflows/test/host-wiring.test.ts`, `docs/**`)

- [x] 1.1 Filter the trigger-path involvement union with `activeChangeNames` and verify host test (a): a stored involvement naming an archived change starts no whole-spec run and refuses nothing.
- [x] 1.2 Settle an unresolved review run whose recorded change is archived cancelled once, before automatic advancement and before gate evaluation, and verify host tests (b), (d), (e) and the terminal case: the next close neither refuses nor starts a round, the unresolved run is cancelled with a reason and stays unchanged afterwards for both archive layouts (including a date-prefixed name in the undated layout), and a terminal task-review run stays byte-identical.
- [x] 1.3 Add the anti-overfilter host test (c) and verify an active involved change still starts its whole-spec round and refuses the close; the missing-change regression (`blocks the close when a failed review leaves no record to read`) keeps passing.
- [x] 1.4 Mutation-check the regressions: revert the source edits, confirm (a), (b), (d) and (e) fail and (c) passes; widen the filter to drop active names, confirm (c) fails; restore the fix.
- [x] 1.5 Refuse a committed approval when the change is no longer active, so a late verdict cannot recreate the archived directory, and verify the review unit test that asserts the refusal and the untouched `openspec/changes` tree.
- [x] 1.5 Document the behavior in `docs/workflows.md` and add the change section to `docs/openspec-status.md`; verify `pnpm lint` reports no Markdown problem.

## 2. serial tail: generated output and the repository gate

- [x] 2.1 Run `pnpm build` and `pnpm gen` and commit the regenerated `packages/plugin-workflows/lib/**`; verify `pnpm gen:check` exits 0 and a second `pnpm build` leaves `rtk git diff --exit-code -- packages/plugin-workflows/lib` clean.
- [x] 2.2 Run the gate in order: `pnpm exec tsc -p tsconfig.check.json --noEmit`, `pnpm exec vitest run packages/plugin-workflows/test/host-wiring.test.ts`, then `pnpm build && pnpm gen && pnpm lint && pnpm check`; verify every command exits 0.
- [x] 2.3 Validate the plan: `openspec validate ignore-archived-change-involvement --strict` exits 0.

## Workflow follow-up

- Start the section task review, the whole-spec review, and the integration review; each must be a current `PASS` before the archive.
- Run `pnpm reviews:check --all`, then archive the change through the gate.
- Release only on the owner's command.
