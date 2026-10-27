import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
/** Windows administrator indicator for the Desktop app. */
export declare const name = "@dsh-setup/plugin-admin-indicator";
/** The status route is served by the Web host; the shortcut is an authenticated POST. */
export declare const inject: string[];
/** Read-only elevation status used by the composer indicator. */
export declare const STATUS_PATH = "/plugins/dsh-setup-admin-indicator/status";
/** Authenticated shortcut action used by the composer menu. */
export declare const SHORTCUT_PATH = "/plugins/dsh-setup-admin-indicator/shortcut";
/** Authenticated session command that creates the administrator shortcut. */
export declare const SHORTCUT_COMMAND = "admin-shortcut";
/** Authenticated session command that restarts DSH elevated. */
export declare const RESTART_COMMAND = "admin-restart";
interface ConnectionService {
    requestRejection(request: {
        headers: IncomingMessage['headers'];
    }): 401 | 403 | undefined;
}
interface HostContext extends Context {
    connection: ConnectionService;
}
/** Row configuration. The restart action is opt-in until its live UAC check passes. */
export interface Config {
    restart?: boolean;
}
/** Fully resolved configuration. */
export interface ResolvedConfig {
    readonly restart: boolean;
}
export declare const DEFAULT_CONFIG: ResolvedConfig;
/** Apply the documented default; reject a mistyped flag instead of guessing. */
export declare function resolveConfig(raw: unknown): ResolvedConfig;
/** Register the read-only status endpoint, authenticated shortcut, and session commands. */
export declare function apply(ctx: HostContext, rawConfig?: unknown): void;
/** The registered route shape, exported for the contract test. */
export type { WebRoute };
