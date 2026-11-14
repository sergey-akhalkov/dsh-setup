# Design

## Context

The engine, its shipped rule set, and the review runtime live in one package
(`packages/plugin-delegation-rules`), and four consumers depend on the package today: the workflows
`task-review` definition calls the `delegate` review contract, `scripts/reviews-check.ts` imports
`shared/approval.ts`, the pre-push hook and both CI workflows audit portable approvals, and the
archive gate in `plugin-workflows` reads the same records. None of those touch `answer`, `patch`,
`failure-streak`, or review learning. The accepted `workflows` spec still requires the owned
task-review gate to keep the learning loop, so retiring learning changes that requirement too. The
live profile is installed from the setup bundle, whose patch replaces the whole `config` object, so
shipped defaults are the only rule set a normal install has.

## Goals / Non-Goals

**Goals:**

- Delete the contracts, trigger, rules, targets, tools, and support modules that have no consumer.
- Keep the review runtime and every artifact the repository already depends on byte-compatible:
  local records, portable approvals, queue state, digests, and the gate-only retirement switch.
- Leave one documented way to do ad-hoc delegation (`subagent` / `codex_subagent`), not two.
- Make a removed contract or trigger fail at configuration load with the replacement named.

**Non-Goals:**

- Moving the `spec-review`, `task-progress`, or lane gates into workflow definitions.
- Changing review behavior, prompts, digests, approvals, or the archive gate.
- Migrating or deleting local `.dsh/review-learning/` scratch.

## Decisions

**Delete the `answer` and `patch` contracts instead of leaving them unconfigured.** A contract with
no shipped rule is dead code, dead validation, and dead documentation that still compiles and still
runs tests. Alternatives considered: keep `answer` for `blocker` only (rejected — one soft rule does
not justify the contract, and the working-principles contract already tells the agent to change
approach and escalate instead of retrying); keep `patch` for future use (rejected — `create_worktree`
plus a write-capable `subagent` is the documented route, and the contract had no recorded run).

**Delete the `failure-streak` trigger with the `answer` contract.** The trigger only ever selected a
soft `answer` rule; with the contract gone no rule shape can use it. `manual` stays because an
explicit review rule is still a valid profile configuration.

**Retire the `review-learning` capability instead of defaulting it off.** It shipped, stored zero
lessons, and its purpose (durable lessons) is served by Hindsight. A disabled-by-default feature
would still keep `learning-tools.ts`, `lesson-store.ts`, `retro.ts`, `finding-history.ts`, four test
files, eleven requirements, and a documentation section alive. The accepted `workflows` requirement
`Owned task-review gate` says the learning loop MUST remain, so the same change amends it to keep the
queue and records without the learning loop; leaving it untouched would make the archive leave an
accepted workflow obligation unsatisfied.

**Keep finding `class` in review records.** The verdict parser already stores it, the reviewer
prompt already asks for it, and it is useful triage data in a record a human reads. Removing it
would change review prompts and every fixture for no size gain; the `Review finding classification`
requirement stays as-is.

**Collapse shipped targets to `codex`.** Targets are data; `worker-fast`, `worker-deep`,
`codex-astra`, and `codex-write` exist only for the removed rules. The `codex-subagent-write`
provider stays registered because it is a general write-capable subagent that `subagent` can still
select; only the shipped target that wired it into the patch contract goes.

**Fail loudly on a stale profile rule.** Configuration validation must reject `contract: answer`,
`contract: patch`, `when: failure-streak`, `isolation: worktree`, and a target `write: true` with a
message naming the removal and the replacement tool. Silent acceptance would compose a profile
whose rule never runs.

## Risks / Trade-offs

- Losing the blocker consult after a failure streak → loop-guard still bounds a repeated loop, and
  the working-principles contract still requires a changed approach and an explicit escalation; the
  cost is at most a wasted turn, and no gate depends on the consult.
- An external profile with a custom answer or patch rule fails to load → the validation message names
  the removed contract and the replacement; the docs carry a migration paragraph and a changelog
  entry in the release notes.
- The removed finding history was the only local record of findings that a later PASS overwrote →
  existing records and the Hindsight memory keep the history that matters; nothing is migrated.
- Deleting a parse path can disturb a consumer that imported it → the change keeps
  `shared/approval.ts` and every exported symbol the scripts, workflows, and hook use; the removal is
  limited to host modules and assets with no importer outside the package.

## Migration Plan

1. Land the code removal, the delta specs, the docs, and the regenerated setup bundle in one release.
2. Build before generating: `pnpm build`, then `pnpm gen` (generation vendors the existing `lib/**`,
   so generating first would vendor the old runtime). The package `files` manifest drops the removed
   modules and assets before either runs, because generation rejects a declared file that is absent.
3. `pnpm gen:check` and `pnpm check` prove the vendored tree and the measured budgets match the
   sources.
4. An installed profile receives the new defaults through the setup patch; a profile that overrides
   `rules` must drop its answer/patch rules in the same edit.
5. Rollback is a version downgrade: no on-disk state is rewritten, and records, approvals, queue
   files, and `.dsh/review-learning/` stay readable by the previous release.

## Open Questions

None. Moving the remaining gates belongs to the follow-up change named in the proposal.
