---
name: serena-discipline
description: >
  Serena code work through the setup's lazy serena server: project activation,
  symbol-level retrieval and editing with exact callers, bounded calls, and the
  repository's checks after every symbol edit. Use only for large-file or
  cross-file refactors where exact callers matter.
---

# Serena discipline

The setup configures Serena as the lazy `serena` server and ships no static `mcp__serena__*` tools.
Reach the server only through the two proxy tools; a direct tool name is not available.

1. **List the tools once.** `mcp_tools` with `server: serena` (optionally a `query`) returns the
   server's tool schemas. Invoke one through `mcp_call` with `server: serena`, `tool`, and the
   matching `args`.
2. **Activate before symbol work.** Call `get_current_config`; when it reports no active project,
   call `activate_project` with this session's working directory, then continue. Activation belongs
   to the server process, not the conversation: a restarted server starts unactivated, and a symbol
   call made before activation fails rather than returning empty symbols. Expect a cold language
   server's first call to be slow.
3. **Keep ordinary work on the file tools.** Small files, literal text, regex, configuration,
   documents and generated files stay on `read`, `grep`, `glob` and `edit`. `search_for_pattern` is
   a fallback for code whose symbol name you cannot guess, not the first search.
4. **Overview, then body, then relationships.** For a known file, start with
   `get_symbols_overview`, fetch only the body you need with `find_symbol`
   (`include_body: true`), then establish what the symbol touches with
   `find_referencing_symbols`, `find_implementations` and `find_declaration`. Do not read a whole
   file to find one function.
5. **Edit symbols, not lines.** Change code through `replace_symbol_body`,
   `insert_before_symbol` / `insert_after_symbol`, `rename_symbol` and `safe_delete_symbol`. Fall
   back to the smallest file edit only when the change is smaller than a symbol and has no reliable
   anchor.
6. **Scope and bound every call.** Pass the narrowest `relative_path` or symbol path and the tool's
   bounds (`max_matches`, `max_answer_chars`). Expand a limit only after naming the fact you still
   lack.
7. **A symbol edit proves the edit, not the callers.** `get_diagnostics_for_file` is a hint at best.
   Run the repository's own checks after the edit, including the callers the change reaches.
8. **Leave generated outputs alone.** Files a build or generator rewrites — `lib/**`, generated
   patches, vendored copies — are outputs: edit their sources and rerun the generator instead of
   editing symbols in the artifact.
9. **No server, no pretending.** When the lazy call fails because the server is unavailable or the
   language has no language server, say so once and continue with the ordinary tools.
