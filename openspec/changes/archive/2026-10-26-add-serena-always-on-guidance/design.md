# Design

## Context

The guidance row of `@dsh-setup/plugin-serena` registers one on-demand skill. Measured over the
owner's 33 recorded sessions (3,086 tool calls), Serena was available in 20 sessions (2,219 tool
calls) and was called 15 times in 2 sessions: 13 calls in the session that installed the adapter and
2 in a subagent (`get_current_config`, `initial_instructions`). No session called an edit or
relationship tool, and `serena-discipline` was loaded zero times. The current session probe of
`get_current_config` returned `No active project`.

Two causes are visible in that record: a skill with no trigger is never loaded, and the first symbol
call fails while no project is active. Strengthening the skill alone repeats the first failure.

## Goal

Make the code-surface routing part of every step of a session that has Serena, without turning the
whole skill into always-on text, and keep the adapter row independent.

## D1 — Placement: the guidance row of the same bundle

The rule belongs to `@dsh-setup/plugin-serena`, not to the working contract: MCP adapters are
optional, and a contract that talks about absent tools is noise. The rule is a system-prompt section
at order `130`, after the working contract (`110`) and the RTK rule (`120`). The guidance row gains
an `alwaysOn` switch so a profile can keep the skill and drop the per-step rule; disabling the row
removes both, while the adapter row keeps mounting the server.

Alternatives rejected:

- **Skill only, rewritten stronger.** The measured failure is that the skill is not loaded; a better
  body changes nothing without a trigger.
- **Append to the working contract.** The contract is bounded at 1,500 estimated tokens and is
  MCP-agnostic; a Serena section there also survives uninstalling Serena.
- **Auto-activate the project in the adapter configuration.** The server is one process for the whole
  profile and its active project is shared by concurrent sessions, so a shipped per-workspace
  `--project` argument would either pin one checkout or fight other sessions. Activation stays an
  explicit first step, which the rule makes visible.

## D2 — The rule text (1,597 bytes, 399 estimated tokens; budget 400)

The rule is a routing rule, not the procedure: activation, symbol reads, symbol edits and the checks
after them, bounded calls, the text-search boundary, the unavailable-server fallback, and the
suspension phrase. The full procedure, the language-support caveat and the generated-output boundary
stay in the `serena-discipline` skill, which is paid only when invoked. A budget test pins both the
400-token ceiling and a reviewed size range, so an edit cannot silently raise the cost of every step.

## D3 — Search boundary and the source adaptation

The rule and skill adapt `codex-harness`'s `global/principles-of-work.md` ("MCP tool selection"),
checked 2026-10-26. The source says to use `rg`, native files and shell for literal text, regex,
configuration and documents, and that `search_for_pattern` is not part of the managed surface.

- **Kept:** activate the intended project once; understand a file through `get_symbols_overview`;
  fetch bodies through `find_symbol`; establish relationships through `find_referencing_symbols`,
  `find_implementations` and `find_declaration`; edit through symbol operations; run the
  repository's checks after a symbol edit; bounded output.
- **Rewritten:** `rg` and native files became this Harness's `grep`, `glob` and `read` tools,
  because the Harness keeps file inspection in its tools and its `grep` is ripgrep-backed; shell
  `rg` remains the RTK-routed form for bulky output. The Code Mode per-answer budget became the
  bounded-call rule without numeric limits, because this Harness has no Code Mode carrier.
- **Removed:** Nuphus and Connected Apps selection, LSP-carrier acceptance, and the per-turn token
  table. They describe surfaces this setup does not configure.
- **Changed:** `search_for_pattern` stays documented as a narrow fallback instead of being banned,
  because it is the only route to code whose symbol name is unknown and its failure is visible.

This record satisfies the recorded-adaptation requirement; no verbatim or provenance claim is made.

## D4 — Activation and persistence

`activate_project` sets the server's active project. The server keeps it while the process lives, so
the choice is shared by sessions using that server and a restart starts with none. The rule therefore
starts with `get_current_config` rather than assuming an activated project, and does not claim that
activation survives a restart. The current probe confirms the no-project state is the normal start.

## Risks

- The rule describes a release-pinned server surface; a future `serena-agent` bump can rename tools.
  The adapter pin and the skill carry the tool names, and the docs defer to `get_current_config`.
- A profile that activates one project per session in different repositories contends over the shared
  server. The rule does not pretend otherwise; the docs state the limitation.
- The always-on text is new per-step cost. The budget test and the documented table bound it.
