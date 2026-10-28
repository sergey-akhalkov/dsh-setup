# lazy-mcp Specification

## Purpose

Lets a profile keep MCP servers configured but dormant, so a session pays no tool-schema cost for a
server it never uses and reaches it on demand through a fixed two-tool proxy.

## ADDED Requirements

### Requirement: Dormant server configuration

The bundle SHALL accept a configuration list of external MCP servers that it does not connect at
startup. Each entry SHALL use the same field names the Harness MCP client accepts for one server, so a
definition can move between a static adapter row and this bundle without rewriting. The bundle SHALL
start normally when the list is empty, when an entry names a missing command, and when a server is
unreachable.

#### Scenario: Empty list

- **WHEN** the bundle is mounted with no configured servers
- **THEN** the Harness starts, the bundle's proxy tools are available, and no MCP tool from any server appears

#### Scenario: Unreachable server

- **WHEN** a configured server cannot be started or the initial connection fails
- **THEN** the proxy call fails with an error result that names the server and the cause, the Harness keeps running, and other configured servers stay usable

### Requirement: Stdio-only transport for this version

This version SHALL connect stdio servers only. A configuration entry whose `transport` names any
other value MUST be rejected when the plugin is composed, with an error that names the server and the
transport, instead of being accepted and failing later. The documentation MUST state that remote
transports are not supported yet.

#### Scenario: Non-stdio entry rejected

- **WHEN** the configuration lists a server with a transport other than `stdio`
- **THEN** composition fails with an error naming the server and the transport, and no process is started

#### Scenario: Stdio entry accepted

- **WHEN** the configuration lists a server with `transport: stdio`
- **THEN** composition succeeds and the server stays dormant until its first proxy call

### Requirement: Fixed proxy tool surface

The bundle SHALL register a fixed set of two model-facing tools no matter how many servers are
configured: one that lists a server's tools with their schemas, and one that invokes a tool. The
model-facing tool names MUST NOT change when a server starts, stops, or is added to the configuration.

#### Scenario: Server count does not change the tool set

- **WHEN** the configuration lists five servers instead of one
- **THEN** the model still sees exactly the same two tool names

#### Scenario: No tool appears after a call

- **WHEN** a proxy call starts a server's process
- **THEN** no additional model-facing tool appears, and the schemas in the request are unchanged

### Requirement: On-demand process lifecycle

A configured server's process SHALL start only on the first proxy call that targets it. That process
SHALL be reused for later calls in the same plugin instance. Every process started by the bundle MUST
be terminated when the plugin unloads.

#### Scenario: No call, no process

- **WHEN** the bundle is mounted and no proxy call targets a configured server
- **THEN** no process for that server is started

#### Scenario: Reuse across calls

- **WHEN** a second proxy call targets a server that is already running
- **THEN** it runs against the same server session, so server-side state established by the first call still applies

#### Scenario: Unload terminates

- **WHEN** the plugin unloads or the Harness shuts down
- **THEN** every server process the bundle started is terminated

### Requirement: Initialization ownership

Process ownership SHALL span transport creation through initialization. A server whose initialization
fails after its process started MUST be terminated. A connection that completes after the plugin
unloaded MUST NOT become usable, and unload SHALL wait for or cancel an initialization already in
flight.

#### Scenario: Initialization fails after start

- **WHEN** a server's process starts but the initial connection fails or rejects
- **THEN** that process is terminated and the failed call reports the cause

#### Scenario: Unload during initialization

- **WHEN** the plugin unloads while a server's first connection is still in flight
- **THEN** the initialization is cancelled or awaited and its process is terminated, and no later call can use that connection

### Requirement: Name-only server selection

The server argument SHALL be accepted only as a name present in the configuration. An unknown name
MUST fail the call without starting any process. The model MUST NOT be able to supply or override a
server's command, arguments, environment, working directory, or transport.

#### Scenario: Unknown server name

- **WHEN** the model names a server that is not configured
- **THEN** the call fails and the error lists the configured server names

#### Scenario: Configured command applies unchanged

- **WHEN** the model calls a tool on a configured server
- **THEN** the server is started with the configured command, arguments, and environment, including any confirmation or safety flag the configuration sets

### Requirement: Faithful call results

Text content returned by a server tool SHALL reach the model. A server-reported error MUST surface as
a failed proxy call, never as a successful result.

#### Scenario: Server error surfaces

- **WHEN** a tool call returns a server-reported error
- **THEN** the proxy call fails visibly and the model sees the server's error message

### Requirement: One home per server

The implementation MUST reject a configuration that lists the same server name twice. The
documentation MUST state that a server configured here must not also be mounted as a static MCP
adapter row in the same profile, because both would expose the same `mcp__<serverName>__<tool>`
names, and MUST state the upgrade reconciliation for a profile that already selects one of the two
paths.

#### Scenario: Duplicate configuration

- **WHEN** the configuration lists one server name twice
- **THEN** composition or validation fails with a message naming the duplicate

#### Scenario: Documented exclusivity

- **WHEN** a user reads the bundle's documentation
- **THEN** it states that the server must be either a static adapter row or a configured lazy entry, not both, and how an upgraded profile restores one home

### Requirement: Static adapter conflict guard

A lazy call MUST fail before starting any process when the composition already enables a static
MCP adapter row for the same `serverName`, and MUST name the server and the conflicting static
adapter row or tool. Detection MUST NOT depend on the adapter having registered its tools: an
enabled row that is still initializing, failed, or retrying counts as a conflict. Already-registered
`mcp__<serverName>__*` tools SHALL also count as a conflict.

#### Scenario: Static adapter already mounted

- **WHEN** a lazy call targets a server whose `mcp__<serverName>__*` tools are already registered by a static adapter row
- **THEN** the call fails with a one-home error naming the server and the conflicting tool, and no server process starts

#### Scenario: Static adapter awaiting discovery

- **WHEN** a lazy call targets a server whose enabled static adapter row exists but has registered no tools yet because it is initializing, failed, or retrying
- **THEN** the call fails with a one-home error naming the adapter row, and no server process starts

### Requirement: Shipped Nuphus migration

The setup bundle SHALL ship the Nuphus server as its configured lazy entry and SHALL disable the
static Nuphus adapter row by default, so a fresh setup session receives no `mcp__nuphus-mcp__*`
tool schema. The lazy entry MUST carry the static row's command, confirmation argument, and
tool-call timeout. The guidance skill SHALL describe the static and lazy access paths, and the
documentation MUST state how a profile restores the static adapter.

#### Scenario: Fresh setup composition

- **WHEN** the setup is installed with no Nuphus override in the profile patch
- **THEN** `dsh-setup-mcp-lazy` lists `nuphus-mcp` and `dsh-setup-nuphus-mcp` is disabled
- **AND** the model-facing request contains `mcp_tools`/`mcp_call` but no `mcp__nuphus-mcp__*`

#### Scenario: Nuphus on demand

- **WHEN** the model lists the configured `nuphus-mcp` tools and then calls one of them
- **THEN** the server starts on the first call, its listing and text result reach the model, and
  later calls reuse the same process

#### Scenario: Restore the static adapter

- **WHEN** a profile patch enables `dsh-setup-nuphus-mcp` and empties the lazy `servers` list
- **THEN** the static adapter is effective again and the lazy row starts no second Nuphus process
