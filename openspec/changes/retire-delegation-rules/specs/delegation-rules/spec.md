# Spec Delta

## REMOVED Requirements

### Requirement: Delegation rule engine

**Reason**: The rule-data model is superseded by engine-shipped and contributed `workflows` definitions; no delegation rule remains configured after Release B.

**Migration**: Folded into `workflows`: `Installed definitions` and `Configuration and off switch`; rules are definitions, and providers resolve through `reviewers`.

### Requirement: Trigger evaluation

**Reason**: The seven triggers existed only to select delegation rules; the engine evaluates a `condition` and the owned gates instead.

**Migration**: Folded into `workflows`: `Review condition`, `Owned task-review gate`, `Owned work-progress gate`, and `Owned lane-assignment gate`.

### Requirement: Target resolution and model options

**Reason**: Reviewer resolution is engine configuration now, and no target or rule data remains.

**Migration**: Folded into `workflows`: `Reviewer configuration`.

### Requirement: Review contract

**Reason**: The engine's review executor computes the digest, runs the reviewer, accepts one verdict, and writes the record.

**Migration**: Folded into `workflows`: `Review verdict contract`.

### Requirement: Task-scoped review

**Reason**: Task scope, its digest, and its historical record are engine behavior.

**Migration**: Folded into `workflows`: `Task-scoped review`.

### Requirement: Task progress note

**Reason**: The note is the `workflows` `note` action.

**Migration**: Folded into `workflows`: `Owned work-progress gate`.

### Requirement: Task progress gate

**Reason**: The engine-owned work-progress gate covers the same cases.

**Migration**: Folded into `workflows`: `Owned work-progress gate`.

### Requirement: Turn-stopping gate

**Reason**: The engine's definition close and its review gate replace the plugin listener.

**Migration**: Folded into `workflows`: `Owned task-review gate` and `Review executor`.

### Requirement: Delegate tool and status

**Reason**: The `delegate`, `task_progress`, and `delegation_status` tools are removed with the plugin; their one-release aliases end.

**Migration**: Deleted with the plugin; the `workflows` tool and the Workflows status surface report runs, queue state, and records.

### Requirement: Model-agnostic defaults and documentation

**Reason**: The shipped default rules are gone; shipped definitions and `reviewers` carry that behavior.

**Migration**: Folded into `workflows`: `Installed definitions` and `Reviewer configuration`.

### Requirement: Model-facing cost

**Reason**: The tool descriptions and skill that the budget measured are removed.

**Migration**: Deleted with the plugin; no delegation tool description or skill body remains.

### Requirement: Removal and opt-out

**Reason**: The row is deleted, so there is no row to disable and no delegation gate to bypass.

**Migration**: Deleted with the plugin; `workflows` `Configuration and off switch` keeps the `enabled` switch for the engine.

### Requirement: Security and trust boundaries

**Reason**: The record and trust rules still apply to the engine's review records.

**Migration**: Folded into `workflows`: `Review trust boundaries`.

### Requirement: Setup delivery and standalone use

**Reason**: The bundle is no longer delivered or installable.

**Migration**: Deleted with the plugin; the setup ships `workflows`, which carries the review runtime.

### Requirement: Asynchronous review runs

**Reason**: The engine runs reviews through its queue and returns before the reviewer finishes.

**Migration**: Folded into `workflows`: `Asynchronous review runs`.

### Requirement: Pending review handling

**Reason**: Queue identity and dedupe are engine behavior.

**Migration**: Folded into `workflows`: `Pending review handling` and `Review queue identity and dedupe`.

### Requirement: Stable review inputs

**Reason**: Snapshot and live-input mutation rules protect the engine's verdicts.

**Migration**: Folded into `workflows`: `Stable review inputs`.

### Requirement: Reviewed worktree input set

**Reason**: The reviewed input set is defined by the engine's digest.

**Migration**: Folded into `workflows`: `Reviewed worktree input set`.

### Requirement: Reviewed change-artifact inputs

**Reason**: Change artifacts are reviewed and frozen inputs of the engine's reviews.

**Migration**: Folded into `workflows`: `Reviewed change-artifact inputs`.

### Requirement: Reviewed-input change report

**Reason**: The engine reports changed reviewed inputs with the same count, paths, and next action.

**Migration**: Folded into `workflows`: `Reviewed-input change report`.

### Requirement: Parallel writer isolation

**Reason**: The guidance lived in the deleted skill and documentation.

**Migration**: Deleted with the plugin; the packaged OpenSpec propose task-lane guidance and the working-principles contract keep the separate-worktree or serial rule, and `create_worktree` starts an isolated checkout.

### Requirement: Explicit task review selection

