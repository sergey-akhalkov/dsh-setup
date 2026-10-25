import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Nuphus plugin: the adapter row mounts the Harness MCP client from the
 * composition fragment, and this module contributes the guidance skill that
 * describes how to drive the desktop and browser tools it exposes. The two rows
 * are independent, so disabling this one leaves the Nuphus tools working.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-nuphus-mcp';
/** Service the registration depends on. */
export const inject = ['skills'];
/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'nuphus-discipline';
/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-nuphus';
/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600;
/** Catalog text; a test keeps it identical to the asset's frontmatter. */
const SKILL_DESCRIPTION = 'Nuphus browser work: a fresh snapshot after every navigation, per-step success and detail inspection, redo only the failed step, DOM extraction for values and screenshots only for visual questions, and batching up to the next checkpoint.';
const assetsDirectory = fileURLToPath(new URL('../assets/nuphus-discipline', import.meta.url));
const skillFile = join(assetsDirectory, 'SKILL.md');
const invocation = { modelInvocable: true, userInvocable: true };
function skillAdapterNote() {
    return [
        '',
        '',
        '---',
        '',
        "DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-nuphus-mcp as first-party guidance adapted for this Harness; it is not pinned upstream text. The Nuphus MCP server itself is configured by the bundle's separate adapter row and keeps working when this guidance row is disabled.",
    ].join('\n');
}
/** Build the provider that lists one candidate and reads its body on demand. */
function createSkillProvider(note) {
    const candidate = {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: assetsDirectory.replaceAll('\\', '/') },
        rank: BUNDLED_SKILL_RANK,
        locator: skillFile,
    };
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve([candidate]),
        async get(loaded, options) {
            if (loaded.name !== SKILL_NAME)
                return undefined;
            const body = await readFile(skillFile, { encoding: 'utf8', signal: options.signal });
            return {
                name: SKILL_NAME,
                description: SKILL_DESCRIPTION,
                invocation,
                provider: PROVIDER_NAME,
                source: 'bundled',
                resourceBase: candidate.resourceBase,
                content: `${body}${note}`,
            };
        },
    };
}
/** Register the on-demand skill; the adapter row mounts separately. */
export function apply(ctx) {
    ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()));
}
