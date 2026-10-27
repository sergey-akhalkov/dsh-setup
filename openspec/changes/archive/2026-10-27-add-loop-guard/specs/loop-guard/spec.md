# Spec Delta

## Purpose

Automatically detects repeated model output during a streamed response, stops the repetition early,
and steers the model back to a constructive path without requiring the user to stop or resume the
turn.

## ADDED Requirements

### Requirement: Repeated-output detection

The loop guard SHALL inspect streamed reasoning by default and visible text when enabled. It SHALL
detect a loop when one normalized line of at least the configured minimum length repeats the
configured number of times within one request, or appears in the configured number of recent
reasoning blocks. It MUST ignore blank lines, short lines, and fenced code.

#### Scenario: Repetition within one request

- **WHEN** a streamed reasoning block repeats one normalized line the configured number of times
- **THEN** the guard reports a loop at that occurrence

#### Scenario: Repetition across steps

- **WHEN** the same normalized line appears in the configured number of recent reasoning blocks
- **THEN** the guard reports a loop without waiting for the line to repeat inside one block

#### Scenario: Ordinary reasoning is left alone

- **WHEN** reasoning contains short lines, blank lines, fenced code, or ordinary prose without the
  configured repetition
- **THEN** the guard reports no loop

#### Scenario: New turn resets state

- **WHEN** the agent starts a new turn
- **THEN** the per-turn intervention state and recent-block window start empty

### Requirement: Safe early stream end

When a loop is detected and no tool-call block is being streamed, the guard SHALL end the current
model stream early. The delivered prefix MUST remain in the session, and the guard MUST NOT drop,
rewrite, or fabricate a tool call. A completed tool call and its result MUST survive an escalation
reset.

#### Scenario: Repetition before a tool call

- **WHEN** the guard cuts a reasoning stream before the model started a tool-call block
- **THEN** the partial assistant message is preserved and no tool call is emitted for the cut step

#### Scenario: Repetition after a completed call

- **WHEN** the model completed a tool call and its result before the repetition
- **THEN** the completed call and result remain intact and only the repeated output is cut

#### Scenario: Tool call in progress

- **WHEN** a tool-call block is being streamed at detection time
- **THEN** the guard does not cut that stream and delivers its notice at the next step

### Requirement: Automatic recovery notice

Unless the intervention limit schedules a reset, after an early stream end the guard SHALL submit a
recovery notice to the agent for the next step without user action. The notice MUST identify the
repetition, instruct the model to use the latest result and take the next concrete action or finish,
and MUST contain no more than the configured preview of the repeated text.

#### Scenario: The turn continues

- **WHEN** the guard cuts a looped stream during a turn
- **THEN** the next step runs with the recovery notice and no user action is required

#### Scenario: Notice content is bounded

- **WHEN** the guard builds a notice
- **THEN** it names the repeated-line count and a preview no longer than the configured limit

### Requirement: External cancellation wins over recovery

The guard MUST NOT deliver a recovery notice or start a follow-up turn after the originating turn
has been cancelled by any cause other than the guard's own hook cancellation. A notice or follow-up
MUST check the turn's cancellation state before acting.

#### Scenario: User stops during stream cleanup

- **WHEN** the user cancels the turn while the model stream is closing
- **THEN** the guard delivers no notice and starts no follow-up turn

#### Scenario: The guard's own reset still follows

- **WHEN** the turn ends because of the guard's own hook cancellation
- **THEN** the follow-up reset notice is allowed

### Requirement: Bounded escalation and automatic turn reset

The guard SHALL bound interventions per turn. After the configured number, it SHALL reset the turn
without user action at the step-end boundary, after the step's tool calls and results settle: cancel
with a hook cause and start a follow-up turn whose reset notice restates the state and asks for the
next concrete action. It MUST stop resetting after the configured session limit and leave a clear
stop reason.

#### Scenario: Intervention limit resets the turn

- **WHEN** a turn reaches the configured intervention limit without recovery
- **THEN** the guard waits for the step-end boundary, cancels the turn, and a follow-up turn starts
  with the reset notice

#### Scenario: A completed tool call survives the reset

- **WHEN** the intervention limit is reached after a tool call completed and its result was
  committed
- **THEN** the reset does not discard that call or result, and the follow-up turn starts from the
  settled history

