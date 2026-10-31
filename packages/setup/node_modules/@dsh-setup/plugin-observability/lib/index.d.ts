import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { type Range } from './aggregate.js';
import { SessionCache } from './cache.js';
import { type PluginConfig } from './config.js';
import { type SessionQueryService } from './reader.js';
import { type Report } from './report.js';
/** Observability: signal counts derived from the session event logs. */
export declare const name = "@dsh-setup/plugin-observability";
/** Services the report route reads through. */
export declare const inject: string[];
/** Read-only report route used by the view. */
export declare const REPORT_PATH = "/plugins/dsh-setup-observability/report";
/** Row configuration: declarative signal and guidance rows only. */
export interface Config {
    readonly rows?: unknown;
    readonly idleGapMinutes?: unknown;
    readonly minEpisodes?: unknown;
    readonly hypotheses?: unknown;
    /** Optional ISO date splitting the process panel before and after. */
    readonly interventionAt?: unknown;
}
interface ConnectionService {
    requestRejection(request: {
        headers: IncomingMessage['headers'];
    }): 401 | 403 | undefined;
}
interface ToolRegistry {
    schemas(): readonly {
        name: string;
    }[];
}
interface HostContext extends Context {
    connection: ConnectionService;
    tools: ToolRuntime;
}
/** Compute one report for a validated range, with its baseline comparison. */
export declare function computeReport(ctx: {
    readonly sessionQuery: SessionQueryService;
    readonly tools: ToolRegistry;
    readonly reflect?: {
        get(name: string): unknown;
    };
}, range: Range, sessionId: SessionId | undefined, now: number, cache: SessionCache, config: PluginConfig, 
/** Evaluate hypotheses here; a plain view request skips their extra windows. */
includeHypotheses?: boolean): Promise<Report>;
/** Register the read-only report route. */
export declare function apply(ctx: HostContext, rawConfig?: Config): void;
export {};
