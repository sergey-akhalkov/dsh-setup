# review-learning Specification

## Purpose
Turns repeated review findings into durable, user-approved lessons and injects the accepted lessons into later reviews, so the same class of failure is not rediscovered from scratch every time.

## Requirements

### Requirement: Lesson store

The plugin SHALL keep a local JSONL lesson store under `.dsh/review-learning/`, one record per lesson, with a class, a title, a body, source evidence, a state, and timestamps. The store MUST be bounded (default 200 lessons or 1 MB per workspace), MUST dedupe by normalized class and title, MUST NOT be tracked, and MUST survive a restart.

#### Scenario: A lesson is stored

- **WHEN** a valid proposed lesson is recorded
- **THEN** one JSONL line is appended and a later read returns the lesson

#### Scenario: Duplicate merges

- **WHEN** the same normalized class and title are proposed again
- **THEN** the existing lesson is updated instead of a second record being appended

#### Scenario: Store is bounded

- **WHEN** the store reaches its configured cap
- **THEN** the oldest non-applied lesson is removed before the write, applied lessons are retained, and when no non-applied lesson exists the write is refused atomically with `capacity` and existing records are unchanged

### Requirement: Lesson lifecycle

A lesson SHALL move through `proposed`, `accepted`, `rejected`, and `applied`. A model MAY propose a lesson but MUST NOT accept, reject, or apply it. Acceptance and rejection SHALL require a direct user answer, and application SHALL name the change, spec, file, or test that carries the lesson.

#### Scenario: Model proposes

- **WHEN** the model records a proposed lesson
- **THEN** the lesson is stored as `proposed` and is not injected

#### Scenario: User accepts

- **WHEN** the user answers yes to the acceptance question
- **THEN** the lesson becomes `accepted` and becomes eligible for injection

#### Scenario: Model cannot accept

- **WHEN** the model tries to accept its own lesson without a user answer
- **THEN** the action is refused with the next action: ask the user

#### Scenario: Applied lesson is traceable

- **WHEN** an accepted lesson is applied
- **THEN** the record names the target and time, and the lesson remains readable

### Requirement: Deterministic retro report

The `review_retro` tool SHALL read the last `window` sanitized finding-history records (default 50) for the workspace, extract findings, group them by class, and return the counts, the top class, up to three bounded examples, the repeat rate, the gap count, and at most one proposed lesson. It MUST NOT call a model, MUST NOT edit a file, and MUST bound its output. A FINDINGS then PASS sequence MUST still contribute the earlier findings.

#### Scenario: FINDINGS then PASS keeps the findings

- **WHEN** a review returned FINDINGS and a later review for the same task returned PASS
- **THEN** the retro report still counts the earlier findings

#### Scenario: Report groups findings

- **WHEN** the window contains findings in `missing-test` and `path-boundary`
- **THEN** the report shows both counts, the top class, and examples with their source records

#### Scenario: Empty window

- **WHEN** no review record with findings exists in the window
- **THEN** the report says so and proposes no lesson

#### Scenario: Malformed record is counted

- **WHEN** one record in the window cannot be parsed
- **THEN** the report names the skipped count and still reports the valid findings

### Requirement: Repeat-finding metric

A finding SHALL count as repeated when the same class and a normalized title hash appeared in an earlier review record in the window. The report SHALL show the repeat count and rate per class, computed from existing records, and MUST NOT add a second log.

#### Scenario: Repetition is measured

- **WHEN** two of ten findings in a class repeat an earlier title
- **THEN** the report shows two repeats and a 20 percent rate for that class

#### Scenario: First occurrence is not a repeat

- **WHEN** a class and title combination appears only once in the window
- **THEN** it is reported as new, not repeated

### Requirement: Lesson injection

At review start, the engine SHALL append up to three `accepted` or `applied` lessons that match the rule and the change's capabilities to the review instruction. The section MUST be bounded (default 1200 characters), MUST omit `proposed` and `rejected` lessons, and MUST add no section when no lesson matches.

#### Scenario: Accepted lesson is injected

- **WHEN** an accepted lesson matches the rule and change
- **THEN** the review instruction carries its class, title, and body before the output contract

#### Scenario: Proposed lesson is not injected

- **WHEN** a lesson is only `proposed`
- **THEN** the review instruction does not include it

#### Scenario: No match adds no section

