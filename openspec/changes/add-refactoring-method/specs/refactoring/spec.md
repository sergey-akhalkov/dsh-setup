# Spec Delta

## Purpose

A state-driven, behavior-preserving refactoring method that audits a codebase, selects the highest-ROI
path from evidence, builds a test safety net before any production edit, executes small green steps,
and leaves an enforceable architecture ratchet.

## ADDED Requirements

### Requirement: Opt-in packaged method

The setup SHALL ship the refactoring method as an on-demand skill in an installable plugin bundle. The
bundle MUST add no always-on prompt contribution, no automatic session behavior, no Client surface, and
no runtime dependency.

#### Scenario: Catalog only

- **WHEN** the bundle is installed and the skill is not invoked
- **THEN** the skill catalog lists `refactoring` and the full skill body is absent from the assembled prompt

#### Scenario: Explicit invocation

- **WHEN** the user or the model invokes `refactoring`
- **THEN** the method body loads from the packaged assets

#### Scenario: Disabled row

- **WHEN** the bundle row is disabled
- **THEN** the skill is absent from the catalog

### Requirement: Evidence-based audit

Before a refactor, the method SHALL create a read-only audit change that records a project brief,
baseline evidence, and an ROI register. Every candidate path MUST carry the nine factor values, its
score, and an evidence reference.

#### Scenario: Ranked register

- **WHEN** the audit runs
- **THEN** every candidate path has H, C, D, A, M, B, E, R, F values, a score, and evidence references

#### Scenario: Missing evidence

- **WHEN** a candidate's factor value has no evidence
- **THEN** the value is not accepted and the candidate is not eligible for selection

#### Scenario: No justified path

- **WHEN** no candidate has a justified gap
- **THEN** the method records that no refactor is needed and creates no refactor change

### Requirement: ROI selection and overrides

The method SHALL select the highest-ROI eligible path. A hard override MUST outrank the score and MUST
be exempt from repeat exclusion: an active P0/P1 defect or incident, a security or data risk, or a
critical contract contradiction.

#### Scenario: Highest ROI

- **WHEN** several candidates are eligible and no hard override exists
- **THEN** the highest-ROI candidate is selected and the rejected candidates are recorded

#### Scenario: Hard override

- **WHEN** an active P0/P1, a security or data risk, or a critical contract contradiction exists
- **THEN** that path is selected before score-based candidates

#### Scenario: Previous area excluded

- **WHEN** the top-scored path is the previous cycle's area and no hard override applies
- **THEN** the next eligible path is selected

#### Scenario: WIP limit

- **WHEN** an audit or an unclassified refactor change is still active
- **THEN** no new audit starts

### Requirement: Path approval gate

The method SHALL present the register, the selected path, the rejected candidates, the target, the risk,
and the safety-net plan to the user, and MUST NOT edit production code until the user approves or
replaces the path.

#### Scenario: Approval

- **WHEN** the user approves the selected path
- **THEN** the audit records the approval and the refactor change may start

#### Scenario: Override

- **WHEN** the user selects a different path
- **THEN** the audit records the user's choice and the overridden score

#### Scenario: No decision

- **WHEN** the user has not decided
- **THEN** no refactor change starts and no production code is edited

### Requirement: Audit change contract

The audit SHALL be an OpenSpec change named `audit-*` that declares `skip_specs: true` and changes no
product behavior. It MUST record the state snapshot, the ROI register, the candidate path records, and
the decision, and MUST close when the refactor change exists or the no-path decision is recorded.

#### Scenario: Creation

- **WHEN** the audit starts
- **THEN** an `audit-*` change exists with `skip_specs: true` and a state snapshot

#### Scenario: No product delta

- **WHEN** the audit change is validated
- **THEN** it contains no product requirement delta

#### Scenario: Close

- **WHEN** the refactor change exists or no path is justified
- **THEN** the audit change is closed with the decision recorded

### Requirement: Separate refactor change

