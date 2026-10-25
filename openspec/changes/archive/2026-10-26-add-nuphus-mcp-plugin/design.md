# Design

## Context

See `proposal.md` — Why. Constraints from the running DSH `0.2.1-rc.3` installation and this
repository:

- DSH ships `@deepseek-ai/dsh-mcp-client` `0.2.1-rc.3`. Its stdio transport spawns through
  `cross-spawn`, so a Windows `.cmd` shim resolves; the child environment is the scrubbed parent
  environment (names matching `KEY`, `PASSWORD`, `SECRET`, or `TOKEN` and `DSH_*` names are
  dropped) plus the row's explicit `env`. Per-call timeout defaults to 60 s,
  `failOnStartupError` to `false`, and reconnect to enabled with a growing delay.
- `nuphus-mcp` is a Rust stdio MCP server — 38 tools in the tested `0.2.2` release, with a larger
  documented set in newer releases — published as the npm meta package `@nuphus/nuphus-mcp`, which
  installs a prebuilt binary and the `nuphus-mcp` command on the PATH. Desktop tools need the
  interactive session of the machine hosting the Harness; browser tools drive a Chrome or Edge
  instance over CDP; strict confirmation is the server's `--confirm-write` flag or
  `NUPHUS_MCP_CONFIRM_WRITE`; BYOK vision reads `NUPHUS_MCP_VISION_*`, and local OCR models download
  on the first `desktop_perceive` call.
- The repository already has the pattern this change needs: `packages/plugin-serena` is a
  configuration-only adapter, and generation accepts one approved foreign row name,
  `@deepseek-ai/dsh-mcp-client`. No generator change is required.
- The upstream DSH wrapper `dsh-nuphus-mcp` (npm, `0.2.1`) is a Host plugin that declares
  `@deepseek-ai/dsh-mcp-client: ^0.0.1-rc.1` — a caret range on a `0.0.x` version, so it resolves to
  the first published client release instead of the Harness's `0.2.1-rc.3` — and its `apply` runs
  `npm install -g @nuphus/nuphus-mcp` when the binary is missing.
- On the owner machine the npm global install is already present (`nuphus-mcp` `0.2.2`), the
  `.cmd` shim sits on the PATH, and the server exits cleanly on stdin EOF.

## Goals / Non-Goals

**Goals:**

- Add desktop automation by installing one bundle, with no Host or Client code, no new package
  dependency, and no install-time or startup install step.
- Keep the generated configuration drift-checked like every other plugin.
- Never block Harness startup when the binary is unavailable, and keep machine-local values
  (vision key, browser paths) out of the repository.
- Keep the change smaller than the Serena change: one package, one docs section, one composition
  marker, no generator edits.

**Non-Goals:**

- Installing, vendoring, pinning, or auto-updating the `nuphus-mcp` binary.
- A Host wrapper or a dependency on the upstream DSH plugin.
- Proxying `NUPHUS_MCP_VISION_API_KEY` through the generated patch.
- Per-session isolation, a tool allowlist, or a Host prompt plugin.
- Changes to the installer, `dsh.json`, the supported DSH range, or the market format.

## Decisions

### D1. Model the integration as a configuration-only bundle

The package contains `package.json`, `cordis.fragment.yml`, the generated `cordis.patch.yml`,
`locale/en.json`, and `icon.svg`. The loader mounts `@deepseek-ai/dsh-mcp-client` from the Harness
installation; the bundle package itself is never imported. This is the shape the
`mcp-adapters` capability already accepts, and the `Configuration-only adapter bundles` and
`Approved adapter targets` requirements need no amendment.

Alternative considered: depend on the upstream `dsh-nuphus-mcp` bundle. Rejected — it adds a second,
older MCP client copy to the profile, mutates the machine during startup, is third-party code inside
a "portable setup" that vendors only its own packages, and would need an exception in generation
and setup-manifest validation. Alternative considered: a Host plugin that imports and mounts the MCP
client, as the acceptance note in the Serena design rejected — profile-level module resolution,
a second runtime copy, committed `lib/` output, and a test, for no behavioral gain.

### D2. Launch the user-installed `nuphus-mcp` from the PATH

The row names the executable and no version:

```yaml
serverName: nuphus-mcp
transport: stdio
command: nuphus-mcp
args:
  - --confirm-write
toolCallTimeoutMs: 120000
failOnStartupError: false
```

- `nuphus-mcp` is the command the npm global install puts on the PATH, and that install is the
  documented prerequisite — the same policy the Serena adapter applies to `uv`. The npm global
  prefix (`%APPDATA%\npm` on Windows) is on the user PATH, and `cross-spawn` resolves the shim.
- No version pin: a command from the PATH cannot be pinned. The docs state the tested version
  (`0.2.2`) and that a server upgrade changes the tool list, which is a token cost change rather
  than a break.
- Alternative considered: `npx -y @nuphus/nuphus-mcp@<version>`. Rejected — it needs Node at
  runtime, hits the network or cache on every Harness start, and stdio negotiation spawns a probe
  process before the serving process, so the launcher cost is paid twice per start. It also hides
  the installed version inside a package-manager cache.
- Alternative considered: pinning through an absolute path. Rejected — machine-local path in a
  tracked file, which the `No secrets or machine data` requirement forbids.

### D3. Pin the row behavior: strict confirmation, long timeout, boot-safe start

- `--confirm-write` is passed to the server, not to the bridge. Write tools then require the tool
  call's explicit confirmation argument; a missing argument fails the call instead of injecting
  input. This is the shipped default required by the new `Strict confirmation` requirement, and it
  matches the upstream recommendation.
