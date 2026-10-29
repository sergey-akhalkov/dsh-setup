# verification-gate Specification

## Purpose

Binds a code-changing turn to a configured check that actually ran and passed, so a turn cannot close on an unverified edit while the session still states which command to run next.

## Requirements

### Requirement: Verification gate boundary

The bundle SHALL observe tool results and the turn-stopping event and SHALL decide only from those observations and its configured commands. It MUST NOT execute, rewrite, intercept, delay, or cancel a tool call, MUST NOT call a model, and MUST NOT write a review record or a task progress note.

#### Scenario: Observation only

- **WHEN** the bundle is active and a turn runs
- **THEN** it registers no tool, no system-prompt section, and no skill, and only observes results and the turn-stopping event

#### Scenario: The gate never runs the check

- **WHEN** the gate refuses a close because no check ran
- **THEN** it does not start the check itself and the agent runs the configured command

#### Scenario: Subagent origin excluded

- **WHEN** a subagent-origin turn stops
- **THEN** the gate does not steer that turn

### Requirement: Code-changing turn detection

The gate SHALL treat a turn as code-changing after a successful `edit` or `write` result whose target lies outside `.dsh/`, `.tmp/`, `node_modules/`, and `openspec/` and whose extension is not `.md`. A failed write MUST NOT mark the turn, and a shell-mediated write MUST NOT be inferred.

#### Scenario: Source edit marks the turn

- **WHEN** a successful `edit` result targets a source file
- **THEN** the turn is code-changing and needs a satisfied check

#### Scenario: Failed write does not mark

- **WHEN** an `edit` or `write` result reports an error
- **THEN** the turn is not marked code-changing by that call

#### Scenario: Markdown only

- **WHEN** the only successful write in the turn targets a `.md` file
- **THEN** the turn is not code-changing

#### Scenario: Planning scratch

- **WHEN** the only successful write in the turn targets a file under `openspec/`, `.dsh/`, or `.tmp/`
- **THEN** the turn is not code-changing

#### Scenario: Shell write is invisible

- **WHEN** a shell command rewrites source files and no successful `edit` or `write` result occurred
- **THEN** the gate does not treat the turn as code-changing, and the documentation states this limit

### Requirement: Command recognition

A configured command SHALL match a shell tool call only when the call's trimmed `command` argument equals that command exactly, or equals it after one leading `rtk ` token is removed together with the whitespace after it. Internal whitespace MUST be preserved, and a compound command, a command with extra arguments, or a command whose quoted arguments differ MUST NOT match.

#### Scenario: Direct match

- **WHEN** the configured command is `pnpm check` and the agent runs `pnpm check`
- **THEN** the call matches

#### Scenario: Wrapped command

- **WHEN** the configured command is `pnpm check` and the agent runs `rtk pnpm check`
- **THEN** the call matches

#### Scenario: Masked failure does not match

- **WHEN** the configured command is `pnpm check` and the agent runs `pnpm check || true` or `pnpm check ; exit 0`
- **THEN** neither call matches, so a failed check cannot be masked into a pass

#### Scenario: Extra arguments do not match

- **WHEN** the configured command is `pnpm check` and the agent runs `pnpm check --watch` or `pnpm check:watch`
- **THEN** the call does not match

#### Scenario: Quoted contents are preserved

- **WHEN** the configured command contains a quoted argument with one space and the agent runs the same command with two spaces at that position
- **THEN** the call does not match, because the two commands can have different behaviour

#### Scenario: Case differs

- **WHEN** the configured command is `pnpm check` and the agent runs `PNPM check`
- **THEN** the call does not match

### Requirement: Successful check requirement

A code-changing turn SHALL NOT close until a matched command's result is a recognized foreground shell result with a zero exit code, no signal, no timeout, no abort, no sandbox denial, and no error, received after the most recent code write. Any other outcome — a non-zero exit, an interruption, a background handle, a missing field, or an unrecognized shape — MUST NOT satisfy the gate, and a text claim MUST NOT satisfy it.

#### Scenario: Verified close

- **WHEN** a code-changing turn runs a configured command successfully after its last write
- **THEN** the close is allowed

#### Scenario: Stale check

- **WHEN** the configured command succeeded before the last code write
- **THEN** the close is refused

#### Scenario: Failing check

- **WHEN** the matched result reports a non-zero exit code
- **THEN** the close is refused

#### Scenario: Interrupted check

- **WHEN** the matched result reports a signal, a timeout, an abort, or a sandbox denial
- **THEN** the close is refused

