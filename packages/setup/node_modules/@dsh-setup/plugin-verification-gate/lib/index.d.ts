import type { Context } from '@deepseek-ai/cordis';
/**
 * Verification gate: a code-changing turn cannot close until one configured
 * check command has succeeded after the last `edit` or `write` result. It is a
 * Host-only observer: no prompt section, no tool, no skill. An empty command
 * list makes it inert.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-verification-gate";
/** No services are read directly; every hook is an event observer. */
export declare const inject: string[];
/** The single fragment row this bundle owns. */
export declare const ROW_ID = "dsh-setup-verification-gate";
/** Consecutive refusals allowed in one turn before the capped unverified close. */
export declare const DEFAULT_MAX_BLOCKS = 8;
/** Row configuration. Both fields are optional; absent means inert. */
export interface Config {
    /** Exact shell commands that satisfy the gate; empty or absent keeps it inert. */
    commands?: string[];
    /** Consecutive refusals allowed in one turn before the close is allowed (default 8). */
    maxBlocks?: number;
}
/** Fully resolved configuration. */
export interface ResolvedConfig {
    readonly commands: readonly string[];
    readonly maxBlocks: number;
}
/**
 * Validate the row configuration once, at load. An empty or absent `commands`
 * list is valid and leaves the gate inert; every malformed value throws.
 * @param raw - the loader-supplied config object, or undefined when the row has none.
 * @returns an immutable complete configuration.
 * @throws when a field is unknown, mistyped, or outside its accepted shape.
 */
export declare function resolveConfig(raw: unknown): ResolvedConfig;
/**
 * Install the gate. Configuration is validated first; an empty command list
 * registers nothing, so the shipped default changes no behavior.
 */
export declare function apply(ctx: Context, config?: Config): void;
