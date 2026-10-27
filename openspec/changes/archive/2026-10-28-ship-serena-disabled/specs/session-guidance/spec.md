# Spec Delta

## MODIFIED Requirements

### Requirement: Serena always-on code-surface rule

The setup SHALL ship the Serena guidance bundle with both of its rows disabled by default, so a default installation mounts neither the MCP adapter nor the always-on rule. A profile that enables the guidance row receives an always-on system-prompt section that states when and how to use the Serena MCP code tools. The rule MUST begin with project activation, MUST direct reading and editing through symbol operations with bounded calls, and MUST route literal text, regex, configuration and document work to the ripgrep-backed file tools instead of Serena's text search.

#### Scenario: Fresh installation

- **WHEN** the setup is installed and no profile patch overrides the Serena rows
- **THEN** both Serena rows remain disabled, the assembled system prompt contains no code-surface rule, and the catalog lists no `serena-discipline` skill

#### Scenario: Enabled by the owner

- **WHEN** the profile patch enables the Serena rows
- **THEN** the assembled system prompt contains the code-surface rule and the catalog lists `serena-discipline`

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
