# review-approval Specification

## Purpose
Defines the repository-level approval boundary: a change's checked tasks must carry a portable task-review PASS before the change is archived, pushed, or merged, with an explicit v0.12.0 exception and a reported pre-cutoff historical baseline.

## Requirements

### Requirement: Archived changes carry task approval

The repository SHALL NOT accept an archive created after the v0.12.0 cutoff unless every checked task in its `tasks.md` has a portable task-review PASS record. Archives created before the cutoff SHALL be reported as a historical baseline without retroactive records; a later modification to any archive MUST satisfy the normal rule. A task whose text changed after its review MUST count as unapproved.

#### Scenario: An approved archive

- **WHEN** an archive created after the cutoff has a checked task with a matching portable PASS record
- **THEN** the audit accepts that task and does not require another review

#### Scenario: A missing approval

- **WHEN** an archive created after the cutoff has a checked task without a portable PASS record
- **THEN** the audit reports the change, the task number and text, and the exact review command, and the archive is not accepted

#### Scenario: A pre-cutoff archive

- **WHEN** the audit runs on an archive created before the cutoff with checked tasks and no portable records
- **THEN** it reports the change and its checked tasks as a historical baseline and does not fail

#### Scenario: A modified historical archive

- **WHEN** a commit after the cutoff modifies a pre-cutoff archive
- **THEN** that archive is checked under the normal rule, not treated as baseline

#### Scenario: A task text change

- **WHEN** a checked task is edited after its review
- **THEN** the new task id has no matching record and the task counts as unapproved

#### Scenario: An unchecked task

- **WHEN** a change has an unchecked task and every checked task is approved
- **THEN** the audit accepts the checked tasks and reports the unchecked task as an open follow-up, not as an approval failure

### Requirement: Push and CI approval

The repository SHALL install a pre-push check that validates the archived changes added in the pushed commit range that are not part of the historical baseline or the v0.12.0 exception, and CI SHALL run the approval audit for archived changes after the cutoff. A check that cannot determine the pushed range or read the evidence MUST fail closed and name the audit command to run manually.

#### Scenario: Push with a missing approval

- **WHEN** a push adds an archived change after the cutoff with a checked task that has no portable PASS record
- **THEN** the push is refused before it reaches the remote, and the message names the change, the task, and the review command

#### Scenario: Push with an approved archive

- **WHEN** every checked task in the archived changes added by the push has a portable PASS record
- **THEN** the push proceeds

#### Scenario: Unknown push range

- **WHEN** the hook cannot determine which commits the push adds, or cannot read the records
- **THEN** the push is refused with the command that runs the full audit; it is not allowed silently

#### Scenario: CI blocks a merge

- **WHEN** a change archived after the v0.12.0 cutoff has a checked task without a portable PASS
- **THEN** the CI validation fails and names the missing approval instead of accepting the archive

### Requirement: The v0.12.0 exception is explicit

The three v0.12.0 changes (`add-goal-block-review`, `adopt-agent-best-practices`, `fix-delegation-review-build-inputs`) SHALL be a documented exception because they were archived before this boundary. The exception MUST cite the post-hoc integration review PASS and the `review-v0-12-0` fixes; the full audit MUST report the three and their checked tasks. A new archive after the v0.12.0 cutoff, or a later modification to a grandfathered change, MUST satisfy the rule.

#### Scenario: The audit reports the exception

- **WHEN** the full audit runs against the repository with the exception configured
- **THEN** it lists the three v0.12.0 changes and their checked tasks as a documented exception, reports the pre-cutoff historical baseline separately, and does not fail for either

#### Scenario: A new archive after the cutoff

- **WHEN** a change archived after v0.12.0 has a checked task without a portable PASS
- **THEN** the audit fails for that change and the exception does not apply

#### Scenario: A modified grandfathered change

- **WHEN** a commit after the cutoff modifies an archived change listed in the exception
- **THEN** the changed archive is checked under the normal rule, not silently grandfathered

### Requirement: Approval evidence is portable

The approval evidence SHALL be the committed `reviews/<taskId>.json` records inside the change. It MUST be sufficient without the local `.dsh` state, so a fresh clone or a worktree that merged the change can be audited. The records MUST NOT contain the reviewing session, run id, machine paths, or credentials.

#### Scenario: Fresh clone

- **WHEN** a fresh clone contains the committed review records and no `.dsh` directory
- **THEN** the audit accepts the approved tasks without asking for a re-review

#### Scenario: Worktree review

- **WHEN** a task review runs in a worktree and its branch with the change's review records is merged
- **THEN** the approval travels with the change and is visible to the main workspace's audit

