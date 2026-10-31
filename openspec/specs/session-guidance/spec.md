# session-guidance Specification

## Purpose
Defines the first-party guidance the setup delivers to sessions: bounded always-on contributions, the
on-demand skill bodies beside them, independently installable domain packs, and the adaptation and
freshness rules that keep that content honest.

## Requirements

### Requirement: Always-on ruleset contribution

Installing a guidance bundle that declares an always-on contribution SHALL register its rules as an always-on system-prompt section, so a session started while the row is active receives them without invoking any skill. A configuration switch MUST disable only that bundle's always-on contribution, while disabling or uninstalling the row MUST remove both that bundle's rules and its skills. A guidance bundle without an always-on contribution is unaffected.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where a guidance bundle with an always-on contribution is active with default configuration
- **THEN** the assembled system prompt contains that bundle's rules and the catalog lists that bundle's skills

#### Scenario: Configuration opt-out

- **WHEN** the profile patch sets a bundle's `alwaysOn` configuration to false
- **THEN** the assembled prompt omits only that bundle's rules, its skills remain cataloged and loadable, and any other bundle's always-on rules remain present

#### Scenario: Row removal

- **WHEN** the row is disabled or the plugin is uninstalled
- **THEN** neither that bundle's rules nor its skills are present in the session

#### Scenario: Two guidance bundles

- **WHEN** two guidance bundles with always-on contributions are active
- **THEN** both rulesets appear in their declared order, and disabling or removing one leaves the other in place

### Requirement: Bounded prompt cost

Each always-on contribution SHALL NOT exceed the estimated-token budget documented for it: the working-principles contract is bounded at 1500 estimated tokens, the RTK rule at 300, and the Serena rule at 200. One estimated token is one quarter of the packaged text's UTF-8 byte count. Repository validation MUST fail when a contribution exceeds its budget, reporting the owning plugin and the measured size, so a later edit cannot silently raise the cost of every session.

#### Scenario: Within budget

- **WHEN** repository validation reads each packaged always-on contribution
- **THEN** it passes, and the plugin documentation states the measured size of each contribution

#### Scenario: Over budget

- **WHEN** an edit grows an always-on contribution past its documented budget
- **THEN** validation fails and reports the owning plugin and the measured size

### Requirement: On-demand skill bodies

Skill bodies and their reference files MUST stay out of the assembled prompt until the model or user
invokes them; the catalog SHALL advertise only each skill's name and description. Installing the
bundle MUST NOT place skill files outside the bundle.

#### Scenario: Catalog entry only

- **WHEN** a session starts and no packaged skill is invoked
- **THEN** the catalog advertises the skills and their bodies are absent from the prompt

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes a packaged skill
- **THEN** its body is rendered as skill content for that session

#### Scenario: Reference on demand

- **WHEN** an invoked skill points at a reference file
- **THEN** that file loads only when it is read, not with the body

#### Scenario: Row disabled

- **WHEN** the profile patch disables the bundle's row
- **THEN** its skills are absent from the catalog

### Requirement: Independent domain packs

A domain skill bundle MUST be usable on its own: composing or loading it SHALL NOT require another
`@dsh-setup` bundle, a shared runtime module, or a row contributed by a sibling bundle.

#### Scenario: Standalone install

- **WHEN** a user installs only a domain bundle
- **THEN** its skills list and load, and its own checks pass

#### Scenario: Absent sibling

- **WHEN** the guidance bundle is not installed
- **THEN** a domain bundle still composes and its rows mount

### Requirement: Recorded adaptation of source content

Guidance adapted from another source MUST record what was removed or rewritten, and why, in the owning
change or documentation. Adapted text MUST NOT be presented as verbatim upstream content and MUST NOT
carry a provenance pin or an upstream license obligation.

#### Scenario: Adaptation record

- **WHEN** a reader follows the guideline text to its owning documentation
- **THEN** it names the source and lists the removals with their reason

#### Scenario: No verbatim claim

- **WHEN** a user reads the plugin's market card or skill text
- **THEN** the content is described as adapted for this setup, not as pinned upstream text

### Requirement: Version-sensitive content freshness

Guidance that names tool versions, the release that stabilized a language feature, or "new in
release" facts SHALL NOT assert a specific version as current; it MUST omit the version or state the
date it was checked and defer to the installed tool's own version report.

