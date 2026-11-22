import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
/**
 * English catalog entry for the pinned third-party `huashu-design` skill.
 *
 * The upstream package is Chinese-only: the description in its SKILL.md
 * frontmatter is the catalog line, and its trigger words are Chinese, so an
 * English or Russian request does not route to it. This provider supplies an
 * English description and English trigger words, and loads the installed
 * upstream body unchanged with a separate English working-language directive
 * appended.
 *
 * It ships no upstream bytes. The package is read from the profile at runtime,
 * and the entry disappears when that package is absent, so the installer's
 * pinned fetch stays the only source of the skill.
 */
export const name = '@dsh-setup/plugin-huashu-design';
export const inject = ['skills'];
/** Skill name the upstream package declares and this provider replaces in the catalog. */
const SKILL_NAME = 'huashu-design';
/** Provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-huashu-design';
/**
 * Rank between a user skill (`USER_AGENTS_RANK` 500 in the filesystem provider)
 * and the bundled root (`BUNDLED_SKILL_RANK` 600): a local copy of the skill
 * still wins, while the upstream bundled candidate is shadowed.
 */
const SKILL_RANK = 550;
/** Upstream package name, resolved from the profile that installed it. */
const UPSTREAM_PACKAGE = 'huashu-design';
/**
 * English description mirroring the upstream v3.5.0 frontmatter: its scope and
 * its trigger words. Keep it in step with the pinned upstream version.
 */
export const DESCRIPTION = 'Huashu Design — HTML-native design work: high-fidelity prototypes, slide decks, animation and video, infographics, and expert design review. Every new design first drafts three directions for the user to choose (a named style or brand is no exemption), then executes the chosen one. Triggers: build a prototype, app prototype, mini-program, App Store artwork or store screenshots, deck, slides, animation, design style, review this design, build an HTML page, UI mockup, export MP4 or GIF, make it look good. Not for production web apps or systems that need a backend.';
/** Appended after the upstream body, which stays exactly as written. */
export const ADAPTER_NOTE = [
    '',
    '',
    '---',
    '',
    "DeepSeek Harness adapter: the upstream instruction in this skill is written in Chinese and remains the authority for the work. Talk to the user in the user's own language, and write the deliverable's own copy in English unless the user asks for another language. Relative paths in the instruction resolve against this skill's base directory, which holds the upstream `references/`, `assets/`, and `scripts/`.",
].join('\n');
/**
 * The installed upstream package directory, or undefined when the profile does
 * not have it. Resolution starts from this module, which is enough for a profile
 * that copied the setup in; a profile that links a checkout keeps this module
 * outside its own tree, so the profile directory — and then the Harness home and
 * profile name — are tried as anchors too.
 */
export function resolveUpstreamDirectory(env = process.env) {
    const anchors = [import.meta.url];
    if (env.DSH_PROFILE_DIR)
        anchors.push(join(env.DSH_PROFILE_DIR, 'package.json'));
    if (env.DSH_HOME && env.DSH_PROFILE) {
        anchors.push(join(env.DSH_HOME, 'profiles', env.DSH_PROFILE, 'package.json'));
    }
    for (const anchor of anchors) {
        try {
            return dirname(createRequire(anchor).resolve(`${UPSTREAM_PACKAGE}/package.json`));
        }
        catch {
            // The next anchor describes the same profile from another side.
        }
    }
    return undefined;
}
/** Drop the upstream YAML frontmatter: this provider supplies its own metadata. */
export function stripFrontmatter(text) {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/u, '');
}
/** Build the provider for one installed upstream directory. */
export function createSkillProvider(directory) {
    const locator = join(directory, 'SKILL.md');
    const candidate = {
        name: SKILL_NAME,
        description: DESCRIPTION,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: PROVIDER_NAME,
        rank: SKILL_RANK,
        locator,
        resourceBase: { kind: 'directory', path: directory.replaceAll('\\', '/') },
    };
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve([candidate]),
        async get(loaded, options) {
            if (loaded.name !== SKILL_NAME)
                return undefined;
            const body = await readFile(locator, { encoding: 'utf8', signal: options.signal });
            return { ...candidate, content: `${stripFrontmatter(body)}${ADAPTER_NOTE}` };
        },
    };
}
/** Register the catalog entry; it lists nothing until the upstream package is installed. */
export function apply(ctx) {
    ctx.skills.registerProvider(() => ({
        name: PROVIDER_NAME,
        list: async (options) => {
            const directory = resolveUpstreamDirectory();
            return directory === undefined ? [] : createSkillProvider(directory).list(options);
        },
        get: async (candidate, options) => {
            const directory = resolveUpstreamDirectory();
            return directory === undefined
                ? undefined
                : createSkillProvider(directory).get(candidate, options);
        },
    }));
}
