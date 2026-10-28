# Serena code guidance

`@dsh-setup/plugin-serena` ships one row: the guidance row. It contributes a short always-on trigger
and the on-demand `serena-discipline` skill. The server itself is the setup's lazy `serena` entry, so a
session reaches Serena through `mcp_tools`/`mcp_call` and never through static `mcp__serena__*` tools.
A standalone install of this package provides the guidance only: configure the server with
[`@dsh-setup/plugin-mcp-lazy`](lazy-mcp.md), or add a static adapter row yourself (the lazy one-home
rule applies to whichever home you choose).

## What the plugin ships

- **A short always-on trigger.** It is a system-prompt section, so a session receives it without
  loading a skill. It limits Serena to large-file or cross-file refactor work, points at the lazy
  `serena` server, and sends everything else to the ordinary file tools.
- **One on-demand skill.** `serena-discipline` carries the lazy invocation, project activation, the
  symbol operations, the bounded-call rule, the generated-output boundary and the fallback. It is
  listed in the catalog and costs nothing until invoked.
- **No other contribution.** The package ships no Serena binary, no installer, no Client half, no
  tool hook and no adapter row. The setup's lazy entry runs the pinned `serena-agent` release through
  `uvx`; the guidance row only registers prompt content.

## Why the trigger is always-on and the procedure is a skill

The recorded history is the reason for the split: 24 Serena tool schemas added 25,815 bytes (~6,454
tokens) to every request, while Serena was used in 7 of 58 sessions and 94 of ~9,500 tool calls, and
no session used the symbol-editing path. A broad 400-token rule that names the static tool surface
did not fix the discoverability problem, and it describes tools the setup no longer mounts.

The trigger is paid on every step but stays narrow; the skill carries the procedure at no per-step
cost. A model that follows the trigger loads the skill once, activates the project, and then pays the
one or two extra proxy calls only for work where exact callers save more than they cost.

## What the agent is told

1. **Reach the lazy server.** `mcp_tools` with `server: serena` (optionally a `query`) lists the
   tools; `mcp_call` with `server: serena`, `tool` and `args` invokes one.
2. **Scope.** Serena is for large files and cross-file refactors where exact callers matter. Small
   files, literal text, regex, configuration, documents and generated files stay on `grep`, `glob`,
   `read` and `edit`; `search_for_pattern` is a fallback, not the search path.
3. **Activate first.** `get_current_config`, then `activate_project` with the session's working
   directory when no project is active. A restart forgets the activation; a call made before it fails.
4. **Read in steps.** `get_symbols_overview` for a file, `find_symbol` (`include_body: true`) for one
   symbol, and `find_referencing_symbols` / `find_implementations` / `find_declaration` for
   relationships.
5. **Edit symbols, not lines.** `replace_symbol_body`, `insert_before_symbol` /
   `insert_after_symbol`, `rename_symbol`, `safe_delete_symbol`. A successful call proves the edit,
   not the callers: the repository's own checks still run.
6. **Bound every call.** Narrowest `relative_path`, `max_matches`, `max_answer_chars`.
7. **Leave generated outputs alone.** Files a build or generator rewrites are outputs; edit their
   sources and rerun the generator.

The full procedure lives in the `serena-discipline` skill, including the unavailable-server fallback.

## When not to use Serena

- Small files, literal text, regex, configuration, documents, and anything the `grep`, `glob` and
  `read` tools already answer faster.
- Generated or vendored files (`lib/**`, generated patches, vendored copies): change the source and
  regenerate.
- Projects whose language has no language server, or when the lazy server is unreachable: say so once
  and continue with the ordinary tools.

## Activate the project

`get_current_config` reports the active project, tools and modes. When it reports none, activate the
session's working directory through `mcp_call`. One Serena instance serves the whole profile, so the
active project is shared by sessions using that server; switching it in one session changes it for
the others, and a restarted server starts with no project. The lazy entry's pinned release is the
authority for the exact tool names and modes.

