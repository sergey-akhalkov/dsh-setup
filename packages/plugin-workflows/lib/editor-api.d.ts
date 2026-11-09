import type { FetchRoute, SessionLookup } from './api.js';
import { installDefinition } from './approval-store.js';
import { type Definition } from './definitions.js';
import type { HostAuth } from './host-auth.js';
/**
 * The editor's workspace-scoped write API. The Host carrier dispatches exact
 * paths only, so the editor routes live under `/api/workflows/editor/` and name
 * one resource with an `id`/`name` query parameter instead of a path segment.
 * Every write validates against the engine's own schema and, for definitions,
 * goes through the shared install/approve function, so a saved definition is
 * active under the same rules as `/workflows install`.
 */
export declare const EDITOR_DEFINITIONS_ROUTE = "/api/workflows/editor/definitions";
export declare const EDITOR_DEFINITION_ROUTE = "/api/workflows/editor/definition";
export declare const EDITOR_TEMPLATES_ROUTE = "/api/workflows/editor/templates";
export declare const EDITOR_DRAFTS_ROUTE = "/api/workflows/editor/drafts";
export declare const EDITOR_DRAFT_ROUTE = "/api/workflows/editor/draft";
export declare const EDITOR_LAYOUT_ROUTE = "/api/workflows/editor/layout";
export declare const LAYOUT_VERSION = 1;
export declare const LAYOUT_DIRECTORY: readonly [".dsh", "workflows", "layout"];
export interface LayoutPosition {
    readonly x: number;
    readonly y: number;
}
/** The editor-owned position sidecar; the engine never reads it. */
export interface LayoutSidecar {
    readonly v: typeof LAYOUT_VERSION;
    readonly id: string;
    readonly positions: Readonly<Record<string, LayoutPosition>>;
}
export type DefinitionSource = 'shipped' | 'local';
export interface EditorDefinitionEntry {
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly stepCount: number;
    readonly source: DefinitionSource;
    /** The SHA-256 of the exact local file bytes; null for a shipped template. */
    readonly revision: string | null;
}
export interface DefinitionDocument {
    readonly definition: Definition;
    readonly revision: string | null;
    readonly source: DefinitionSource;
}
export interface TemplateEntry extends EditorDefinitionEntry {
    readonly definition: Definition;
}
export interface DraftEntry {
    readonly name: string;
    readonly id: string;
    readonly title: string;
    readonly stepCount: number;
}
export interface EditorApiServices {
    readonly agents: SessionLookup;
    readonly workingDirectory: {
        get(session: unknown): string;
    };
    /** The host key used by the shared install/approve function. */
    readonly auth: () => Promise<HostAuth | undefined>;
    /** Test seam: the shared install/approve function. */
    readonly install?: typeof installDefinition;
}
/** The workspace layout sidecar directory. */
export declare function layoutDirectory(workspace: string): string;
/** The layout sidecar path for one definition id. */
export declare function layoutPath(workspace: string, id: string): string;
/** The revision of a resource is the SHA-256 of its exact file bytes. */
export declare function revisionOf(bytes: Buffer | string): string;
/** Map the validator's `field "x" ...` message back to a structured error. */
export declare function definitionErrors(error: unknown): {
    path: string;
    message: string;
}[];
/** Validate a layout sidecar; the engine ignores it, the editor must not crash on it. */
export declare function validateLayout(raw: unknown, id: string): LayoutSidecar;
/** Build the editor write routes; the caller registers them on the carrier. */
export declare function createEditorRoutes(services: EditorApiServices): FetchRoute[];
/** Register the editor routes on the Host Fetch carrier; absent means no writes. */
export declare function registerEditorRoutes(ctx: {
    get(name: string): unknown;
    effect(callback: () => () => void): () => void;
}, services: EditorApiServices): boolean;
