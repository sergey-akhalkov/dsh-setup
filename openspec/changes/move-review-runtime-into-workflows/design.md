# Design

## Context

Two process engines coexist. Workflows owns the run model, definitions, evidence, the archive
gate, and the checkpoint/task-review/verification closes; delegation owns the review runtime
(target routing, prompt, snapshot, digest, verdict, queue, record, approval) and the retained
`spec-review`, task-progress, and lane gates. The seam is narrow: workflows starts a review through
the `delegate` tool and reads its record, and it already re-implements record parsing for evidence
and the UI.

The migration rules are already durable contracts: `Ownership retirement`, `Retained gate
retirement`, `Migration completion`, and `Gate-only switches`. They require a parity report per
retired signal, the legacy switch off in the same change, the replacement proven in a live profile
before the legacy code is deleted, and a per-signal rollback.

## Goals

- One plugin, one turn-stopping listener, one record store, one status surface.
- Every rule visible with its steps, evidence, and result contract; engine-owned gates visible as
  read-only cards, never as definitions they are not.
- Committed approvals unchanged: same path, same fields, same audit commands.
- A one-release coexistence window where rollback is one config flip.

## Non-Goals

- Deleting the delegation plugin in this change.
- New review scopes, new exit conditions, or ad-hoc delegation.
- Changing the review prompt semantics or the finding classification.

## Decisions

### D1 — Native `review` executor instead of a tool dispatch

The engine runs the reviewer: resolve `reviewers.<target>`, render the bundled instruction with the
change name, task text and id, and the prepared digest, enforce exactly one fenced JSON verdict that
echoes the digest, validate severities, write the record, publish the approval, and settle the step.

