# Spec Delta

## MODIFIED Requirements

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

### Requirement: The approval audit is one command

The repository SHALL provide `pnpm reviews:check --change <name>`, `pnpm reviews:check --all`, and
`pnpm reviews:check --push`, plus `pnpm hooks:install` for the pre-push hook. The missing-approval output
MUST name the change, the task number and text, the expected record path, and the exact supported
`workflows` review call with the explicit task selector:
`workflows(action: "start", definitionId: "task-review", change: "<change>", task: "<taskId>")`. The
retired `reviews:export` command is not part of the audit surface. The archive workflow guidance and the
contributor documentation MUST point at the audit before an archive.

#### Scenario: Audit an active change

- **WHEN** a contributor runs the audit for an active change with an unreviewed checked task
- **THEN** the output lists the task and the exact `workflows` review call, and exits non-zero

#### Scenario: Audit all archived changes

- **WHEN** a contributor runs the full audit
- **THEN** it reports every archived change's coverage, including the pre-cutoff historical baseline and the documented exception, and fails only for a post-cutoff violation

#### Scenario: Install the hook

- **WHEN** a contributor runs `pnpm hooks:install`
- **THEN** the repository's pre-push hook is selected and a subsequent push runs the audit

#### Scenario: No export fallback

- **WHEN** a contributor looks for a way to copy a local `.dsh` record into an approval after Release B
- **THEN** the audit and the documentation name the native task review instead, and no export command exists

## ADDED Requirements

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
