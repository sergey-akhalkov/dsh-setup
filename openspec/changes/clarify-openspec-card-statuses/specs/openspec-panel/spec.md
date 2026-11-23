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

### Requirement: Change card gutter

A change card for an active change in the `Changes` list SHALL render a fixed-width readiness
gutter, separated from the card body by a hairline. With task-review state available the gutter
SHALL state a readiness percent over the two counts that produce it: `N/T implemented` and
`N/T reviewed`, each with its own status dot and label. A line whose count equals the total SHALL
carry the success dot; a line that is still behind SHALL carry the informational dot the phase
already uses, never a warning one, because unfinished work is not a problem to fix. Every task MUST
count twice in that percent,
once for being checked in `tasks.md` and once for carrying a task-review `PASS`, so only a change
that is fully implemented and fully reviewed reads `100%`. While either count is below the total the
percent MUST read at most `99`, so rounding can never report completion. The percent states task
completion, not archive eligibility: a `100%` change whose whole-spec `PASS` is missing or stale
still cannot be archived. Without task-review state the gutter
SHALL keep stating the completed and total task counts over a `tasks` label, or a dash when no tasks
are written. The gutter MUST NOT draw a tracking bar.

#### Scenario: Readiness from two counts

- **WHEN** an active change has 9 tasks, 6 of them checked, and 4 of the checked tasks carry a task-review PASS
- **THEN** the gutter reads `56%` over `6/9 implemented` and `4/9 reviewed`, each with the informational dot

#### Scenario: Fully implemented and reviewed

- **WHEN** every task is checked and every checked task carries a PASS
- **THEN** the gutter reads `100%` over `9/9 implemented` and `9/9 reviewed` with success dots

#### Scenario: Missing task approvals

- **WHEN** a change has 16 tasks, every one checked, and 14 carry a portable task-review PASS
- **THEN** the reviewed line reads `14/16 reviewed` with the informational dot and its tooltip names the two missing task numbers

#### Scenario: Rounding never reports completion

- **WHEN** a change has 100 tasks, every one checked, and 99 carrying a portable PASS
- **THEN** the gutter reads `99%`, never `100%`

#### Scenario: Readiness is not archive eligibility

- **WHEN** every task is checked and every checked task carries a PASS but the whole-spec PASS is missing or stale
- **THEN** the gutter reads `100%` and an archive attempt is still refused for the missing whole-spec record

#### Scenario: No task-review state

- **WHEN** the workflows engine reports no task-review state for the change
- **THEN** the gutter states the plain completed and total counts over `tasks` and renders no percent

#### Scenario: No tasks written

- **WHEN** an active change has a proposal but no tasks file
- **THEN** the gutter states a dash instead of a fraction and the facts row states that no tasks are written yet