- **WHEN** no accepted or applied lesson matches the rule and change
- **THEN** the review instruction is byte-identical to the classification-aware instruction with lesson injection disabled

### Requirement: Manual interface and opt-out

The bundle SHALL expose `review_retro` and `review_lesson` tools and a `/review-retro` command. `reviewLearning.enabled` (default true) SHALL control retro reporting, lesson decisions, and prompt injection; disabling it MUST leave existing records readable and MUST NOT change review verdicts or gates.

#### Scenario: Tools are available

- **WHEN** the plugin loads with learning enabled
- **THEN** the tools and the command are registered and the tool descriptions name the user-approval rule

#### Scenario: Learning is disabled

- **WHEN** `reviewLearning.enabled` is false
- **THEN** no retro or lesson tool is registered, no lesson is injected, and reviews behave as before

### Requirement: Trust boundaries

Lesson text is untrusted data. The plugin MUST NOT execute it, MUST NOT treat it as an instruction, MUST NOT store credentials or machine paths, and MUST scope the store to the requesting workspace. A lesson MUST NOT change the P0/P1 pass rule or the approval gate.

#### Scenario: A finding contains an instruction

- **WHEN** a finding body says to ignore the review rules
- **THEN** the text is stored as lesson data and is not executed as an instruction

#### Scenario: Workspace isolation

- **WHEN** a lesson was accepted in another workspace
- **THEN** it is not injected into this workspace's review

#### Scenario: Approval boundary is unchanged

- **WHEN** an accepted lesson recommends passing a review with a finding
- **THEN** the review still returns FINDINGS and the gate still rejects the task

### Requirement: Lesson revisioning

A duplicate proposal for an accepted or applied lesson SHALL create a new `proposed` revision with a `supersedes` link; the accepted or applied content and scope MUST remain immutable. A user answer SHALL be bound to the exact lesson revision; an answer for an older revision MUST be rejected.

#### Scenario: Accepted content is immutable

- **WHEN** a duplicate proposal has different content for an accepted lesson
- **THEN** a new proposed revision is created and the accepted content is unchanged

#### Scenario: Stale answer is rejected

- **WHEN** a user answer refers to a lesson revision that has since changed
- **THEN** the decision is refused and the current revision is named

### Requirement: Lesson capacity

When the store is full and no non-applied lesson can be evicted, a write SHALL be refused atomically with `capacity`; existing records MUST remain unchanged.

#### Scenario: Applied-only store is full

- **WHEN** the store reaches its count or byte cap and every lesson is applied
- **THEN** the write is refused with `capacity` and no record is removed

### Requirement: Finding history

The bundle SHALL retain a bounded local history of sanitized per-run verdicts and findings so a later PASS does not erase the learning input. The history MUST NOT duplicate a reused record, MUST be bounded, and MUST NOT contain prompts, credentials, or machine paths.

#### Scenario: Findings survive a later PASS

- **WHEN** a review publishes FINDINGS and a later review for the same task publishes PASS
- **THEN** the history still contains the earlier findings for the retro report

#### Scenario: Reused record is not duplicated

- **WHEN** a review reuses an existing matching record
- **THEN** no second history entry is appended

#### Scenario: History is bounded

- **WHEN** the history reaches its configured cap
- **THEN** the oldest entry is pruned before the write and the retro window still reads the most recent entries

### Requirement: Finding history failure boundary

The history entry SHALL be appended after the authoritative review record is published, outside the record-publication error path. A failed append MUST NOT change the review verdict, replace the authoritative record, or write a second or conflicting approval record. The engine SHALL attempt one bounded `gap` marker and MUST NOT retry inside the same completion; when the file cannot be written at all, the run status detail MUST name the gap.

#### Scenario: History write failure after FINDINGS

- **WHEN** appending the history entry fails after a FINDINGS record is published
- **THEN** the verdict, the local record, and its findings are unchanged, no ERROR record replaces them, and the gap is reported

#### Scenario: History write failure after PASS

- **WHEN** appending the history entry fails after a PASS record and its portable approval are published
- **THEN** both PASS records stay unchanged, no ERROR record replaces them, the gate still accepts the PASS, and the gap is reported

#### Scenario: Gap is visible to the retro

- **WHEN** the history carries a gap marker
- **THEN** the retro report names the gap count and still reports the valid findings

#### Scenario: Next review recovers

- **WHEN** a later review settles after a failed append
- **THEN** it appends normally and the earlier gap marker stays until the history is pruned
