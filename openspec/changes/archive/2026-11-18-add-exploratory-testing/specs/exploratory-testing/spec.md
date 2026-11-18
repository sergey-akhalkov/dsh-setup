# Spec Delta

## Purpose

State-driven exploratory testing that runs as an OpenSpec cycle change and ends in a reviewable
outcome change for defects, regression tests, and spec corrections.

## ADDED Requirements

### Requirement: Opt-in packaged method

The setup SHALL ship the exploratory testing method as an on-demand skill in an installable plugin
bundle. The bundle MUST add no always-on prompt contribution, no automatic session behavior, no
Client surface, and no runtime dependency.

#### Scenario: Catalog only

- **WHEN** the bundle is installed and the skill is not invoked
- **THEN** the skill catalog lists `exploratory-testing` and the full skill body is absent from the assembled prompt

#### Scenario: Explicit invocation

- **WHEN** the user or the model invokes `exploratory-testing`
- **THEN** the method body loads from the packaged assets

#### Scenario: Disabled row

- **WHEN** the bundle row is disabled
- **THEN** the skill is absent from the catalog

### Requirement: State-driven focus selection

Before a cycle, the method SHALL build a focus register from current evidence covering knowledge
gaps, test gaps, churn, defect history, ambiguity, staleness, criticality, and feasibility. Each
candidate MUST carry a score and the evidence behind it. The register MUST name the selected focus,
its focus mode, and the rejected candidates.

#### Scenario: Ranked register

- **WHEN** the state scan runs
- **THEN** every candidate area has the eight factor values, its score, and evidence references

#### Scenario: Selection

- **WHEN** the register is complete
- **THEN** one primary focus is selected and its focus mode is recorded

#### Scenario: No justified cycle

- **WHEN** no candidate has a justified gap
- **THEN** the method reports that no cycle is needed and creates no cycle change

### Requirement: Anti-repetition and overrides

The method SHALL exclude the previous cycle's focus from selection unless it matches a hard
override: an open P0/P1 defect or incident, a security or data risk, or a critical spec
contradiction. Every hard-override category MUST be exempt from repeat exclusion and MUST outrank
the score. When all remaining candidates repeat, the method MUST rotate the focus mode and heuristic
family instead of repeating the same charter.

#### Scenario: Previous area excluded

- **WHEN** the top-scored area was the previous cycle's focus and matches no hard override
- **THEN** the next eligible area is selected

#### Scenario: Rotation fallback

- **WHEN** every candidate was recently explored and none matches a hard override
- **THEN** the next cycle changes the focus mode and the heuristic family

#### Scenario: Hard override

- **WHEN** an open P0/P1 defect, a data or security risk, or a critical spec contradiction exists
- **THEN** that area is eligible regardless of repeat exclusion and is selected before score-based candidates

#### Scenario: Previous focus with a security risk

- **WHEN** the previous cycle's focus now has a security or data risk but no confirmed critical defect
- **THEN** it remains eligible as a hard override instead of being excluded as a repeat

### Requirement: Focus approval gate

The method SHALL present the focus register and the proposed charters to the user and MUST NOT
start an exploratory session until the user approves or replaces the focus. The cycle change MUST
record the approval decision and the rationale for any override.

#### Scenario: Approval

- **WHEN** the user approves the focus
- **THEN** the cycle change records the approval and sessions may start

#### Scenario: Override

- **WHEN** the user selects a different area
- **THEN** the cycle change records the user's choice and the overridden score

#### Scenario: No approval

- **WHEN** the user has not decided
- **THEN** no exploratory session starts

### Requirement: Cycle change contract

The method SHALL create an OpenSpec change named `explore-*` that records the state snapshot, the
focus register, the charters, and the session evidence. The change MUST declare `skip_specs: true`
because it changes no product behavior, and its tasks MUST drive the cycle through planning,
sessions, triage, and outcome creation. The cycle change closes when the outcome change exists or
the no-finding decision is recorded.

#### Scenario: Creation

- **WHEN** the focus is approved
- **THEN** an `explore-*` change exists with `skip_specs: true` and a state snapshot

#### Scenario: Task progress

- **WHEN** a cycle phase completes
- **THEN** its task is checked and the evidence artifact is present

#### Scenario: Close

- **WHEN** the outcome change exists or no finding is actionable
- **THEN** the cycle change is closed

#### Scenario: No product delta

- **WHEN** the cycle change is validated
- **THEN** it contains no product requirement delta

#### Scenario: Spec-less platform path

- **WHEN** the cycle change is created with `skip_specs: true`
- **THEN** intake, adoption, and user-click archive accept it without a spec file and still require the current whole-spec PASS record

### Requirement: Outcome change and finding review

