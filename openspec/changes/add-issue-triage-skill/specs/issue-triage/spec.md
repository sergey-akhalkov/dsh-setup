## ADDED Requirements

### Requirement: The triage run stops without a usable gh

The skill SHALL verify `gh` authentication and the OpenSpec root before any inventory, and MUST stop
with one line naming the remedy when either is missing.

#### Scenario: Missing authentication

- **WHEN** the run starts where `gh auth status` fails
- **THEN** it prints the one-line remedy and makes no inventory call and no GitHub write

### Requirement: Every verdict carries evidence

Each issue SHALL receive one verdict from `tracked`, `shipped`, `fixed`, `duplicate`, `invalid`,
`needs-info`, `deferred`, or `needs-change`. A `fixed` verdict MUST name the command and its passing
output, a `duplicate` verdict the canonical issue number, a `tracked` verdict the change name, and a
`needs-change` verdict the paths it will touch. A verdict MUST NOT rest on a text claim alone.

#### Scenario: A fixed verdict carries a command

- **WHEN** an issue is reported as already fixed
- **THEN** the report entry names the command that reproduced the fix and that command's passing
  output

#### Scenario: A duplicate names its canonical issue

- **WHEN** two open issues describe the same defect
- **THEN** the run closes the one no other artifact references and names the canonical number in the
  closing comment

### Requirement: Closes are limited and owner decisions are asked

The run SHALL close duplicates and already-fixed issues with a comment. It MUST NOT close an issue
whose verdict is `invalid` or `wontfix` without a recorded owner answer.

#### Scenario: A duplicate is closed

- **WHEN** an issue is a duplicate of a canonical open issue
- **THEN** it is closed with reason `duplicate`, a comment naming the canonical issue, and no body
  edit

#### Scenario: Invalid needs the owner

- **WHEN** an issue is judged invalid or out of scope
- **THEN** the run asks the owner and leaves the issue open until the answer arrives

### Requirement: Valid issues are clustered and capped

The run SHALL group `needs-change` issues whose touched paths overlap into one proposal, and SHALL
propose at most three changes per run, ordered by gate-breaking, data loss or security, visible
breakage, then flake. An issue beyond the cap MUST receive a deferral comment and stay open.

#### Scenario: Two symptoms share one change

- **WHEN** two issues would edit the same files
- **THEN** they become one proposal and one comment each names that proposal

#### Scenario: The cap defers the rest

- **WHEN** more than three proposals are valid
- **THEN** only three are drafted and every other issue gets a deferral comment naming the reason

### Requirement: A proposal is a draft

A triage run SHALL write one change draft per cluster under `.dsh/workflows/drafts/<name>/` and MUST
NOT create `openspec/changes/<name>/` itself.

#### Scenario: A drafted cluster

- **WHEN** a cluster is promoted to a proposal
- **THEN** its requirements, architecture, and interface drafts exist under
  `.dsh/workflows/drafts/<name>/` and no change directory exists yet

### Requirement: Promotion enters the normal intake

After the owner's promotion decision, the agent MUST invoke `openspec new change <name>` through the
Harness shell tool, which is the call the intake gate matches. A direct CLI invocation outside the
Harness session does not start the intake and MUST NOT be the documented promotion path. The
intake's approval decides the spec before implementation.

#### Scenario: Promotion starts the intake

- **WHEN** the owner decides to promote a draft
- **THEN** the agent invokes `openspec new change <name>` through the Harness shell tool and the
  intake's approval decides the spec before implementation

### Requirement: GitHub writes are lead-only and idempotent

Only the lead SHALL post a triage comment or close an issue; a subagent MUST write only its own draft
directory. A rerun MUST NOT post a second triage comment for an issue whose marker comment already
exists.

#### Scenario: A second run posts nothing

- **WHEN** the run executes again for an issue whose link comment with the change marker exists
- **THEN** no second comment is posted

#### Scenario: A worker cannot comment

- **WHEN** a subagent drafts a cluster
- **THEN** it makes no `gh` write and the lead posts the comment afterwards

### Requirement: One report table

The run SHALL end with one table carrying the columns issue, verdict, evidence, change or draft, and
next step, ordered by severity, plus a separate table for the items closed during the run.

#### Scenario: The report ends the run

- **WHEN** the run completes
- **THEN** the reply contains the two tables and every verdict appears in exactly one row
