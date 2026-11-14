# Proposal

## Why

`@dsh-setup/plugin-delegation-rules` is 21% of the plugin source and 18% of the plugin tests, but
its demonstrated value is the review/approval core: 1541 review runs in this workspace, 703 verdict
records, and 13 of the last 50 settled reviews returned findings. The rest duplicates mechanics the
setup already ships and has no measured use:

- the manual `answer` rules (`research`, `advisor`, `worker-fast`, `worker-deep`) re-implement the
  first-party `subagent` and `codex_subagent` tools, which already take a provider, model, and
  reasoning effort;
- the `patch` contract re-implements `create_worktree` plus a write-capable subagent, and this
  workspace has no worktree or run from it;
- review learning stored zero lessons since it shipped; only its 50-entry history file exists;
- the `failure-streak` trigger exists only to reach an `answer` rule.

The bundle absorbs 24 of the repository's 75 archived changes and a 60 KB document, so every
contract without a use is paid for in code, tests, and review runs on this repository itself.

## What Changes

- **BREAKING** — Remove the `answer` and `patch` result contracts. The contract vocabulary becomes
  `review` and `note`, and `delegate` runs only gated review rules or records a progress note.
- **BREAKING** — Remove the `failure-streak` trigger. The trigger vocabulary drops from eight to
  seven; a stuck turn is handled by the existing loop guard and the working-principles contract.
- **BREAKING** — Remove the shipped `research`, `advisor`, `worker-fast`, `worker-deep`, `blocker`,
  and `bug-fix` rules and the `worker-fast`, `worker-deep`, `codex-astra`, and `codex-write`
  targets. The shipped target set is the single `codex` review target.
- Remove review learning: the `review_lesson` and `review_retro` tools, the `/review-retro` command,
  the lesson store, the finding history, the lesson prompt injection, and the `reviewLearning`
  config block. The `review-learning` capability is retired, and the workflows `Owned task-review
  gate` obligation drops its learning-loop clause while keeping the queue and records.
- Keep the review contracts (whole, task, section, integration), the review queue, digest-bound
  records, portable approvals, archive evidence, `spec-review`, `task_progress`, `lane-fanout`, and
  `lane-boundary` unchanged. Finding `class` stays in review records as human triage data.
- Update the shipped fragment and owner defaults, the skill assets, the locale description, the
  documentation, and the tests; regenerate the setup bundle.

Out of scope: moving the remaining `spec-review` and lane gates into workflow definitions, and
removing the gate-only retirement switch. Those follow in a separate change once this removal has
shipped.

## Capabilities

### New Capabilities

None. This change only removes behavior.

### Modified Capabilities

- `delegation-rules`: the trigger and contract vocabularies, the shipped rules and targets, the
  `delegate` tool description, the security boundary, and the synchronous-contract note change.
- `review-learning`: every requirement is removed; the capability is retired.
- `workflows`: the owned task-review gate keeps the queue and records but no longer requires the
  learning loop to remain.

## Impact

- `packages/plugin-delegation-rules/src|test|assets`, `cordis.fragment.yml`, `locale/en.json`, and
  the package `files` manifest that lists those modules and assets.
- `packages/setup/defaults.yml`, plus the generated setup patch and vendored tree (`pnpm gen`).
- `docs/delegation-rules.md`, `docs/codex-subagent.md`.
- `openspec/specs/delegation-rules/spec.md`, the retired `openspec/specs/review-learning/spec.md`,
  and `openspec/specs/workflows/spec.md`.
- Local `.dsh/review-learning/` scratch stays on disk, unread and untracked.
- Unaffected: the workflows `task-review` definition, which calls `delegate` only for review rules,
  and the archive gate, coverage audit, and portable approvals.