Rejected: keeping `delegate` as a tool step (the runtime stays in another plugin, so the split
survives and the step's evidence is a tool call rather than a verdict); a tool step whose output is
parsed by a main step (a model-mediated step cannot be authoritative evidence).

### D2 — The review definitions ship with the engine

`Installed definitions` forbids new product-specific definitions and lists three legacy exceptions.
The review rules are the built-in process, not a product feature, so the requirement is modified to
name the shipped rule set: `spec-review`, `task-review`, `integration-review`, plus `retro` and
`verify`, while `change-intake` stays contributed.

Rejected: a fourth contributor plugin (defeats the goal); contributing the rules from
`plugin-openspec` (wrong ownership); local definitions only (a fresh install would ship no review
gate).

### D3 — Reviewer routing is profile configuration

`reviewers: { codex: { provider, model, reasoningEffort, agentOptions } }` on the workflows row; a
review step names only `target: "codex"`. Definitions are host-signed artifacts, so a model id inside
one would force a re-approval for a machine-local choice. A missing provider is not a load error; the
run fails with the target id, the provider name, and the next action.

### D4 — Records move, approvals do not

Local records go to `.dsh/workflows/records/<definition>/<change>/<phase>.json` and
`.../tasks/<taskId>.json`. The committed `openspec/changes/<change>/reviews/<taskId>.json` keeps its
field set and byte layout, is written before the local record is published, and remains auditable on
a clean clone without the host key. `reviews:export` reads the legacy `.dsh/delegation/**` store for
one release, then the fallback is dropped in Release B.

### D5 — A local copy cannot weaken a gate

A review definition declares `settings.gate: "review"` plus its gate identity. A local override that
removes the review step, drops the declaration, or narrows its scope is refused at load with the
remedy, mirroring `Gate-preserving override` for intake. Without this, editable rules are a way to
turn a gate off.

### D6 — Lane fan-out stays an engine-owned gate

The obligation is per lane and needs dynamic evidence: one tagged worker start or one serial note
per reported lane. The closed step model has static steps and static `all` lists. Expressing it as a
definition would need dynamic evidence, or a condition over run state with repeat suppression that
re-arms after each settle.

Rejected: run-per-lane with a run-state condition (condition context would need run state and the
trigger would re-fire after a settle); loop with per-iteration evidence (schema growth for one gate).
Decision: engine-owned gate with its own contract card, sharing the listener with the other gates.

### D7 — The progress note is an action

`workflows` gains `note(change, task, status, reason)` writing `.dsh/workflows/notes/<change>.json`
with the current worktree digest; the serial-lane decision is the same action. A one-line record does
not deserve a run, a step, and a history page. `task_progress` stays as a deprecated alias for one
release and routes by effective owner: the workflows note action while the progress signal is owned,
the legacy `.dsh/delegation/task-progress/<change>.json` note while it is enabled. The call also
updates the active lane owner's serial state, so a progress-owned note still satisfies a legacy lane
gate and the converse.

### D8 — Per-signal legacy switches with switch-driven ownership

`delegation.gates` becomes
`{ workflowOwned, specReview, integrationReview, taskProgress, laneFanout }`. Each false value
disables exactly one legacy signal; `workflowOwned` keeps its current meaning (task-review plus the
archive gate). The shipped review definitions declare `own` but resolve their **effective** ownership
from the switch: while a legacy signal is enabled the matching definition or step is effectively
`defer`, and while it is disabled it is `own`. A switch flip alone therefore restores the legacy
steer without a definition edit; an explicit local override that contradicts the switch is refused at
load, naming both sides. `defer` beside a disabled signal and `own` beside an enabled one stay
refused as split states for any definition that does not resolve from the switch.

### D9 — Two releases

Release A ships the executor, definitions, cards, moved gates, and parity with the legacy row
installed, its rules — including a dormant `implementation-work` note rule — and target still
configured, and every gate switch off: the row is dormant, not emptied, so a flip restores its steer,
a rolled-back `bundled:` instruction still resolves, and the legacy progress gate has a rule to
enforce again. The review prompt assets are copied into workflows and the legacy copies stay until
Release B. Release B deletes the plugin and folds its requirements. `Migration completion` forbids
deleting the code before the replacement has run in a live profile, so the deletion is a separate
change created by this change's last task.

### D10 — Two card kinds in the UI

Definitions render in the editor canvas; engine-owned gates render as read-only contract cards
(trigger condition, evidence, record path, steer payload) in the same Workflows surface. A gate is
never drawn as an editable graph it is not. A review step's inspector shows the prompt, the digest
scope, the verdict schema, and the reuse policy.

### D11 — Queue and snapshots move with the executor

`reviewQueue` (concurrency 2, `maxQueued`, `maxAttempts`, backoff, `waitTimeoutMs`) and the
`.dsh/workflows/snapshots/<runId>` checkout move into the workflows row config and engine. Review
runs are admitted through that queue rather than the step dispatch. The settlement rule is unchanged:
records are authoritative, runs are the process, `ERROR` allows an intermediate close and never
approves.

### D12 — `soft` reproduces the once-only refusal

The legacy `soft` rule refuses one close and lets the next through, so a non-blocking step would
silently change the decision. The shipped integration definition therefore blocks the close with
`maxBlocks: 1`: the first close is refused, the next is allowed with a recorded `VIOLATION`. Parity
compares the per-turn decision sequence, and the recorded violation is the declared, documented
difference. An exhausted soft budget SHALL settle the step as `completed-soft`, never as a pass, so
the run carries no open required step and an otherwise authorized archive is not blocked.

### D13 — Evidence source follows the owner

A `defer` step reads the enabled legacy provider's record; an `own` step reads the workflows record
store. The work-progress gate resolves task-review evidence the same way: it reads the active review
owner's record store, not a fixed path. The rule is ownership-dependent, not time-dependent, so a
rolled-back intake still completes from a current legacy PASS and an owned step never accepts the
legacy path. The active review owner —
the workflows executor while a signal is owned, the retained legacy runtime while it is enabled — is
the only producer of a committed approval, with the same format and ordering. A matching `ERROR`
allows an intermediate close with the failure visible and never approves; the next close retries the
review.

### D14 — Release A involvement and path boundaries (owner decision)

The condition's involvement is established from the session's own successful `write`/`edit`
calls under `openspec/changes/<name>/`, a successful `openspec new change <name>`, the persisted
per-session involvement, and supported shell writes: `Set-Content`, `Add-Content`, `Out-File`,
`New-Item`, and `tee` stages with a named `-Path`/`-LiteralPath`/`-FilePath` destination or one
positional destination after standard option values, output redirections (`>`/`>>`), pipelines,
and PowerShell or POSIX quoting/escapes. A shell form outside this list does not establish
involvement in Release A: the watcher sees a file mutation but cannot identify the writing session,
so it is not an involvement source. Correlating watcher mutations with their writer, and parsing
further shell grammar, are follow-up work.

The condition context rejects absolute drive paths, `..` traversal, UNC paths, delimiter-adjacent
absolute POSIX paths, and `event.command` paths after `>`/`>>`. A POSIX path wrapped in Markdown
emphasis is treated as a glob and is not rejected; task prose is owner-authored plan text, not
untrusted input. Shell parsing hardening beyond these boundaries is follow-up work, not a load or
condition contract.

## Release, migration, and rollback

1. Release A: engine + definitions + cards + switches + parity; the delegation row keeps its rules
   (including the dormant `implementation-work` note rule) and target configured and ships all five
   switches false, so it installs no steer.
2. A live profile runs one review natively; the record and approval are inspected.
3. Release B: delete the plugin, fold the requirements into `workflows` and `review-approval`, remove
   the row, docs, skill, observability row, legacy prompt copies, and bundle entries.

Rollback per signal: set the matching legacy switch back to true; the configured rule restores that
steer, the shipped definition resolves to `defer` because of the switch, the owning workflow
counterpart yields, the compatibility tools route to the legacy runtime and state, and records and
notes are never rewritten. The legacy review owner publishes the committed approval with the same
format, so a rolled-back review still satisfies the completion and archive gates. Rolling back the
whole change disables the workflows review definitions and re-enables the legacy rule set; the
committed approvals stay valid because their format is unchanged.

## Risks

- Double review in the coexistence window: every legacy gate switch ships false, the rules stay
  configured only for rollback, the shipped test sequence covers all five signals, and a composed
  profile must install no legacy steer.
- A signal without a switch or without a dormant rule is not rollback-able: `integrationReview` and
  the dormant `implementation-work` rule exist for exactly that reason, and a composed-profile test
  completes a task list with every switch off and asserts only the native integration review acts.
- The queue/step-scheduler merge is the only genuinely new engine work; a review run must not
  starve, double-start, or be treated as a resumable step process.
- Parity is the release gate; a stale template hash must fail the check, and a missing evaluator or a
  decision mismatch must fail certification rather than pass silently.
- Foreign profiles with `rules:`/`targets:` break at load after Release B; release notes carry the
  migration and the replacement (`reviewers`, definitions).
- Snapshot leftovers and `live worktree` fallback keep their documented causes and remedies.

## Open Questions

- Whether the goal-complete guard moves in this change or is cited from workflows to the delegation
  record store for one release. The plan is to move it, because it reads the same portable approvals
  and the workflows listener already evaluates them.
- Whether `delegation_status`'s text shape survives as the `workflows status` summary or is replaced
  outright; the plan is a deprecated alias with a deprecation line, removed in Release B.