**Reason**: The engine selects an explicit task or section for a run.

**Migration**: Folded into `workflows`: `Explicit task review selection`.

### Requirement: Deterministic review-run settlement signal

**Reason**: The engine queue's settlement observer is the same signal.

**Migration**: Folded into `workflows`: `Review queue settlement`.

### Requirement: Session change involvement

**Reason**: The engine's condition and gates use per-session involvement.

**Migration**: Folded into `workflows`: `Session change involvement`.

### Requirement: Per-write task attribution

**Reason**: Per-write attribution still scopes the engine's review triggers.

**Migration**: Folded into `workflows`: `Per-write task attribution`.

### Requirement: Session-scoped review triggers

**Reason**: Engine definitions and gates still apply only to the session's own changes.

**Migration**: Folded into `workflows`: `Session-scoped review triggers`.

### Requirement: Cross-session delegation tools

**Reason**: The tools are removed; cross-session review records and attribution remain.

**Migration**: Folded into `workflows`: `Cross-session review evidence`.

### Requirement: Portable task-review approval

**Reason**: The committed `reviews/<taskId>.json` approval remains the portable evidence.

**Migration**: Folded into `review-approval`: `Portable task-review approval`.

### Requirement: Change-level review coverage

**Reason**: Approval coverage over every checked task remains the archive boundary.

**Migration**: Folded into `review-approval`: `Change-level review coverage`.

### Requirement: Archive approval gate

**Reason**: The workflow archive gate owns the refusal after the legacy guard is deleted.

**Migration**: Folded into `review-approval`: `Archive approval gate`.

### Requirement: PASS-only approval boundary

**Reason**: `ERROR` may close a turn but never approves; that boundary is unchanged.

**Migration**: Folded into `review-approval`: `PASS-only approval boundary`.

### Requirement: Shipped strong Codex targets

**Reason**: The shipped strong reviewer is `reviewers.codex` in the setup defaults, not a delegation target.

**Migration**: Folded into `workflows`: `Reviewer configuration`; the setup defaults keep the documented model and effort.

### Requirement: Lane-boundary fan-out gate

**Reason**: The deprecated `lane-boundary` trigger is deleted; the owned lane-assignment gate is the only lane gate.

**Migration**: Deleted with the plugin; `workflows` `Lane-assignment fan-out gate` keeps the active lane cases.

### Requirement: Task lanes and the serial tail

**Reason**: Lane parsing still feeds the owned lane gate.

**Migration**: Folded into `workflows`: `Task lanes and the serial tail`.

### Requirement: Lane-boundary steer payload

**Reason**: Its payload details are carried by the owned lane-assignment steer.

**Migration**: Deleted with the plugin; `workflows` `Lane-assignment steer payload` keeps the checkpoint-first, no-machine-path payload.

### Requirement: Lane-boundary payload preconditions

**Reason**: The payload preconditions are carried by the owned lane-assignment steer.

**Migration**: Deleted with the plugin; the checkpoint-first and root-anchored rules moved to `Lane-assignment steer payload`.

### Requirement: Lane-boundary fail-open

**Reason**: The trigger is deleted with the plugin.

**Migration**: Deleted with the plugin; the owned lane gate's fail-open rules remain in `Lane-assignment fail-open`.

### Requirement: Task review snapshot

**Reason**: The engine builds the same detached snapshot.

**Migration**: Folded into `workflows`: `Task review snapshot`.

### Requirement: Snapshot exclusions

**Reason**: The engine excludes the same scratch paths.

**Migration**: Folded into `workflows`: `Snapshot exclusions`.

### Requirement: Frozen change artifacts

**Reason**: The engine freezes and digests the change directory identically.

**Migration**: Folded into `workflows`: `Frozen change artifacts`.

### Requirement: Snapshot cleanup on settle

**Reason**: The engine owns the same cleanup.

**Migration**: Folded into `workflows`: `Snapshot cleanup on settle`.

### Requirement: Stale snapshot sweep

**Reason**: The engine owns the same throttled sweep.

**Migration**: Folded into `workflows`: `Stale snapshot sweep`.

### Requirement: Lane-assignment fan-out gate

**Reason**: The engine-owned lane-assignment gate reproduces the trigger.

**Migration**: Folded into `workflows`: `Lane-assignment fan-out gate`.

### Requirement: Lane assignment state

**Reason**: The engine keeps the same per-lane assignment state.

**Migration**: Folded into `workflows`: `Lane assignment state`.

### Requirement: Lane-assignment steer payload

**Reason**: The engine renders the same steer.

**Migration**: Folded into `workflows`: `Lane-assignment steer payload`.

