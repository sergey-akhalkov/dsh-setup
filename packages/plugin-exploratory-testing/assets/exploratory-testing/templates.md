# Templates

Copy-ready sections for the exploratory testing method. Replace every `<placeholder>`; delete a
section only when its phase does not apply. The method body is in `SKILL.md` in this package.

## A: proposal.md

```markdown
# Proposal

## Why this area now

- Selected focus: `<area>`
- Focus mode: `<knowledge | coverage | defect | spec>`
- Scan summary: `<top three candidates and scores>`
- Hard override: `<none, or the defect/incident/risk/contradiction that outranked the score>`

## State snapshot

`<short summary of the state that justified this cycle; the full register is in state.md>`

## Scope

- In scope: `<capabilities, surfaces, or code paths>`
- Expected outcome: `<outcome change when findings are actionable, or the decision to close with none>`

## Non-goals

- `<what this cycle will not investigate or fix>`
```

## A: design.md

```markdown
# Design

## Focus register

| Area | B | K | T | C | D | A | S | F | Score | Evidence |
| --- | - | - | - | - | - | - | - | - | ----- | -------- |
| `<area>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<score>` | `<links>` |

Selected focus: `<area>`. Focus mode: `<mode>`. Heuristic family: `<family>`.

Rejected candidates: `<area — reason it lost; area — reason>`.

## Charters

### Charter 1

- Mission: `<what to learn or break>`
- Risk hypothesis: `<the failure the session targets>`
- Areas: `<entry points, components, commands>`
- Oracles: `<specs, invariants, documented expectations>`
- Heuristics: `<state/data, failure/recovery, integration/contract, security/permissions, time/locale, upgrade/migration, scale/performance>`
- Timebox: `<duration>`
- Out-of-scope: `<what not to touch>`
- Exit criteria: `<evidence that ends the session>`

## Oracles and expectations

`<where a correct result comes from: spec scenarios, contracts, prior behavior>`

## Environment

`<build/commit, test runner, data setup, throwaway state, how to reproduce a session>`

## Safety

`<production data excluded, live profile excluded, what stops the session>`

## Severity rubric

`<the P0-P3 rubric from SKILL.md, specialized for this project if needed>`

## Classification protocol

`<how candidate findings are recorded and presented for user classification>`

## Approval decision

- Decision: `<approved | replaced | pending>`
- By: `<user>`
- Rationale or overridden score: `<text>`
```

## A: tasks.md

```markdown
# Tasks

## 1. State and focus (owns `<no source path; planning only>`)

- [ ] 1.1 Record the focus register in `state.md`.
- [ ] 1.2 Record the approved charters and the approval decision in `design.md`.

## 2. Sessions

- [ ] 2.1 Run session 1 and record its evidence.
- [ ] 2.2 Run session 2 and record its evidence.

## 3. Triage and outcome

- [ ] 3.1 Write the triage table and every candidate finding record.
- [ ] 3.2 Create the outcome change B, or record why no candidate is actionable.
- [ ] 3.3 Update `brief.md`, `state.md`, and the Hindsight digest; close A.
```

## A: state.md

```markdown
# State

## Focus register

| Area | B | K | T | C | D | A | S | F | Score | Evidence |
| --- | - | - | - | - | - | - | - | - | ----- | -------- |
| `<area>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<score>` | `<links>` |

## Previous cycle

- Last explored: `<area, date, outcome change>`
- Used focus modes: `<list>`
- Used heuristic families: `<list>`

## Coverage state

- Risk nodes with oracle-backed tests: `<count and names>`
- Known test gaps: `<list>`

## Open findings

- `<finding, owner, status>`

## Next-cycle input

- `<what the next scan should weigh; areas now stale, open risks, follow-ups>`
```

## A: brief.md

```markdown
# Project brief

## Stack

`<languages, frameworks, runtime versions>`

## Commands

- Build: `<command>`
- Run: `<command>`
- Test: `<command>`
- Lint and typecheck: `<command>`

## Environments

`<local, CI, test data, disposable environments>`

## Data setup

`<fixtures, seeds, credentials source, teardown>`

## Safety boundaries

`<production excluded, destructive operations, owner-owned profiles>`

## Criticality table

| Area | Criticality | Why |
| --- | --- | --- |
| `<area>` | `<high/medium/low>` | `<data, security, availability, side surface>` |

## Oracle sources

`<specs, contracts, docs, prior behavior a finding can contradict>`

## Review policy

`<the project's review and approval rules; gates this method must honor>`

