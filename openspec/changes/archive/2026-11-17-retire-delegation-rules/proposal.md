# Proposal

## Why

`move-review-runtime-into-workflows` (Release A) moved the review runtime, the queue, the snapshots, and
the retained `spec-review`, work-progress, and lane gates into `@dsh-setup/plugin-workflows`, and left the
delegation row installed but dormant — its rules and target configured, every legacy switch off, so one
flip restores its steer. Release A also proved the replacement in a live profile, which is the condition
`Migration completion` requires before the legacy code may be deleted.

The dormant plugin is now dead weight: two installed gate systems and two record parsers, 8,300 source
lines, 13,700 test lines, a skill, a 60 KB document, and the 70 requirements of the `delegation-rules`
capability. Release B deletes it and folds the requirements whose behavior the engine now owns. It is the
second release of [`move-review-runtime-into-workflows`](../move-review-runtime-into-workflows/proposal.md)
and applies only after that change is archived and its live profile confirmation is recorded.

## What Changes

- **BREAKING** — Delete `@dsh-setup/plugin-delegation-rules` and `packages/plugin-delegation-rules/**`:
  the rule engine, the `delegate`, `task_progress`, and `delegation_status` tools, the turn-stopping
  listener, the review queue and snapshots, the `delegation-rules` skill, the bundled review prompt
  copies, the locale description, the generated patch, the emitted `lib/**`, and every test.
- **BREAKING** — Remove the `dsh-setup-delegation-rules` row from `packages/setup/defaults.yml`, the
  package dependency and bundle entry from `packages/setup/package.json`, the vendored tree, and the
  root `tsconfig.json` project reference; regenerate the setup patch, manifest, and vendored tree.
- Fold the 70 requirements of `delegation-rules` into the two surviving capabilities. No requirement is
  invented: the workflow text names the delegation requirements it absorbs, and every removed
  requirement names its destination in `**Migration**`.
  - `workflows` receives 47 of the 70 requirements as 46 folded blocks: `Review verdict contract`
    (`Review contract`), `Task-scoped review`, `Explicit task review selection`,
    `Asynchronous review runs`, `Pending review handling`, `Review queue admission`,
    `Review queue identity and dedupe`, `Review failure classification and retry`,
    `Review queue record integrity`, `Review queue settlement` (`Deterministic review-run settlement
    signal` and `Review queue settlement`), `Review queue visibility`,
    `Review queue configuration and off switch`, `Review queue failure isolation`,
    `Restart reconciliation`, `Stable review inputs`, `Reviewed worktree input set`,
    `Reviewed change-artifact inputs`, `Reviewed-input change report`, `Task review snapshot`,
    `Snapshot exclusions`, `Frozen change artifacts`, `Snapshot cleanup on settle`,
    `Stale snapshot sweep`, `Review fallback visibility`, `Section-scoped review`,
    `Section run identity`, `Section gate and status behavior`, `Section approval publication`,
    `Section publication transaction`, `Section failure visibility`, `Session change involvement`,
    `Per-write task attribution`, `Session-scoped review triggers`, `Cross-session review evidence`
    (`Cross-session delegation tools`), `Review finding classification`,
    `Task lanes and the serial tail`, `Lane-assignment fan-out gate`, `Lane assignment state`,
    `Lane-assignment steer payload`, `Lane-assignment fail-open`, `Worker-assigned checkpoint lanes`,
    `Plan lane shape in whole-spec review`, `Review overlap in the apply loop`,
    `Review trust boundaries`, `Cataloged external review runs`,
    `Provider-specific delivery and catalog behavior`.
    - 13 more are absorbed by existing engine requirements: `Delegation rule engine` and
      `Model-agnostic defaults and documentation` (`Installed definitions`, `Configuration and off
      switch`); `Trigger evaluation` (`Review condition` and the owned gates); `Target resolution and
      model options`, `Shipped strong Codex targets` (`Reviewer configuration`);
      `Task progress note`, `Task progress gate` (`Owned work-progress gate`); `Turn-stopping gate`
      (`Owned task-review gate`, `Review executor`); `Delegate tool and status` (`workflows` status);
      `Lane-boundary fan-out gate`, `Lane-boundary steer payload`, `Lane-boundary payload
      preconditions`, `Lane-boundary fail-open` (the owned lane gate).
  - `review-approval` receives 4 folded requirements: `Portable task-review approval`,
    `Change-level review coverage`, `Archive approval gate`, `PASS-only approval boundary`.
  - 6 are deleted with the plugin and have no replacement behavior: `Model-facing cost`,
    `Removal and opt-out`, `Setup delivery and standalone use`, `Parallel writer isolation`,
    `Deprecated lane-boundary trigger`, `Gate-only retirement switch`.
