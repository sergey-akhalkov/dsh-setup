# Tasks

## 1. Always-on contract rule

- [x] 1.1 Add the two-bullet "Delegate only to parallelize" section to `packages/plugin-working-principles/assets/working-principles/contract.md` after "Scope belongs to the user": one agent with its skills is the default; a subagent or teammate is allowed only for an independent, parallel piece that returns a compact result or for verification that needs a fresh context; no team for sequential work, ceremony, or a context restatement. Verify the section names the default, the allowed conditions, and the forbidden cases and adds no command the Harness does not provide.
- [x] 1.2 Raise `MAXIMUM_BYTES` in `packages/plugin-working-principles/test/budget.test.ts` from 4,800 to 5,200 and keep `BUDGET_TOKENS` at 1,500. Verify `pnpm exec vitest run packages/plugin-working-principles/test/budget.test.ts` passes and reports the new measured size.

## 2. On-demand rationale

- [x] 2.1 Add the "Delegate only to parallelize" rationale to `packages/plugin-working-principles/assets/working-principles/SKILL.md`: the conditions, the lossy-handoff failure mode, divide by context rather than by problem type, a one-shot subagent over a durable teammate, and folding a noisy handoff back into the main loop. Verify `pnpm exec vitest run packages/plugin-working-principles/test/skill-provider.test.ts` passes (the catalog description is unchanged) and the body is still read only on invocation.

## 3. Documentation

- [x] 3.1 Update `docs/principles.md`: name the delegation rule in "What the plugin ships", replace the contract's size and token values in the prompt-cost table with the measured values, and add the adaptation record (source, checked date, what was kept and dropped, paraphrased not copied). Verify `pnpm lint` passes and the table states the measured size the budget test reports.

## 4. Regeneration and repository checks

- [x] 4.1 Run `pnpm gen` and verify `pnpm gen:check` passes; confirm the vendored `packages/setup/node_modules/@dsh-setup/plugin-working-principles` copy carries the edited contract and skill.
- [x] 4.2 Run `pnpm test`, `pnpm lint`, and `pnpm validate:repo`; verify all pass and no generated file outside the vendored plugin copy changed. A live profile install is not part of this change; the assembled prompt is checked on the next install.

## Workflow follow-up

- Apply the change and tick the tasks.
- Sync the `session-guidance` delta into `openspec/specs/session-guidance/spec.md`.
- Archive the change after the project's review requirements are satisfied.
