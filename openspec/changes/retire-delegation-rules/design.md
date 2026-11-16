# Design

## Context

Release A (`move-review-runtime-into-workflows`) moved the review executor, the queue, the snapshots,
and the retained `spec-review`, work-progress, and lane gates into `@dsh-setup/plugin-workflows`, copied
the bundled review instructions, and left the delegation row installed with its rules and target
configured under five false switches. The one-release coexistence window exists only to prove the
replacement in a live profile before the legacy code is deleted, which Release A's live confirmation
does.

The package still has five in-repo consumers besides its own tests: `scripts/reviews-check.ts` imports
the committed-approval format from `src/shared/approval.ts`; `packages/plugin-workflows/test/parity-fixtures.ts`
imports the built package and replays its gate, so `scripts/workflows-parity.ts` would fail module
resolution once the package is gone; the workflows engine reads and writes the legacy `.dsh/delegation/**`
paths when a signal is enabled; the setup patch, manifest, and vendored tree list the package and the row;
and the observability signal map carries the `delegation-rules` row. The delegation skill, the
`docs/delegation-rules.md` page, the legacy review prompt copies, and only the delegation-rules
`legacy`/`ownership` blocks in the three review definitions and the contributed `change-intake` also exist
only for that plugin. The `retro` and `verify` definitions bind `goal-continuity` and `verification-gate`,
which survive, so their blocks and the ownership validation around them are not removal scope.

Release B is planned while Release A is still an active change, so some `MODIFIED` blocks
(the `review-approval` `Approval producer`, and `workflows` `Owned work-progress gate` and
`Owned lane-assignment gate`) name requirements Release A adds.
`openspec validate retire-delegation-rules --strict` exits 0 and reports those headers as informational
"archive would refuse" notes until Release A is archived; the apply task refreshes the delta against the
accepted post-Release A text before applying.

## Goals

- Delete one plugin and one gate system; `workflows` is the only review and gate owner.
- Fold the surviving `delegation-rules` requirements into `workflows` and `review-approval` without
  changing a behavior, a prompt semantic, a record field, an audit mode, or the committed record format.
- Keep the committed approval record format byte-compatible and the audit modes unchanged, and move the
  audit's review call onto the surviving `workflows` tool.
- Leave no reference to the deleted row, skill, prompt copies, tools, or switches in the shipped
  defaults, docs, setup bundle, accepted specs, or a surviving printed call.

## Non-Goals

- No new review scope, definition, trigger, gate, prompt, or approval field. The explicit task/section
  selector on the `workflows` `start` action is the relocated interface of the removed `delegate` alias,
  not a new scope.
- No change to the review audit modes, the approval coverage, the committed record field set, or the
  existing committed approvals.
- No migration or deletion of the local `.dsh/delegation/**` scratch; it stays on disk, unread. The
  `reviews:export` command that read it is retired, so nothing produces a new approval from it.
- No change to the `workflows` engine's surviving ownership resolution beyond deleting the delegation
  source: the checkpoint (`goal-continuity`) and verification (`verification-gate`) signals keep their
  refusal rules.
- No second rollback switch: after Release B there is no legacy runtime to restore on the same install.

## Decisions

**D1 — Delete the package instead of leaving it disabled.** A disabled plugin keeps 8,300 source lines,
13,700 test lines, its skill, its docs, its setup row, and two record parsers alive. Rejected: ship
`enabled: false` (the same maintenance cost with no behavior), keep only `shared/approval.ts` in place
(a plugin whose only remaining export is an approval parser, and a bundle that still installs it).

**D2 — Fold by capability, not by copy.** The 70 requirements split into 47 folded into `workflows` as
46 requirement blocks (the settlement signal and queue settlement share one block), 4 folded into
`review-approval`, 13 already expressed by surviving engine requirements, and 6 that are plugin
mechanics with no surviving behavior. The proposal lists the destination of every requirement, and each
removed requirement's `**Migration**` names its absorber. Folded text is the removed normative text with
only the naming changed (`delegate` rule -> definition, target -> reviewer); no clause is added. The 6
deletions (`Model-facing cost`, `Removal and opt-out`, `Setup delivery and standalone use`, `Parallel
writer isolation`, `Deprecated lane-boundary trigger`, `Gate-only retirement switch`) describe the
deleted plugin's own skill, row, bundle, or trigger vocabulary.

**D3 — Move the portable record format, not the module's audit prose.** `scripts/reviews-check.ts` and
the archive audit must keep reading the same committed record after the plugin is gone.
`src/shared/approval.ts` moves to `packages/plugin-workflows/src/shared/approval.ts`, and the script
imports the new path. Byte compatibility is limited to the record format: the committed path, field set,
ordering, and sanitization are unchanged, and the tests that pin the format move with it. The module's
user-facing audit text is not frozen, because keeping it byte-identical would preserve a call to the
removed `delegate` tool: `formatApprovalGapLines()` prints
`workflows(action: "start", definitionId: "task-review", change: "<change>", task: "<taskId>")`, and the
missing-approval output gets its own regression test after the alias is removed. Rejected: duplicate the
parser into the script (two format owners, the split this migration exists to end); move the whole module
byte-identically (it would keep a dead call and the legacy export reader alive).

