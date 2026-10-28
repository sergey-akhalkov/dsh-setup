import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  apply,
  CALL_TOOL,
  type LazyConfig,
  type McpCallResult,
  type McpClient,
  type McpTool,
  type McpTransport,
  type ServerConfig,
  TOOLS_TOOL,
} from '../lib/index.js'

/** One configured stdio server with a plausible default. */
function server(serverName: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { serverName, transport: 'stdio', command: 'fake-mcp-server', ...overrides }
}

/** A transport that records process start and termination instead of spawning. */
class FakeTransport implements McpTransport {
  readonly serverName: string
  starts = 0
  closes = 0
  private readonly onClose: (() => void) | undefined

  constructor(serverName: string, onClose?: () => void) {
    this.serverName = serverName
    this.onClose = onClose
  }

  async start(): Promise<void> {
    this.starts += 1
  }

  async close(): Promise<void> {
    this.closes += 1
    this.onClose?.()
  }
}

/** A client that answers locally; tests choose the tool inventory and results. */
class FakeClient implements McpClient {
  readonly calls: Array<{
    params: { name: string; arguments: Record<string, unknown> }
    options?: { timeout?: number; signal?: AbortSignal }
  }> = []
  handler: (params: { name: string; arguments: Record<string, unknown> }) => McpCallResult =
    () => ({
      content: [],
    })
  private serverName: string | undefined

  constructor(private readonly toolsByServer: Record<string, McpTool[]> = {}) {}

  async connect(transport: McpTransport): Promise<void> {
    this.serverName = (transport as FakeTransport).serverName
  }

  async listTools(): Promise<{ tools: readonly McpTool[] }> {
    return { tools: this.toolsByServer[this.serverName ?? ''] ?? [] }
  }

  async callTool(
    params: { name: string; arguments: Record<string, unknown> },
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<McpCallResult> {
    this.calls.push({ params, options })
    return this.handler(params)
  }
}

/** A client whose handshake always fails. */
function failingClient(message: string): McpClient {
  return {
    connect: async () => {
      throw new Error(message)
    },
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
  }
}

interface HarnessOptions {
  clients?: () => McpClient
  createTransport?: (entry: ServerConfig) => FakeTransport
  toolsByServer?: Record<string, McpTool[]>
  loader?: {
    entries: () => Array<{
      disabled: boolean
      options: { id: string; name: string; config?: unknown }
      evaluate?: (expr: string) => unknown
    }>
  }
  staticTools?: readonly string[]
}

/** A fake Cordis context plus the plugin registrations under test. */
class Harness {
  readonly tools = new Map<string, ToolDefinition>()
  readonly transports: FakeTransport[] = []
  readonly clients: McpClient[] = []
  private readonly disposers: Array<() => unknown> = []

  constructor(config: LazyConfig, options: HarnessOptions = {}) {
    const toolsByServer = options.toolsByServer ?? {}
    const ctx = {
      tools: {
        register: (definition: ToolDefinition) => {
          this.tools.set(definition.name, definition)
          return () => undefined
        },
        schemas: () =>
          (options.staticTools ?? []).map((name) => ({ name, description: '', parameters: {} })),
      },
      effect: (body: () => unknown) => {
        const disposer = body()
        if (typeof disposer === 'function') this.disposers.push(disposer as () => unknown)
        return () => undefined
      },
      get: (name: string) => (name === 'loader' ? options.loader : undefined),
    }
    apply(ctx as never, config, {
      createClient: () => {
        const client = options.clients?.() ?? new FakeClient(toolsByServer)
        this.clients.push(client)
        return client
      },
      createTransport: (entry: ServerConfig) => {
        const transport = options.createTransport?.(entry) ?? new FakeTransport(entry.serverName)
        this.transports.push(transport)
        return transport
      },
    })
  }

  schemas(): Array<{ name: string; description?: string; parameters: unknown }> {
    return [...this.tools.values()].map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    }))
  }

  async dispose(): Promise<void> {
    for (const disposer of this.disposers.reverse()) await disposer()
  }

  async callTool(name: string, args: unknown): Promise<{ text: string }> {
    const definition = this.tools.get(name)
    if (definition === undefined) throw new Error(`tool ${name} is not registered`)
    return (await definition.execute(args, {
      signal: new AbortController().signal,
    } as never)) as { text: string }
  }
}

function listedTools(text: string): string[] {
  const body = JSON.parse(text) as { tools: Array<{ name: string }> }
  return body.tools.map((tool) => tool.name)
}

