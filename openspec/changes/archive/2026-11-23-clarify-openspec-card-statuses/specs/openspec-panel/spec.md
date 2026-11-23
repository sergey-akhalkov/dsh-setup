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

#### Scenario: Current whole-spec PASS

- **WHEN** the whole-spec record is a PASS whose digest matches the current change artifacts
- **THEN** the row shows `AI spec review passed` with a success dot, and its tooltip names the reviewer, the model, and when the review ran

#### Scenario: Plan edited after the PASS

- **WHEN** the whole-spec record is a PASS whose digest differs from the current change artifacts
- **THEN** the row shows `AI spec review outdated` with a warning dot and does not present the change as reviewed

#### Scenario: Missing task approvals

- **WHEN** a change has 16 checked tasks and 14 carry a portable task-review PASS
- **THEN** the row reports 14 of 16 reviewed tasks and names the two missing task numbers

#### Scenario: Uncommitted approval

- **WHEN** a checked task carries a valid portable PASS that is present in the working tree but not committed
- **THEN** the row counts it exactly as the archive gate does, and the commit-backed audit remains the separate `pnpm reviews:check` run

#### Scenario: Findings or error

- **WHEN** the last whole-spec record is findings or an engine error at the current digest
- **THEN** the row shows `AI spec review: N findings` or `AI spec review failed` with an error dot while the label itself stays neutral

#### Scenario: No local record

- **WHEN** the change has no local whole-spec record, for example in a fresh clone
- **THEN** the row shows `AI spec review not run` with a warning dot and a tooltip naming how the review starts and that archive needs it, and claims no failure

### Requirement: Change card gutter

A change card for an active change in the `Changes` list SHALL render a fixed-width readiness
gutter, separated from the card body by a hairline. With task-review state available the gutter
SHALL state a readiness percent over the two counts that produce it: `N/T implemented` and
`N/T reviewed`, each with its own status dot and label. A line whose count equals the total SHALL
carry the success dot; a line that is still behind SHALL carry the informational dot the phase
already uses, never a warning one, because unfinished work is not a problem to fix. Every task MUST
count twice in that percent, once for being checked in `tasks.md` and once for carrying a
task-review `PASS`, so only a change that is fully implemented and fully reviewed reads `100%`.
While either count is below the total the percent MUST read at most `99`, so rounding can never
report completion. The percent states task completion, not archive eligibility: a `100%` change
whose whole-spec `PASS` is missing or stale still cannot be archived. Without task-review state the
gutter SHALL state the completed and total task counts over a `tasks` label, or a dash when no tasks
are written. The gutter MUST NOT draw a tracking bar.

#### Scenario: Counts lead the row

- **WHEN** an active change reports 3 of 12 tasks done and the engine reports no task-review state
- **THEN** its gutter states `3/12` above `tasks`, and the body states the name, purpose, facts and navigation

#### Scenario: No tasks written

- **WHEN** an active change has a proposal but no tasks file
- **THEN** the gutter states a dash instead of a fraction and the facts row states that no tasks are written yet

#### Scenario: Readiness from two counts

- **WHEN** an active change has 9 tasks, 6 of them checked, and 4 of the checked tasks carry a task-review PASS
- **THEN** the gutter reads `56%` over `6/9 implemented` and `4/9 reviewed`, each with the informational dot

#### Scenario: Fully implemented and reviewed

- **WHEN** every task is checked and every checked task carries a PASS
- **THEN** the gutter reads `100%` over `9/9 implemented` and `9/9 reviewed` with success dots

#### Scenario: Rounding never reports completion

- **WHEN** a change has 100 tasks, every one checked, and 99 carrying a portable PASS
- **THEN** the gutter reads `99%`, never `100%`

#### Scenario: Readiness is not archive eligibility

- **WHEN** every task is checked and every checked task carries a PASS but the whole-spec PASS is missing or stale
- **THEN** the gutter reads `100%` and an archive attempt is still refused for the missing whole-spec record

#### Scenario: No task-review state

- **WHEN** the workflows engine reports no task-review state for the change
- **THEN** the gutter states the plain completed and total counts over `tasks` and renders no percent

#### Scenario: Uniform facts spacing

- **WHEN** two cards render phases of different label length
- **THEN** the gap between any two facts is the same, because no item reserves a fixed column

### Requirement: Change card body

The body of an active change card SHALL state, in order, the change name with its last-modified time,
the proposal's purpose clamped to two lines, one facts row, and one navigation row carrying the
artifact entries beside the card's actions. An archived change card SHALL keep the same history
facts — its last-modified time, task completion, purpose, artifact entries and last commit — in that
shared skeleton, state the neutral `archived` dot and label in its facts row, and offer no action
and no review state.

#### Scenario: Purpose stays short

- **WHEN** a proposal's Why runs longer than two lines of the body at the current width
- **THEN** the purpose shows two lines with a trailing ellipsis and the full text on demand

#### Scenario: Navigation row

- **WHEN** an active change carries a proposal, a design, delta spec requirements and tasks
- **THEN** one navigation row lists those artifacts beside the card's actions, and choosing an entry opens that artifact

#### Scenario: Archived row keeps its history layout

- **WHEN** a card renders an archived change in the `Archive` segment or in the empty-state recents
- **THEN** it uses the same gutter, facts and navigation rows, states the neutral `archived` dot and label instead of a tag, shows its last commit where the actions sit, and offers no action and no review state