After path approval, the method SHALL create a separate OpenSpec change named `refactor-*` for exactly
one path. The change MUST state that behavior is preserved and MUST carry the target structure, the step
plan, the verification contract, and the ratchet.

#### Scenario: One path

- **WHEN** the refactor change is created
- **THEN** it names exactly one selected path and its scope

#### Scenario: Behavior preservation

- **WHEN** the change is reviewed
- **THEN** it states that no product behavior changes and names the oracles that prove it

#### Scenario: No refactor change

- **WHEN** no path is justified or approved
- **THEN** no `refactor-*` change is created

### Requirement: Honest spec-less refactor change

A refactor change SHALL declare `skip_specs: true` when it changes no requirement and adds no
enforceable architecture rule. It MUST carry a delta only when a requirement or an enforceable rule
actually changes, and MUST NOT invent a requirement to satisfy validation.

#### Scenario: No requirement change

- **WHEN** the path only restructures code and adds no rule
- **THEN** the change declares `skip_specs: true` and validates without a delta

#### Scenario: Enforceable rule

- **WHEN** the path adds or changes an enforceable architecture rule or contract
- **THEN** the change carries the corresponding delta

#### Scenario: No fake delta

- **WHEN** a behavior is already covered by an existing scenario
- **THEN** no requirement is added solely to make the change validate

### Requirement: Mandatory safety net

Before the first production edit, the refactor change MUST prove a green baseline, behavior oracles at
the public seams it moves, mutation proof that the oracles fail when behavior is broken, and a
performance or data baseline where the path is hot or stateful.

#### Scenario: Green baseline

- **WHEN** the safety net is prepared
- **THEN** the relevant suite passes on the current commit and the command, environment, duration, and known flakes are recorded

#### Scenario: Behavior oracles

- **WHEN** a public seam will move
- **THEN** an oracle at that seam passes on the current code

#### Scenario: Mutation proof

- **WHEN** the behavior is deliberately broken
- **THEN** the oracle fails, and the mutation is recorded

#### Scenario: Weak net refused

- **WHEN** an oracle cannot fail or the baseline is red
- **THEN** no production edit starts

### Requirement: Safety-net approval gate

The method SHALL present the safety-net proofs to the user and MUST NOT edit production code until the
user approves the net. The decision MUST be recorded in the refactor change.

#### Scenario: Approval

- **WHEN** the user approves the safety net
- **THEN** the refactor steps may start

#### Scenario: Refusal

- **WHEN** the user refuses the net
- **THEN** no production edit starts and the missing proof is recorded

#### Scenario: Pending

- **WHEN** the user has not decided
- **THEN** the refactor waits

### Requirement: Behavior-preserving execution

The method SHALL execute one behavior-preserving transformation per green commit. A red step MUST be
reverted rather than pushed through. Tests that encode live behavior MUST NOT be deleted; a test for
proven-dead code MAY be removed only with proof of unreachability.

#### Scenario: Green step

- **WHEN** a step completes
- **THEN** the narrow suite and the relevant full suite pass and the step is committed

#### Scenario: Red step

- **WHEN** a step makes the suite red
- **THEN** the step is reverted before the next step

#### Scenario: Test removal

- **WHEN** a step would delete a test that encodes live behavior
- **THEN** the method stops and treats it as a behavior change

### Requirement: Behavior changes are separate changes

A refactor MUST NOT change product behavior. When a behavior change is discovered, the method MUST stop
the refactor or record the defect and handle it in a separate red-test-first change.

#### Scenario: Defect discovered

- **WHEN** a test reveals a defect
- **THEN** the current behavior is pinned, the refactor continues only if safe, and a separate change fixes the defect

#### Scenario: Contract change needed

- **WHEN** the refactor requires a changed contract or behavior
- **THEN** the method stops and the change is split

#### Scenario: Unsafe defect

- **WHEN** the defect makes the refactor unsafe
- **THEN** the defect is fixed first in its own change and the refactor resumes after

### Requirement: Verification and ratchet

