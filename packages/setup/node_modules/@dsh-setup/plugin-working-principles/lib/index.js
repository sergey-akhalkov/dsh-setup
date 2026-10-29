import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Working-principles plugin: registers a first-party working contract as an
 * always-on system-prompt section and lists on-demand skills beside it.
 *
 * Both contributions read the vendored assets that ship inside the package, so
 * installation, catalog listing, and prompt assembly never touch the network.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-working-principles';
/** Services both registrations depend on. */
export const inject = ['skills', 'systemPrompt'];
/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-working-principles';
/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600;
/** Namespaced prompt-section name, unique inside the system-prompt registry. */
const SECTION_NAME = 'dsh-setup:working-principles';
/** Directly after the packaged lazy-dev ruleset (`100`), before plan policy (`500`). */
const SECTION_ORDER = 110;
const assetsDirectory = fileURLToPath(new URL('../assets', import.meta.url));
const contractFile = join(assetsDirectory, 'working-principles', 'contract.md');
/**
 * Descriptions live here because the catalog needs them before any body loads;
 * a test keeps them identical to each asset's frontmatter.
 */
const SKILLS = [
    {
        name: 'working-principles',
        description: 'Load when the always-on working contract needs its rationale: designing, reviewing a plan, judging whether work is finished, or resolving a scope disagreement.',
        directory: 'working-principles',
    },
    {
        name: 'verify-change',
        description: 'Verify a change before calling it done: reproduce the failure first, reduce one dimension at a time, and judge a run by whether its original trigger fired. Use for bug fixes, regressions, flaky tests, or any claim that a fix works.',
        directory: 'verify-change',
    },
    {
        name: 'instruction-budget',
        description: 'Audit a workspace instruction file against its documented byte budget and move duplicated or repository-level detail into the docs that own it. Use when AGENTS.md (or an equivalent file) is over budget, feels too long, or a rule keeps being skipped because it is buried in prose.',
        directory: 'instruction-budget',
    },
];
function skillAdapterNote() {
    return [
        '',
        '',
        '---',
        '',
        'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-working-principles as first-party guidance adapted for this Harness; it is not pinned upstream text. The full contract is `working-principles/contract.md` in the same package.',
    ].join('\n');
}
function alwaysOnFooter() {
    return [
        '',
        '',
        '---',
        '',
        'Always-on note: this working contract ships with @dsh-setup/plugin-working-principles and applies by default in this deployment. Say "stop working principles" or "normal mode" to suspend it for the rest of the session. Turn the section off permanently with `alwaysOn: false` on the row. It does not restate the installed lazy-dev ruleset, which remains in force.',
    ].join('\n');
}
/** Build the provider that lists both candidates and reads a body on demand. */
function createSkillProvider(note) {
    const invocation = { modelInvocable: true, userInvocable: true };
    const candidates = SKILLS.map((skill) => {
        const directory = join(assetsDirectory, skill.directory);
        return {
            name: skill.name,
            description: skill.description,
            invocation,
            provider: PROVIDER_NAME,
            source: 'bundled',
            resourceBase: { kind: 'directory', path: directory.replaceAll('\\', '/') },
            rank: BUNDLED_SKILL_RANK,
            locator: join(directory, 'SKILL.md'),
        };
    });
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve(candidates),
        async get(loaded, options) {
            const index = SKILLS.findIndex((skill) => skill.name === loaded.name);
            const skill = SKILLS[index];
            const candidate = candidates[index];
            if (skill === undefined || candidate === undefined)
                return undefined;
            const body = await readFile(join(assetsDirectory, skill.directory, 'SKILL.md'), {
                encoding: 'utf8',
                signal: options.signal,
            });
            return {
                name: skill.name,
                description: skill.description,
                invocation,
                provider: PROVIDER_NAME,
                source: 'bundled',
                resourceBase: candidate.resourceBase,
                content: `${body}${note}`,
            };
        },
    };
}
/** Register the working contract as a literal system-prompt section. */
function registerContract(ctx) {
    const contract = readFileSync(contractFile, 'utf8');
    const section = {
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: `${contract}${alwaysOnFooter()}`,
        interpolate: false,
    };
    ctx.systemPrompt.section(section);
}
/**
 * Register both skills and, unless the row configures `alwaysOn: false`, the
 * always-on contract.
 */
export function apply(ctx, config = {}) {
    ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()));
    if (config.alwaysOn !== false)
        registerContract(ctx);
}