describe('lazy MCP configuration', () => {
  it('accepts a full stdio entry and an empty list', async () => {
    const configured = new Harness({
      servers: [
        server('demo', {
          args: ['--confirm-write'],
          env: { DEMO_TOKEN: 'secret' },
          cwd: 'somewhere',
          toolCallTimeoutMs: 120000,
        }),
      ],
    })
    expect([...configured.tools.keys()]).toEqual([TOOLS_TOOL, CALL_TOOL])

    const empty = new Harness({ servers: [] })
    expect([...empty.tools.keys()]).toEqual([TOOLS_TOOL, CALL_TOOL])
    await expect(empty.callTool(TOOLS_TOOL, { server: 'anything' })).rejects.toThrow(
      /configured servers: \(none\)/,
    )
    expect(empty.transports).toHaveLength(0)
  })

  it('rejects a duplicate server name before any client is constructed', () => {
    let created = 0
    const attempt = () =>
      new Harness(
        { servers: [server('double'), server('double')] },
        {
          clients: () => {
            created += 1
            return new FakeClient()
          },
        },
      )
    expect(attempt).toThrow(/server "double" is configured twice/)
    expect(created).toBe(0)
  })

  it('rejects a non-stdio transport naming the server and the transport', () => {
    let created = 0
    const attempt = () =>
      new Harness(
        { servers: [server('remote', { transport: 'streamable-http' })] },
        {
          clients: () => {
            created += 1
            return new FakeClient()
          },
        },
      )
    expect(attempt).toThrow(/server "remote" uses transport "streamable-http"/)
    expect(created).toBe(0)
  })

  it('rejects an unknown server name and lists the configured ones', async () => {
    const harness = new Harness({ servers: [server('demo')] })
    await expect(harness.callTool(TOOLS_TOOL, { server: 'ghost' })).rejects.toThrow(
      /unknown server "ghost"; configured servers: demo/,
    )
    await expect(harness.callTool(CALL_TOOL, { server: 'ghost', tool: 'x' })).rejects.toThrow(
      /configured servers: demo/,
    )
    expect(harness.transports).toHaveLength(0)
    expect(harness.clients).toHaveLength(0)
  })
})

