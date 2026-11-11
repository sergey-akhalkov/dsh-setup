import { loadShippedDefinitions, validateDefinition } from './definitions.js';
import { loadCatalog, validateCatalog } from './triggers.js';
/** The engine's own source label for the definitions it ships. */
export const SHIPPED_SOURCE = '@dsh-setup/plugin-workflows';
function ownerLabel(entry) {
    return entry.source === 'plugin' ? (entry.plugin ?? 'a plugin') : SHIPPED_SOURCE;
}
export class DefinitionsRegistry {
    contributions = new Map();
    shippedDefinitions = new Map();
    shippedTriggers = new Map();
    seeded = false;
    revisionNumber = 0;
    /** The installed catalog revision; a change invalidates a cached load. */
    get revision() {
        return this.revisionNumber;
    }
    /** Seed the engine's own assets once; a later call is a no-op. */
    seedShipped(definitions = loadShippedDefinitions(), triggers = loadCatalog()) {
        if (this.seeded)
            return;
        this.seeded = true;
        for (const definition of definitions) {
            this.shippedDefinitions.set(definition.id, { definition, source: 'shipped' });
        }
        for (const trigger of triggers) {
            this.shippedTriggers.set(trigger.id, { trigger, source: 'shipped' });
        }
        this.revisionNumber += 1;
    }
    ensureSeeded() {
        if (!this.seeded)
            this.seedShipped();
    }
    /** Every installed definition: shipped plus contributed, registration order. */
    definitions() {
        this.ensureSeeded();
        const entries = [...this.shippedDefinitions.values()];
        for (const contribution of this.contributions.values()) {
            for (const definition of contribution.definitions) {
                entries.push({ definition, source: 'plugin', plugin: contribution.source });
            }
        }
        return entries;
    }
    /** Every installed trigger: the generic catalog plus contributed entries. */
    triggers() {
        this.ensureSeeded();
        const entries = [...this.shippedTriggers.values()];
        for (const contribution of this.contributions.values()) {
            for (const trigger of contribution.triggers) {
                entries.push({ trigger, source: 'plugin', plugin: contribution.source });
            }
        }
        return entries;
    }
    /** The installed definition with this id, or undefined. */
    installed(id) {
        return this.definitions().find((entry) => entry.definition.id === id);
    }
    /** The installed trigger with this id, or undefined. */
    installedTrigger(id) {
        return this.triggers().find((entry) => entry.trigger.id === id);
    }
    /**
     * A definition id is global: a duplicate is refused naming both sources, and
     * a malformed contribution registers no part of itself.
     */
    register(contribution) {
        this.ensureSeeded();
        const source = contribution.source;
        if (typeof source !== 'string' || source.trim() === '') {
            throw new Error('workflow contribution: source must be a non-empty plugin name');
        }
        const rawDefinitions = contribution.definitions ?? [];
        const rawTriggers = contribution.triggers ?? [];
        if (!Array.isArray(rawDefinitions)) {
            throw new Error(`workflow contribution from "${source}": definitions must be a list`);
        }
        if (!Array.isArray(rawTriggers)) {
            throw new Error(`workflow contribution from "${source}": triggers must be a list`);
        }
        let definitions;
        let triggers;
        try {
            definitions = rawDefinitions.map((raw) => validateDefinition(raw, source));
            triggers = validateCatalog({ triggers: rawTriggers });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`workflow contribution from "${source}" was refused: ${message}`);
        }
        const batchDefinitions = new Set();
        for (const definition of definitions) {
            if (batchDefinitions.has(definition.id)) {
                throw new Error(`workflow definition "${definition.id}" is declared twice in the contribution from "${source}"; the contribution was refused`);
            }
            batchDefinitions.add(definition.id);
            const existing = this.installed(definition.id);
            if (existing !== undefined) {
                throw new Error(`workflow definition "${definition.id}" is already installed by ${ownerLabel(existing)}; the contribution from "${source}" was refused`);
            }
        }
        const batchTriggers = new Set();
        for (const trigger of triggers) {
            if (batchTriggers.has(trigger.id)) {
                throw new Error(`workflow trigger "${trigger.id}" is declared twice in the contribution from "${source}"; the contribution was refused`);
            }
            batchTriggers.add(trigger.id);
            const existing = this.installedTrigger(trigger.id);
            if (existing !== undefined) {
                throw new Error(`workflow trigger "${trigger.id}" is already installed by ${ownerLabel(existing)}; the contribution from "${source}" was refused`);
            }
        }
        const key = Symbol(source);
        this.contributions.set(key, { source, definitions, triggers });
        this.revisionNumber += 1;
        let disposed = false;
        return () => {
            if (disposed)
                return;
            disposed = true;
            if (this.contributions.delete(key))
                this.revisionNumber += 1;
        };
    }
}
/**
 * The process-wide registry. The engine's host entry seeds and provides it; the
 * editor and API read the same merged catalog, and a test may register its own
 * contribution and dispose it.
 */
export const definitionsRegistry = new DefinitionsRegistry();
