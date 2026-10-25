# Design

## Context

See `proposal.md` — Why. Constraints from the running DSH `0.2.1-rc.3` installation and this
repository:

- DSH ships `@deepseek-ai/dsh-mcp-client` (the MCP bridge that registers `mcp__<serverName>__<tool>`
  tools) and `@deepseek-ai/dsh-mcp-resources`. The base bundle mounts only the resources row; the
  client is available for a profile or bundle patch to mount by name.
- A configuration-only bundle is an existing DSH pattern: the package declares `dsh.bundle.patch`
  and no Host/Client entry, and its patch inserts a row that names `@deepseek-ai/dsh-mcp-client`
  with `serverName`, `transport`, `command`, and `args`. The row resolves from the Harness
  installation, like the profile's own DSH package rows.
- dsh-setup generates each plugin's `cordis.patch.yml` and the aggregated setup patch from
  `cordis.fragment.yml`. A fragment row currently accepts only `id` and `config`; the module name is
  forced to the owning package, and a test pins that behavior.
- `packages/setup` vendors every `packages/plugin-*` package that declares a bundle. Adding a plugin
  package therefore adds it to the setup bundle and to the market on the next release, with no
  `dsh.json` or installer change.
- Serena 1.7.0 is a Python MCP server launched through `uv`/`uvx`. It needs a project activated at
  runtime, auto-generates `~/.serena/serena_config.yml` when missing, and its built-in contexts
  select the tool subset and the prompt sent to the agent.

## Goals / Non-Goals

**Goals:**

- Add Serena by installing one bundle, with no Host or Client code, no new package dependency, and
  no install-time script.
- Keep the setup patch generated from the fragment, so drift remains detectable like for every
  other plugin.
- Never block Harness startup when `uv` or Serena is unavailable, and keep machine-local project
  paths out of the repository.
- Keep the change reviewable: one new package, one narrow generator exception, tests, and docs.

**Non-Goals:**

- Per-session MCP instances, per-session project switching, or a Host prompt plugin.
- Installing or vendoring `uv`, Serena, or language servers.
- A custom Serena context YAML or a DSH-specific Serena wrapper.
- Changes to the installer, `dsh.json`, the supported DSH range, or the market format.

## Decisions

### D1. Model the integration as a configuration-only bundle

The package contains only `package.json`, `cordis.fragment.yml`, the generated `cordis.patch.yml`,
`locale/en.json`, and `icon.svg`. The loader never imports the package; it reads the patch and
mounts the MCP client row.

Alternative considered: a Host plugin whose `apply` imports and mounts
`@deepseek-ai/dsh-mcp-client`. Rejected — a bare import from the profile's `node_modules` does not
resolve DSH's own packages, which live in the Harness installation. Making it resolve would require
declaring the client as a dependency (a second runtime copy and its peer graph), a composite
TypeScript project, committed `lib/` output, and a test, for no behavioral gain.

Alternative considered: a hand-maintained patch with no generator involvement. Rejected — it would
need a second source format and a generator exception for static bundles, and it loses the drift
check.

### D2. Allow one approved foreign row in a configuration-only fragment

`parseCompositionFragment` gains an optional row `name`. A fragment may set it only to
`@deepseek-ai/dsh-mcp-client`; generation rejects any other foreign name. Generation also rejects a
foreign row when the package declares `main`, `types`, or `dsh.client`, so only a configuration-only
package can mount another package's code. Normal fragments keep deriving the name from the owning
package, and the existing row-id rules are unchanged.

Alternative considered: an open `name` field for any DSH package. Rejected — it would let a fragment
mount arbitrary Harness services (for example a second tool registry) and would weaken the
repository's "a fragment mounts its own code" invariant more than this adapter needs.

### D3. Launch Serena through `uvx` with a pinned release

The row configuration is:

```yaml
serverName: serena
transport: stdio
command: uvx
args:
  - --from
  - serena-agent==1.7.0
  - serena
  - start-mcp-server
  - --context=vscode
  - --enable-web-dashboard=false
toolCallTimeoutMs: 120000
failOnStartupError: false
```

- `uvx` rather than `serena`: the `uv tool` shim directory is commonly absent from the Harness
  process PATH, while `uvx` is the documented launcher and creates the environment on demand. The
  same `uvx` command works on a machine where Serena was never installed.
- `serena-agent==1.7.0` pins the tested release. The context and prompt are part of that release and
  are therefore stable until an intentional bump.
- `--context=vscode` selects the same tool exclusions as `ide` (no Serena `read_file`,
  `create_text_file`, `execute_shell_command`, `find_file`, or `list_dir`) and its generic prompt
  adds the missing instruction: activate the working directory with `activate_project` and read the
  initial instructions. This is the cheapest way to make the first use work without a Host prompt
  plugin. If a future release changes that context, the fallback is `--context=ide` plus a
  documented first-use phrase.
