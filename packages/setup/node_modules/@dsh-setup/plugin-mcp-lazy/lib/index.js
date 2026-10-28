import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
/**
 * Lazy MCP: keeps stdio MCP servers dormant and reaches them through two fixed
 * proxy tools, so the model-facing tool set never grows with the server count.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-mcp-lazy';
/** Service the tool registrations depend on. */
export const inject = ['tools'];
/** The only two model-facing tools; both exist for every configuration. */
export const TOOLS_TOOL = 'mcp_tools';
export const CALL_TOOL = 'mcp_call';
/** Client identity sent in the MCP handshake. */
const CLIENT_INFO = { name, version: '0.7.0' };
function defaultCreateClient() {
    // The SDK's client and transport types are wider than the surface used here.
    return new Client(CLIENT_INFO);
}
function defaultCreateTransport(server) {
    return new StdioClientTransport({
        command: server.command,
        ...(server.args === undefined ? {} : { args: server.args }),
        ...(server.env === undefined ? {} : { env: server.env }),
        ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Harness package that mounts a static MCP adapter row. */
const STATIC_ADAPTER_NAME = '@deepseek-ai/dsh-mcp-client';
/** Read the loader service without importing its package; it is not a plugin peer. */
function loaderOf(ctx) {
    const get = ctx.get;
    if (typeof get !== 'function')
        return undefined;
    const loader = get.call(ctx, 'loader');
    if (!isRecord(loader) || typeof loader.entries !== 'function')
        return undefined;
    return loader;
}
/** Resolve a config value that the loader kept as a `!!js` expression. */
function evaluateValue(entry, value) {
    if (isRecord(value) && typeof value.__jsExpr === 'string' && typeof entry.evaluate === 'function') {
        try {
            return entry.evaluate(value.__jsExpr);
        }
        catch {
            return undefined;
        }
    }
    return value;
}
/** The enabled static adapter row for one server, whether or not its tools exist yet. */
function staticAdapterRow(loader, serverName) {
    if (loader === undefined)
        return undefined;
    try {
        for (const entry of loader.entries()) {
            if (entry.disabled || entry.options.name !== STATIC_ADAPTER_NAME)
                continue;
            const config = evaluateValue(entry, entry.options.config);
            if (!isRecord(config))
                continue;
            if (evaluateValue(entry, config.serverName) === serverName)
                return entry.options.id;
        }
    }
    catch {
        // A loader that cannot enumerate is not a conflict signal.
    }
    return undefined;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** The tool result's text blocks, joined in order. */
function textOf(result) {
    return (result.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join('\n');
}
/**
 * Validate the row configuration. Duplicates and non-stdio transports fail
 * composition here instead of failing on the first call; a missing executable
 * is not checked, so an absent server cannot keep the Harness from starting.
 */
export function parseServers(config) {
    const servers = config.servers ?? [];
    if (!Array.isArray(servers))
        throw new Error('lazy MCP: "servers" must be a list');
    const seen = new Set();
    for (const server of servers) {
        if (!isRecord(server))
            throw new Error('lazy MCP: every "servers" entry must be a mapping');
        const serverName = server.serverName;
        if (typeof serverName !== 'string' || serverName.trim() === '') {
            throw new Error('lazy MCP: every "servers" entry needs a non-empty "serverName"');
        }
        if (seen.has(serverName)) {
            throw new Error(`lazy MCP: server "${serverName}" is configured twice; one server needs one home`);
        }
        seen.add(serverName);
        const transport = server.transport ?? 'stdio';
        if (transport !== 'stdio') {
            throw new Error(`lazy MCP: server "${serverName}" uses transport "${String(transport)}", but only "stdio" is supported`);
        }
        if (typeof server.command !== 'string' || server.command.trim() === '') {
            throw new Error(`lazy MCP: server "${serverName}" needs a non-empty "command"`);
        }
    }
    return servers;
}
/**
 * The MCP client closes its transport itself on a failed handshake or a read
 * overflow, without awaiting it. Replace the instance's close with one shared
 * promise, so those internal `this.close()` calls and unload wait for the same
 * termination instead of observing an already-cleared transport.
 */
function shareClose(transport) {
    const originalClose = transport.close.bind(transport);
    let closing;
    transport.close = () => {
        closing ??= Promise.resolve().then(async () => {
            try {
                await originalClose();
            }
            catch {
                // A transport that cannot close cleanly is already gone.
            }
        });
        return closing;
    };
    return transport;
}
/**
 * Start every server on first use and keep it for the plugin's lifetime. One
 * slot per name keeps servers independent: a broken server never affects another.
 */
export class ServerPool {
    slots = new Map();
    createClient;
    createTransport;
    findStaticAdapter;
    constructor(servers, options) {
        this.createClient = options.createClient ?? defaultCreateClient;
        this.createTransport = options.createTransport ?? defaultCreateTransport;
        this.findStaticAdapter = options.findStaticAdapter ?? (() => undefined);
        for (const config of servers)
            this.slots.set(config.serverName, { config, disposed: false });
    }
    /** Configured names, in configuration order. */
    names() {
        return [...this.slots.keys()];
    }
    configFor(serverName) {
        return this.slots.get(serverName)?.config;
    }
    /** The started client for one configured server, or a failure naming it. */
    async clientFor(serverName) {
        const slot = this.slots.get(serverName);
        if (slot === undefined) {
            const configured = this.names();
            throw new Error(`lazy MCP: unknown server "${serverName}"; configured servers: ${configured.length === 0 ? '(none)' : configured.join(', ')}`);
        }
        if (slot.disposed) {
            throw new Error(`lazy MCP: server "${serverName}" is unavailable: the plugin unloaded`);
        }
        const conflict = this.findStaticAdapter(serverName);
        if (conflict !== undefined) {
            throw new Error(`lazy MCP: server "${serverName}" is also mounted as a static adapter (${conflict}); keep one home`);
        }
        if (slot.client !== undefined)
            return slot.client;
        if (slot.starting === undefined)
            slot.starting = this.start(slot);
        return slot.starting;
    }
    async start(slot) {
        const serverName = slot.config.serverName;
        const transport = shareClose(this.createTransport(slot.config));
        slot.transport = transport;
        const client = this.createClient();
        try {
            await client.connect(transport);
        }
        catch (error) {
            await this.closeSlot(slot);
            slot.starting = undefined;
            if (slot.disposed) {
                throw new Error(`lazy MCP: server "${serverName}" was unloaded during initialization`);
            }
            throw new Error(`lazy MCP: server "${serverName}" failed to start: ${messageOf(error)}`);
        }
        if (slot.disposed) {
            await this.closeSlot(slot);
            slot.starting = undefined;
            throw new Error(`lazy MCP: server "${serverName}" was unloaded during initialization`);
        }
        slot.client = client;
        return client;
    }
    /** Take the transport once and await its shared close, so no caller can skip pending cleanup. */
    async closeSlot(slot) {
        const transport = slot.transport;
        slot.transport = undefined;
        if (transport === undefined)
            return;
        await transport.close();
    }
    /** Terminate every started process; a pending initialization is cancelled by its close. */
    async unload() {
        for (const slot of this.slots.values())
            slot.disposed = true;
        await Promise.allSettled([...this.slots.values()].map(async (slot) => {
            await this.closeSlot(slot);
        }));
        await Promise.allSettled([...this.slots.values()].map(async (slot) => {
            await slot.starting;
        }));
    }
}
/** Read a required string argument. */
function stringArg(args, field) {
    const value = isRecord(args) ? args[field] : undefined;
    if (typeof value !== 'string' || value === '') {
        throw new Error(`lazy MCP: "${field}" must be a non-empty string argument`);
    }
    return value;
}
const OUTPUT = {
    schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
    },
    render: (_args, value) => [
        {
            type: 'text',
            text: isRecord(value) && typeof value.text === 'string' ? value.text : String(value),
        },
    ],
};
/** Both proxy tools, registered once per plugin instance. */
export function buildToolDefinitions(pool) {
    const configured = pool.names();
    const serverHint = configured.length === 0
        ? 'No MCP servers are configured; ask the user to add one to the bundle configuration.'
        : `Configured servers: ${configured.join(', ')}.`;
    return [
        {
            name: TOOLS_TOOL,
            description: `List one dormant MCP server's tools with their JSON schemas. Use this before ${CALL_TOOL}. ${serverHint}`,
            parameters: {
                type: 'object',
                properties: {
                    server: {
                        type: 'string',
                        description: 'Configured MCP server name.',
                    },
                    query: {
                        type: 'string',
                        description: 'Optional case-insensitive filter over tool names and descriptions.',
                    },
                },
                required: ['server'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const serverName = stringArg(args, 'server');
                const query = isRecord(args) && typeof args.query === 'string' ? args.query : undefined;
                const client = await pool.clientFor(serverName);
                const listed = await client.listTools();
                const needle = query?.toLowerCase();
                const tools = listed.tools
                    .filter((tool) => needle === undefined ||
                    tool.name.toLowerCase().includes(needle) ||
                    (tool.description ?? '').toLowerCase().includes(needle))
                    .map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                }));
                return { text: JSON.stringify({ server: serverName, tools }, null, 2) };
            },
        },
        {
            name: CALL_TOOL,
            description: `Call one tool on a dormant MCP server. ${serverHint}`,
            parameters: {
                type: 'object',
                properties: {
                    server: {
                        type: 'string',
                        description: 'Configured MCP server name.',
                    },
                    tool: {
                        type: 'string',
                        description: 'Tool name, as listed by mcp_tools.',
                    },
                    args: {
                        type: 'object',
                        description: 'Tool arguments, matching the tool schema.',
                        additionalProperties: true,
                    },
                },
                required: ['server', 'tool'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args, exec) => {
                const serverName = stringArg(args, 'server');
                const toolName = stringArg(args, 'tool');
                const client = await pool.clientFor(serverName);
                const toolArguments = isRecord(args) && isRecord(args.args) ? args.args : {};
                const timeout = pool.configFor(serverName)?.toolCallTimeoutMs;
                const result = await client.callTool({ name: toolName, arguments: toolArguments }, { ...(timeout === undefined ? {} : { timeout }), signal: exec.signal });
                const text = textOf(result);
                if (result.isError === true) {
                    throw new Error(`lazy MCP: server "${serverName}" reported an error calling "${toolName}": ${text}`);
                }
                return { text };
            },
        },
    ];
}
/** Register the proxy tools and terminate every started server on unload. */
export function apply(ctx, config = {}, options = {}) {
    const loader = loaderOf(ctx);
    const findStaticAdapter = options.findStaticAdapter ??
        ((serverName) => {
            const row = staticAdapterRow(loader, serverName);
            if (row !== undefined)
                return `static adapter row "${row}"`;
            const prefix = `mcp__${serverName}__`;
            const tool = ctx.tools.schemas().find((schema) => schema.name.startsWith(prefix));
            return tool === undefined ? undefined : `tool "${tool.name}"`;
        });
    const pool = new ServerPool(parseServers(config), { ...options, findStaticAdapter });
    for (const definition of buildToolDefinitions(pool))
        ctx.tools.register(definition);
    ctx.effect(() => async () => {
        await pool.unload();
    });
}
