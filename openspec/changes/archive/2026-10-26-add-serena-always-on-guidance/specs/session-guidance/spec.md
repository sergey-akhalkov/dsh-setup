# Spec Delta

## Purpose

Defines the first-party guidance the setup delivers to sessions: bounded always-on contributions, the
on-demand skill bodies beside them, and the routing rule for the Serena code surface.

## ADDED Requirements

### Requirement: Serena always-on code-surface rule

The setup SHALL ship the Serena guidance bundle with an always-on system-prompt section, enabled by default, that states when and how to use the Serena MCP code tools. The rule MUST begin with project activation, MUST direct reading and editing through symbol operations with bounded calls, and MUST route literal text, regex, configuration and document work to the ripgrep-backed file tools instead of Serena's text search.

#### Scenario: Fresh installation

- **WHEN** a session starts in a profile where the Serena guidance row is active with default configuration
- **THEN** the assembled system prompt contains the code-surface rule and the catalog still lists `serena-discipline`

#### Scenario: Activation before symbol calls

- **WHEN** Serena reports no active project on the first symbol call
- **THEN** the rule directs `activate_project` on the session's working directory before symbol work continues

#### Scenario: Text search stays with the file tools

- **WHEN** the task is literal text, regex, configuration or a document edit
- **THEN** the rule keeps that work on the `grep`, `glob` and `read` tools and names `search_for_pattern` only as a fallback

#### Scenario: Symbol edit still verifies

- **WHEN** the agent changes code through a Serena symbol operation
- **THEN** the rule still requires the repository's own checks, because the call proves the edit and not the callers

#### Scenario: Unavailable server

- **WHEN** the Serena tools are absent or the language has no language server
- **THEN** the rule directs the agent to state that once and continue with the ordinary tools

#### Scenario: Suspend in conversation

- **WHEN** the user asks to stop the rule for this session
- **THEN** the agent stops applying it for the remainder of the session while the Serena tools and the skill keep working

## MODIFIED Requirements

### Requirement: Bounded prompt cost

Each always-on contribution SHALL NOT exceed the estimated-token budget documented for it: the working-principles contract is bounded at 1500 estimated tokens, the RTK rule at 300, and the Serena rule at 400. One estimated token is one quarter of the packaged text's UTF-8 byte count. Repository validation MUST fail when a contribution exceeds its budget, reporting the owning plugin and the measured size, so a later edit cannot silently raise the cost of every session.

#### Scenario: Within budget

- **WHEN** repository validation reads each packaged always-on contribution
- **THEN** it passes, and the plugin documentation states the measured size of each contribution

#### Scenario: Over budget

- **WHEN** an edit grows an always-on contribution past its documented budget
- **THEN** validation fails and reports the owning plugin and the measured size
