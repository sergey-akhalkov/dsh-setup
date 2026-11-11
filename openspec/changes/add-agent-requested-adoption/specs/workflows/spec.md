# Spec Delta

## MODIFIED Requirements

### Requirement: Security and trust

Tool steps SHALL use an allowlist, paths SHALL stay inside the workspace, prompts and outputs SHALL be bounded and redacted, and no definition SHALL carry a credential. Approvals, receipts, and authoritative run state SHALL be authenticated with a host key held outside `.dsh`; the model MUST NOT forge them. The write guard SHALL cover the definitions, approvals, receipts, and runs directories. Adoption SHALL remain user-authorized: the model MAY request it through the `workflows` tool, but a valid adoption receipt SHALL be written only after the host asks the user and the user answers yes; the model MUST NOT forge a receipt or supply the confirmation answer.

#### Scenario: Path escape is refused

- **WHEN** a step's evidence or draft path resolves outside the workspace
- **THEN** the step is refused and the run records the reason

#### Scenario: Secret is refused

- **WHEN** a definition contains a credential-shaped value
- **THEN** load fails with the field and no secret is stored

#### Scenario: Model cannot forge an adoption receipt

- **WHEN** the model requests adoption without a host-mediated user yes or writes a receipt file directly
- **THEN** no valid adoption receipt exists and the archive gate stays refused

### Requirement: Adoption of existing changes

The `/workflows adopt <name>` command and the model-facing `workflows` tool action `adopt` SHALL verify the existing `proposal.md`, `design.md`, `tasks.md`, at least one `specs/*/spec.md`, and the current whole-spec `PASS` record, ask the user to confirm through the host user-questions service, and write a host-authenticated `.dsh/workflows/receipts/<name>.json` without calling `openspec new change`. A non-affirmative answer, a timeout, or an unavailable question service MUST NOT write the receipt. The model MAY request adoption, but it MUST NOT supply the confirmation answer; the receipt is written only after the host asks the user and the user answers yes. The change and its verified digest MUST be re-verified after the answer, and a change that moved MUST NOT write the receipt.

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

### Requirement: Model interface

The `workflows` tool SHALL expose `list`, `start`, `resume`, `status`, `evidence`, `cancel`, and `adopt`. `start` SHALL require `allowModelStart` and user confirmation for `risk: high`. `list` SHALL name a definition whose `allowModelStart` is false as user-started and MUST NOT report it as a refused or failed model start. `resume` SHALL continue an `interrupted`, `blocked`, or `failed` run in the current session and workspace at its pending step without starting a new run. `cancel` SHALL be allowed for a run of the current session or for a run whose owning session has no live agent. `evidence` SHALL be accepted only when the host verifies it. `adopt` SHALL request adoption of one existing change and MUST write a receipt only after the host asks the user and the user answers yes. The tool MUST NOT accept a raw script or definition, install one, or write a receipt for any other action.

#### Scenario: List definitions

- **WHEN** the model calls `list`
- **THEN** it receives the definitions it may start, their trigger modes, and whether a start is model-allowed or user-started

#### Scenario: Allowed start

- **WHEN** the model starts a definition with `allowModelStart: true`
- **THEN** one run starts and the tool returns its id

#### Scenario: Refused start

- **WHEN** the model starts a definition without `allowModelStart`
- **THEN** the start is refused with the next action

#### Scenario: Interrupted run resumes

- **WHEN** the model calls `resume` with an interrupted run id in its session
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Failed run resumes

- **WHEN** the model calls `resume` with a failed run id in its session
- **THEN** the failed step is reopened and the run continues at it

#### Scenario: Dead-session run is cancellable

- **WHEN** the model calls `cancel` for a run whose owning session has no live agent
- **THEN** the run is cancelled and its open step is recorded as cancelled

#### Scenario: Live foreign run is not cancellable

- **WHEN** the model calls `cancel` or `resume` for a run whose owning session is live and different from the caller
- **THEN** the call is refused and the run is left unchanged

#### Scenario: Raw script is refused

- **WHEN** the model submits a script instead of a definition id
- **THEN** the tool rejects the call

#### Scenario: Adoption asks the user

- **WHEN** the model calls `adopt` for an existing adoptable change
- **THEN** the host asks the user to confirm and no receipt is written before a yes answer
