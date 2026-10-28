# Design

## Context

See `proposal.md` - Why for the measured cost. Constraints that shape the approach:

- The Harness has no tool search: `dsh-tools` presents `native` (every visible schema) or `ptc`
  (one `run_code` plus a generated SDK block). `deferLoading` is a marker only.
- `@deepseek-ai/dsh-mcp-client` registers every tool a server lists, with no include/exclude filter,
  and its rows are mounted by the Harness loader from the Harness module tree - the profile has no
  copy of that package to import, and editing its configuration needs a profile recomposition.
- Registering a tool through `ctx.tools` is enough to make it visible: the registry projects
  typed definitions onto the model-facing schema set at request time, in scoped layers that a
  disposal removes.
- A server may change its tool list mid-session and the loop tolerates it, but every change appends a
  `tool-addition`/`tool-removal` developer message and invalidates the cached prompt prefix.
- The Harness MCP client depends on `@modelcontextprotocol/client@2.2.0` (MIT, exports `./stdio`).

## Goals / Non-Goals

**Goals:**

- Any stdio MCP server is reachable on demand with a constant, tiny model-facing surface.
- The model-facing tool set never changes while the session runs.
- Server selection is a name from shipped configuration, never a model-supplied command.
- The shipped setup reaches Nuphus through the proxy by default instead of paying its full schema
  cost in every request.

**Non-Goals:**

- Registering a server's tools as native typed tools at runtime.
- Projecting image or resource content from a server into a tool result.
- Remote (streamable-http) transports, which need endpoint and header configuration and a
  different connection path.
- Shipping a server list from the lazy plugin itself; the setup's defaults configure Nuphus as a
  deliberate, overridable migration.
- Migrating any other static adapter, or rewriting a profile that deliberately keeps Nuphus static.
- Auto-detecting when a server is needed.

## Decisions

### D1: Two proxy tools instead of native per-tool registration

The bundle registers `mcp_tools` and `mcp_call` for every configuration. Alternatives: (a) register
each discovered tool as `mcp__<server>__<tool>` on first use - better ergonomics, but the tool set
changes at runtime, which appends a developer message and invalidates the prompt prefix each wake;
(b) keep static rows - no on-demand behavior at all. The proxy pair keeps the schema set constant, is
roughly half the code, and matches the published code-execution pattern.

### D2: Reuse `@modelcontextprotocol/client@2.2.0`

The same library and version the Harness MCP client uses, exported with a stdio transport.
Alternatives: import `@deepseek-ai/dsh-mcp-client` and apply it with `ctx.plugin()` - rejected
because that package is resolved by the Harness loader from its own module tree, not from the
profile, so a plugin cannot rely on importing it; hand-roll JSON-RPC - rejected because content
projection and pagination would drift from the official client for three methods' worth of savings;
`@modelcontextprotocol/sdk` - rejected as a different, older package line than the one in use.

Pin the exact version and bump it together with `dsh.json` -> supported DSH versions.

### D3: Lazy start, reuse for the plugin lifetime, dispose on unload

Starting on first use keeps an unused server's process from existing at all; reuse avoids repeated
cold starts (a desktop-automation server is a large native binary); disposal on unload bounds what the
bundle leaves behind. Ownership covers the whole path, not just the happy case: a transport is closed
when its initialization fails, a connection that completes after unload never becomes usable, and
unload awaits or cancels an initialization already in flight. Alternatives: spawn per call - rejected, cold start dominates; idle timer -
rejected, state to tune with no measured benefit; release at turn end - rejected, it would break
multi-turn UI work and re-pay startup on the next turn.

### D4: Configuration mirrors the Harness MCP client fields

`serverName`, `transport`, `command`, `args`, `env`, `cwd`, `toolCallTimeoutMs`, so a definition
moves between a static adapter row and this bundle unchanged and the existing documentation stays
useful. The plugin's own list is empty: a bundle that shipped servers would reintroduce the
always-on cost this change exists to remove. The setup layer is where a deliberate migration lives
(D8), so a standalone install of the plugin adds no server.

The `transport` field accepts `stdio` only in this version; any other value is rejected at
composition with an error naming the server and the transport. Remote transports need `url` and
`headers` and a different connection path, so accepting a configuration the bundle cannot connect is
worse than refusing it. Alternative considered: implement both transports now - rejected as scope the
measured cost does not justify, since every configured server in use here is stdio.
`shortcut: stdio only, add url/headers and the remote connection path when a server that is actually
needed is remote-only`.

### D5: Name-only selection is the security boundary

The server argument indexes the configuration. Command, arguments, environment, working directory,
and transport come only from configuration, so a model that is prompt-injected cannot launch an
arbitrary process through this tool. Unknown names fail before any spawn.

### D6: One home per server

The configuration rejects duplicate names. Documentation states the exclusivity rule against static
adapter rows, because both would publish the same `mcp__<serverName>__<tool>` identity and a server
process would be started twice.

### D7: Text results only in this version

A tool result's text content is returned; images and embedded resources are not projected.
`shortcut: text-only results, upgrade when a configured server returns images that the model needs`.

### D8: Ship Nuphus through the proxy from the setup

