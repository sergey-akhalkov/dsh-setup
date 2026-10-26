# Design

## Context

The current fork resolves only `codexPath` and `PATH`, and the delegation target schema has a generic
model/agent-options slot but no explicit reasoning effort or Codex pass-through. The latest stable
`@openai/codex` npm release is `0.164.0` (the same version as the installed CLI); `0.165.0-alpha.1`
is pre-release. The app-server `0.164.0` handshake and a completed authenticated turn are already
verified, and the owner's `~/.codex` is logged in with ChatGPT. See `proposal.md` for motivation and
the delta specs for requirements.

## Goals / Non-Goals

**Goals:**

- The fork installs and resolves the latest stable Codex platform binary without an installed CLI.
- The fork passes Serena MCP configuration to the bundled app-server via `-c` and uses the existing
  `~/.codex` login without rewriting config or credentials.
- Delegation targets accept `model` and `reasoningEffort` and pass them to the Codex provider.
- Setup, status, docs, tests, and market card describe the bundled binary, login, and options.

**Non-Goals:**

- Committing a platform binary or making the setup platform-specific.
- Signing in, copying auth, or writing the user's `~/.codex` config.
- Installing the Serena MCP server runtime; only its Codex configuration is shipped.
- A separate `CODEX_HOME`; the existing `~/.codex` is reused.
- Changing the generic rules engine into a Codex-specific plugin.

## Decisions

### D1: Use the latest stable `@openai/codex` npm dependency, not a committed exe

Add `@openai/codex@0.164.0` to the fork's `dependencies`. pnpm installs the platform-specific
package and binary into the profile; no `.exe` is committed. This matches the official plugin's
distribution model, supports the pnpm platform matrix, and keeps the git/setup tree small. A
committed Windows exe would break macOS/Linux, the market install, and the repository's generated
files. The version is pinned; a Codex update changes the dependency, lockfile, status, docs, and
acceptance together.

### D2: Resolution order is `codexPath` > bundled > `PATH`

Keep `codexPath` as the explicit escape hatch. Resolve the bundled package next, using the package's
platform binary (executed directly on Windows; the package's JS shim only where needed). Fall back to
`PATH` for existing users. The status reports `config`, `bundled`, or `PATH` plus the version. A
missing or invalid source remains a visible startup error with the status next action. A discovered
but invalid executable is terminal: `PATH` is tried only when `codexPath` is omitted and the bundled
binary cannot be discovered.

### D3: Serena via `-c` overrides in the existing `~/.codex`

Spawn the bundled binary with the fixed overrides:
`-c mcp_servers.serena.command=uvx`,
`-c mcp_servers.serena.args=["--from","serena-agent==1.7.0","serena","start-mcp-server","--context=vscode","--project=<run working directory>","--enable-web-dashboard=false"]`,
and any additional fixed Serena settings, including `-c mcp_servers.serena.enabled=true`,
`-c mcp_servers.serena.required=true`, and `-c mcp_servers.serena.cwd=<run working directory>`, so an
inherited `enabled=false` or cwd cannot bypass the required startup or retarget the project. Serena
starts with the explicit `--project` pointing at the exact run working directory (not the nearest
ancestor containing `.git`/`.serena`, which can differ for a nested cwd), and with a per-run
throwaway `SERENA_HOME` (passed as
`-c mcp_servers.serena.env.SERENA_HOME=<run dir>`) whose config the provider precreates with
`trusted_project_path_patterns: []` and `project_serena_folder_location:
"<run dir>/projects/$projectFolderName"` for that same directory, and whose resolved
`<run dir>/projects/$projectFolderName` directory the provider also creates before spawn (Serena
falls back to an existing checkout `.serena` when the configured directory is missing):
project-dependent tools work for a nested cwd too, no activation hook runs, and Serena's startup
project files land in the run directory instead of the checkout, so the user's Serena config and the
checkout stay unchanged. The
child keeps the user's `CODEX_HOME` unset, so the existing `~/.codex` auth applies. The
override list is fixed, contains no credentials, and never rewrites the user's `config.toml`. The
Serena server runtime (`uvx`/`serena-agent`) remains a machine prerequisite; the required flag makes a
missing runtime fail the Codex run visibly, not a setup failure.

### D4: Login once, status gives the command

The user runs the bundled CLI's `login` (or the already-installed CLI's login, which writes the same
`~/.codex/auth.json`). The provider never prompts for or copies credentials. `codex_subagent_status`
prints the resolved binary and the exact login command; a 401 is surfaced as an explicit
authentication failure with that next action.