- `toolCallTimeoutMs: 120000` raises the bridge default of 60 s, which is too low for screenshots and
  first-call OCR model downloads. A first `desktop_perceive` call can still exceed it; the docs say
  to retry after the download.
- `failOnStartupError: false` keeps a missing or slow binary from rejecting the row; the Harness
  logs the failed connection and starts without the tools. Reconnect policy stays at the bridge
  defaults: installing the binary later requires a Harness restart or profile recomposition anyway,
  and changing the retry policy is untested scope.
- `serverName: nuphus-mcp` yields `mcp__nuphus-mcp__<tool>`, matching the upstream documentation, so
  prompts and docs from the project stay valid. The row id is `dsh-setup-nuphus-mcp`.

### D4. Ship it in the setup by default, with a profile-level opt-out

Because the setup vendors every plugin package, this bundle joins the setup patch, the setup
manifest, the vendored tree, and the market automatically. The escape hatch is the profile patch:

```yaml
- id: dsh-setup-nuphus-mcp
  disabled: true
```

Or, to relax confirmation, restating the complete configuration because a patch replaces the
`config` object rather than merging it:

```yaml
- id: dsh-setup-nuphus-mcp
  config:
    serverName: nuphus-mcp
    transport: stdio
    command: nuphus-mcp
    args: []
    toolCallTimeoutMs: 120000
    failOnStartupError: false
```

Alternative considered: a generator exclusion so the bundle is published but not shipped in the
setup. Rejected for the same reason as the Serena change — a repository-wide concept to avoid one row
that can be disabled locally.

### D5. Do not proxy the BYOK vision environment

The bridge scrubs credential-shaped names, so `NUPHUS_MCP_VISION_API_KEY` never reaches the child;
`NUPHUS_MCP_CONFIRM_WRITE`, `NUPHUS_MCP_BROWSER_CDP_URL`, `NUPHUS_BROWSER_*`,
`NUPHUS_MCP_HUD`, and the keyless `NUPHUS_MCP_VISION_*` names do pass through. The generator emits
plain YAML, so a `!!js process.env...` value cannot appear in the shipped patch. The docs give the
profile-level override for the key, using the dialect the profile patch already supports:

```yaml
- id: dsh-setup-nuphus-mcp
  config:
    # … the complete row configuration …
    env:
      NUPHUS_MCP_VISION_API_KEY: !!js process.env.NUPHUS_MCP_VISION_API_KEY
```

Alternative considered: teach the generator to emit `!!js` expressions. Rejected — a repository-wide
YAML dialect change for one optional tool, and it would put environment-dependent values into
generated files. A literal key in the fragment is forbidden by the `No secrets or machine data`
requirement.

### D6. Verify at three levels

- `pnpm gen` and `gen:check` prove the plugin patch, setup patch, manifest, and vendored copy are
  reproducible; `validate:repo` covers `engines.dsh`, fragment rules, the no-install-script rule, and
  the machine-path scan.
- `validate:composition` gains a `dsh-setup-nuphus-mcp` marker, proving the row survives composition
  in a throwaway profile on the supported DSH CLI.
- Manual smoke with the binary already installed on the owner machine: start the Harness, confirm
  `mcp__nuphus-mcp__*` tools appear, call a read tool (screen size or window list), call a write tool
  without the confirmation argument and observe the rejection, then call it with the argument.
- Market dry run (`node scripts/generate-market.ts --output .tmp/market-nuphus`) checks the card
  title, description, icon, version, `engines.dsh`, and git path.

### D7. Document the prerequisite and the sharp edges

`docs/install.md` gets a Nuphus section: the `npm install -g @nuphus/nuphus-mcp` prerequisite, the
`nuphus-mcp` PATH requirement and the first-run behavior, the confirmation default and both
overrides, the vision-key override, Chrome/Edge for browser tools, the platform support table, the
one-instance-per-profile limit, and the warning not to install both this bundle and the upstream
`dsh-nuphus-mcp` plugin. `docs/plugins.md` names this package as the second adapter example.
The market description states the prerequisite, so a card reader sees it before installing.

## Risks / Trade-offs

- **Token cost** — 38 tool definitions plus server instructions join every request once connected,
  the largest addition of any shipped plugin. The row can be disabled, and without the binary nothing
  is added.
- **Unexpected desktop control** — a user who installed `nuphus-mcp` for another MCP client gets
  desktop tools in every DSH session after the setup update. Strict confirmation limits the blast
  radius; the docs and the market description disclose the behavior.
- **Wrong machine** — tools act on the host running the Harness; a `dsh web` session on a remote
  machine controls that machine, not the viewer's. Documented.
- **Shared instance** — one server and one managed browser per profile, so concurrent sessions can
  interleave input and tab state. Same limit as the Serena adapter.
- **Version drift** — no pin means a server upgrade can change tool names, schemas, and token cost,
  and invalidate cached prompt prefixes. The docs name the tested version; a bump is re-verified
  against the manual smoke.
- **Startup probe** — stdio negotiation starts a probe process first, so a server that fails to
  initialize is spawned twice and then retried by the reconnect policy, producing repeated log
  lines.
- **Chrome 136+** — the managed profile path is the documented default; attaching the real default
  profile needs an external debugging port and a non-default user-data directory, which remains the
  user's own configuration task.

## Migration Plan

1. Add the package and the docs section; run `pnpm gen`, then the local gate
   (`pnpm build`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`,
   `pnpm validate:composition`).
2. Release a new set version; the market lists the new bundle and the setup bundle contains it.
3. Existing setup installations receive the row on their next install or update; no profile manifest
   edit is required. Users without the binary see no tools and one logged connection error.
4. Rollback: disable the row in the profile patch immediately, or remove the package, regenerate,
   and release. No data migration is involved.
