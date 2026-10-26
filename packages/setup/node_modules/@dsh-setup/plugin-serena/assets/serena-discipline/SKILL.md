---
name: serena-discipline
description: >
  Serena code work: symbol-level retrieval and editing before whole-file reads or
  line surgery, with bounded scope and answer sizes, and the project's own checks
  after every symbol edit. Use when Serena's code tools are available and the task
  touches source files.
---

# Serena discipline

Serena is the semantic code surface for this session: the symbols you can name, their bodies, and
their callers. A symbol call returns less text than a whole-file read and keeps the references exact,
which is what makes a symbol edit safe to run without reading the rest of the file. That is why the
setup keeps the routing rule always on and this body on demand.

1. **Activate, then verify.** Symbol calls need an activated project. Call `get_current_config`;
   when it reports none, call `activate_project` with this session's working directory and continue.
   Activation belongs to one server process, not to the conversation: a restarted server starts
   unactivated, and a call made before activation fails rather than returning empty symbols. Confirm
   the language server covers the language before reading empty results as absence, and expect a
   cold server's first call to be slow.
2. **Overview, then body, then relationships.** For a known file, start with
   `get_symbols_overview`, fetch only the body you need with `find_symbol`
   (`include_body: true`), then establish what the symbol touches with
   `find_referencing_symbols`, `find_implementations` and `find_declaration`. Do not read a whole
   file to find one function.
3. **Edit symbols, not lines.** Change code through `replace_symbol_body`,
   `insert_before_symbol` / `insert_after_symbol`, `rename_symbol` and `safe_delete_symbol`. Fall
   back to the smallest file edit only when the change is smaller than a symbol and has no reliable
   anchor.
4. **Scope and bound every call.** Pass the narrowest `relative_path` or symbol path and the tool's
   bounds (`max_matches`, `max_answer_chars`). Expand a limit only after naming the fact you still
   lack.
5. **Keep text search on the ordinary tools.** Literal text, regex, configuration and document work
   belong to the ripgrep-backed `grep`, `glob` and `read` tools, which are faster than symbol
   search; `search_for_pattern` is the fallback for code whose symbol name you cannot guess, not
   the first search. For a repo-wide search whose output may be bulky, the always-on `rtk` rule
   routes the shell form through `rtk rg`.
6. **A symbol edit proves the edit, not the callers.** `get_diagnostics_for_file` is a hint at best.
   Run the repository's own checks after the edit, including the callers the change reaches.
7. **Leave generated outputs alone.** Files a build or generator rewrites — `lib/**`, generated
   patches, vendored copies — are outputs: edit their sources and rerun the generator instead of
   editing symbols in the artifact.
