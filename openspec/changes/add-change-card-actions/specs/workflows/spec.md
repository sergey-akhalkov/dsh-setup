# Spec Delta

## MODIFIED Requirements

### Requirement: Pre-execute archive gate

The engine SHALL refuse `openspec archive <change>` while a required review or spec-review step is open, no authenticated completed `change-intake` run or authenticated receipt exists, or the current whole-spec `PASS` record is missing or stale. A receipt MUST verify its host HMAC; a forged or unsigned receipt MUST NOT satisfy the gate. The refusal SHALL name the run, step, and missing evidence. It MUST allow the archive when the evidence is present and MUST NOT treat a text claim as evidence. When a shell command carries a shell separator and contains an archive invocation or archive move that the parser cannot understand, the engine SHALL refuse the call with the existing "could not be parsed safely" reason instead of allowing it; a compound command that names no archive SHALL NOT be refused by this rule.

#### Scenario: Archive is refused

- **WHEN** a required review step is open for the change
- **THEN** the archive is refused with the run, step, and missing evidence

#### Scenario: No intake run

- **WHEN** no completed `change-intake` run or authenticated receipt exists for the change
- **THEN** the archive is refused with the missing intake run and its next step

#### Scenario: Stale review blocks archive

- **WHEN** the whole-spec record's digest does not match the current change artifacts
- **THEN** the archive is refused with the stale record and the next review action

#### Scenario: Adopted change archives

- **WHEN** a pre-existing change has a valid host-authenticated adoption receipt
- **THEN** the archive gate accepts the receipt and does not require a recreated directory

#### Scenario: Receipt survives pruning

- **WHEN** the run history is pruned after a successful intake and the current whole-spec `PASS` record exists
- **THEN** the valid authenticated receipt still lets the archive gate accept the completed intake

#### Scenario: Archive is allowed

- **WHEN** every required step has verified evidence
- **THEN** the archive is allowed

#### Scenario: Text claim is refused

- **WHEN** the model claims the review passed without a PASS record
- **THEN** the archive remains refused

#### Scenario: Separator cannot hide an unparsed archive

- **WHEN** a shell command contains `openspec archive <change>` after a `;`, `&&`, `||`, newline, or `cd` compound command and the parser cannot read it as one documented invocation
- **THEN** the call is refused with the "could not be parsed safely" reason and the command does not run

#### Scenario: Quoted or compound archive move is refused

- **WHEN** a command moves a change into the archive with a quoted destination or another command after the destination, such as `git status; git mv openspec/changes/auth "openspec/changes/archive"` or `cd .; mv openspec/changes/auth openspec/changes/archive; pwd`
- **THEN** the call is refused with the "could not be parsed safely" reason and the move does not run

#### Scenario: Benign compound command is not an archive

- **WHEN** a compound shell command names no archive invocation or archive move
- **THEN** the archive gate does not refuse it and the call proceeds

## ADDED Requirements

### Requirement: User-clicked archive authorization

The workflows plugin SHALL provide `workflowsArchiveGate.authorizeAndCheck(workspace, change)`. It SHALL ensure the host key, verify the change artifacts and the current whole-spec `PASS`, and write the host-signed adoption receipt. The click is the final authorization: it MUST NOT apply the agent path's run/approval/marker checks, run the archive, or accept a text claim; the agent path keeps the full gate.

#### Scenario: Verified click is authorized

- **WHEN** the click service runs for a change with all four artifacts and a current whole-spec `PASS` record
- **THEN** the host-signed adoption receipt is written and the service returns `ok`

#### Scenario: Missing PASS record is refused

- **WHEN** the current whole-spec `PASS` record is missing or stale
- **THEN** no archive is authorized, the service returns the missing or stale reason, and the change stays active

#### Scenario: Open run step does not block the click

- **WHEN** a related run has an open required step but the artifacts and whole-spec `PASS` are current
- **THEN** the click is authorized and the receipt is written

#### Scenario: Missing portable approvals do not block the click

- **WHEN** a checked task has no portable task-review PASS, whether the shipped rule is `own` or `defer`
- **THEN** the click is authorized and the receipt is written

#### Scenario: Malformed legacy marker does not block the click

- **WHEN** `openspec/review-approval.json` exists but cannot be read as a valid marker
- **THEN** the click is authorized; the marker only affects the agent command path

#### Scenario: Engine absent means no engine checks

- **WHEN** a profile does not install the workflows engine
- **THEN** no archive gate service exists, and the OpenSpec plugin's own complete-task check still applies
