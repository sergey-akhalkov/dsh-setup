# Spec Delta

## MODIFIED Requirements

### Requirement: Adoption of existing changes

The `/workflows adopt <name>` command and the model-facing `workflows` tool action `adopt` SHALL verify the existing `proposal.md`, `design.md`, `tasks.md`, at least one `specs/*/spec.md` — or, when the change's `.openspec.yaml` sets `skip_specs: true`, the three artifacts plus that marker — and the current whole-spec `PASS` record, ask the user to confirm through the host user-questions service, and write a host-authenticated `.dsh/workflows/receipts/<name>.json` without calling `openspec new change`. A non-affirmative answer, a timeout, or an unavailable question service MUST NOT write the receipt. The model MAY request adoption, but it MUST NOT supply the confirmation answer; the receipt is written only after the host asks the user and the user answers yes. The change and its verified digest MUST be re-verified after the answer, and a change that moved MUST NOT write the receipt.

#### Scenario: Existing change is adopted

- **WHEN** the user runs `/workflows adopt auth` for a change with all artifacts and a current whole-spec `PASS` record and answers yes
- **THEN** the host-authenticated adoption receipt is written and the change directory is not recreated

#### Scenario: Model requests adoption with a user confirmation

- **WHEN** the model calls the `workflows` tool `adopt` for an existing adoptable change and the user answers yes in the host question
- **THEN** the host-authenticated adoption receipt is written, the change directory is not recreated, and the archive gate accepts the later archive

#### Scenario: Missing artifact blocks adoption

- **WHEN** one required artifact is missing
- **THEN** no receipt is written and the missing artifact is named

#### Scenario: Rejected confirmation writes nothing

- **WHEN** the user answers no to the adoption confirmation
- **THEN** no receipt is written and the archive gate stays refused

#### Scenario: Change that moves during the question is refused

- **WHEN** the change artifacts or the whole-spec `PASS` digest change while the adoption question is open
- **THEN** no receipt is written and the refusal names the changed verification

#### Scenario: Model cannot adopt

- **WHEN** the model requests adoption and the question service is unavailable, the question times out, or the user does not answer yes
- **THEN** no receipt is written and the tool returns the named reason

#### Scenario: Spec-less change is adopted

- **WHEN** the change has proposal.md, design.md, tasks.md, `skip_specs: true`, no spec file, and a current whole-spec `PASS`, and the user answers yes
- **THEN** the host-authenticated adoption receipt is written without requiring a spec file

#### Scenario: Spec-less change without the marker is refused

- **WHEN** the change has no spec file and no `skip_specs: true` marker
- **THEN** no receipt is written and the refusal names the missing spec or marker

### Requirement: User-clicked archive authorization

The workflows plugin SHALL provide `workflowsArchiveGate.authorizeAndCheck(workspace, change)`. It SHALL ensure the host key, verify the change artifacts — the three artifacts plus the `skip_specs` marker for a spec-less change — and the current whole-spec `PASS`, and write the host-signed adoption receipt. The click is the final authorization: it MUST NOT apply the agent path's run/approval/marker checks, run the archive, or accept a text claim; the agent path keeps the full gate.

#### Scenario: Verified click is authorized

- **WHEN** the click service runs for a change with all four artifacts and a current whole-spec `PASS` record
- **THEN** the host-signed adoption receipt is written and the service returns `ok`

#### Scenario: Spec-less click is authorized

- **WHEN** the click service runs for a change with proposal.md, design.md, tasks.md, `skip_specs: true`, and a current whole-spec `PASS` record
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

## ADDED Requirements

### Requirement: Finding records in whole-spec review

The bundled whole-spec review instruction SHALL include every `findings/**/*.md` file under the change directory in its review scope when present, in addition to `proposal.md`, `design.md`, delta specs, and `tasks.md`. The review MUST assess each finding record's evidence and proposed classification, not only the proposal and design.

#### Scenario: Outcome change with finding records

- **WHEN** the change contains a `findings/F-001.md` record
- **THEN** the review scope includes it and the review reports on its evidence and proposed classification

#### Scenario: Change without finding records

- **WHEN** the change has no findings directory
- **THEN** the existing whole-spec review scope is unchanged

### Requirement: Spec-less marker freshness

The change artifact digest SHALL include the effective `skip_specs` declaration. Archive authorization and adoption SHALL recheck that the change has either a spec file or `skip_specs: true` after the whole-spec record check. Adding, changing, or removing the marker MUST make an existing whole-spec record stale and MUST refuse archive or adoption until a new PASS exists.

#### Scenario: Marker removed after PASS

- **WHEN** a spec-less change has a current whole-spec PASS and its `skip_specs` marker is removed
- **THEN** the record is stale, archive is refused, and the refusal names the missing spec or marker

#### Scenario: Marker changes during adoption confirmation

- **WHEN** the marker changes or is removed while the adoption confirmation is open
- **THEN** no receipt is written and the re-verification refusal names the marker

#### Scenario: Spec-bearing change unchanged

- **WHEN** a change has a spec file
- **THEN** its digest and archive or adoption behavior are unchanged