- No `--project` and no `--project-from-cwd`. The MCP server lives at profile scope and does not
  know the session's working directory; `--project-from-cwd` would bind the Harness process
  directory. The agent activates the session workspace at runtime instead.
- `--enable-web-dashboard=false` avoids a local dashboard server and a browser window.
- `toolCallTimeoutMs: 120000` covers the first symbolic call, when the language server is starting.
- `failOnStartupError: false` keeps a missing `uv` or a first-run download timeout from rejecting
  the row; the Harness logs the failed connection and starts without Serena tools. Reconnect
  defaults stay unchanged.

### D4. Ship it in the setup by default, with a profile-level opt-out

Because the setup vendors every plugin package, `@dsh-setup/plugin-serena` is included in the setup
bundle, the setup manifest, the vendored tree, and the market automatically. A user who does not
want it can disable the row from the profile's own patch:

```yaml
- id: dsh-setup-serena
  disabled: true
```

This keeps the minimal path minimal. Alternative considered: an exclusion flag in the generator and
an exception in setup manifest validation and the market mapping. Rejected for this change — it
adds a repository-wide concept to avoid one row that can be disabled locally.

### D5. Treat the adapter target as Harness-provided, not as a setup dependency

The setup patch mounts `@deepseek-ai/dsh-mcp-client`, but the setup manifest must not declare it:
pnpm would install a second copy and its peer graph into the profile. The accepted
`Dependency-contained plugins` requirement is amended so dependency containment applies to
repository plugin packages, with an explicit scenario for a Harness-provided adapter target. The
generated setup patch and vendored copy still contain the adapter bundle itself, so one git install
delivers the configuration; the client code comes from the Harness installation.

### D6. Verify at three levels

- Unit tests cover the fragment row name and the configuration-only rejection.
- `pnpm gen` and `gen:check` prove the generated patch, setup patch, manifest, and vendored copy are
  reproducible.
- `validate:composition` gains `dsh-setup-serena` and `@deepseek-ai/dsh-mcp-client` markers, so a
  composed throwaway profile proves the row survives composition on the supported DSH CLI.
- Manual smoke: install the checkout into a throwaway profile, start the Harness, call
  `mcp__serena__get_current_config` (no project needed) and `mcp__serena__activate_project` with the
  test workspace, then call `mcp__serena__get_symbols_overview`.
- Market dry run: `node scripts/generate-market.ts --output .tmp/market-serena` lists the new bundle
  with its title, description, icon, version, `engines.dsh`, and git path.

### D7. Document the prerequisites, not hide them

`docs/install.md` gets the `uv` prerequisite and the first-run note; `docs/plugins.md` gets the
configuration-only adapter section, the fragment-name exception, the activation workflow, and the
one-instance-per-profile limit; `AGENTS.md` updates the fragment rule. The market description states
that the bundle requires `uv`.

## Risks / Trade-offs

- **`uv` missing** → the row logs a failed connection and the Harness boots without Serena tools.
  Document the prerequisite and the `uvx` command; keep `failOnStartupError: false`.
- **First `uvx` run exceeds the connection timeout** → restart the Harness once after the download,
  or pre-warm with `uvx --from serena-agent==1.7.0 serena --version`. Documented.
- **`--context=vscode` drifts in a future Serena** → the version is pinned; re-verify the context and
  the activation prompt on every bump; fall back to `--context=ide` plus the first-use phrase.
- **One Serena instance per profile** → all sessions share the active project; activating a project
  in one session changes it for the others. Documented; per-session MCP is a separate design.
- **Serena edits files outside DSH's filesystem guard and sandbox** → the MCP tool call is the
  approval gate; the `vscode` context disables Serena's shell and basic file tools; the market
  description and docs disclose the behavior. Symbolic edits remain available by design.
- **Context cost** → Serena adds its tools and instructions to every request. The row can be
  disabled locally; a smaller context can be chosen on a Serena bump.
- **Setup default-on** → every setup user receives the row. The profile-level disable above is the
  escape hatch; an exclusion mechanism remains a future option.

## Migration Plan

1. Add the package and the generator exception; run `pnpm gen`, `pnpm build`, and the full local
   gate.
2. Release a new set version; the market lists the new bundle and the setup bundle includes it.
3. Existing setup installations receive it on their next install/update; no profile manifest edit is
   required.
4. Rollback: remove the package, regenerate, and release. Users can disable the row in the profile
   patch immediately, without waiting for a release.
