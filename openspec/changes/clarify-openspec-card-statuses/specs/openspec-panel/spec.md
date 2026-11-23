# Spec Delta

## MODIFIED Requirements

### Requirement: Review state on a change row

An active change row SHALL carry the review state beside its completion facts as status dots with
short neutral labels. The label MUST NOT carry colour; the colour MUST live in the dot, and each
colour MUST name one disposition: the success token for a passed or complete state, the warning
token for a state that waits on the reader, the error token for a failed state, and the neutral token
for a running or waiting state. The state MUST be derived from the workflows review records and the
current change-artifact digest. A missing local record MUST read as not run, never as a failed
review.

The whole-spec record SHALL read as `AI spec review passed`, `AI spec review not run`,
`AI spec review outdated`, `AI spec review failed`, or `AI spec review: N findings`. A live review
SHALL read as `AI spec review running · N`, `AI task review · <unit>`, or `AI code review · N`, and
the waiting form SHALL read `Waiting for the AI reviewer`. A live unit MUST replace only its own
unit and MUST NOT be rendered as settled.

The count of checked tasks with a valid portable task-review PASS SHALL render as
`tasks reviewed N/M` with its own dot: the success token when every checked task carries a PASS, the
warning token while any is missing, and no item at all when no task is checked. Its tooltip SHALL
name the missing tasks.

The facts row SHALL keep one uniform gap between items. It MUST NOT reserve a fixed column that
widens one gap relative to another.

#### Scenario: Current whole-spec PASS

- **WHEN** the whole-spec record is a PASS whose digest matches the current change artifacts
- **THEN** the row shows `AI spec review passed` with a success dot, and its tooltip names the reviewer, the model, and when the review ran

#### Scenario: No local record

- **WHEN** the change has no local whole-spec record, for example in a fresh clone
- **THEN** the row shows `AI spec review not run` with a warning dot and a tooltip naming how the review starts and that archive needs it, and claims no failure

#### Scenario: Plan edited after the PASS

- **WHEN** the whole-spec record is a PASS whose digest differs from the current change artifacts
- **THEN** the row shows `AI spec review outdated` with a warning dot and does not present the change as reviewed

#### Scenario: Findings or error

- **WHEN** the last whole-spec record is findings or an engine error at the current digest
- **THEN** the row shows `AI spec review: N findings` or `AI spec review failed` with an error dot while the label itself stays neutral

#### Scenario: Missing task approvals

- **WHEN** a change has 16 checked tasks and 14 carry a portable task-review PASS
- **THEN** the row shows `tasks reviewed 14/16` with a warning dot and names the two missing task numbers in its tooltip

#### Scenario: Every checked task reviewed

- **WHEN** every checked task carries a valid portable PASS
- **THEN** the reviewed-task count renders with a success dot

#### Scenario: No task checked

- **WHEN** no task is checked
- **THEN** the row renders no reviewed-task count

#### Scenario: Uncommitted approval

- **WHEN** a checked task carries a valid portable PASS that is present in the working tree but not committed
- **THEN** the row counts it exactly as the archive gate does, and the commit-backed audit remains the separate `pnpm reviews:check` run

#### Scenario: Live review

- **WHEN** a spec, task, or integration review of the change is starting or running
- **THEN** the row shows that unit with a spinner and its plain label, and no settled state for it

#### Scenario: Waiting for a covering review

- **WHEN** the change's run waits on a live covering review of another unit
- **THEN** the row shows `Waiting for the AI reviewer` with the neutral dot and keeps the spinner off

#### Scenario: Uniform facts spacing

- **WHEN** two cards render phases of different label length
- **THEN** the gap between any two facts is the same, because no item reserves a fixed column
