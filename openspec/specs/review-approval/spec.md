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

The repository SHALL provide `pnpm reviews:check --change <name>`, `pnpm reviews:check --all`, and `pnpm reviews:check --push`, plus `pnpm hooks:install` for the pre-push hook. The missing-approval output MUST name the change, the task number and text, the expected record path, and the exact `delegate` call. The archive workflow guidance and the contributor documentation MUST point at the audit before an archive.

#### Scenario: Audit an active change

- **WHEN** a contributor runs the audit for an active change with an unreviewed checked task
- **THEN** the output lists the task and the review call, and exits non-zero

#### Scenario: Audit all archived changes

- **WHEN** a contributor runs the full audit
- **THEN** it reports every archived change's coverage, including the pre-cutoff historical baseline and the documented exception, and fails only for a post-cutoff violation

#### Scenario: Install the hook

- **WHEN** a contributor runs `pnpm hooks:install`
- **THEN** the repository's pre-push hook is selected and a subsequent push runs the audit