#### Scenario: Background handle

- **WHEN** the matched call returned a background job handle instead of a settled result
- **THEN** the close is refused

#### Scenario: Unrecognized shape

- **WHEN** the matched result is missing the exit state or does not have a recognized shape
- **THEN** the close is refused and the refusal says the exit state could not be read

#### Scenario: Text claim

- **WHEN** the agent states that the checks pass without a matching successful result
- **THEN** the close is refused

### Requirement: Refusal message and block cap

On a refusal the gate SHALL steer once per stop attempt with a bounded message that names the configured commands, the most recent written file, and the next action. It MUST allow the close after `maxBlocks` consecutive refusals in the same turn and MUST state in that notice that the turn closes unverified. `maxBlocks` MUST default to 8, the consecutive-refusal counter MUST reset only when the turn identifier changes, and a capped close MUST NOT be reported as a pass.

#### Scenario: First refusal

- **WHEN** an unverified code-changing turn stops
- **THEN** the gate steers with the commands, the last written file, and the next action

#### Scenario: Repeated refusal

- **WHEN** the turn stops again before the block cap with the same unmet condition
- **THEN** the gate steers again

#### Scenario: Intermediate step does not reset

- **WHEN** a steered turn runs another step in the same turn and stops again
- **THEN** the refusal counter continues from its previous value

#### Scenario: Cap reached

- **WHEN** the turn reaches `maxBlocks` consecutive refusals
- **THEN** the close is allowed with a notice that the turn closes unverified

#### Scenario: Counter reset

- **WHEN** the turn identifier changes
- **THEN** the consecutive-refusal counter is zero and the cap counts from the new turn

#### Scenario: Capped close is not a pass

- **WHEN** the cap allows a close
- **THEN** the notice does not state that the check passed and no record claims verification

### Requirement: Configuration

The gate SHALL be configured by a `commands` list of non-empty strings and an optional positive-integer `maxBlocks`, read from the row configuration. Absent or empty `commands` MUST leave the gate inert. An invalid configuration MUST fail at apply with the row id, the offending value, and the accepted shape, and the shipped profile defaults MUST NOT configure the gate.

#### Scenario: Inert default

- **WHEN** the row is active with no `commands`
- **THEN** every turn closes as it did before this bundle existed

#### Scenario: Valid configuration

- **WHEN** the row sets `commands: ["pnpm check"]`
- **THEN** only that command satisfies the gate

#### Scenario: Invalid configuration

- **WHEN** the row sets an empty string, a non-string entry, or `maxBlocks: 0`
- **THEN** apply fails naming the row id, the offending value, and the accepted shape

#### Scenario: No shipped default

- **WHEN** the setup's defaults are inspected
- **THEN** they contain no `commands` default for this row

### Requirement: Delivery and opt-out

The setup SHALL deliver the bundle as one row and the bundle MUST be installable on its own without another `@dsh-setup` bundle. Disabling or removing the row MUST remove the gate and stop every steer, and no in-session request MAY bypass an active gate.

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the bundle and mounts its row exactly once

#### Scenario: Setup bundle only

- **WHEN** the bundle is added to the shipped set
- **THEN** it is delivered through the setup bundle, and the installer's shipped-bundle lists are unchanged because those lists select independent profile bundles before the setup is installed

#### Scenario: Standalone install

- **WHEN** only this bundle is installed
- **THEN** it composes, its configuration validates, and no sibling bundle is required

#### Scenario: Row removed

- **WHEN** the row is disabled or the plugin is uninstalled
- **THEN** no turn is gated and no steer is emitted

#### Scenario: No in-session bypass

- **WHEN** a session claims verification is unnecessary or asks to skip the gate
- **THEN** the active gate still refuses an unverified close

### Requirement: Security and trust boundaries

The gate MUST NOT execute, shell-expand, or otherwise act on a configured command string, and MUST treat tool arguments and results as untrusted data. Its steer message MUST be bounded in length, MUST strip control characters, and MUST NOT include file contents.

#### Scenario: Configuration is data

- **WHEN** the row configures a command string containing shell syntax
- **THEN** the gate uses it only for matching and never executes or expands it

#### Scenario: Bounded message

- **WHEN** the gate steers
- **THEN** the message is shorter than the documented bound and contains no file contents or control characters

#### Scenario: Unknown shape ignored

- **WHEN** a tool result has a shape the gate does not recognize
- **THEN** the gate ignores it and does not fail the turn