#### Scenario: Reset limit stops the retries

- **WHEN** the configured reset limit is reached and the loop persists
- **THEN** the guard stops the turn with a stop reason that names the repeated line and the limits

#### Scenario: Recovery ends the escalation

- **WHEN** the model takes a constructive step after a cut and does not repeat the line
- **THEN** the guard does not escalate for that turn

### Requirement: Reset boundary preserves user input

The guard MUST reset only at the step-end boundary, after the step's tool calls and results settle.
It MUST NOT cancel from `agent/pre-step`. At that boundary it cancels with `keepInbox`, then defers
its inbox writes (its own notice removal and the follow-up) until the step-end session-event
publication unwinds; it MUST NOT mutate an inbox inside that callback. User messages MUST be delivered
exactly once.

#### Scenario: Queued user steering survives

- **WHEN** user steering is pending alongside the guard's recovery notice and the intervention limit
  is reached
- **THEN** the guard removes only its own notice, keeps the user message, and the follow-up turn
  delivers it exactly once

#### Scenario: Every step has a completed tool call

- **WHEN** every response contains a completed non-concluding tool call before repeated reasoning
- **THEN** the step-end boundary still triggers the reset and the final-stop limit

#### Scenario: Follow-up starts after publication

- **WHEN** the reset fires at the step-end event
- **THEN** the follow-up insertion happens after the session-event publication unwinds and starts
  exactly once

#### Scenario: No pre-step cancellation

- **WHEN** the intervention limit is reached before a step
- **THEN** the guard lets the step run and does not cancel before its messages are admitted

### Requirement: Configuration and fail-loud validation

The row configuration SHALL expose detection thresholds, text and subagent scope, the cross-block
window, intervention and reset limits, the preview length, and the final fallback. Invalid values
MUST fail at plugin load with a message naming the field; the guard MUST NOT silently fall back.

#### Scenario: Valid configuration

- **WHEN** the row is mounted with valid values
- **THEN** the guard starts with those values or the documented defaults

#### Scenario: Invalid configuration

- **WHEN** a threshold, limit, or preview length is empty, non-integer, or outside its allowed range
- **THEN** plugin load fails and names the offending field

#### Scenario: Subagent scope

- **WHEN** subagent coverage is disabled
- **THEN** a subagent stream is not cut or steered by the guard

#### Scenario: Profile override

- **WHEN** the profile patch sets the row configuration
- **THEN** the profile value is effective over the bundle default

### Requirement: No tool or prompt side effects

The guard MUST NOT modify tool arguments or results, register a system-prompt section, or ship a
Client interface. It acts only on model output and the agent steering, cancellation, and follow-up
APIs.

#### Scenario: Tool data is untouched

- **WHEN** the guard runs during a turn with tool calls
- **THEN** every tool call argument and result is byte-identical to the model's and tool's own value

#### Scenario: No prompt or Client contribution

- **WHEN** the guard is installed
- **THEN** it adds no system-prompt text, no Client bundle, and no UI registration

### Requirement: Default deployment and override

The setup bundle SHALL ship the loop guard mounted and enabled with the documented defaults. A
profile patch MAY override the row configuration; disabling or removing the row MUST remove the
behavior.

#### Scenario: Fresh setup

- **WHEN** the setup bundle is installed into a profile with no loop-guard configuration
- **THEN** the row is active with the bundled defaults

#### Scenario: Owner disables the guard

- **WHEN** the profile disables or removes the row
- **THEN** no stream is cut and no recovery notice is submitted

### Requirement: Reasoning privacy

The guard MUST keep streamed reasoning in memory only. A recovery notice and a stop reason MAY carry
at most the configured preview of the repeated line; that capped preview is the only reasoning text
the guard may persist, through the ordinary notice message and turn-end reason. The guard MUST NOT
write any other reasoning text to disk, logs, or new session events.

#### Scenario: Preview is capped

- **WHEN** the guard emits a notice or a stop reason
- **THEN** the repeated-line preview does not exceed the configured length

#### Scenario: No additional reasoning record

- **WHEN** the guard processes a stream
- **THEN** the only persisted reasoning text is the capped preview carried by its notice or stop
  reason, and no guard-owned file or log contains reasoning