## Tracker

`<issue tracker and how a finding is filed when it is out of scope>`
```

## Session record

```markdown
# Session: `<charter title>`

- Charter: `<mission and risk hypothesis>`
- Timebox: `<duration>`
- Build/commit and environment: `<exact revision and setup>`

## Evidence log

| Time | Action | Expected | Observed | Evidence |
| --- | --- | --- | --- | --- |
| `<time>` | `<step>` | `<oracle>` | `<result>` | `<note, screenshot, output>` |

## Hypotheses

- `<suspicion from reading or observing; mark confirmed or refuted>`

## Exit

`<why the session ended: exit criteria met, timebox, blocker>`
```

## B: proposal.md

```markdown
# Proposal

## Findings summary

| ID | Severity | Observed | Expected / oracle | Evidence | Proposed class | Confidence | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `F-<n>` | `<P0-P3>` | `<behavior>` | `<oracle or "none">` | `<link>` | `<bug/feature/spec error/test gap/unknown>` | `<high/medium/low>` | `<fix/document/correct spec/test/ask>` |

## Classification decision requested

`<the list of findings and the decision the user must make; no fix has been applied>`

## Result of the cycle

- Cycle change: `explore-<area>-<date>`
- Accepted findings: `<ids>`
- Rejected or deferred findings: `<ids and why>`
```

## B: design.md

```markdown
# Design

## Findings

`<one record per finding, linked from findings/F-<n>.md>`

## Decision log

| Finding | Decision | Severity | Rationale | Oracle or scenario | Action |
| --- | --- | --- | --- | --- | --- |
| `F-<n>` | `pending` | `<P0-P3>` | `<user rationale>` | `<delta scenario or existing scenario, or none>` | `<fix/spec/test/ask>` |

## Spec decision

- Delta: `<capability and requirement changed, or "none">`
- `skip_specs`: `<true when every accepted finding maps to an existing scenario and no requirement changes>`

## Fix plan

`<per finding: red test, fix or spec correction, green proof>`
```

## B: finding record (`findings/F-<n>.md`)

```markdown
# F-<n>: `<short title>`

- Severity: `<P0-P3>`
- Confidence: `<high/medium/low>`
- Proposed class: `<bug/feature/spec error/test gap/unknown>`
- Status: `<candidate/confirmed/rejected>`
- Hypothesis: `<yes when it was never executed; a hypothesis cannot be a bug>`

## Observed behavior

`<exact behavior, input, and result>`

## Expected behavior or oracle

`<the requirement, contract, documented expectation, or "no oracle exists">`

## Evidence

`<build/commit, environment, commands, output, links to local session notes>`

## Minimal reproduction

1. `<step>`
2. `<step>`

## Blast radius

`<users, data, security, availability, supported environments>`

## Proposed action

- `<fix code / document feature / correct spec / add test / ask the user>`
- Options: `<alternatives and trade-offs>`
```

## B: decision log entry

```markdown
### `F-<n>` — `<title>`

- Decision: `<bug | feature | spec error | test gap | unknown | rejected>`
- Severity: `<P0-P3>`
- Rationale: `<why the user decided this>`
- Oracle or scenario: `<delta scenario, existing scenario, or none>`
- Action: `<red test -> fix/spec -> green, document, or nothing>`
```

## B: tasks.md

```markdown
# Tasks

## 1. Review (`<change artifacts only>`)

- [ ] 1.1 Confirm the findings table and the decision log are complete, then get the user's classification.

## 2. Findings

- [ ] 2.1 `F-<n>`: add the failing regression test and record the red run.
- [ ] 2.2 `F-<n>`: apply the fix or spec correction and confirm the test passes.
- [ ] 2.3 `F-<n>`: map the finding to a delta scenario or the named existing scenario.
```
