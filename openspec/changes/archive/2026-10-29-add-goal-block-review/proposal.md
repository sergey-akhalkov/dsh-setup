# Proposal

## Why

Two inspected goal runs ended the same way: the agent marked the goal blocked while an authorized, non-user route still existed. In the first, it asked for approval to add a missing method to a sibling automation repository while the session had `danger-full-access`; in the second, it asked for permission to make the HMI testable while offering an operator-assisted alternative. Both blocks ended an autonomous run and cost hours of user time, and the user's one-line grant was enough to resume the work.

The goal is not to stop the agent from ever stopping. The goal is to stop only when the next step requires an action or knowledge that only the user has. The `goal-continuity` plugin owns the goal lifecycle, so the independent blocker review belongs there, not in the delegation-rules engine.

## What Changes

- Add a **block review gate** to `@dsh-setup/plugin-goal-continuity`. Every root-agent `update_goal(action: "blocked")` on an active goal is reviewed by an independent DeepSeek subagent before the block takes effect.
  - `not-blocker`: deny the tool call with a concrete next step; the goal stays active and the model continues.
  - `blocker`: allow the block and carry the exact user-only action into the closing message.
- Run the reviewer in a **read-only preset** contributed by the goal-continuity fragment: the preset exposes only read-only tools, and the gate applies a reviewer-scoped allowlist through the reviewer child's own scope after preset binding, filtering inherited global tools. The session sandbox is not the enforcement; a provider or preset that cannot apply the allowlist is unavailable.
- Bundle a **blocker-review prompt**, a strict verdict parser, a digest-bound record, a verdict cache, a per-goal review budget, and explicit error, unavailable, and exhausted policies. An `allow` policy is the only way to accept an unverified block, and it is recorded and visibly marked.
- Check the effective `blockedAfterConsecutiveRounds` threshold only for goal-round calls, so a premature goal-round block consumes no review budget, while a direct-human “continue” turn is still reviewed.
- Extend the always-on working contract with the user's blocker definition, the means-vs-scope rule, the standing-grant ledger rule, the no-menu rule, and the testability/instrumentation rule.
- Add the **standing-grant ledger** to the reviewer's evidence: the workspace `AGENTS.md` and a machine-local grant file. A covered action is not a permission blocker.
- Split the plugin boundary: the continuity supervisor remains deterministic and never calls a model; the block-review gate is the only model call, only for a pending block, and never starts or continues a turn.

Out of scope: completion review, question-only mode, changing the default runtime block threshold, and any new delegation-rules trigger or contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-continuity`: add the block-review gate, its read-only preset selection, threshold check, configuration and off switch, the verdict record, and the reviewer evidence/standing-grant requirements; modify the continuity supervision boundary so the deterministic supervisor and the bounded review subagent are separate responsibilities.
- `session-guidance`: replace the round-count-only blocker rule with the user-only definition, the means-vs-scope and permission rules, the standing-grant ledger, the no-menu rule, and testability/instrumentation as means; keep the contract within its documented budget.
- `portable-setup`: add the read-only reviewer preset declaration to the setup patch and allow its Harness-provided packages without duplicating them as setup dependencies.

## Impact

- `packages/plugin-goal-continuity`: Host source (including the child-scope reviewer allowlist), config, a new prompt asset, a read-only preset row in the composition fragment, tests, locale/README row.
- `packages/plugin-working-principles/assets/working-principles/contract.md` and its budget test.
- `scripts/lib/generate.ts`/`fragments.ts`: allow the goal-continuity fragment's `preset-goal-reviewer` declaration that names the Harness-provided `@deepseek-ai/dsh-agent-preset`; the setup patch includes it.
- Generated setup files and the vendored tree via `pnpm gen`; `pnpm build`.
- `docs/` and the root `README.md` plugin rows.
- No change to `delegation-rules` behavior; its engine remains for task/spec reviews and the `blocker` consultation rule is unchanged.
- Runtime: DSH `0.2.1-rc.3` `tools/pre-execute`, the `spawn` provider's `agentPreset` capability, and the Harness-provided read-only tools; the existing engines range stays pinned.
- The owner must fully restart the app for the Host change; live acceptance replays the two inspected incidents and the read-only preset.