describe('lazy MCP lifecycle', () => {
  it('starts a server on first use only, not on mount', async () => {
    const client = new FakeClient({ demo: [{ name: 'alpha' }] })
    let listed = 0
    const listTools = client.listTools.bind(client)
    client.listTools = async () => {
      listed += 1
      return listTools()
    }
    const harness = new Harness({ servers: [server('demo')] }, { clients: () => client })
    expect(harness.transports).toHaveLength(0)

    await harness.callTool(TOOLS_TOOL, { server: 'demo' })
    await harness.callTool(TOOLS_TOOL, { server: 'demo' })

    expect(harness.transports).toHaveLength(1)
    expect(harness.clients).toHaveLength(1)
    expect(listed).toBe(2)
  })

  it('keeps server-side state across calls by reusing one client', async () => {
    const client = new FakeClient()
    let counter = 0
    client.listTools = async () => {
      counter += 1
      return { tools: [{ name: 'alpha', description: `call ${counter}` }] }
    }
    const harness = new Harness({ servers: [server('demo')] }, { clients: () => client })

    const first = JSON.parse((await harness.callTool(TOOLS_TOOL, { server: 'demo' })).text) as {
      tools: Array<{ description: string }>
    }
    const second = JSON.parse((await harness.callTool(TOOLS_TOOL, { server: 'demo' })).text) as {
      tools: Array<{ description: string }>
    }

    expect(first.tools[0]?.description).toBe('call 1')
    expect(second.tools[0]?.description).toBe('call 2')
  })

  it('terminates every started process on unload and none other', async () => {
    const harness = new Harness({ servers: [server('one'), server('two'), server('never')] })
    await harness.callTool(TOOLS_TOOL, { server: 'one' })
    await harness.callTool(TOOLS_TOOL, { server: 'two' })

    await harness.dispose()

    expect(harness.transports.map((transport) => transport.serverName)).toEqual(['one', 'two'])
    expect(harness.transports.map((transport) => transport.closes)).toEqual([1, 1])
  })

  it('passes the configured values untouched and applies the call timeout', async () => {
    const config = server('demo', {
      args: ['--confirm-write'],
      env: { DEMO_TOKEN: 'secret' },
      cwd: 'somewhere',
      toolCallTimeoutMs: 120000,
    })
    const received: ServerConfig[] = []
    const client = new FakeClient()
    client.handler = () => ({ content: [{ type: 'text', text: 'done' }] })
    const harness = new Harness(
      { servers: [config] },
      {
        clients: () => client,
        createTransport: (entry: ServerConfig) => {
          received.push(entry)
          return new FakeTransport(entry.serverName)
        },
      },
    )

    const result = await harness.callTool(CALL_TOOL, {
      server: 'demo',
      tool: 'alpha',
      args: { value: 1 },
    })

    expect(result.text).toBe('done')
    expect(received).toStrictEqual([config])
    expect(received[0]?.args).toEqual(['--confirm-write'])
    expect(client.calls[0]?.options?.timeout).toBe(120000)
  })

  it('closes the transport when initialization fails after the process started', async () => {
    const transport = new FakeTransport('broken')
    const harness = new Harness(
      { servers: [server('broken')] },
      { clients: () => failingClient('handshake exploded'), createTransport: () => transport },
    )

    await expect(harness.callTool(TOOLS_TOOL, { server: 'broken' })).rejects.toThrow(
      /server "broken" failed to start: handshake exploded/,
    )
    expect(transport.closes).toBe(1)
  })

  it('waits for a failed initialization cleanup before unload resolves', async () => {
    const transport = new FakeTransport('broken')
    let signalCloseStarted: (() => void) | undefined
    let releaseClose: (() => void) | undefined
    const closeStarted = new Promise<void>((resolve) => {
      signalCloseStarted = resolve
    })
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    transport.close = async () => {
      transport.closes += 1
      signalCloseStarted?.()
      await closeGate
    }
    const harness = new Harness(
      { servers: [server('broken')] },
      { clients: () => failingClient('handshake exploded'), createTransport: () => transport },
    )

    const failed = harness.callTool(TOOLS_TOOL, { server: 'broken' }).then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await closeStarted
    let unloaded = false
    const unloading = harness.dispose().then(() => {
      unloaded = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(unloaded).toBe(false)
    releaseClose?.()
    await unloading
    expect(unloaded).toBe(true)
    expect(transport.closes).toBe(1)
    expect(await failed).toMatch(/unloaded during initialization/)
  })

  it('waits for a client-initiated transport close before unload resolves', async () => {
    const transport = new FakeTransport('broken')
    let signalCloseStarted: (() => void) | undefined
    let releaseClose: (() => void) | undefined
    const closeStarted = new Promise<void>((resolve) => {
      signalCloseStarted = resolve
    })
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    let closeCalls = 0
    // The real stdio transport returns immediately on a second close.
    transport.close = async () => {
      closeCalls += 1
      transport.closes += 1
      if (closeCalls === 1) {
        signalCloseStarted?.()
        await closeGate
      }
    }
    const client: McpClient = {
      connect: async (connection) => {
        void connection.close()
        throw new Error('handshake exploded')
      },
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
    }
    const harness = new Harness(
      { servers: [server('broken')] },
      { clients: () => client, createTransport: () => transport },
    )

    const failed = harness.callTool(TOOLS_TOOL, { server: 'broken' }).then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await closeStarted
    let unloaded = false
    const unloading = harness.dispose().then(() => {
      unloaded = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(unloaded).toBe(false)
    releaseClose?.()
    await unloading
    expect(unloaded).toBe(true)
    expect(transport.closes).toBe(1)
    expect(await failed).toMatch(/unloaded during initialization/)
  })

  it('waits for a transport-initiated close after a successful connection', async () => {
    const transport = new FakeTransport('demo')
    let signalCloseStarted: (() => void) | undefined
    let releaseClose: (() => void) | undefined
    const closeStarted = new Promise<void>((resolve) => {
      signalCloseStarted = resolve
    })
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    let closeCalls = 0
    transport.close = async () => {
      closeCalls += 1
      transport.closes += 1
      if (closeCalls === 1) {
        signalCloseStarted?.()
        await closeGate
      }
    }
    const harness = new Harness(
      { servers: [server('demo')] },
      {
        clients: () => new FakeClient({ demo: [{ name: 'alpha' }] }),
        createTransport: () => transport,
      },
    )
    await harness.callTool(TOOLS_TOOL, { server: 'demo' })

    // The transport's own read-overflow handler closes itself without awaiting.
    void transport.close()
    await closeStarted
    let unloaded = false
    const unloading = harness.dispose().then(() => {
      unloaded = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(unloaded).toBe(false)
    releaseClose?.()
    await unloading
    expect(unloaded).toBe(true)
    expect(transport.closes).toBe(1)
  })

  it('retries a server after a failed start and closes each transport once', async () => {
    const transports: FakeTransport[] = []
    let created = 0
    const harness = new Harness(
      { servers: [server('flaky')] },
      {
        clients: () => {
          created += 1
          return failingClient(`failure ${created}`)
        },
        createTransport: (entry: ServerConfig) => {
          const transport = new FakeTransport(entry.serverName)
          transports.push(transport)
          return transport
        },
      },
    )

    await expect(harness.callTool(TOOLS_TOOL, { server: 'flaky' })).rejects.toThrow(/failure 1/)
    await expect(harness.callTool(TOOLS_TOOL, { server: 'flaky' })).rejects.toThrow(/failure 2/)
    expect(transports).toHaveLength(2)
    expect(transports.map((transport) => transport.closes)).toEqual([1, 1])
  })

  it('never exposes a connection that completes after unload', async () => {
    let rejectConnect: ((error: Error) => void) | undefined
    const transport = new FakeTransport('demo', () =>
      rejectConnect?.(new Error('transport closed')),
    )
    const pending: McpClient = {
      connect: () =>
        new Promise((_resolve, reject) => {
          rejectConnect = reject
        }),
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
    }
    const harness = new Harness(
      { servers: [server('demo')] },
      { clients: () => pending, createTransport: () => transport },
    )

    const inFlight = harness.callTool(TOOLS_TOOL, { server: 'demo' }).then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await harness.dispose()

    expect(await inFlight).toMatch(/unloaded/)
    expect(transport.closes).toBe(1)
    await expect(harness.callTool(TOOLS_TOOL, { server: 'demo' })).rejects.toThrow(
      /the plugin unloaded/,
    )
  })
})

describe('one home guard', () => {
  const adapter = (id: string, serverName: string, disabled = false) => ({
    disabled,
    options: { id, name: '@deepseek-ai/dsh-mcp-client', config: { serverName } },
  })

  it('refuses a server whose enabled static adapter row exists, even without tools', async () => {
    const harness = new Harness(
      { servers: [server('demo')] },
      { loader: { entries: () => [adapter('dsh-setup-demo', 'demo')] } },
    )
    await expect(harness.callTool(TOOLS_TOOL, { server: 'demo' })).rejects.toThrow(
      /also mounted as a static adapter \(static adapter row "dsh-setup-demo"\)/,
    )
    expect(harness.transports).toHaveLength(0)
  })

  it('ignores a disabled static row and a row for another server', async () => {
    const harness = new Harness(
      { servers: [server('demo')] },
      {
        loader: {
          entries: () => [
            adapter('dsh-setup-demo', 'demo', true),
            adapter('dsh-setup-other', 'other'),
          ],
        },
      },
    )
    await harness.callTool(TOOLS_TOOL, { server: 'demo' })
    expect(harness.transports).toHaveLength(1)
  })

  it('falls back to a registered static tool when the loader is absent', async () => {
    const harness = new Harness({ servers: [server('demo')] }, { staticTools: ['mcp__demo__do'] })
    await expect(harness.callTool(TOOLS_TOOL, { server: 'demo' })).rejects.toThrow(
      /also mounted as a static adapter \(tool "mcp__demo__do"\)/,
    )
    expect(harness.transports).toHaveLength(0)
  })

  it('resolves a loader expression for the static server name', async () => {
    const harness = new Harness(
      { servers: [server('demo')] },
      {
        loader: {
          entries: () => [
            {
              disabled: false,
              options: {
                id: 'dsh-setup-demo',
                name: '@deepseek-ai/dsh-mcp-client',
                config: { serverName: { __jsExpr: "'demo'" } },
              },
              evaluate: (expr: string) => (expr === "'demo'" ? 'demo' : undefined),
            },
          ],
        },
      },
    )
    await expect(harness.callTool(TOOLS_TOOL, { server: 'demo' })).rejects.toThrow(
      /also mounted as a static adapter/,
    )
    expect(harness.transports).toHaveLength(0)
  })

  it('retries after the conflicting static row is disabled', async () => {
    let entries: Array<ReturnType<typeof adapter>> = [adapter('dsh-setup-demo', 'demo')]
    const harness = new Harness(
      { servers: [server('demo')] },
      { loader: { entries: () => entries } },
    )
    await expect(harness.callTool(TOOLS_TOOL, { server: 'demo' })).rejects.toThrow(/also mounted/)
    expect(harness.transports).toHaveLength(0)
    entries = []
    await harness.callTool(TOOLS_TOOL, { server: 'demo' })
    expect(harness.transports).toHaveLength(1)
  })

  it('stops serving a cached client when the static row becomes enabled', async () => {
    let entries: Array<ReturnType<typeof adapter>> = []
    const harness = new Harness(
      { servers: [server('demo')] },
      { loader: { entries: () => entries } },
    )
    await harness.callTool(TOOLS_TOOL, { server: 'demo' })
    expect(harness.transports).toHaveLength(1)
    entries = [adapter('dsh-setup-demo', 'demo')]
    await expect(harness.callTool(TOOLS_TOOL, { server: 'demo' })).rejects.toThrow(/also mounted/)
    entries = []
    await harness.callTool(TOOLS_TOOL, { server: 'demo' })
    expect(harness.transports).toHaveLength(1)
  })
})

describe('lazy MCP proxy tools', () => {
  it('lists only one server tools and narrows them by query', async () => {
    const harness = new Harness(
      { servers: [server('alpha'), server('beta')] },
      {
        toolsByServer: {
          alpha: [
            { name: 'alpha-read', description: 'Read a file', inputSchema: { type: 'object' } },
            { name: 'alpha-write', description: 'Write a file', inputSchema: { type: 'object' } },
          ],
          beta: [{ name: 'beta-run', description: 'Run a task', inputSchema: { type: 'object' } }],
        },
      },
    )

    const alpha = await harness.callTool(TOOLS_TOOL, { server: 'alpha' })
    const beta = await harness.callTool(TOOLS_TOOL, { server: 'beta' })
    const filtered = await harness.callTool(TOOLS_TOOL, { server: 'alpha', query: 'write' })

    expect(listedTools(alpha.text)).toEqual(['alpha-read', 'alpha-write'])
    expect(listedTools(beta.text)).toEqual(['beta-run'])
    expect(listedTools(filtered.text)).toEqual(['alpha-write'])
    const body = JSON.parse(alpha.text) as { tools: Array<{ inputSchema?: unknown }> }
    expect(body.tools[0]?.inputSchema).toStrictEqual({ type: 'object' })
  })

  it('forwards mcp_call arguments and returns the text content', async () => {
    const client = new FakeClient()
    client.handler = () => ({
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    })
    const harness = new Harness({ servers: [server('demo')] }, { clients: () => client })

    const result = await harness.callTool(CALL_TOOL, {
      server: 'demo',
      tool: 'alpha',
      args: { value: 1 },
    })

    expect(result.text).toBe('first\nsecond')
    expect(client.calls[0]?.params).toStrictEqual({ name: 'alpha', arguments: { value: 1 } })
  })

  it('surfaces a server-reported error as a failed call', async () => {
    const client = new FakeClient()
    client.handler = () => ({ isError: true, content: [{ type: 'text', text: 'bad input' }] })
    const harness = new Harness({ servers: [server('demo')] }, { clients: () => client })

    await expect(harness.callTool(CALL_TOOL, { server: 'demo', tool: 'alpha' })).rejects.toThrow(
      /bad input/,
    )
  })

  it('fails one unreachable server while another stays usable', async () => {
    let created = 0
    const working = new FakeClient()
    working.handler = () => ({ content: [{ type: 'text', text: 'ok' }] })
    const harness = new Harness(
      { servers: [server('broken'), server('working')] },
      {
        clients: () => {
          created += 1
          return created === 1 ? failingClient('binary missing') : working
        },
      },
    )

    await expect(harness.callTool(CALL_TOOL, { server: 'broken', tool: 'alpha' })).rejects.toThrow(
      /server "broken" failed to start: binary missing/,
    )
    const result = await harness.callTool(CALL_TOOL, { server: 'working', tool: 'alpha' })
    expect(result.text).toBe('ok')
  })

  it('registers exactly two tool names for one or five servers, unchanged by calls', async () => {
    const one = new Harness({ servers: [server('one')] })
    expect([...one.tools.keys()]).toEqual([TOOLS_TOOL, CALL_TOOL])

    const five = new Harness({
      servers: ['a', 'b', 'c', 'd', 'e'].map((entry) => server(entry)),
    })
    expect([...five.tools.keys()]).toEqual([TOOLS_TOOL, CALL_TOOL])

    const before = one.schemas()
    await one.callTool(TOOLS_TOOL, { server: 'one' })
    await one.callTool(CALL_TOOL, { server: 'one', tool: 'alpha' })
    expect(one.schemas()).toStrictEqual(before)
  })
})
