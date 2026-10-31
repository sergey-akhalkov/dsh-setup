# Spec Delta

## ADDED Requirements

### Requirement: Process events are shown on one time axis

The system SHALL derive a process timeline from the recorded session metadata: worker activations and
their spans, the number of workers active over time, decomposition markers, and reflection markers. It
SHALL render the worker concurrency over time with the decomposition and reflection markers on the same
time axis and a step-rate strip below them. It MUST carry metadata only.

#### Scenario: Worker burst

- **WHEN** an episode's first worker starts after a period with no active worker
- **THEN** a decomposition marker is placed at that time with the episode id and the number of workers in the episode

#### Scenario: Reflection marker

- **WHEN** a work checkpoint call with an outcome word appears in an episode
- **THEN** a reflection marker is placed at its time with its outcome word and the steps since the previous reflection

#### Scenario: Malformed reflection call

- **WHEN** a work checkpoint call has no parseable outcome word
- **THEN** it is excluded from the reflection markers, does not reset the reflection cadence, and does not count toward reflection coverage

#### Scenario: Concurrency series

- **WHEN** two workers are active at the same instant
- **THEN** the timeline reads two active workers at that instant

#### Scenario: Work rate

- **WHEN** the timeline renders
- **THEN** a step-rate strip shows the steps recorded per bucket under the markers

#### Scenario: No workers

- **WHEN** no worker was recorded in the window
- **THEN** the timeline states that no worker was observed and does not imply that decomposition ran

#### Scenario: Thin data

- **WHEN** the window holds no episode
- **THEN** the timeline renders its empty state and no marker

#### Scenario: Metadata only

- **WHEN** the timeline renders
- **THEN** it carries times, counts, ids, and outcome words, never message text or tool arguments

### Requirement: The process summary states coverage and an intervention comparison

The system SHALL report the window's workers, episodes with a worker, worker activations, maximum
concurrency, time to first worker (p50/p90), steps between reflections (p50/p90), reflections per
episode, and reflection coverage. It SHALL compare before and after a configured intervention date, or
against the previous equal window, with sample sizes and an association label. Below the configured
minimum either side SHALL read insufficient data.

#### Scenario: Summary

- **WHEN** the window holds episodes with workers and reflections
- **THEN** the summary reports every listed count and distribution with its sample size

#### Scenario: Intervention split

- **WHEN** an intervention date is configured
- **THEN** the summary reports the before and after side separately, prints the date it used, and labels the comparison an association

#### Scenario: No intervention date

- **WHEN** no intervention date is configured
- **THEN** the comparison uses the previous equal window, or the previous completed session for the session range, names that baseline, or is absent when no baseline exists

#### Scenario: Insufficient sides

- **WHEN** either side of the comparison holds fewer episodes than the configured minimum
- **THEN** the comparison reads insufficient data and is not shown as an improvement

#### Scenario: No workers

- **WHEN** the window holds no worker
- **THEN** the summary reads zero workers and states that no decomposition was observed rather than treating it as compliance
