import type { WorkflowHealth } from './health.js';
import type { Journal } from './journal.js';
import type { Trigger } from './triggers.js';
/**
 * The read-only Workflows API. Routes are registered through the carrier-neutral
 * `connection.fetch` registry the OpenSpec panel uses; the carrier owns owner
 * admission (a non-owner peer is refused before a handler runs), and every
 * handler below still accepts GET only and resolves the workspace from a live
 * session, never from request text.
 */
export declare const EVENTS_ROUTE = "/api/workflows/events";
export declare const RUNS_ROUTE = "/api/workflows/runs";
export declare const TRIGGERS_ROUTE = "/api/workflows/triggers";
export declare const HEALTH_ROUTE = "/api/workflows/health";
/** Default and maximum page sizes. */
export declare const DEFAULT_LIMIT = 50;
export declare const MAX_LIMIT = 200;
/** Every method the carrier must dispatch so a non-GET reaches the 405 guard. */
export declare const ROUTE_METHODS: readonly ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** One exact Fetch route of the Host Connection service. */
export interface FetchRoute {
    readonly path: string;
    readonly methods: readonly string[];
    readonly requestBody: 'buffered';
    fetch(request: Request): Promise<Response>;
}
/** The live-session lookup the routes resolve the workspace through. */
export interface SessionLookup {
    get(id: string): {
        readonly session: unknown;
    } | undefined;
}
export interface WorkflowApiServices {
    readonly agents: SessionLookup;
    readonly workingDirectory: {
        get(session: unknown): string;
    };
    readonly journal: Journal;
    readonly healthFor: (workspace: string) => WorkflowHealth;
    /** The requesting session's own last observed event time, if any. */
    readonly lastEventAtFor?: (session: string) => number | undefined;
    readonly triggers: readonly Trigger[];
}
/** Build the four read-only routes. */
export declare function createWorkflowRoutes(services: WorkflowApiServices): FetchRoute[];
/** Register the routes on the host's Fetch carrier; absent means no API. */
export declare function registerWorkflowRoutes(ctx: {
    get(name: string): unknown;
    effect(callback: () => () => void): () => void;
}, services: WorkflowApiServices): boolean;