- Remove the Release A coexistence scaffolding from the accepted specs: `workflows` `Gate-only switches`
  and `Per-signal legacy ownership` are removed, and the surviving checkpoint and verification clauses of
  the latter move to a new `Surviving legacy ownership` requirement; the delegation signal clauses and the
  `defer`/legacy-owner clauses are dropped from `Whole-spec review evidence`, `Owned task-review gate`,
  `Owned work-progress gate`, `Owned lane-assignment gate`, `Installed definitions`, `Retirement parity`,
  `Migration completion`, and the `review-approval` `Approval producer`. The committed approvals, their
  path, and their audit stay unchanged.
- Preserve the parity baseline independently of the deleted runtime: move the certified legacy replay into
  a retained executable baseline in the workflows test package, point the fixtures at the moved approval
  format, and regenerate `packages/plugin-workflows/assets/parity/retire-legacy-gates.json` so
  `node scripts/workflows-parity.ts --check` runs with the package absent.
- Retire the legacy exporter: remove `reviews:export`, its `exportChange()` implementation and tests, and
  the root script, while keeping `--change`, `--all`, `--push`, `--staged`, `pnpm hooks:install`, and every
  committed record. The missing-approval output and the surviving gate and parity diagnostics print the
  supported `workflows(action: "start", definitionId: "task-review", change, task)` review call.
- Migrate the shipped OpenSpec apply guidance in `packages/plugin-openspec/assets/guidance/task-lanes.md`
  to the `workflows` `note` action and the native review-at-tick/snapshot loop, with its tests.
- Remove only the delegation-rules `legacy`/`ownership` bindings from the shipped definitions and the
  contributed intake; the `retro` (`goal-continuity`) and `verify` (`verification-gate`) bindings, their
  ownership validation, and their surviving spec clauses stay.
- Remove the legacy `.dsh/delegation/**` fallbacks from the engine and the `legacy` blocks from the
  shipped definitions and the contributed `change-intake`; a profile that still carries the deleted
  row's patch entry loads with that entry ignored and no such row mounted, migrating its intent to the
  workflow `reviewers` map and the shipped definitions.
- Delete `docs/delegation-rules.md` and the `delegation-rules` skill; update `AGENTS.md`, `README.md`,
  `docs/*` (workflows, plugins, contributing, openspec-status, review-approval, codex-subagent) to name
  `workflows` as the only owner, drop the delegation apply-loop paragraph, and remove every
  `reviews:export` reference. The apply-loop guidance moves into
  `packages/plugin-openspec/assets/guidance/task-lanes.md` with the `workflows` `note` action.
- Remove the `delegation-rules` observability row, its triggers and sources, and the setup
  `sourceKind: delegation-rules` and `delegation_status` tool entries; update the observability tests.
- Sequencing: this change is planned now and applied only after Release A is archived and its live
  profile confirmation is recorded. The parent proposal and design link it and state the order. Its
  per-signal rollback flips apply only before this release; after it, rollback is a version downgrade
  to the last Release A build, because the plugin and its switches no longer exist.

## Capabilities

### New Capabilities

None. This change only removes a capability and moves requirements between existing ones.

### Modified Capabilities

- `delegation-rules`: every requirement is removed and the capability is retired.
- `workflows`: absorbs 60 delegation requirements as 13 folded requirements plus the existing engine
  requirements, loses the Release A switch requirements, and owns the whole review runtime.
- `review-approval`: absorbs the portable-publication and coverage/archive-boundary requirements, and
  the review executor becomes the only approval producer.

## Impact

- `packages/plugin-delegation-rules/**` (deleted), `packages/plugin-workflows/src|test|assets/**` (legacy
  fallbacks, definitions, retained parity baseline, parity report),
  `packages/plugin-openspec/assets/workflows/change-intake.json`,
  `packages/plugin-openspec/assets/guidance/task-lanes.md`, and its tests.
- `scripts/reviews-check.ts` (import moves to the workflows copy of the approval format; the export mode
  and its legacy-scratch reader are removed), `scripts/test/reviews-check.test.ts`,
  `scripts/workflows-parity.ts`, and the root `package.json` script entry.
- `packages/setup/{defaults.yml,package.json,cordis.patch.yml,node_modules/@dsh-setup/**}` and
  `pnpm-lock.yaml` (regenerated).
- `packages/plugin-observability/assets|src|test/**`, `tsconfig.json`, `README.md`, `AGENTS.md`,
  `docs/**`.
- `openspec/specs/delegation-rules/spec.md` (deleted), `openspec/specs/workflows/spec.md`,
  `openspec/specs/review-approval/spec.md`.

Out of scope: any new review scope, definition, prompt semantic, approval field, or gate; the explicit
task/section selector on the `workflows` `start` action is the relocated interface of the removed
`delegate` alias, not a new review scope. Migrating or deleting the local `.dsh/delegation/**` scratch,
which stays on disk unread (no command reads it after the export retirement), is also out of scope. The
Release A rollback switches exist only until this change ships (rollback after Release B is a version
downgrade).
