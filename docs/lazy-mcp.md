# Lazy MCP

`@dsh-setup/plugin-mcp-lazy` (row `dsh-setup-mcp-lazy`) keeps stdio MCP servers configured but
dormant. A session reaches them through two fixed proxy tools, so the model-facing tool set stays at
two entries no matter how many servers the profile carries. The plugin's own fragment ships an empty
list; the setup bundle configures Nuphus as its first lazy server and disables Nuphus' static adapter
(section [Configuration](#configuration)). A bundle that shipped servers on its own would reintroduce
the always-on schema cost this plugin removes.

The row exists because every mounted MCP adapter pays its complete tool-schema block in every model
request, whether or not the session calls that server. A static adapter is the right choice for a
server a session uses constantly. This bundle is the alternative for the other servers.

## Tools

The bundle registers exactly two tools, for every configuration:

- **`mcp_tools`** — lists one server's tools with their JSON schemas. Arguments: `server` (a
  configured name) and an optional case-insensitive `query` that filters by tool name and
  description. Use it before calling a tool you have not inspected.
- **`mcp_call`** — invokes one tool. Arguments: `server`, `tool`, and an optional `args` object that
  matches the tool's schema. Text content returned by the server reaches the model; a server-reported
  error fails the call with the server's message.

No per-server tool is ever registered, so the tool names and schemas in a request do not change when
a server starts, stops, or is added to the configuration.

## Configuration

The row mirrors the Harness MCP client's field names, so a stdio server definition moves between a
static adapter row and this bundle unchanged:

| Field               | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `serverName`        | Name the model selects; also the server's identity in errors     |
| `transport`         | Must be `stdio` (the default); any other value fails composition |
| `command`           | Executable to start                                              |
| `args`              | Arguments, including any confirmation or safety flag             |
| `env`               | Environment variables for the process                            |
| `cwd`               | Working directory                                                |
| `toolCallTimeoutMs` | Per-call timeout forwarded to the MCP client request             |

The plugin's own fragment ships an empty list. The setup bundle configures the first migration —
Nuphus — and disables its static adapter:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers:
      - serverName: nuphus-mcp
        transport: stdio
        command: nuphus-mcp
        args: ["--confirm-write"]
        toolCallTimeoutMs: 120000
- id: dsh-setup-nuphus-mcp
  disabled: true
```

A fresh setup session therefore sees only `mcp_tools`/`mcp_call` for Nuphus: the first call starts
the server, later calls reuse it, and unload terminates it. The Nuphus guidance skill describes both
the static and lazy access paths.

To restore the static Nuphus adapter, re-enable it and empty the lazy list in the profile patch:

```yaml
- id: dsh-setup-nuphus-mcp
  disabled: false
- id: dsh-setup-mcp-lazy
  config:
    servers: []
```

To keep Nuphus off after the setup migration, a profile that previously disabled the static row must
also empty the lazy list. A profile that explicitly enables the static row keeps it active alongside
the setup's lazy entry; the lazy call fails with the one-home error naming the adapter row instead of
starting a second process, so remove one path. The setup never reads or rewrites the profile patch.

Adopt another server by adding its entry. A profile patch replaces the whole `config` object, so
restate every server the row needs:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers:
      - serverName: my-server
        transport: stdio
        command: my-mcp-server
        args: ["--confirm-write"]
        toolCallTimeoutMs: 120000
```

An entry whose executable is missing does not keep the Harness from starting: the server is started
only on demand, and a failed start fails that call with the server name and the cause while other
servers stay usable.

## Lifecycle

A server's process is created on the first `mcp_tools` or `mcp_call` that targets it, reused for the
rest of the plugin's lifetime, and terminated when the plugin unloads. The first call therefore pays
the server's startup cost; a large server can take seconds. Later calls reuse the same session, so
server-side state established by an earlier call still applies.

## Scope and limits

- **stdio only.** Remote transports are not supported yet; an entry naming another transport is
  rejected when the profile is composed, with an error naming the server and the transport.
- **Text results only.** Image and embedded-resource content is not projected into the call result.
- **A server has one home.** Do not also mount the same server as a static MCP adapter row in the
  same profile: both would expose the same `mcp__<serverName>__<tool>` identity, and the server
  process would start twice. A lazy call fails with a one-home error naming the static adapter row
  (or the conflicting tool) when an enabled static row for the same server is still mounted, even
  while that adapter is initializing or retrying; use either the static row or a lazy entry, never
  both.
- **Request/response only.** A server tool that relies on server-initiated notifications is outside
  this version.
- **Nuphus screenshots.** `desktop_screenshot` without `path` returns an image, which this version
  drops. Pass `path`, save the PNG, and read it with `read_image`. The first `desktop_perceive` also
  downloads OCR models, so keep a two-minute `toolCallTimeoutMs` for Nuphus.
