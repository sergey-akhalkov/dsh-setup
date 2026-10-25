---
name: serena-discipline
description: >
  Serena code work: symbol-level retrieval and editing before whole-file reads or
  line surgery, with bounded scope and answer sizes, and the project's own checks
  after every symbol edit. Use when Serena's code tools are available and the task
  touches source files.
---

# Serena discipline

Serena is the semantic code surface for this session. It works on symbols in one activated
project: use it for code you can name, and leave everything else to the ordinary tools.

1. **Overview, then body, then relationships.** For a known file, start with
   `get_symbols_overview`, fetch only the body you need with `find_symbol`
   (`include_body: true`), then establish what the symbol touches with
   `find_referencing_symbols`, `find_implementations` and `find_declaration`. Do not read a whole
   file to find one function.
2. **Edit symbols, not lines.** Change code through `replace_symbol_body`,
   `insert_before_symbol` / `insert_after_symbol`, `rename_symbol` and `safe_delete_symbol`. Fall
   back to the smallest file edit only when the change is smaller than a symbol and has no reliable
   anchor.
3. **Scope and bound every call.** Pass the narrowest `relative_path` or symbol path and the tool's
   bounds (`max_matches`, `max_answer_chars`). Expand a limit only after naming the fact you still
   lack.
4. **Keep search on the ordinary tools.** Literal text, regex, configuration and document work
   belong to the ordinary file and grep tools; Serena is the code surface, not a general search
   engine. `search_for_pattern` exists, but it is the fallback for code whose symbol name you cannot
   guess.
5. **A symbol edit proves the edit, not the callers.** `get_diagnostics_for_file` is a hint at best.
   Run the repository's own checks after the edit, including the callers the change reaches.
6. **Verify the ground before trusting results.** Symbol calls need an activated project: when
   Serena reports none, select this checkout with `activate_project` (activation is profile-wide, so
   it affects every session using this server). `get_current_config` shows the active project, tools
   and modes once one is active. Confirm the language server supports the language before reading
   empty symbol results as absence, and expect a cold server's first call to be slow.
