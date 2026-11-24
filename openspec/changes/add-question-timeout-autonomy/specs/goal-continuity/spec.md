# Spec Delta

## MODIFIED Requirements

### Requirement: Continuation evidence

Before deciding continuation, the supervisor SHALL read the latest successful `work_checkpoint` plan recorded after the most recent user signal and at or before the settled turn, counting a plan from that turn or the one before. A user signal is a direct message, an answered `ask_user_question`, or a timed `ask_user_question` that returned `pending`; only a direct message or an answer carries a decision, and a pending result settles the ask without deciding it. The decision runs at every settled turn of an active goal, whatever its activation. An older, stale, absent, or unreadable plan is no evidence, and reading it MUST NOT change the goal phase.

#### Scenario: Armed goal is decided too

- **WHEN** a goal round of an armed goal settles
- **THEN** the supervisor reads the continuation evidence for that turn before the driver can admit the next round

#### Scenario: A user answer invalidates the earlier plan

- **WHEN** the user sends a direct message and no new plan is recorded afterwards
- **THEN** a plan from before that message is not evidence for the next settled turn, and the unevidenced rule applies instead

#### Scenario: An answered question invalidates the plan that asked it

- **WHEN** a plan names a `user_decision` bottleneck and the model asks through `ask_user_question` and receives an answer
- **THEN** that plan is not evidence for the next settled turn, so the decision the user supplied cannot replay as a stop

#### Scenario: A pending question invalidates the plan that asked it

- **WHEN** a plan names a `user_decision` bottleneck and the timed `ask_user_question` returns `pending`
- **THEN** that plan is not evidence for the next settled turn, so the unanswered decision cannot replay as a stop; the pending result is not an answer and is not permission

#### Scenario: Stale plan is no evidence

- **WHEN** the latest plan is older than the turn before the settled turn
- **THEN** the supervisor treats it as absent and uses it neither to withhold nor to justify a resume

#### Scenario: Unreadable plan is no evidence

- **WHEN** the latest record cannot be parsed or lacks a required field
- **THEN** the supervisor treats it as absent and does not fail the session

#### Scenario: Evidence read changes no goal

- **WHEN** the supervisor reads the evidence for a continuation decision
- **THEN** the goal keeps its phase and activation, so a later user message or an explicit resume still applies
