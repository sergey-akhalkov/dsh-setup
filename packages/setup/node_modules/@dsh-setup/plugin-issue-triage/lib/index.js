import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Issue-triage plugin: registers the opt-in `issue-triage` skill in the catalog.
 * The method body ships beside the built module, so listing and loading never
 * touch the network. Nothing is always-on.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-issue-triage';
/** Service the registration depends on. */
export const inject = ['skills'];
/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'issue-triage';
/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-issue-triage';
/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600;
/** Catalog text; a test keeps it identical to the asset's frontmatter. */
const SKILL_DESCRIPTION = 'Issue triage: turns open GitHub issues into evidence-backed verdicts, closes duplicates and already-fixed issues with a comment, clusters the valid ones into at most three change drafts, and reports one summary table. Opt-in; lead-only GitHub writes. Needs the gh CLI and the OpenSpec CLI.';
const assetsDirectory = fileURLToPath(new URL('../assets/issue-triage', import.meta.url));
const skillFile = join(assetsDirectory, 'SKILL.md');
const invocation = { modelInvocable: true, userInvocable: true };
function skillAdapterNote() {
    return [
        '',
        '',
        '---',
        '',
        'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-issue-triage as first-party guidance for this Harness; it is not pinned upstream text. It runs `gh` and the `openspec` CLI from PATH.',
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
/** Register the on-demand skill; no system-prompt or tool contribution. */
export function apply(ctx) {
    ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()));
}