#### Scenario: Omitted versions

- **WHEN** guidance maps a newer standard feature to the code it replaces
- **THEN** the mapping names the replacement without claiming the release that introduced it

#### Scenario: Checked date

- **WHEN** guidance must name a version-sensitive fact
- **THEN** it states the date it was checked and directs the reader to query the installed tool

### Requirement: Session suspension

The always-on section SHALL state how a user suspends it for the rest of the session, and MUST NOT
direct the reader to a command the Harness does not provide.

#### Scenario: Suspend in conversation

- **WHEN** the user asks to stop the ruleset for this session
- **THEN** the agent stops applying it for the remainder of the session

#### Scenario: No phantom command

- **WHEN** a reader searches the section for an invocation the Harness does not have
- **THEN** it finds none, and the section relies on plain wording instead

### Requirement: RTK always-on routing rule

The setup SHALL ship a Host-only guidance bundle that registers a short always-on routing rule and an on-demand `rtk` skill. The rule MUST direct the agent to run supported bulk-output shell commands through the user-installed rtk CLI, keep the `read`, `grep`, and `glob` tools for file inspection, and fall back to the native command when rtk is missing or the command has no rtk equivalent.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where the RTK bundle row is active with default configuration
- **THEN** the assembled system prompt contains the RTK routing rule and the catalog lists the `rtk` skill

#### Scenario: Supported bulky command

- **WHEN** the agent is about to run a supported bulky command such as `git diff`, a test suite, or a repo-wide search
- **THEN** the always-on rule directs it to use the rtk form, and the skill names the supported command groups

#### Scenario: Unsupported command or absent rtk

- **WHEN** rtk is not installed or a command has no rtk equivalent
- **THEN** the guidance directs the agent to run the native command and preserve its errors, and the profile still composes and starts

### Requirement: RTK skill body

The `rtk` skill body MUST load only when the model or user invokes the skill and MUST carry the supported-command groups, the native fallback, the full-output recovery route, and the security boundary for untrusted project filters. The catalog SHALL advertise only the skill's name and description until invocation.

#### Scenario: Catalog entry only

- **WHEN** a session starts and the `rtk` skill is not invoked
- **THEN** the catalog advertises its description and the skill body is absent from the assembled prompt

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes the `rtk` skill
- **THEN** its body is rendered as skill content for that session

#### Scenario: Untrusted project filters

- **WHEN** the agent works in a repository it does not trust
- **THEN** the skill directs it not to run `rtk trust` or load project-local filters and to use the built-in filters only

#### Scenario: Full detail recovery

- **WHEN** the compact output is insufficient to diagnose a failure
- **THEN** the skill names `rtk proxy <command>` for raw output and warns not to rerun a mutating command to recover detail

### Requirement: RTK external runtime

rtk SHALL remain an external, user-installed CLI. The bundle MUST NOT install, vendor, or declare a dependency on rtk, and MUST NOT spawn rtk from plugin code. The documentation MUST name the prerequisite and the install routes and MUST credit the rtk project as the source of the command contract without claiming pinned or verbatim upstream content.

#### Scenario: Not bundled

- **WHEN** the plugin package is inspected
- **THEN** it contains no rtk binary, no rtk installer, and no rtk package dependency

#### Scenario: Absent rtk

- **WHEN** rtk is not on the PATH
- **THEN** the profile still composes and starts, and the guidance directs the agent to run the native command

#### Scenario: Documentation

- **WHEN** a user reads the plugin's market card or documentation
- **THEN** it names rtk, the install routes, and the date the command guidance was checked, and credits the rtk project

### Requirement: RTK guidance boundary

The RTK bundle MUST change agent guidance only: it MUST NOT patch the shell service, rewrite tool arguments, filter or replace tool results, or register a post-execute hook. It MUST remain installable without any sibling `@dsh-setup` bundle, and its always-on rule MUST name a plain-language phrase that suspends only that rule for the rest of the session.

#### Scenario: No interception

- **WHEN** the RTK bundle is active
- **THEN** it registers only a system-prompt section and a skill provider, with no shell patch, tool hook, result filter, or child process

#### Scenario: Standalone install

- **WHEN** only the RTK bundle is installed
- **THEN** its skill lists and loads and its own checks pass, without requiring any other `@dsh-setup` bundle

#### Scenario: Suspension