**D4 — Remove the legacy fallbacks for the delegation signals only.** The engine reads and writes
`.dsh/delegation/**` only while a delegation signal is enabled; with the plugin and its switches gone,
the delegation path resolution in `evidence.ts`, `notes.ts`, `condition.ts`, `engine-gates.ts`,
`adoption.ts`, `api.ts`, and the client panel is dead, as are the `legacy`/`ownership` blocks on the
three review definitions and the contributed intake. They are deleted, not left dormant. The `retro`
(`goal-continuity` `work_checkpoint`) and `verify` (`verification-gate`) bindings, their switch/row-driven
ownership validation, and their spec clauses describe plugins that survive this release and are kept.
Existing local records are not read, rewritten, or removed, but no command copies them into an approval
anymore (D10).

**D5 — Delete the setup row and bundle entry, do not hide it.** The row, the dependency, the
`bundleDependencies` entry, the vendored tree, and the `tsconfig.json` project reference go; `pnpm gen`
regenerates the patch and manifest, and `pnpm gen:check` proves no drift. Rejected: leaving the package
vendored but unselected (a shipped tarball with no row, and a setup bundle that still resolves code it
never mounts).

**D6 — Remove only the delegation scaffolding from the accepted specs.** `Gate-only switches` describes
delegation configuration that no longer exists and is removed. `Per-signal legacy ownership` is removed
too, because it resolves the five delegation signals; its generic refusal rule and the checkpoint and
verification scenarios move into a new `Surviving legacy ownership` requirement, since `goal-continuity`
and `verification-gate` still install legacy sources. The delegation signal clauses and their split-state
scenarios are deleted with the signal. `Migration completion` is updated to its completed form, and
`Installed definitions` declares the three review definitions `own` while the checkpoint and verification
definitions keep their surviving source references. The generic `Legacy gate composition` and
`Ownership retirement` requirements stay: they are engine mechanisms for any installed legacy source, not
delegation-specific.

**D7 — Rollback is not a switch after Release B; it is a version downgrade.** Release A's per-signal
flips are the rollback path only before Release B ships. Release B deletes the switches, so a profile on
Release B has no flip: rolling back means installing the last Release A release, which restores the
plugin, its row, its switches, and its rules. Committed approvals and local `.dsh/delegation/**` records
survive because Release B never rewrites them, and the approval format is unchanged. The owner accepts
this one-way boundary when the live confirmation is recorded, as `Migration completion` requires.

