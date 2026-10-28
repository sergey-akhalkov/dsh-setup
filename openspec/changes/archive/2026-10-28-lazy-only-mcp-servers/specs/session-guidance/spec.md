# Spec Delta

## MODIFIED Requirements

### Requirement: Bounded prompt cost

Each always-on contribution SHALL NOT exceed the estimated-token budget documented for it: the working-principles contract is bounded at 1500 estimated tokens, the RTK rule at 300, and the Serena rule at 200. One estimated token is one quarter of the packaged text's UTF-8 byte count. Repository validation MUST fail when a contribution exceeds its budget, reporting the owning plugin and the measured size, so a later edit cannot silently raise the cost of every session.

#### Scenario: Within budget

- **WHEN** repository validation reads each packaged always-on contribution
- **THEN** it passes, and the plugin documentation states the measured size of each contribution

#### Scenario: Over budget

- **WHEN** an edit grows an always-on contribution past its documented budget
- **THEN** validation fails and reports the owning plugin and the measured size

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
