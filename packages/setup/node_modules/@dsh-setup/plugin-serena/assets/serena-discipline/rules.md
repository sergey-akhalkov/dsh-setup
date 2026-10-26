# Serena code surface

Serena is the semantic code surface for this session: named symbols, their bodies, their callers. It
returns less than a whole-file read and keeps callers exact, so use its `mcp__serena__*` tools when
the task changes or reasons about source code.

1. Activate before the first symbol call. `get_current_config` first; when it reports no active
   project, `activate_project` with this session's working directory, then continue.
2. Read in steps. `get_symbols_overview` for a file, `find_symbol` (`include_body: true`) for one
   symbol, `find_referencing_symbols` / `find_implementations` / `find_declaration` for relationships.
3. Edit symbols, not lines. `replace_symbol_body`, `insert_before_symbol` / `insert_after_symbol`,
   `rename_symbol`, `safe_delete_symbol`; fall back to a file edit only for a change smaller than a
   symbol. A successful call proves the edit, not the callers: run the repository's checks.
4. Bound every call: narrowest `relative_path`, `max_matches`, `max_answer_chars`.
5. Text stays off Serena. Literal strings, regex, configuration, documents and docs go to the
   ripgrep-backed `grep`, `glob` and `read` tools, faster than symbol search;
   `search_for_pattern` is a fallback, not the search path. Shell and `pwsh` stay for execution.
6. No tools, no pretending. When the tools are missing or the language has no server, say so once and
   use the ordinary tools.

Load the `serena-discipline` skill for the full procedure. Say "stop serena guidance" to suspend this
rule for the rest of the session; the tools and skill keep working.