#### Scenario: Local state lost

- **WHEN** the local `.dsh` delegation state is deleted
- **THEN** the committed review records still approve the tasks they cover

### Requirement: The approval audit is one command

The repository SHALL provide `pnpm reviews:check --change <name>`, `pnpm reviews:check --all`, and
`pnpm reviews:check --push`, plus `pnpm hooks:install` for the pre-push hook. The missing-approval output
MUST name the change, the task number and text, the expected record path, and the exact supported
`workflows` review call with the explicit task selector:
`workflows(action: "start", definitionId: "<the definition for the selected approval taskRule, default task-review>", change: "<change>", task: "<taskId>")`. The
retired `reviews:export` command is not part of the audit surface. The archive workflow guidance and the
contributor documentation MUST point at the audit before an archive.

#### Scenario: Audit an active change

- **WHEN** a contributor runs the audit for an active change with an unreviewed checked task
- **THEN** the output lists the task and the exact `workflows` review call, and exits non-zero

#### Scenario: Non-default task rule

- **WHEN** `openspec/review-approval.json` selects a supported non-default `taskRule`
- **THEN** the printed recovery call names that rule's workflow definition and the resulting approval satisfies the audit

#### Scenario: Audit all archived changes

- **WHEN** a contributor runs the full audit
- **THEN** it reports every archived change's coverage, including the pre-cutoff historical baseline and the documented exception, and fails only for a post-cutoff violation

#### Scenario: Install the hook

- **WHEN** a contributor runs `pnpm hooks:install`
- **THEN** the repository's pre-push hook is selected and a subsequent push runs the audit

#### Scenario: No export fallback

- **WHEN** a contributor looks for a way to copy a local `.dsh` record into an approval after Release B
- **THEN** the audit and the documentation name the native task review instead, and no export command exists

### Requirement: Reviewer identity binding

When `openspec/review-approval.json` declares `reviewerProvider`, every portable task-review PASS MUST name a matching `target.provider`; a declared `reviewerModel` MUST also match. The live archive gate, live task gate, the `workflows` status evidence, and `pnpm reviews:check` SHALL apply the same binding. An absent declaration preserves provider-agnostic behavior; a mismatch is unapproved.

#### Scenario: Matching provider

- **WHEN** the marker declares `reviewerProvider` and a portable PASS names that provider
- **THEN** the record counts as approved

#### Scenario: Mismatched provider

- **WHEN** the marker declares `reviewerProvider` and a portable PASS names another provider
- **THEN** the record counts as unapproved and the detail names both providers

#### Scenario: Model pin

- **WHEN** the marker declares `reviewerModel` and the record target model differs
- **THEN** the record counts as unapproved

#### Scenario: Legacy marker

- **WHEN** the marker declares neither field
- **THEN** any valid record target counts as before

#### Scenario: Live task gate

- **WHEN** a checked task has a local task-review record from a provider other than the marker's reviewer and the marker declares one
- **THEN** the live task gate refuses the close

#### Scenario: Audit and live gate agree

- **WHEN** the archive gate and the approval audit inspect the same record
- **THEN** both apply the same provider/model binding and report the same approval result

### Requirement: Staged archive audit

The repository SHALL provide `pnpm reviews:check --staged` and a tracked `.githooks/pre-commit` hook selected by `pnpm hooks:install` once per clone. The command SHALL audit every staged change under `openspec/changes/archive/` and fail closed when a checked task lacks a matching PASS. A commit with no staged path under the archive passes; an unknown range or unreadable evidence fails closed and names `pnpm reviews:check --all`. The pre-push and CI audits remain authoritative.

#### Scenario: Staged unapproved archive

- **WHEN** a commit stages a change under `openspec/changes/archive/` and a checked task has no matching PASS
- **THEN** `reviews:check --staged` exits non-zero, names the task and record path, and the commit is refused

#### Scenario: Staged approved archive

- **WHEN** a commit stages an archived change whose checked tasks all have matching PASS records
- **THEN** the staged audit exits zero

#### Scenario: Non-archive commit

- **WHEN** a commit stages no path under `openspec/changes/archive/`
- **THEN** the staged audit exits zero without a full archive audit

#### Scenario: Unknown staged range

- **WHEN** the staged range cannot be determined or the evidence cannot be read
- **THEN** the audit fails closed and prints the full audit command

#### Scenario: Fresh clone hook

- **WHEN** a fresh clone on Windows runs `pnpm hooks:install` and then `git commit`
- **THEN** the pre-commit hook runs the staged audit from the tracked hooks

### Requirement: Approval producer