- **WHEN** the user asks to stop rtk routing for the rest of the session
- **THEN** the agent stops applying only that rule, the other always-on guidance remains in force, and the section names no command the Harness does not provide

### Requirement: Delegation guidance

The always-on working contract SHALL state that one agent with its on-demand skills is the default, and SHALL name the conditions for handing work to a subagent or teammate: an independent piece with little shared context that runs in parallel and returns a compact result, or verification that needs a fresh context. The contract MUST NOT require a team or subagent for sequential or shared-context work.

#### Scenario: Default single loop

- **WHEN** a session starts with the working-principles row active with default configuration
- **THEN** the assembled prompt states the single-agent default and the delegation conditions

#### Scenario: Independent parallel piece

- **WHEN** a piece is independent, can run in parallel, and returns a compact result
- **THEN** the guidance permits a subagent or teammate for that piece

#### Scenario: Sequential work

- **WHEN** the work is sequential or shares evolving context
- **THEN** the guidance does not require a team or subagent and keeps the work in the main loop

#### Scenario: Single section

- **WHEN** the contract is assembled
- **THEN** the delegation guidance is part of the existing working-principles section, not a second always-on section

### Requirement: Serena always-on code-surface rule

The setup SHALL ship the Serena guidance bundle with its single guidance row enabled and the `serena` server configured in the shipped lazy row, not as a static adapter row. The always-on section SHALL be a narrow trigger that limits Serena to large-file or cross-file refactor work, directs the agent to load the `serena-discipline` skill before the first call, and keeps ordinary source reads, literal text, regex, configuration, documents and generated files on the `grep`, `glob`, `read` and `edit` tools. The skill MUST carry the lazy invocation, project activation, bounded symbol operations, and the unavailable-server fallback.

#### Scenario: Fresh installation

- **WHEN** the setup is installed and no profile patch overrides the Serena rows
- **THEN** the lazy row lists `serena`, no static `@deepseek-ai/dsh-mcp-client` row for Serena is mounted, the guidance row is enabled, the assembled system prompt contains the trigger, and the catalog lists `serena-discipline`

#### Scenario: Enabled by the owner

- **WHEN** the owner keeps the shipped Serena guidance row enabled (the default)
- **THEN** the assembled system prompt contains the trigger and the catalog lists `serena-discipline`

#### Scenario: Lazy invocation

- **WHEN** the agent follows the rule for a large-file or cross-file refactor
- **THEN** the rule directs it to the `serena` lazy server through `mcp_tools`/`mcp_call` and to the skill, and the session does not require the static `mcp__serena__*` tool names

#### Scenario: Activation before symbol calls

- **WHEN** the lazy Serena server reports no active project before symbol work
- **THEN** the skill directs `activate_project` on the session's working directory through `mcp_call`, then the bounded symbol operations

#### Scenario: Large-file and refactor scope

- **WHEN** the task is an ordinary source read, a literal text edit, regex, configuration or a document
- **THEN** the rule keeps that work on the `grep`, `glob`, `read` and `edit` tools, and limits Serena to large files and cross-file refactors

#### Scenario: Text search stays with the file tools

- **WHEN** the task is literal text, regex, configuration or a document edit
- **THEN** the skill names `search_for_pattern` only as a fallback and keeps the search on the `grep`, `glob` and `read` tools

#### Scenario: Symbol edit still verifies

- **WHEN** the agent changes code through a Serena symbol operation
- **THEN** the rule still requires the repository's own checks, because the call proves the edit and not the callers

#### Scenario: Unavailable server

- **WHEN** the lazy Serena server is unreachable or the language has no language server
- **THEN** the skill directs the agent to state that once and continue with the ordinary tools

#### Scenario: Always-on opt-out

- **WHEN** the profile sets `alwaysOn: false` on the guidance row
- **THEN** the assembled system prompt contains no Serena trigger and the catalog still lists `serena-discipline`

#### Scenario: Suspend in conversation

- **WHEN** the user asks to stop the rule for this session
- **THEN** the agent stops applying it for the remainder of the session while the lazy Serena server and the skill keep working

### Requirement: Goal-round wait handling

The always-on working contract SHALL state that a goal round MUST NOT end only to wait for
background work: the agent SHALL use `job_output(wait: true)` or do independent work in the same
round. A timeout MUST NOT be treated as a blocker; the same job handle is rechecked.

