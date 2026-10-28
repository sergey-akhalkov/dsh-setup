# Serena code surface

Use the lazy `serena` server through `mcp_tools`/`mcp_call` only for large-file or cross-file refactor
work where exact callers matter. Load the `serena-discipline` skill before the first call: it carries
project activation, the symbol tools and the call bounds, and a symbol call before `activate_project`
fails instead of returning empty results.

Ordinary source reads, literal text, regex, configuration, documents and generated files stay on
`grep`, `glob`, `read` and `edit`; `search_for_pattern` is a fallback, not the search path. After a
symbol edit, run the repository's own checks.

Say "stop serena guidance" to suspend this rule for the rest of the session; the server and the skill
keep working.