The workflows review executor SHALL be the only producer of a committed task approval. It SHALL write
`openspec/changes/<change>/reviews/<taskId>.json` atomically before its local record, and a failed write
SHALL publish no `PASS`. The approval SHALL keep the existing field set, so the audit commands, the
archive marker, and an archived change are unchanged. The retired `reviews:export` command SHALL NOT
produce an approval: a record that exists only in the local `.dsh/delegation/**` scratch SHALL NOT be
copied, counted, or audited as an approval.

#### Scenario: Review executor publishes the approval

- **WHEN** a native task review returns PASS
- **THEN** the approval is written at its committed path before the local record and carries the verdict, the digest, the task id, the change, and the target

#### Scenario: Failed publication approves nothing

- **WHEN** the approval cannot be written
- **THEN** no approval exists, the local record becomes `ERROR`, and the run names the failed path

#### Scenario: Audit is producer-agnostic

- **WHEN** `pnpm reviews:check` reads a change whose approvals were written by the executor and a change whose approvals were written before the legacy runtime was deleted
- **THEN** both produce identical results for the same fields

#### Scenario: Legacy-only scratch produces no approval

- **WHEN** a checked task has a local `.dsh/delegation/task-review/<change>/tasks/<taskId>.json` PASS and no committed approval
- **THEN** no approval is written, the audit reports the task as missing, and the remedy is the native task review, not the retired export command

### Requirement: Portable task-review approval

A task-scope review that returns PASS SHALL publish a sanitized portable record under the change's
`reviews/<taskId>.json` in addition to the local record. The record MUST identify the rule, change, task
id, verdict, target, time, and digests, MUST NOT include the reviewing session, run id, or machine
paths, and MUST be committed with the change.

#### Scenario: PASS writes the portable record

- **WHEN** a task review returns PASS
- **THEN** the change directory contains `reviews/<taskId>.json` with the rule, change, task id, verdict, target, time, and digests, and no session, run id, or machine path

#### Scenario: ERROR or FINDINGS is not approval

- **WHEN** a task review returns `ERROR` or `FINDINGS`
- **THEN** no portable PASS record is written for that task

#### Scenario: The record travels with the branch

- **WHEN** a task review runs in a worktree and the branch containing the change is merged
- **THEN** the portable record is present in the merged change and can approve the task there

### Requirement: Change-level review coverage

Approval SHALL be computed over every checked task in `tasks.md`, independent of session attribution. A
checked task is approved only by a matching portable task-review PASS; `ERROR`, `FINDINGS`, a missing or
malformed record, and a checked line that does not parse as a numbered task are not approved. Unchecked
tasks are reported but not required.

#### Scenario: A shell tick

- **WHEN** a session changes `tasks.md` through a shell command and no task id is attributed
- **THEN** the checked task still requires a portable PASS before archive

#### Scenario: A foreign session PASS

- **WHEN** another session wrote the portable PASS for a checked task
- **THEN** the coverage accepts that task

#### Scenario: Malformed record

- **WHEN** a portable record for a checked task is unreadable or malformed
- **THEN** the task is unapproved and the status names the malformed record

### Requirement: Archive approval gate

In a workspace whose tracked `openspec/review-approval.json` sets `archiveGate: true`, the archive SHALL
be refused before it runs unless every checked task has a portable task-review PASS. The refusal MUST
name the change, the missing tasks, and the exact review calls, and MUST leave the change active. The
guard MUST fail closed on an unreadable change, record, or task rule. A workspace without the marker
MUST be unchanged.

#### Scenario: Missing approval

- **WHEN** the archive command runs for a change with a checked task that has no portable PASS
- **THEN** the command is refused before the move and the change remains active

#### Scenario: Complete approval

- **WHEN** every checked task in the change has a portable PASS
- **THEN** the archive operation proceeds

#### Scenario: Marker absent

- **WHEN** the workspace has no `openspec/review-approval.json` marker or `archiveGate` is false
- **THEN** the archive operation is unchanged

### Requirement: PASS-only approval boundary

An `ERROR` review record MAY let a turn close but MUST NOT approve a task for archive or push. The status
and audit MUST report PASS, ERROR, and missing separately, and an archive is ready only when every
checked task has a PASS.

#### Scenario: ERROR closes a turn

- **WHEN** the only task review record is `ERROR`
- **THEN** the turn may close and the status reports the change as not archive-ready

#### Scenario: Re-review produces approval

- **WHEN** the task is reviewed again with its explicit task id and returns PASS
- **THEN** the task is approved for archive

#### Scenario: Status separates verdicts

- **WHEN** the status or audit runs
- **THEN** it reports the PASS, ERROR, and missing counts separately and names the missing tasks