## Prompt cost

The always-on trigger is a hard budget, not a preference. The package test measures
`assets/serena-discipline/rules.md` as `UTF-8 bytes / 4` and fails above `200` estimated tokens.

| Contribution                         | Size        | Cost per model step |
| ------------------------------------ | ----------- | ------------------- |
| Packaged lazy-dev ruleset (Ponytail) | 2,721 bytes | ~0.7k tokens        |
| Working contract                     | 5,257 bytes | ~1.3k tokens        |
| RTK routing rule                     | 884 bytes   | ~0.2k tokens        |
| Serena code-surface trigger          | 733 bytes   | ~0.2k tokens        |
| **All four, active**                 |             | **~2.4k tokens**    |

The `serena-discipline` skill body is 2,914 bytes and loads only when invoked, so it is not in the
per-step table. The measured values come from the package budget test and the asset files; update
this table when the assets change.

## Turn off the always-on trigger

The guidance row ships enabled. Keep the skill but drop the system-prompt section by overriding the
row in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-setup-serena-guidance
  config:
    alwaysOn: false
```

A patch replaces the whole `config` object for the row, so restate every option the row needs; this
row only has `alwaysOn`. Restart DeepSeek Harness after editing the profile patch.

## Suspend in a session

Say "stop serena guidance" to suspend only this rule for the rest of the session. The lazy server and
the `serena-discipline` skill keep working, and the other always-on sections are unaffected. The
section deliberately names no slash command because the Harness does not provide one.

## Disable or remove

Disabling `dsh-setup-serena-guidance` removes the trigger and the skill; the lazy server stays
configured:

```yaml
- id: dsh-setup-serena-guidance
  disabled: true
```

To stop the server itself, override the lazy row without `serena` — a patch replaces the whole
`servers` list, so restate the servers you keep — or set an empty list:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers: []
```

Uninstalling this bundle removes only the guidance.

## Adaptation record

The trigger and skill are first-party guidance adapted for this Harness from the owner's
[codex-harness](https://github.com/sergey-akhalkov/codex-harness) repository,
`global/principles-of-work.md` ("MCP tool selection"), checked 2026-10-26. They are not pinned
upstream text and carry no provenance pin or upstream license.

- **Kept:** activate the intended project once before symbol work; overview, then body, then
  relationships; edit through symbol operations rather than line surgery; bounded calls; the
  repository's own checks after a symbol edit.
- **Rewritten:** `rg`, native files and shell became the built-in ripgrep-backed `grep`, `glob`
  and `read` tools, because this Harness keeps file inspection in its tools and its `grep` is
  ripgrep; the Code Mode per-answer budget became the bounded-call rule without the numeric table,
  because this Harness has no Code Mode carrier. The direct `mcp__serena__*` tools became the lazy
  `mcp_tools`/`mcp_call` proxy.
- **Removed:** Nuphus and Connected Apps selection, LSP-carrier acceptance criteria, and the
  per-turn token table. They describe surfaces this setup does not configure, and restating them
  would be a rule the session cannot apply.
- **Serena search:** the source treats `search_for_pattern` as out of the managed surface. This
  setup documents it as a narrow fallback in the skill instead of banning it, because a language
  server can be the only way to locate code whose symbol name is unknown, and the failure is visible
  in the call result.

## Limits and security

- Serena runs in its own process and edits the activated project directly; the MCP tool call is the
  approval gate, and the active project is shared across sessions using that server.
- A static adapter row for `serena` in the same profile conflicts with the lazy entry: the lazy call
  fails with the one-home error and starts no second process. Use one home, not both.
- Empty symbol results are not absence: the language server must support the language, and a cold
  server's first call can be slow. The lazy call adds the server's first-call startup cost.
- The trigger was checked on 2026-10-26 against the pinned `serena-agent` release. Run
  `mcp_tools` for the installed tool surface instead of trusting a version claim here.
