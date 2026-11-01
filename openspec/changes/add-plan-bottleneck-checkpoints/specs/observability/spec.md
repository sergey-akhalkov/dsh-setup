# Spec Delta

## ADDED Requirements

### Requirement: Checkpoint plan metrics

The system SHALL derive from the checkpoint metadata the share of checkpoints whose plan computes
parallel work, the blocked-lane rate, the share of `continue` checkpoints whose remedy was matched
before the next checkpoint, and the dispatch count per checkpoint. It SHALL expose them on the
existing observability surface, add `parallel-share` and `remedy-resolution` to the fixed hypothesis
metric catalog, and MUST NOT store checkpoint text or add a log.

#### Scenario: Parallel share

- **WHEN** two of four checkpoints in the window computed parallel work
- **THEN** the reported parallel share is 0.5

#### Scenario: Blocked-lane rate

- **WHEN** the window's checkpoints carry five lanes and three are `blocked`
- **THEN** the reported blocked-lane rate is 0.6

#### Scenario: Remedy resolution

- **WHEN** a `continue` checkpoint's remedy is matched before the next checkpoint
- **THEN** that checkpoint counts as resolved

#### Scenario: Dispatch per checkpoint

- **WHEN** two worker starts occur between two checkpoints
- **THEN** the reported dispatch count for the later checkpoint is 2

#### Scenario: Hypothesis metric accepted

- **WHEN** a hypothesis names `parallel-share` or `remedy-resolution`
- **THEN** the hypothesis is accepted and evaluated like the other catalog metrics

#### Scenario: No checkpoint data

- **WHEN** the window holds no checkpoint
- **THEN** the plan metrics read not applicable and no metric divides by zero

#### Scenario: Metadata only

- **WHEN** the plan metrics render
- **THEN** they carry counts and shares only, never lane text, owners, or tool arguments

## MODIFIED Requirements

### Requirement: Verification evidence is explicit

The system SHALL treat a work checkpoint as verification evidence only when its outcome is `done`
and its verified list is non-empty. It SHALL report verified and unverified closes and checkpoint
coverage, and MUST NOT store or render the text of the verified list or the lane plan. A checkpoint
with outcome `continue` is not a close.

#### Scenario: Done with evidence

- **WHEN** a checkpoint has outcome `done` and a non-empty verified list
- **THEN** the episode is verified

#### Scenario: Done without evidence

- **WHEN** a checkpoint has outcome `done` and an empty verified list
- **THEN** the episode is unverified

#### Scenario: Continue is not a close

- **WHEN** a checkpoint has outcome `continue`
- **THEN** it does not count as a verified or unverified close

#### Scenario: No checkpoint text

- **WHEN** a checkpoint's verified list or lane plan contains paths, scopes, owners, or text
- **THEN** the report carries only counts and the rendered view carries no text

#### Scenario: Missing checkpoint

- **WHEN** an episode completes without any work checkpoint
- **THEN** it is unverified and the coverage statement says so

#### Scenario: Coverage

- **WHEN** the window holds substantive episodes and checkpoints
- **THEN** checkpoint coverage is the share of substantive episodes with a completed checkpoint
