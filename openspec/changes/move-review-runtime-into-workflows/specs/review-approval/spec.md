# Spec Delta

## ADDED Requirements

### Requirement: Approval producer

The active review owner SHALL be the only producer of a committed task approval: the workflows review
executor while the signal is owned, and the retained legacy runtime while the matching legacy switch
is enabled. Either owner SHALL write `openspec/changes/<change>/reviews/<taskId>.json` atomically
before its local record, and a failed write SHALL publish no `PASS`. The approval SHALL keep the
existing field set, so the audit commands, the archive marker, and an archived change are unchanged.

#### Scenario: Review executor publishes the approval

- **WHEN** a native task review returns PASS
- **THEN** the approval is written at its committed path before the local record and carries the verdict, the digest, the task id, the change, and the target

#### Scenario: Legacy owner publishes during rollback

- **WHEN** the matching legacy switch is enabled and its review returns PASS
- **THEN** the legacy runtime writes the same committed path and field set, no workflow approval is produced, and completion and archive accept it

#### Scenario: Failed publication approves nothing

- **WHEN** the approval cannot be written
- **THEN** no approval exists, the local record becomes `ERROR`, and the run names the failed path

#### Scenario: Audit is producer-agnostic

- **WHEN** `pnpm reviews:check` reads a change whose approvals were written by the native executor and one written by the legacy runtime
- **THEN** both produce identical results for the same fields