### Requirement: Lane-assignment fail-open

**Reason**: The engine gate fails open the same way.

**Migration**: Folded into `workflows`: `Lane-assignment fail-open`.

### Requirement: Deprecated lane-boundary trigger

**Reason**: The trigger exists only in the deleted engine.

**Migration**: Deleted with the plugin; a profile that configured it fails at load, and the owned lane-assignment gate is the replacement.

### Requirement: Review fallback visibility

**Reason**: The engine records the same bounded live-worktree reason.

**Migration**: Folded into `workflows`: `Review fallback visibility`.

### Requirement: Plan lane shape in whole-spec review

**Reason**: The bundled whole-spec instruction still checks the plan's lane shape.

**Migration**: Folded into `workflows`: `Plan lane shape in whole-spec review`.

### Requirement: Review overlap in the apply loop

**Reason**: The apply guidance still starts a review at the tick and resumes on a frozen snapshot.

**Migration**: Folded into `workflows`: `Review overlap in the apply loop`.

### Requirement: Worker-assigned checkpoint lanes

**Reason**: The engine's checkpoint and lane coordination keeps the worker-lane binding.

**Migration**: Folded into `workflows`: `Worker-assigned checkpoint lanes`.

### Requirement: Review queue admission

**Reason**: The engine queue admits every review.

**Migration**: Folded into `workflows`: `Review queue admission`.

### Requirement: Review queue identity and dedupe

**Reason**: The engine queue keeps identity and dedupe.

**Migration**: Folded into `workflows`: `Review queue identity and dedupe`.

### Requirement: Review failure classification and retry

**Reason**: The engine queue keeps the transient/permanent classification and retry budget.

**Migration**: Folded into `workflows`: `Review failure classification and retry`.

### Requirement: Review queue record integrity

**Reason**: The engine publishes one authoritative record per identity.

**Migration**: Folded into `workflows`: `Review queue record integrity`.

### Requirement: Review queue settlement

**Reason**: The engine fires the settlement observer once.

**Migration**: Folded into `workflows`: `Review queue settlement`.

### Requirement: Review queue visibility

**Reason**: The engine status reports queue depth, positions, attempts, and failure class.

**Migration**: Folded into `workflows`: `Review queue visibility`.

### Requirement: Review queue configuration and off switch

**Reason**: `reviewQueue` on the workflows row replaces the delegation configuration; the engine runs reviews only through its queue, so the off switch no longer starts an unmanaged reviewer.

**Migration**: Folded into `workflows`: `Review queue configuration and off switch`.

### Requirement: Review queue failure isolation

**Reason**: The engine queue keeps the direct-start fallback and the `ERROR` boundary.

**Migration**: Folded into `workflows`: `Review queue failure isolation`.

### Requirement: Restart reconciliation

**Reason**: The engine reconciles durable runs on load.

**Migration**: Folded into `workflows`: `Restart reconciliation`.

### Requirement: Review finding classification

**Reason**: The bundled instructions still request a class, and records still normalize it.

**Migration**: Folded into `workflows`: `Review finding classification`.

### Requirement: Section-scoped task review

**Reason**: The engine reviews a section in one snapshot.

**Migration**: Folded into `workflows`: `Section-scoped review`.

### Requirement: Section run identity

**Reason**: The engine keys a section run by its stable section identity.

**Migration**: Folded into `workflows`: `Section run identity`.

### Requirement: Section approval publication

**Reason**: The engine publishes the per-task approvals for a section PASS.

**Migration**: Folded into `workflows`: `Section approval publication`.

### Requirement: Section publication transaction

**Reason**: The engine writes section approvals transactionally.

**Migration**: Folded into `workflows`: `Section publication transaction`.

### Requirement: Section gate and status behavior

**Reason**: Section PASS and `ERROR` evidence feeds the engine gates and status.

**Migration**: Folded into `workflows`: `Section gate and status behavior`.

### Requirement: Section failure visibility

**Reason**: A section `ERROR` is visible to each covered checked task.

**Migration**: Folded into `workflows`: `Section failure visibility`.

### Requirement: Gate-only retirement switch

**Reason**: The per-signal switches exist only to restore the deleted plugin.

**Migration**: Deleted with the plugin; the `workflows` Release A switch requirements are removed in the same change.

### Requirement: Cataloged external review runs

**Reason**: The engine starts external reviewers as cataloged children.

**Migration**: Folded into `workflows`: `Cataloged external review runs`.

### Requirement: Provider-specific delivery and catalog behavior

**Reason**: The engine keeps the same delivery and catalog split.

**Migration**: Folded into `workflows`: `Provider-specific delivery and catalog behavior`.