#### Scenario: Pending background job

- **WHEN** a goal round has a pending background job
- **THEN** the assembled contract directs the agent to wait with `job_output(wait: true)` or to do independent work instead of ending the round

#### Scenario: Timeout is not a blocker

- **WHEN** a job observation times out
- **THEN** the contract directs the agent to recheck the same handle rather than report a blocker

### Requirement: Goal blocker and completion evidence

The always-on working contract SHALL state that `blocked` requires both the runtime round threshold and a user-only obstacle: a next step that only the user can perform, or knowledge only the user has. It SHALL state that difficulty, uncertainty, remaining work, a library or sibling-repository change, a testability or instrumentation change, and a permission the runtime already grants are not blockers. It SHALL state that a blocker names exactly one user-only action and that a menu containing an authorized alternative is not a blocker. It SHALL state that `complete` requires current evidence for every requirement of the objective.

#### Scenario: Premature blocker

- **WHEN** the agent considers reporting `blocked` before three consecutive rounds or with a changed obstacle
- **THEN** the contract rejects that report and keeps the goal active

#### Scenario: Completion audit

- **WHEN** the agent considers reporting `complete`
- **THEN** the contract requires each requirement of the objective to be checked against current evidence

#### Scenario: Authorized means

- **WHEN** the obstacle is a library, sibling-repository, test, or testability change within the agent's authority
- **THEN** the contract rejects the block and directs the agent to make that change

#### Scenario: Permission already granted

- **WHEN** the runtime grants full file access or a standing grant covers the action
- **THEN** the contract rejects a permission block for that action

#### Scenario: Menu of alternatives

- **WHEN** the block reason lists a code or tool option beside a user-only option
- **THEN** the contract rejects the block as a menu and selects the authorized option

#### Scenario: User-only obstacle

- **WHEN** the next step is a restart, a credential, a product decision, a publication, or data only the user has
- **THEN** the contract permits the block and requires the exact user-only action

### Requirement: Goal round-cap discipline

The always-on working contract SHALL state that goal creation omits `max_goal_rounds` unless the
user explicitly asked for a round limit, so the deployment default governs the budget.

#### Scenario: Default budget

- **WHEN** a goal is created without a user-requested round limit
- **THEN** the contract omits `max_goal_rounds` and the deployment default applies

#### Scenario: Explicit limit

- **WHEN** the user explicitly asks for a round limit
- **THEN** the contract passes that limit

### Requirement: Goal guidance stays in the bounded contract

The goal guidance SHALL be part of the existing working-principles always-on section, not a second
section, and the contract MUST remain within its documented 1500 estimated-token budget.

#### Scenario: Single bounded section

- **WHEN** the contract is assembled and repository validation measures it
- **THEN** the goal guidance appears in the working-principles section and the measured size stays within the documented budget

### Requirement: Standing grant ledger

The always-on working contract SHALL state that a standing user grant is recorded durably in the workspace `AGENTS.md` or a machine-local grant record with its date and scope, and that the agent MUST NOT ask again for an action the grant covers. A grant SHALL cover means only and SHALL NOT authorize a new product requirement, a destructive action, a credential, or a publication unless it names it.

#### Scenario: Grant is recorded

- **WHEN** the user says not to ask for permission and to do what the goal needs
- **THEN** the agent records the dated grant and its scope in the workspace instruction file or the local grant record, then proceeds

#### Scenario: Covered action

- **WHEN** a block proposal asks for permission for an action the grant covers
- **THEN** the contract treats the action as authorized and rejects the permission block

#### Scenario: Scope limit

- **WHEN** a destructive action, credential, publication, or new product requirement is outside the grant
- **THEN** it remains a user decision

#### Scenario: Foreign or stale grant

- **WHEN** the grant belongs to another workspace, task, or an earlier scope that the user narrowed
- **THEN** the contract does not apply it

### Requirement: Means versus scope

The always-on working contract SHALL distinguish a scope change from a means. A new feature or requirement, a changed public contract, destroyed data, a changed access or credential, and a publication SHALL be user decisions. Editing another repository, adding a helper, a test harness, instrumentation, or test-only activation to achieve the requested outcome SHALL be a means that the agent performs and discloses.

#### Scenario: Sibling repository

