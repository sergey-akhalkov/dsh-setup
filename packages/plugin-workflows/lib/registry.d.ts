import { type Definition } from './definitions.js';
import { type Trigger } from './triggers.js';
/**
 * The host definition registry. The engine seeds it with its remaining shipped
 * definitions and generic triggers; an installed plugin contributes its
 * read-only definitions and shadow triggers through the same closed schemas.
 * No package directory is scanned and no profile path list is accepted.
 */
/** Where an installed definition came from. */
export type DefinitionSource = 'shipped' | 'plugin';
/** The engine's own source label for the definitions it ships. */
export declare const SHIPPED_SOURCE = "@dsh-setup/plugin-workflows";
export interface InstalledDefinition {
    readonly definition: Definition;
    readonly source: DefinitionSource;
    /** The contributing plugin package name; absent for a shipped definition. */
    readonly plugin?: string;
}
export interface InstalledTrigger {
    readonly trigger: Trigger;
    readonly source: DefinitionSource;
    /** The contributing plugin package name; absent for a shipped trigger. */
    readonly plugin?: string;
}
/** One plugin's read-only contribution; raw values are validated on register. */
export interface DefinitionsContribution {
    readonly source: string;
    readonly definitions?: readonly unknown[];
    readonly triggers?: readonly unknown[];
}
/** The host service a feature plugin receives as `workflowsDefinitions`. */
export interface WorkflowsDefinitionsService {
    register(contribution: DefinitionsContribution): () => void;
}
export declare class DefinitionsRegistry {
    private readonly contributions;
    private readonly shippedDefinitions;
    private readonly shippedTriggers;
    private seeded;
    private revisionNumber;
    /** The installed catalog revision; a change invalidates a cached load. */
    get revision(): number;
    /** Seed the engine's own assets once; a later call is a no-op. */
    seedShipped(definitions?: readonly Definition[], triggers?: readonly Trigger[]): void;
    private ensureSeeded;
    /** Every installed definition: shipped plus contributed, registration order. */
    definitions(): InstalledDefinition[];
    /** Every installed trigger: the generic catalog plus contributed entries. */
    triggers(): InstalledTrigger[];
    /** The installed definition with this id, or undefined. */
    installed(id: string): InstalledDefinition | undefined;
    /** The installed trigger with this id, or undefined. */
    installedTrigger(id: string): InstalledTrigger | undefined;
    /**
     * A definition id is global: a duplicate is refused naming both sources, and
     * a malformed contribution registers no part of itself.
     */
    register(contribution: DefinitionsContribution): () => void;
}
/**
 * The process-wide registry. The engine's host entry seeds and provides it; the
 * editor and API read the same merged catalog, and a test may register its own
 * contribution and dispose it.
 */
export declare const definitionsRegistry: DefinitionsRegistry;