**D8 — Two-release ordering.** This change applies only after `move-review-runtime-into-workflows` is
archived and its live profile confirmation exists. The parent proposal and design link this change and
name the order; the Release B apply starts by refreshing the `MODIFIED` blocks against the accepted
post-Release A text and re-running strict validation, then deletes the package. Rejected: creating the
Release B change earlier with full text (it would duplicate Release A's requirements) or applying both
releases at once (it would delete code before the live proof `Migration completion` requires).

**D9 — The surviving review call is the `workflows` `start` action.** Removing `delegate` also removes
the only call that carried an explicit task or section to a task-scoped review. The folded `Explicit task
review selection` and `Section-scoped review` requirements keep that selector, so the `workflows` `start`
action accepts `change` with `task` or `section` for a `task-review` definition, validates the selector
against the checked tasks and the definition, and records it in the run context. Every surviving printed
review call uses it: the work-progress steer, the approval gap formatter, and the parity approval
diagnostic. Rejected: leaving the printed calls pointing at the deleted tool; keeping `delegate` as a
hidden alias (the change removes the tool); a new review-scoped tool (the existing action is the tool).

**D10 — The legacy exporter retires with the plugin.** `reviews:export` exists only to copy a local
`.dsh/delegation` PASS into the committed format for changes reviewed before the portable write existed.
Once that runtime is deleted it is an approval producer that reads deleted scratch, so the `--export`
mode, `exportChange()`, the export-only path/record helpers, the root script, its tests, and its docs
references are removed. The audit modes (`--change`, `--all`, `--push`, `--staged`), `pnpm hooks:install`,
and every committed record stay unchanged, and a profile with only legacy scratch therefore cannot create
a new approval after Release B.

**D11 — The parity baseline outlives the deleted runtime.** The tracked report is the release gate, but
`scripts/workflows-parity.ts` loads `test/parity-fixtures.ts`, which imports the delegation build and
runs `applyDelegationRules`. Deleting the package would therefore fail the required `--check` before any
comparison. The certified legacy replay moves into a retained executable baseline in the workflows test
package: it covers the same spec-review, integration, progress, and lane scenarios, imports no plugin
code, and is driven by the same fixture table. A baseline or definition change regenerates the report,
and `--check` fails on a stale report, a missing baseline evaluator, or a decision mismatch, so the
command is verified with the delegation package absent. Rejected: deleting the retained parity cases (the
`Retirement parity` contract still gates the shipped `own` definitions); keeping a test-only copy of the
plugin (the deletion this change exists to make).

**D12 — The shipped apply guidance moves to the surviving tools.** The apply-loop guidance currently
lives in the deleted `docs/delegation-rules.md` and the serial-note instruction in
`packages/plugin-openspec/assets/guidance/task-lanes.md` names `task_progress`. The guidance asset is
attached to the apply, propose, and update skills, so it must ship the surviving calls: the `workflows`
`note` action for a serial decision, a task review started as soon as the task is checked, an independent
next task only while the review runs on a frozen snapshot, and the snapshot/fallback rule (restore
snapshot support and re-run, or defer writes until settlement, without a blocking sleep). Its tests move
with the text and keep the single-lane work-constraint rule and the size/no-CR checks.

## Risks / Trade-offs

- **A foreign profile still configures `rules`, `targets`, or `delegation.gates`** -> plugin load fails
  with the removed row named; release notes carry the migration to `reviewers` and definitions. This is
  the declared breaking change and is acceptable because the shipped profile never relied on a local
  delegation rule.
- **An unlisted importer of the package internals** -> the approval format and the parity fixtures are
  the known outside consumers; the move, the retained baseline in D11, and the grep in task 1.4 catch a
  stale import, and the full gate blocks a merge if one remains.
- **A section or queue edge case loses its spec home** -> the fold keeps one requirement per removed
  behavior and the parity report keeps its hashes; a missed case fails the strict archive audit of the
  specs, not only review.
- **The retained parity baseline drifts from the certified decisions** -> it is test-only, reviewed with
  the change, and a baseline edit makes the tracked report stale until it is regenerated; `--check`
  fails on a missing baseline evaluator or a mismatch, so the report never certifies a silent edit.
- **The `.dsh/delegation/**` scratch grows unread** -> it is local, untracked, and no command reads it
  after the export retirement; deleting it is the user's choice and is out of scope.
- **A user relies on `reviews:export`** -> the docs state that a legacy-only local record cannot become
  an approval after Release B and that a new native task review writes the portable record directly;
  the audit modes and the committed records are unchanged.
- **The observability dashboards expect the `delegation-rules` signal row** -> the setup defaults and
  the signal map drop it in the same change, and the workflows review signals replace it; the
  observability tests pin the new row list.
- **The Release A `MODIFIED` blocks** -> validate reports the not-yet-accepted ones as informational
  until Release A is archived; the apply task refreshes every block first, so the applied delta always
  targets the accepted text.
- **The guidance asset ships to three skills** -> the text and its `skill-provider` test change in the
  same task, and the test pins the `note` action and the review-at-tick/snapshot paragraphs.

## Migration Plan

1. Start only after Release A is archived and its live confirmation is recorded; archive Release A,
   sync its deltas, and re-run `openspec validate retire-delegation-rules --strict`.
2. Move `shared/approval.ts` into `workflows`, update the script and fixture imports, print the surviving
   `workflows` review call from the gap formatter, and run the review-audit tests before deleting anything
   else, so the approval boundary is proven first.
3. Migrate the parity fixtures to the retained executable baseline and regenerate the tracked report;
   prove `node scripts/workflows-parity.ts --check` without the delegation import before the package is
   deleted.
4. Delete the delegation engine fallbacks and only the delegation-rules `legacy`/`ownership` bindings,
   the package directory, and the alias routing; keep the checkpoint and verification bindings and their
   ownership validation; update the root build references and lockfile. Retire `reviews:export` with its
   tests and script, and add the explicit selector to the `workflows` `start` action.
5. Remove the setup row, dependency, bundle entry, and vendored tree; run `pnpm build` then `pnpm gen`,
   and commit the regenerated setup files.
6. Delete the docs page and skill, update the remaining docs and `AGENTS.md` (including every
   `reviews:export` reference and the surviving review call), migrate the OpenSpec apply guidance, and
   remove the observability row.
7. Sync the specs: delete `openspec/specs/delegation-rules/spec.md`, apply the folded requirements, remove
   `Gate-only switches` and `Per-signal legacy ownership`, add `Surviving legacy ownership` with the
   checkpoint and verification clauses, and apply the audit-call change.
8. Run `pnpm build && git diff --exit-code`, `pnpm check`, `pnpm validate:repo`,
   `pnpm validate:composition`, `pnpm validate:installer`, and `node scripts/workflows-parity.ts --check`;
   then install in a throwaway profile and confirm no delegation row, skill, tool, or export command
   exists, the shipped guidance names the `note` action, and one native review still produces its record
   and committed approval.

## Open Questions

None. The one-way rollback boundary is an owner decision recorded in D7, and the apply ordering is the
parent change's Release B contract.
