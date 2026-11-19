# Spec Delta

## ADDED Requirements

### Requirement: Session-row review indicator

While a session owns a review that is starting, running, or waiting on a live covering review, its
session-list row SHALL show a non-interactive review indicator in the leading status seat. The
indicator MUST end when the verdict settles, MUST NOT appear for an orphaned run with no executor,
and MUST NOT appear while the row already shows agent-turn activity.

#### Scenario: Review running

- **WHEN** a session's waiting close left a spec, task, or integration review starting or running
- **THEN** that session's row shows the review indicator while the rest of the session surface stays idle

#### Scenario: Waiting for a covering review

- **WHEN** the session's run waits on a live covering review owned by another session
- **THEN** the row shows the waiting form of the indicator with no spinner

#### Scenario: Verdict settles

- **WHEN** the live review writes its verdict and the next turn starts
- **THEN** the review indicator disappears and the shell's own turn activity takes over

#### Scenario: Orphaned run

- **WHEN** the session has an open review run with no executor
- **THEN** no review indicator is shown for that session

#### Scenario: No review

- **WHEN** the session has no live or waiting review
- **THEN** the row renders its normal status and no review indicator

### Requirement: Review liveness read surface

The plugin SHALL serve a read-only review-liveness surface with two request forms: one live
`session` reports every live or waiting review in that session's workspace, each entry naming the
owning session; a bounded `sessions` list reports only those sessions' entries. It MUST resolve
each session to its workspace, MUST NOT return prompts, findings text, diffs, or workspace paths,
and MUST NOT steer, block a turn, or write review state.

#### Scenario: Live entries are reported

- **WHEN** a workspace has a review run that is starting or running
- **THEN** the surface reports its session, change, definition, unit, state, attempt, and start time

#### Scenario: Workspace form includes another session's run

- **WHEN** the requesting session is idle and another live session in the same workspace runs the review
- **THEN** the single-session form reports that review and names the owning session

#### Scenario: Session list form is session-attributed

- **WHEN** the request names only session A and the review is owned by session B
- **THEN** the response omits B's entry, so a sidebar row shows only its own session's reviews

#### Scenario: Closed sessions are skipped

- **WHEN** a requested session id is not live in the host
- **THEN** the response omits it instead of failing the read

#### Scenario: Empty result

- **WHEN** the requested scope has no live or waiting review
- **THEN** the response carries an empty list

#### Scenario: Ambiguous request

- **WHEN** a request carries neither form, both forms, or more than 100 session ids
- **THEN** the surface refuses the call with a bounded reason

#### Scenario: Read-only

- **WHEN** a caller uses any method other than a read
- **THEN** the surface refuses the call and no review state or turn is changed

### Requirement: Review surfaces are inert without the engine

When the workflows engine is not installed, the plugin SHALL register no session-row indicator and
no review-liveness surface, and the surfaces that do not depend on the engine SHALL keep working.

#### Scenario: Engine absent

- **WHEN** the workflows plugin is not installed in the profile
- **THEN** the session list and the rest of the observability view register nothing new and report no error