Before the refactor change closes, the behavior oracles MUST pass, the public contract diff MUST be
empty, performance MUST be within budget, the full suite MUST be green, the targeted measured metric
MUST improve without another metric regressing beyond its budget, and at least one automated ratchet
MUST guard the target architecture.

#### Scenario: Definition of done

- **WHEN** the refactor is proposed as done
- **THEN** the oracles, contract diff, performance budget, full suite, and before/after metrics are recorded

#### Scenario: Ratchet

- **WHEN** the refactor changes the architecture
- **THEN** an automated guard fails on a new violation of the target architecture

#### Scenario: Oracle rewrite

- **WHEN** an oracle asserted implementation details and had to be rewritten
- **THEN** the rewrite is justified, the behavior is re-proven, and the reason is recorded

### Requirement: Ratchet baseline

When the target rule already has existing violations, the method SHALL freeze them in a baseline and
MUST fail only on new violations.

#### Scenario: Existing violations

- **WHEN** the target rule has pre-existing violations
- **THEN** the baseline records them and the check passes on them

#### Scenario: New violation

- **WHEN** a new violation of the target rule is introduced
- **THEN** the ratchet fails

### Requirement: Deduplication rule

The method SHALL unify only behavior that is proven identical and MUST NOT create an abstraction for
merely similar code. One source of truth per fact is the goal, not zero textual duplication.

#### Scenario: Proven duplicate

- **WHEN** two implementations are proven identical by tests or contract
- **THEN** they are collapsed to one source of truth and the callers are verified

#### Scenario: Similar but distinct

- **WHEN** two implementations look similar but have different behavior or ownership
- **THEN** they remain separate and the reason is recorded

#### Scenario: Wrong abstraction

- **WHEN** a proposed abstraction would couple unrelated concepts
- **THEN** the method rejects it and keeps the duplication

### Requirement: Knowledge and state continuity

At close, the method SHALL update the project brief, the state snapshot used by the next audit, and a
durable Hindsight digest when Hindsight is available. The next audit MUST read the latest audit and
refactor artifacts and the digest before scoring candidates.

#### Scenario: Next input

- **WHEN** a new audit starts
- **THEN** it reads the latest audit state and the refactor decision record

#### Scenario: Digest

- **WHEN** Hindsight is available
- **THEN** the close writes a declarative digest of invariants, oracles, traps, and confirmed or refuted risks

#### Scenario: No report-only

- **WHEN** a cycle ends
- **THEN** it leaves the audit change and, when actionable, the refactor change; a standalone report is not the only output

### Requirement: Portability and safety

The method SHALL discover the host project's stack, commands, test tooling, environments, and review
policy before acting, and MUST NOT assume dsh-setup paths. It MUST NOT run destructive actions against
production data or the live Harness profile and MUST stop when a safe environment cannot be established.

#### Scenario: Other project

- **WHEN** the method runs in a project without dsh-setup paths
- **THEN** it discovers commands and oracles from that project's files and tools

#### Scenario: Unsafe environment

- **WHEN** a step would require production data or the live Harness profile
- **THEN** the method stops and asks for a safe environment

#### Scenario: Missing prerequisite

- **WHEN** the OpenSpec CLI or the spec-less platform support is unavailable
- **THEN** the method reports the prerequisite and does not fabricate change artifacts

### Requirement: Optional tool adapters

The method SHALL use the host project's existing tools as the default evidence sources. Serena is
optional and MUST be used only for symbol-level work through its documented discipline; the method MUST
NOT require CodeGraph or install a new tool without the user's approval.

#### Scenario: Serena unavailable

- **WHEN** Serena is not configured
- **THEN** the method continues with ordinary file and repository tools

#### Scenario: No mandatory tool

- **WHEN** the project lacks a code-graph, duplication, or mutation tool
- **THEN** the method uses the available evidence and records the gap instead of installing a dependency

#### Scenario: Optional adapter

- **WHEN** an optional adapter is already configured
- **THEN** the method may use it and still records the evidence it produced