- **WHEN** the requested outcome needs a change in a sibling repository
- **THEN** the contract treats the change as a means, performs it, and discloses it in the report

#### Scenario: Testability

- **WHEN** the requested evidence needs a test-only activation, accessibility hook, or instrumentation
- **THEN** the contract treats it as a means and prefers a test-only flag without a production behavior change

#### Scenario: Production behavior

- **WHEN** the only route changes production behavior
- **THEN** the contract treats it as a product decision

#### Scenario: New feature

- **WHEN** the proposed work adds a feature or requirement the user did not ask for
- **THEN** the contract treats it as a scope change and requires the user's decision

### Requirement: Block review guidance

The always-on working contract SHALL state that a model-proposed goal block is independently reviewed before it takes effect, that a denied block means the agent continues with the review's next action, and that an allowed block names exactly one user-only action. The contract MUST NOT present the review as a reason to ask the user for permission.

#### Scenario: Denied block

- **WHEN** the review rejects a proposed block
- **THEN** the contract directs the agent to continue with the review's next action and keep the goal active

#### Scenario: Verified block

- **WHEN** the review confirms a blocker
- **THEN** the closing message names the exact user-only action and what it unblocks

#### Scenario: No permission request

- **WHEN** the review is available
- **THEN** the contract does not turn the review into a request for the user's approval

### Requirement: Plan checkpoint guidance

The always-on working contract SHALL state that a request which touches more than one file, or whose cause is not yet known, gets a written plan and the user's nod before the first edit, and that a one-line fix needs none. It MUST NOT claim a command or mode the Harness does not provide, and the clause MUST keep the contract within its documented budget.

#### Scenario: Multi-file request

- **WHEN** the assembled contract is read before a request that spans several files
- **THEN** it directs the agent to write the plan and wait for approval before editing

#### Scenario: One-line fix

- **WHEN** the request is a single localized fix
- **THEN** the contract does not require a plan

#### Scenario: Plan mode belongs to the user

- **WHEN** the user has plan mode enabled
- **THEN** the contract directs the agent not to edit while it is active and names no way to enter or leave it

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1,500 estimated-token budget

### Requirement: Second-mistake rule

The `verify-change` skill SHALL state that a correction needed twice is a durable gap and MUST direct the agent to propose the durable fix — an edit to the workspace instruction file or a hook — naming which one, instead of promising more care.

#### Scenario: Repeated correction

- **WHEN** the agent notices that the same correction was applied twice in a session
- **THEN** the skill directs it to propose the instruction-file edit or the hook and name the choice

#### Scenario: A single correction

- **WHEN** a correction happened once
- **THEN** the skill does not require a durable change

### Requirement: Workspace instruction budget

The repository's workspace instruction file SHALL NOT exceed a documented budget of 16,000 bytes, roughly 4,000 estimated tokens at the repository's bytes-per-four convention, and `validate:repo` MUST fail above that budget, reporting the owning file and the measured size. The `instruction-budget` skill SHALL report a workspace instruction file against the same budget and MUST propose moving detail out instead of deleting it.

#### Scenario: Within budget

- **WHEN** `validate:repo` runs with the workspace instruction file at or below the budget
- **THEN** the check passes and the documentation states the budget and the measured size

#### Scenario: Over budget

- **WHEN** the workspace instruction file grows past the budget
- **THEN** `validate:repo` fails and names the file and the measured size

#### Scenario: Audit reports duplication

- **WHEN** the `instruction-budget` skill is invoked for a workspace instruction file
- **THEN** it reports the measured size against the budget and lists the lines that duplicate the repository, its documentation, or its architecture

#### Scenario: Audit moves instead of deleting

- **WHEN** the audit proposes removing a line that carries a fact found nowhere else
- **THEN** it proposes the destination that will hold the fact and moves it there

#### Scenario: Catalog entry only

- **WHEN** the session starts without invoking `instruction-budget`
- **THEN** the catalog advertises its description and its body is absent from the assembled prompt

### Requirement: Interface design skill

The guidance bundle SHALL ship an on-demand `interface-design` skill in the skill catalog, with a
description that names the trigger and the covered surfaces, and the full body MUST stay out of the
assembled prompt until the skill is invoked.

#### Scenario: Catalog entry only

- **WHEN** a session starts and the skill is not invoked
- **THEN** the catalog advertises its name and description and the body is absent from the prompt

