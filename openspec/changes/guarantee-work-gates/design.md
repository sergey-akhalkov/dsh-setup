# Design

## Context

See `proposal.md` - Why. Three existing mechanisms are close to the requested guarantees but have one missing binding each:

- `packages/plugin-delegation-rules` already owns the `lane-assignment` gate, the session-scoped lane ledger, the `lane-tag: <change>#<n>` worker evidence, and the per-lane `task_progress` serial note. The shipped default set intentionally omits the `lane-fanout` rule after `replace-rare-triggers-with-work-checkpoints`; the code and tests remain.
- `packages/plugin-goal-continuity` already owns the `work_checkpoint` tool, the lane plan, the bottleneck remedy gate, bottleneck age, and the close cap. A `worker_start` remedy currently matches any later worker start whose arguments contain the checkpoint id; the bottleneck id, the owner, and the worker-only distinction are not checked.
- `packages/plugin-delegation-rules` and `scripts/reviews-check.ts` already check a portable task-review PASS by rule, change, task id, and verdict. The marker supports `archiveGate`, `taskRule`, `cutoff`, and `grandfathered`; it has no reviewer binding. The pre-push hook and both CI workflows audit the committed tree; there is no staged audit before the commit.

Baseline from the 2026-11-05 analysis: 0 of 8 v2 checkpoint records computed parallel work; 7 of 8 were `done` without a plan; 12 of 35 substantial dsh roots had an accepted checkpoint; 960 of 1,195 delegate calls were task reviews; 308 portable PASS records, all `codex-subagent`, 306 of 306 post-cutoff checked tasks approved; 0 observed approval refusals and 4 manual move groups.

## Goals / Non-Goals

**Goals:**

- Make decomposition a default, enforced decision for multi-lane OpenSpec changes: a tagged worker per independent lane or a visible work-constraint serial decision, before the turn closes.
- Make bottleneck remediation a delegated, evidence-checked action for worker-owned lanes: a worker start carrying both the checkpoint id and the bottleneck id, with `lead_action` limited to lead-owned bottlenecks.
- Make task-review approval bound to the configured independent reviewer and catch archive moves before the commit, including moves the shell guard cannot see.
- Keep the change small: no new agent, plugin, tool, log, or telemetry surface.

**Non-Goals:**

- No review-start queue or retry engine. The gate blocks a turn when a review cannot start rather than silently passing; queueing is a follow-up.
- No new retro command or dashboard. The existing Observability process summary and hypotheses are the measurement surface.
- No requirement that every unchecked task be approved before archive. Unchecked tasks remain open follow-ups; requiring them is a separate owner decision.
- No cryptographic attestation of review records. This is process integrity for the normal agent path, not anti-forgery against a deliberate agent that writes a fake PASS.
- No automatic decomposition for non-OpenSpec work or for a single-lane/hot-file plan.

## Decisions

### 1. Reuse the lane-assignment gate and ship it as a strict default

The gate, lane ledger, worker tag, serial escape, and tests already exist. The change adds one default rule:

```yaml
- id: lane-fanout
  when: lane-assignment
  contract: note
  gate: strict
```

The gate fires only when a readable `tasks.md` has at least two non-`serial` lanes, at least one unassigned lane owns paths and has unchecked tasks, and the turn ticked a task or changed implementation files. It then requires a tagged worker start per unassigned lane or a matching `task_progress` serial note.

Alternatives considered:

- Put the same check in `work-checkpoints`. It would couple a generic plugin to the OpenSpec task parser and duplicate the existing lane ledger.
- Add a new scheduler or pre-execute block. A pre-execute block would need to classify every edit path before the turn has run; the existing turn-close gate already stops progress and can use the turn's own write evidence.
- Make every change fan out. That would force workers on hot-file and generated-output work; the gate's use of owned paths and serial titles avoids it.

### 2. Enforce at turn close, not before the first edit

The first implementation edit is allowed; the turn cannot close until the lane decision exists. This preserves the normal apply loop (tick, start review, keep working) and avoids blocking a legitimate first write while the plan is still being read. The gate is strict and has no refusal cap; the turn stays open until each unassigned lane is covered.

The cost is that one serial step can happen before fan-out. The plan-time review already requires owned paths and 2-6 substantive tasks per lane, and the gate reports the first tick or implementation change, so the window is one task, not a whole run.

### 3. Keep the serial escape as a `task_progress` note, not a new enum

The existing note is local, bounded, and tied to the current worktree digest. The gate names the allowed work constraints in its steer (shared hot file, generated output, or serial gate). The whole-spec review already rejects a tasks.md single-lane reason that cites the review or archive process as a P1 finding. Adding a structured enum would add a schema and a second place to update for no additional evidence.

A plan whose lanes lack owned paths fails open; the whole-spec review's lane-shape criterion is the plan-time guard. This is intentional: a malformed plan must not block all work.

### 4. Bind the reflection remedy to the bottleneck owner and both ids

In `packages/plugin-goal-continuity/src/host/index.ts`:

