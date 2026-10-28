import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/**
 * Lazy MCP: keeps stdio MCP servers dormant and reaches them through two fixed
 * proxy tools, so the model-facing tool set never grows with the server count.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-mcp-lazy";
/** Service the tool registrations depend on. */
export declare const inject: string[];
/** The only two model-facing tools; both exist for every configuration. */
export declare const TOOLS_TOOL = "mcp_tools";
export declare const CALL_TOOL = "mcp_call";
/** One dormant server, with the Harness MCP client's field names. */
export interface ServerConfig {
    serverName: string;
    transport?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    toolCallTimeoutMs?: number;
}
/** The row configuration the bundle accepts. */
export interface LazyConfig {
    servers?: ServerConfig[];
}
/** One tool as the server reports it. */
export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: unknown;
}
/** The part of a tool result this version projects. */
export interface McpCallResult {
    content?: readonly {
        type: string;
        text?: string;
    }[];
    isError?: boolean;
}
/** The narrow client surface the plugin drives; tests inject a fake. */
export interface McpClient {
    connect(transport: McpTransport): Promise<void>;
    listTools(): Promise<{
        tools: readonly McpTool[];
    }>;
    callTool(params: {
        name: string;
        arguments: Record<string, unknown>;
    }, options?: {
        timeout?: number;
        signal?: AbortSignal;
    }): Promise<McpCallResult>;
}
/** Process ownership lives in the transport: closing it terminates the process. */
export interface McpTransport {
    start(): Promise<void>;
    close(): Promise<void>;
}
/** Test seam: a fake client/transport pair never spawns a process. */
export interface ApplyOptions {
    createClient?: () => McpClient;
    createTransport?: (server: ServerConfig) => McpTransport;
    /** Test seam for the one-home check; `apply` derives the real one. */
    findStaticAdapter?: (serverName: string) => string | undefined;
}
/**
 * Validate the row configuration. Duplicates and non-stdio transports fail
 * composition here instead of failing on the first call; a missing executable
 * is not checked, so an absent server cannot keep the Harness from starting.
 */
export declare function parseServers(config: LazyConfig): ServerConfig[];
/**
 * Start every server on first use and keep it for the plugin's lifetime. One
 * slot per name keeps servers independent: a broken server never affects another.
 */
export declare class ServerPool {
    private readonly slots;
    private readonly createClient;
    private readonly createTransport;
    private readonly findStaticAdapter;
    constructor(servers: ServerConfig[], options: ApplyOptions);
    /** Configured names, in configuration order. */
    names(): string[];
    configFor(serverName: string): ServerConfig | undefined;
    /** The started client for one configured server, or a failure naming it. */
    clientFor(serverName: string): Promise<McpClient>;
    private start;
    /** Take the transport once and await its shared close, so no caller can skip pending cleanup. */
    private closeSlot;
    /** Terminate every started process; a pending initialization is cancelled by its close. */
    unload(): Promise<void>;
}
/** Both proxy tools, registered once per plugin instance. */
export declare function buildToolDefinitions(pool: ServerPool): ToolDefinition[];
/** Register the proxy tools and terminate every started server on unload. */
export declare function apply(ctx: Context, config?: LazyConfig, options?: ApplyOptions): void;