The setup already mounts Nuphus' static adapter by default, so every session pays its full tool
list whether or not the session touches the desktop. Nuphus is the first server to migrate: the
setup's defaults configure `dsh-setup-mcp-lazy` with the same stdio entry and disable
`dsh-setup-nuphus-mcp`. The lazy plugin's own fragment stays empty, so a standalone install of the
plugin still ships nothing; only the setup carries the deliberate default. Alternatives: leave the
static row (no cost reduction, the status quo this change exists to fix); disable Nuphus entirely
(no desktop automation at all); require each user to edit the profile (the owner's first request was
exactly this confusion, and the setup's purpose is to reproduce the setup in one install). The
trade-off is real: first use pays startup, image results are dropped in this version, and a user who
runs Nuphus every step must restore the static adapter in the profile patch. The migration is
documented with that rollback, and the profile patch remains the final authority.

The setup cannot read or rewrite the profile patch, so two explicit upgrade states need
reconciliation. A profile that sets `disabled: false` on the static row keeps that row active
alongside the new lazy entry; a profile that previously opted out by setting `disabled: true` still
gets the lazy entry and so would still reach Nuphus on demand. The lazy plugin therefore gains a
one-home guard at call time: it walks the loader's entry tree for an enabled
`@deepseek-ai/dsh-mcp-client` row whose `config.serverName` matches, which is present even while the
adapter is initializing, failed, or retrying and has registered no tools; registered
`mcp__<serverName>__*` tools are a fallback when the loader service is absent. The call fails naming
the adapter row or the conflicting tool and starts nothing. The documentation states both
reconciliations (empty the lazy list, or clear the explicit static enable), and the change's
composition validation covers the default and both overlays.

### D9: Setup defaults may target setup rows and disable them

The generated setup patch already inserts every plugin row and then applies `defaults.yml`, but the
defaults contract only accepted shipped-row ids with a `config` object. To ship the Nuphus migration
as one generated layer, `defaults.yml` gains an optional `disabled` field and its ids may name a row
the setup itself inserts; the generator, `validate-repo`, and the `portable-setup` requirement for
scoped patch entries are updated together. A configuration override still restates the complete
config (a patch replaces it), a disable override carries no config, and the profile patch still
outranks the whole setup layer. The Loader ignores a same-layer `disabled` override on a row the same
patch inserts, so the generator bakes a setup-row disable into that row's insert entry; configuration
overrides remain separate entries. Alternatives: hardcode the migration in the generator (implicit
and untestable as data); change the plugin fragments (the standalone Nuphus bundle would ship a
disabled adapter and the lazy bundle would ship a server, changing both plugins' meaning); a second
`overrides.yml` file (a second concept beside defaults for no added safety).

## Risks / Trade-offs

- **A large server makes `mcp_tools` a large payload** -> the listing takes an optional query filter,
  and the cost lands only on the calls that ask for it, not on every request.
- **First-call latency** -> reuse after the first start; document that the first call pays the
  startup cost. A desktop-automation server can take seconds, and a second instance of the same
  server may contend for its resources, which is why D6 matters.
- **A remote-only server** -> it is refused with a message naming the transport, and the
  documentation says remote transports are not supported yet.
- **Notification-driven or streaming tools** -> the proxy is request/response; a server tool that
  relies on server-initiated notifications is out of scope for this version.
- **Dependency drift against the Harness** -> the exact version is pinned and released with the
  supported DSH versions; `pnpm validate:composition` proves the composed profile.
- **PTC presentation** -> the two tools appear in the generated SDK block instead of the schema list;
  behavior should not differ, but it needs one live check in a `ptc` profile.
- **Nuphus users who rely on always-on tools** -> the migration is a default, not a lock: a profile
  patch re-enables the static adapter and empties the lazy list. The install documentation says so.
- **Nuphus image results** -> `desktop_screenshot` without a path returns an image, and this version
  drops it; the documentation tells the model to save a path and read the file instead.
- **Existing custom Nuphus overrides** -> a profile that already pins the static row keeps its
  configuration but becomes inactive after the setup update; restoring it needs `disabled: false`
  beside that config and an empty lazy list. A profile that explicitly enables the static row keeps
  both paths until reconciled; the lazy one-home guard fails the call instead of starting a second
  process. Documented in the migration plan.
- **Migration discoverability** -> the setup default changes a shipped behavior without editing the
  profile. The install guide, the lazy-MCP page, and the Nuphus section each state the default, the
  two upgrade reconciliations, and the rollback; the guidance skill describes both access paths.

## Migration Plan

Nothing to migrate for existing non-Nuphus servers: the new bundle starts empty. The setup update
changes the shipped Nuphus default:

- A profile with no Nuphus override gets the lazy row and the disabled static adapter after the
  Harness restarts.
- A profile that configured the static Nuphus row without `disabled` keeps that configuration but
  the row is inactive; restoring it means `disabled: false` on the profile's static entry and an
  empty lazy `servers` list.
- A profile that explicitly enables the static row (`disabled: false`) keeps it active alongside the
  lazy entry; the lazy one-home guard fails the first lazy call with the conflict instead of starting
  a second process. The documented reconciliation removes the duplicate path.
- A profile that previously opted out by disabling the static row still receives the lazy default;
  emptying the lazy `servers` list is the documented way to keep Nuphus off.

Rolling back is the same profile override; removing the bundle entry restores the plugin-only
composition.

## Open Questions

None that affect the specs, the approach, or the task breakdown.