- `taggedWorkerStarted` gains the bottleneck id and requires the worker call's arguments to contain both the checkpoint id and the bottleneck id.
- `remedyMatched` rejects `lead_action` when `bottleneck.owner !== 'lead'`; it accepts `worker_start` or `user_decision` in that case.
- When no worker-start tool is visible, the owner rule fails open and a targeted `lead_action` edit/write is accepted, so the gate cannot trap a profile without workers.
- The tool validation rejects `lead_action` for a non-`lead` owner early with a field diagnostic; the close gate keeps the same check as the enforcement boundary.
- The delegation-rules gate observes the latest `work_checkpoint` arguments and compares the checkpoint lanes to the lane-assignment ledger. A task lane assigned to a tagged worker must be covered by a checkpoint lane whose owner is not `lead`; a bottleneck whose targets fall inside that lane must use `worker_start` or `user_decision`. An omitted checkpoint lane for a worker-assigned task lane is refused; an unreadable checkpoint plan or task-lane plan fails open. The goal-continuity owner rule still applies independently. This is the check that closes the observed all-`lead` lane plan without asking the user to police the owner string.

Alternatives considered:

- Require a worker for every bottleneck. That blocks a genuine one-file lead fix and creates ceremony the owner asked to avoid.
- Keep a text-only delegation hint. The analysis shows the current gate already accepts a worker start tagged only with the checkpoint id; a review delegate could satisfy it without fixing the bottleneck. Both ids make the evidence specific.

### 5. Bind approval to the configured reviewer through the tracked marker

`openspec/review-approval.json` gains optional `reviewerProvider` and `reviewerModel`. When present:

- `computeApprovalCoverage` compares `record.target.provider` and, when declared, `record.target.model`.
- The live archive gate, the completion coverage, the live task-review gate, `delegation_status`, and `pnpm reviews:check` pass the same expected target.
- A mismatch is a coverage error with a detail naming expected and actual; it is not a missing record.
- The expected reviewer is part of cached-record reuse and task selection: `beginReviewRun` only reuses a record whose target matches, and `taskHasReview`/`nextTaskForReview` treat a mismatched record as unreviewed, so the prescribed delegate call starts the required reviewer instead of returning the old PASS.
- This repository sets `reviewerProvider: "codex-subagent"`. The existing 308 records all name that provider, so the migration is a no-op for the audit; the 71 records without a model pass because no model is pinned.

An absent field preserves the previous provider-agnostic behavior, so standalone and other repositories keep composing. A profile that intentionally uses another provider updates the marker; the change does not hardcode Codex in the engine.

Alternatives considered:

- Hardcode `codex-subagent` in the coverage function. It would break standalone use and the model-agnostic engine.
- Derive the expected provider from the profile only. The portable audit cannot read a profile config from a fresh clone, and the marker is the portable contract.
- Sign the records. That is a different threat model and needs a key or CI attestation; it is out of scope.

### 6. Add a staged audit at the commit boundary, not a `run_code` regex

The local archive guard sees `pwsh`, `bash`, and `terminal_send` only. `run_code`, `write`, a manual Explorer move, and several shell spellings can move a change into `archive/` without the guard. A pre-commit hook is the earliest durable boundary that sees the staged result regardless of which tool produced it.

- `scripts/reviews-check.ts` gains `--staged`: read the staged name-status, select every change touched under `openspec/changes/archive/` (moved or modified), and audit each with the same coverage code.
- `.githooks/pre-commit` runs `pnpm reviews:check --staged`. The hook files are tracked, but `core.hooksPath` is local configuration: `pnpm hooks:install` selects the tracked hooks once per clone, as `docs/contributing.md` already requires. A fresh clone is inactive until that command runs.
- The hook fails closed if pnpm or the staged range is unavailable and prints `pnpm reviews:check --all`.
- The pre-push hook and CI `--all` remain authoritative for the committed tree; `--no-verify` is a visible bypass only until the push/CI audit.

Alternatives considered:

- Inspect `run_code` source for archive paths. Arbitrary code makes this a guard, not a boundary.
- Only CI. It catches the violation after the commit is public; the pre-commit is cheap and local.
- A full index-based audit. The committed audit is authoritative; a staged audit that reads the worktree catches the normal case. The design states this limit.

### 7. Do not add the queue, retro command, or all-tasks requirement here

The guarantees are about decisions, not throughput. The review gate already blocks when a review cannot start; the 53 active-child-limit errors and 109 failed runs are a queue follow-up. The Observability process summary already reports parallel share, reflection coverage, time to first worker, steps between reflections, and the two hypotheses; a new command is a reporting follow-up. Unchecked tasks are reported as open follow-ups by the current spec; requiring them is an owner policy decision.

Keeping these out makes the guarantee change reviewable and avoids adding bureaucracy before the gates are proven.

### 8. Fail-open and cap boundaries stay