### D5: Target `model` and `reasoningEffort` are explicit options

Extend the rules target config with `model?: string` and `reasoningEffort?: string` (and keep the
generic `agentOptions`). The engine validates the target/provider before a run, passes the options in
the DSH subagent start request, and reports an unsupported option with the target id/provider. This
lets one target be `astra`/`xhigh` and another use a different model/effort; no per-rule Codex
hard-coding is added.

### D6: Codex maps target options to app-server params

The forked provider reads the request's model/options, maps `model` and `reasoningEffort` to the
`thread/start` model/effort fields (or equivalent fixed `-c` overrides) supported by `0.164.0`, and
keeps the existing default model config. The app-server adapter stays the upstream-based one; any
mapping change is a local patch recorded in the README/NOTICE.

### D7: Setup installs the dependency; no binary in the vendored tree

The setup continues to vendor the fork's publishable files only. The profile's pnpm install resolves
`@openai/codex` and its platform package. The CI install gains the package download; the repository
stays platform-neutral. The setup's generated manifest and lockfile record the dependency.

### D8: Verification

Unit tests cover the resolution order, bundled source, `-c` args, login/status, target option
validation/pass-through, and the no-committed-binary scan. `pnpm check`, `gen:check`, `validate:repo`,
`validate:composition`, and the installer/dogfood must stay green. The live check uses a throwaway
`headless`/`ci` profile with the setup and the owner's `~/.codex` login: a completed Codex turn plus
delegation target `astra`/`xhigh` (or the available model slug) and a non-Codex target.

### D9: Security

The Serena overrides and spawn argv are fixed and contain no secrets. Records/logs keep no
credentials or auth paths beyond the status-documented CLI path. The user's Codex sandbox/config
still governs the child, but local MCP processes and project-activation hooks run outside that
sandbox. Both instances therefore disable the mutating Serena tools and `activate_project` in the
child overrides (overriding inherited approvals/trust), and start Serena with the explicit
`--project` pointing at the exact run working directory, plus a run-scoped `SERENA_HOME` whose
precreated config has empty project trust and a run-scoped `project_serena_folder_location` for that
exact directory, with that resolved project data directory precreated as well: symbol reads work,
while activation hooks cannot run, Serena's startup project files stay out of the checkout, and the
user's Serena config is untouched. The write
instance edits only through the Codex
sandbox in the isolated worktree, so the session checkout is never touched. The source Codex binary is
installed from the pinned npm package; its license/NOTICE is retained.

## Risks / Trade-offs

- **Binary size and CI time** -> the npm dependency downloads the platform package once; the lock
  improves reuse. The repo does not commit it.
- **Bundled version vs DSH protocol** -> pin the verified `0.164.0`; update/re-run the handshake and a
  completed turn on every bump.
- **Serena runtime absent** -> the required `mcp_servers.serena.required=true` fails the Codex run
  visibly; docs name `uvx`/`serena-agent==1.7.0`.
- **User config drift** -> use `-c` only and never write `~/.codex` config or credentials; status
  verifies config bytes unchanged; Codex-managed token refresh is allowed.
- **Model slug/effort vocabulary** -> pass the strings through; document the example and let the
  Codex app-server reject invalid values with its own error.
- **No separate home means the bundled binary uses the user's existing auth** -> this is the intended
  "only login" behavior; a broken login is a 401 with the status next action.

## Migration Plan

Existing profiles keep working: `codexPath` still wins and PATH remains a fallback; the bundled
binary becomes the default when no override is set. `~/.codex/config.toml` is unchanged; Codex may
refresh its own auth tokens. A profile that previously depended on an installed CLI can remove it
after the bundled dependency is installed.
Rollback = revert the fork dependency/resolution patch; PATH/`codexPath` continue to work.

## Open Questions

- Exact display/API model slug for "Astra" and the accepted effort strings on `0.164.0`; the
  configuration accepts the values and the live check will confirm the available slug.
- Whether the Serena `uvx` command needs a project-specific context beyond `--context=vscode`; the
  current `plugin-serena` row is the source of truth.
