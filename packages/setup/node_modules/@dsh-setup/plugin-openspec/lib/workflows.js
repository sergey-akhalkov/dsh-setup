import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * OpenSpec plugin: contributes the `change-intake` definition and the four
 * OpenSpec shadow triggers to the optional workflows engine. The assets are
 * read-only; editing one creates a workspace-local copy through the engine's
 * editor and approval flow, never a plugin write.
 */
/** Cordis plugin name, equal to the package name; also the contribution source. */
export const WORKFLOWS_SOURCE = '@dsh-setup/plugin-openspec';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`${WORKFLOWS_SOURCE}: ${file} could not be read: ${cause}`);
    }
}
/**
 * The plugin's workflow asset directory. Like the engine's own assets it
 * resolves from both layouts: `src/host` during a source test (two levels to
 * the package root) and `lib` after compilation (one level).
 */
function workflowsDirectory() {
    const candidates = [
        fileURLToPath(new URL('../../assets/workflows', import.meta.url)),
        fileURLToPath(new URL('../assets/workflows', import.meta.url)),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined) {
        throw new Error(`${WORKFLOWS_SOURCE}: workflow assets were not found at ${candidates.join(' or ')}`);
    }
    return found;
}
/**
 * Read both assets eagerly so a malformed file fails the plugin load with its
 * path. Only the outer shape is checked here: the engine's closed schema
 * validates each definition and trigger and refuses an invalid one by field.
 */
export function readWorkflowContribution() {
    const directory = workflowsDirectory();
    const definitionFile = join(directory, 'change-intake.json');
    const definition = readJson(definitionFile);
    if (!isRecord(definition)) {
        throw new Error(`${WORKFLOWS_SOURCE}: workflow definition ${definitionFile} must be a JSON object`);
    }
    const triggersFile = join(directory, 'triggers.json');
    const catalog = readJson(triggersFile);
    if (!isRecord(catalog) || !Array.isArray(catalog.triggers)) {
        throw new Error(`${WORKFLOWS_SOURCE}: workflow trigger catalog ${triggersFile} must carry a triggers array`);
    }
    return { source: WORKFLOWS_SOURCE, definitions: [definition], triggers: catalog.triggers };
}
/**
 * Register the contribution when the engine's registry service exists. A host
 * without `inject`, or a profile without the workflows plugin, registers
 * nothing and keeps the panel, picker, and skill surfaces working.
 */
export function registerWorkflowsContribution(ctx) {
    const contribution = readWorkflowContribution();
    if (typeof ctx.inject !== 'function')
        return;
    ctx.inject(['workflowsDefinitions'], (serviceCtx) => {
        const registry = serviceCtx.get('workflowsDefinitions');
        if (registry === undefined || typeof registry.register !== 'function')
            return;
        const register = () => registry.register(contribution);
        if (typeof serviceCtx.effect === 'function') {
            serviceCtx.effect(register);
        }
        else {
            // A minimal host stub exposes get() only; registering is still safe.
            register();
        }
    });
}