- The lane gate fails open on an unreadable plan, no owned paths, or no worker tools; the review P1 and the steer carry the quality requirement.
- The checkpoint close gate keeps its `maxBlocks` cap and visible UNCHECKED notice; a hard infinite block is worse than an explicit unchecked close that the next substantial turn must checkpoint.
- The archive and task gates fail closed on evidence gaps, but an internal plugin state error in the goal-continuity gate still fails open as before.
- The review binding is a process check. A hand-written PASS with `codex-subagent` still passes; the docs state that this is not anti-forgery.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| The lane gate fires on a plan that is genuinely serial despite two owned lanes. | The serial escape is one `task_progress` note per lane; the steer names the three work constraints; the whole-spec review rejects a review-process single-lane reason. |
| The lane gate adds friction to small multi-lane changes. | It fires only for two or more non-serial lanes with owned paths and unchecked tasks; a one-line hot-file/generated/serial reason keeps the plan serial. The review P1 keeps lanes at 2-6 substantive tasks. |
| A checkpoint lane owner is still free text, so an agent can write a non-`lead` name without a worker. | The lane-assignment ledger must already show a tagged worker for that lane; the delegation-rules consistency check compares the checkpoint lane to the ledger, not to the owner string alone. An omitted lane is refused; only an unreadable plan fails open. |
| The consistency check needs the checkpoint arguments in the delegation-rules gate. | Observe the existing `work_checkpoint` tool result in the gate's `tools/result` hook; no new tool, file, or cross-plugin call is required. The goal-continuity record remains the durable artifact. |
| A worker-owned bottleneck has no registered worker tool. | The owner rule fails open to a targeted `lead_action`; the steer explains the missing worker. |
| The reviewer binding breaks a profile that uses another provider. | The field is optional and opt-in per marker; this repo sets Codex explicitly. A profile updates the marker with its reviewer. |
| The staged audit reads the worktree and can miss a partially staged or index-only edit. | The pre-push hook and CI `--all` audit the committed tree; the design names them as authoritative. |
| A fresh clone has no active hooks until `pnpm hooks:install` runs. | The hook files are tracked and the install step is documented as a one-time fresh-clone prerequisite; task 3.4 verifies activation after the installer runs. |
| A forged PASS record or a `--no-verify` commit still bypasses local checks. | This is process integrity, not a security sandbox; branch protection and CI are the remote boundary. A signed record is a separate change. |
| The change reduces speed because of extra worker starts or refusals. | The gate only fires where the plan itself declares independent lanes; the measurement plan compares the process metrics and the two existing hypotheses against the baseline. |
| The strict lane gate is a reversal of the 2026-10-31 removal. | The removal was about rare firing and ordinary-work coverage, not about the gate being wrong. The new default is scoped to multi-lane OpenSpec changes; ordinary work keeps the checkpoint. The measurement decides whether it stays. |

## Measurement and acceptance

The change has two levels of acceptance.

**Process guarantees (immediate):**

- A multi-lane OpenSpec change cannot close a turn after the first tick or implementation change without a tagged worker per unassigned lane or a matching serial note; the lane-fanout steer appears with the lane titles.
- A `continue` checkpoint with a non-`lead` bottleneck cannot pass without a worker start carrying both ids; a `lead`-owned bottleneck still passes with a targeted edit/write. A checkpoint lane matching a ledger-assigned worker lane cannot be `lead`-owned, and a bottleneck targeting that lane cannot use `lead_action`.
- Every post-cutoff portable task-review PASS names `codex-subagent`; `pnpm reviews:check --all` remains green; a staged unapproved archive move fails the pre-commit audit.
- `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm gen:check`, and `openspec validate guarantee-work-gates --strict` pass.

**Speed hypothesis (measured, not guaranteed):**

The Observability plugin already computes the process summary and the two configured hypotheses:

- `steps-per-human-message` decreasing by 0.5,
- `active-minutes-per-episode` decreasing by 5,

with a week window and `minSamples: 20` on each side. Set `interventionAt` in the profile to the archive date, then read the process summary after at least 20 episodes on each side. The comparison is an association, not proof. The baseline is the 2026-11-05 analysis: 0 of 8 v2 checkpoints parallel, 34.3% reflection coverage, 308 of 308 Codex records, 2.7 task-review attempts per PASS, 109 failed review runs.

If the hypothesis does not move, the next step is the queue/retro follow-up and a review of whether the lane gate is firing on work that should stay serial; the gates are not relaxed without that evidence.

## Migration Plan

1. Add the default rule to the delegation-rules fragment; run `pnpm gen` and commit the generated setup tree.
2. Add the optional marker fields and set `reviewerProvider: "codex-subagent"`; the existing 308 records already match, so the full audit stays green.
3. Add the tracked pre-commit hook and run `pnpm hooks:install` once per clone; a fresh clone is not active until that local `core.hooksPath` exists. The pre-push hook and CI remain unchanged.
4. Release through the normal version bump. A profile that replaces the delegation-rules config with its own rule list is unaffected by the new default; a profile that wants the old behavior removes the `lane-fanout` rule from its config.
5. Rollback: remove the default rule, the marker fields, and the pre-commit hook; no records or data were migrated, so the previous audit behavior returns.

## Open Questions

- Whether to enable a strict all-tasks-checked requirement at archive is a future owner policy; it does not change this design. The current three archives with unchecked tasks remain reported open follow-ups.
- Whether the review-start queue and the retro command are worth their cost is a follow-up decision after the process metrics are read.