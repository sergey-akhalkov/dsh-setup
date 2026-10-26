# Serena code guidance

`@dsh-setup/plugin-serena` ships two rows: the adapter row mounts the Serena MCP server through the
Harness MCP client, and the guidance row contributes an always-on code-surface rule and the on-demand
`serena-discipline` skill. The rows are independent: disabling the guidance row leaves the Serena
tools working, and disabling the adapter row leaves the guidance in place.

## What the plugin ships

- **An always-on code-surface rule, enabled by default.** It is a system-prompt section, so a session
  receives it without loading a skill. It says when Serena is the right surface, how to activate the
  project, how to read and edit through symbols, how to bound calls, and which work stays on the
  ordinary tools.
- **One on-demand skill.** `serena-discipline` carries the full procedure, the activation and
  language-support caveats, the bounded-call rule, and the generated-output boundary. It is listed in
  the catalog and costs nothing until invoked.
- **No other contribution.** The package ships no Serena binary, no installer, no Client half, and no
  tool hook. The adapter row runs the pinned `serena-agent` release through `uvx`; the guidance row
  only registers prompt content.

## Why the rule is always-on

The earlier shape was one on-demand skill. In the owner's recorded sessions it was never loaded, and a
skill that nobody invokes binds nothing. The one Serena-heavy session was the session that installed
the adapter, not ordinary work. A separate failure made the skill path worse: the first symbol call
fails while no project is active, so a model that tried Serena without the activation step got an
error and fell back to whole-file reads.

The rule closes both gaps: it is paid on every step without a decision, and it starts with
`get_current_config` and `activate_project`. The skill body stays the place for detail, so the
per-step text stays short.

## What the agent is told

1. **Activate first.** `get_current_config`, then `activate_project` with the session's working
   directory when no project is active. A restart forgets the activation; a call made before it fails.
2. **Read in steps.** `get_symbols_overview` for a file, `find_symbol` (`include_body: true`) for
   one symbol, and `find_referencing_symbols` / `find_implementations` / `find_declaration` for
   relationships.
3. **Edit symbols, not lines.** `replace_symbol_body`, `insert_before_symbol` /
   `insert_after_symbol`, `rename_symbol`, `safe_delete_symbol`. A successful call proves the
   edit, not the callers: the repository's own checks still run.
4. **Bound every call.** Narrowest `relative_path`, `max_matches`, `max_answer_chars`.
5. **Text stays off Serena.** Literal strings, regex, configuration and documents go to the
   ripgrep-backed `grep`, `glob` and `read` tools, which are faster than symbol search;
   `search_for_pattern` is a fallback, not the search path. Bulky shell searches keep the
   [RTK](rtk.md) route.
6. **Leave generated outputs alone.** Files a build or generator rewrites are outputs; edit their
   sources and rerun the generator.

## When not to use Serena

- Literal text, regex, configuration, documents, and anything the `grep`, `glob` and `read` tools
  already answer faster.
- Generated or vendored files (`lib/**`, generated patches, vendored copies): change the source and
  regenerate.
- Projects whose language has no language server, or when the Serena tools are missing: say so once
  and continue with the ordinary tools.

## Activate the project

`get_current_config` reports the active project, tools and modes. When it reports none, activate the
session's working directory. One Serena instance serves the whole profile, so the active project is
shared by sessions using that server; switching it in one session changes it for the others, and a
restarted server starts with no project. The adapter's pinned release is the authority for the exact
tool names and modes.

## Prompt cost

The always-on rule is a hard budget, not a preference. The package test measures
`assets/serena-discipline/rules.md` as `UTF-8 bytes / 4` and fails above `400` estimated tokens.

| Contribution                         | Size        | Cost per model step |
| ------------------------------------ | ----------- | ------------------- |
| Packaged lazy-dev ruleset (Ponytail) | 2,721 bytes | ~0.7k tokens        |
| Working contract                     | 4,876 bytes | ~1.2k tokens        |
| RTK routing rule                     | 884 bytes   | ~0.2k tokens        |
| Serena code-surface rule             | 1,597 bytes | ~0.4k tokens        |
| **All four, active**                 |             | **~2.5k tokens**    |

The `serena-discipline` skill body is 2,937 bytes and loads only when invoked, so it is not in the
per-step table. The measured values come from the package budget tests and the asset files; update
this table when the assets change.

## Turn off the always-on rule

Keep the skill but drop the system-prompt section by overriding the row in the profile's
`cordis.patch.yml`:

```yaml
- id: dsh-setup-serena-guidance
  config:
    alwaysOn: false
```

A patch replaces the whole `config` object for the row, so restate every option the row needs; this
row only has `alwaysOn`. Restart DeepSeek Harness after editing the profile patch.

## Suspend in a session

Say "stop serena guidance" to suspend only this rule for the rest of the session. The Serena tools and
the `serena-discipline` skill keep working, and the other always-on sections are unaffected. The
section deliberately names no slash command because the Harness does not provide one.

## Disable or remove

The two rows are independent:

```yaml
- id: dsh-setup-serena
  disabled: true
```

removes the MCP server and its tools. Disabling `dsh-setup-serena-guidance` instead removes the rule
and the skill. Uninstalling the bundle removes both.

## Adaptation record

The rule and skill are first-party guidance adapted for this Harness from the owner's
[codex-harness](https://github.com/sergey-akhalkov/codex-harness) repository,
`global/principles-of-work.md` ("MCP tool selection"), checked 2026-10-26. They are not pinned upstream text and carry no provenance pin or upstream license.

- **Kept:** activate the intended project once before symbol work; overview, then body, then
  relationships; edit through symbol operations rather than line surgery; bounded calls; the
  repository's own checks after a symbol edit.
- **Rewritten:** `rg`, native files and shell became the built-in ripgrep-backed `grep`, `glob`
  and `read` tools, because this Harness keeps file inspection in its tools and its `grep` is
  ripgrep; the Code Mode per-answer budget became the bounded-call rule without the numeric table,
  because this Harness has no Code Mode carrier.
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
- Empty symbol results are not absence: the language server must support the language, and a cold
  server's first call can be slow.
- The rule was checked on 2026-10-26 against the adapter's pinned `serena-agent` release. Run
  `get_current_config` for the installed tool surface instead of trusting a version claim here.