After triage, the method SHALL create a spec-driven OpenSpec change named `fix-*` or `harden-*`
containing one structured finding record per candidate and a decision log. The change MUST NOT
apply a code or spec fix before the user classifies each finding. The change MAY be omitted when no
candidate is actionable.

#### Scenario: Findings

- **WHEN** triage completes
- **THEN** each candidate has a record with observed behavior, expected behavior or oracle, evidence, severity, and proposed class

#### Scenario: Decision gate

- **WHEN** a finding's decision is pending
- **THEN** no fix task is executed for that finding

#### Scenario: No actionable findings

- **WHEN** no candidate is actionable
- **THEN** no outcome change is created and the cycle change records why

### Requirement: Spec-less outcome change

When every accepted finding maps to an explicitly named existing scenario and no requirement
changes, the outcome change SHALL declare `skip_specs: true`. It MUST NOT invent a requirement or a
delta to satisfy validation. The whole-spec review still runs on its proposal, design, findings, and
tasks. The marker is part of the change digest; removing or changing it invalidates the PASS and
requires a new review.

#### Scenario: Existing scenarios cover every finding

- **WHEN** every accepted finding names an existing scenario and no requirement changes
- **THEN** the outcome change declares `skip_specs: true` and validates without a spec delta

#### Scenario: Requirement changes

- **WHEN** at least one accepted finding changes or adds a requirement
- **THEN** the outcome change carries the corresponding spec delta instead of `skip_specs`

#### Scenario: No fake delta

- **WHEN** a finding is covered by an existing scenario
- **THEN** no requirement is added solely to make the change validate

### Requirement: Finding classification

Each finding SHALL be classified as bug, feature, spec error, test gap, or unknown. A finding
without a valid oracle MUST default to unknown and MUST NOT be treated as a bug. The decision log
MUST record the user's classification, severity, and rationale.

#### Scenario: Bug

- **WHEN** behavior contradicts a valid requirement, contract, or documented expectation
- **THEN** it is classified as a bug with the oracle named

#### Scenario: Feature

- **WHEN** behavior is intentional and the spec is silent
- **THEN** it is classified as a feature to be documented, not as a bug

#### Scenario: Unknown

- **WHEN** no oracle exists
- **THEN** the finding stays unknown until the user decides

#### Scenario: User decision

- **WHEN** the user classifies a finding
- **THEN** the decision log records the class, severity, and rationale

### Requirement: Regression proof and spec correction

Every confirmed bug MUST receive a regression test that fails on the pre-fix code and passes after
the fix. Every accepted finding MUST map to a spec delta or to an explicitly named existing
scenario. A dismissed finding MUST leave an oracle, a test, or a recorded rationale so a later
cycle does not rediscover it. Test count and line coverage MUST NOT be used as the goal.

#### Scenario: Red before green

- **WHEN** a bug fix is proposed
- **THEN** the regression test is shown failing before the fix and passing after it

#### Scenario: Spec map

- **WHEN** a finding is accepted
- **THEN** its outcome names the delta scenario or the existing scenario that covers it

#### Scenario: Dismissed

- **WHEN** a finding is dismissed
- **THEN** the decision log names the oracle or test that prevents rediscovery

### Requirement: Knowledge and state continuity

At cycle close, the method SHALL update the project brief, the state snapshot used by the next
scan, and a durable Hindsight digest when Hindsight is available. The next cycle MUST read the
latest cycle and outcome artifacts and the digest before scoring candidates. A standalone report
MUST NOT be the only output of a cycle.

#### Scenario: Next input

- **WHEN** a new cycle starts
- **THEN** the state scan reads the latest cycle state snapshot and outcome decisions

#### Scenario: Digest

- **WHEN** Hindsight is available
- **THEN** the cycle writes a declarative digest of invariants, oracles, traps, and confirmed or refuted risks

#### Scenario: No report-only

- **WHEN** a cycle ends
- **THEN** it leaves a cycle change and, when actionable, an outcome change

### Requirement: Portability and safety

The method SHALL discover the project's stack, commands, test tooling, environments, oracles, and
review policy before running a session. It MUST NOT assume dsh-setup-specific paths. It MUST NOT
run destructive actions against production data or the live Harness profile, and it MUST stop and
ask when a safe environment cannot be established.

#### Scenario: Other project

- **WHEN** the method runs in a project without dsh-setup paths
- **THEN** it discovers commands and oracles from that project's files and tools

#### Scenario: Unsafe environment

- **WHEN** a session would require production data or the live Harness profile
- **THEN** the method stops and asks for a safe environment

#### Scenario: Missing prerequisite

- **WHEN** the OpenSpec CLI is unavailable
- **THEN** the method reports the prerequisite and does not fabricate change artifacts