#### Scenario: Explicit invocation

- **WHEN** the model or the user invokes `interface-design`
- **THEN** the body is rendered as skill content for that session

#### Scenario: Description matches the asset

- **WHEN** the provider lists the skill
- **THEN** its catalog description is identical to the asset's frontmatter description

#### Scenario: Offline load

- **WHEN** the machine has no network access after installation
- **THEN** the skill lists and loads from the installed package

### Requirement: Interface design content contract

The skill body SHALL state the first-time test (what this is, the one next action, what will happen,
what happened, how to recover) and SHALL apply one cost model — recall, decision, prediction,
interpretation, recovery — to client UI, CLI or installer, API or signature, code, and skill or tool
definitions. It SHALL give each surface concrete rules, red flags, and the repository patterns to
reuse.

#### Scenario: First-time test present

- **WHEN** the body is read
- **THEN** it asks what the interface is, the one next action, what will happen, what happened, and how to recover

#### Scenario: Cross-surface coverage

- **WHEN** the body is read
- **THEN** it contains a rule or check for every covered surface and does not stop at visual design

#### Scenario: Repository anchors

- **WHEN** the skill is used inside this repository
- **THEN** it points to the client primitives and tokens, the installer contract, and the skill packaging rules instead of inventing a new design system

### Requirement: Interface design review output

The skill SHALL end with a review output that rates severity and Thinking Cost and gives a one-line
problem, impact, fix, and location for each finding.

#### Scenario: Actionable review

- **WHEN** the skill is used to review an interface
- **THEN** the result rates severity and Thinking Cost and names a concrete fix and location for each finding

### Requirement: Interface design skill boundaries

The change MUST NOT add or alter an always-on contribution, so the bundle keeps exactly one
always-on section within its documented budget. Detailed references SHALL load only when read. The
skill SHALL record its sources and what was removed or rewritten, and MUST NOT present adapted text
as verbatim upstream content or carry a provenance pin.

#### Scenario: One always-on section

- **WHEN** the bundle is assembled
- **THEN** it registers one always-on section and the interface design skill contributes none

#### Scenario: Budget unchanged

- **WHEN** the always-on contract is measured
- **THEN** it stays within the documented estimated-token and byte limits

#### Scenario: References on demand

- **WHEN** the skill body is loaded
- **THEN** its reference files are not loaded until the model reads them

#### Scenario: Recorded adaptation

- **WHEN** a reader follows the skill to its source record
- **THEN** it names the sources and the removed or rewritten parts, and the skill is not described as pinned upstream content

### Requirement: Goal as the work unit

The always-on working contract SHALL state that a multi-step task runs under an active goal: the agent creates a goal before the first step and treats each pause as a goal round. A single-turn, one-line, or purely informational request MUST NOT create a goal. The clause MUST stay in the existing working-principles section and within its documented 1500 estimated-token budget.

#### Scenario: Multi-step task

- **WHEN** a request needs more than one working turn
- **THEN** the contract directs the agent to create a goal before the first step

#### Scenario: Single-turn request

- **WHEN** the request is a one-line fix or an informational answer
- **THEN** the contract does not require a goal

#### Scenario: Pause is a goal round

- **WHEN** a goal round ends
- **THEN** the contract treats the pause as a goal round rather than a silent stop

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget

### Requirement: Work checkpoint guidance

The always-on working contract SHALL state that a substantial pause ends with a `work_checkpoint` call covering whether the work is done, what is verified, what remains, and whether the remainder has independent parallel lanes. It SHALL state that a parallel declaration starts a worker for at least one lane before the turn closes, and that serial work names its reason. The clause MUST stay in the existing section and within the 1500 estimated-token budget.

#### Scenario: Pause checkpoint

- **WHEN** the assembled contract is read before a substantial pause
- **THEN** it directs a checkpoint call with the done, verified, remaining, and parallel decisions

#### Scenario: Parallel lane

- **WHEN** the remaining work has independent lanes
- **THEN** the contract directs a worker start before closing and keeps integration in the main agent

#### Scenario: Serial reason

- **WHEN** the remaining work is serial
- **THEN** the contract directs the checkpoint serial reason

#### Scenario: No second section

- **WHEN** the contract is assembled
- **THEN** the guidance is part of the existing working-principles section, not a second always-on section

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget
