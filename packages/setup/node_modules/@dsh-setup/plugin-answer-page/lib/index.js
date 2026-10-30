import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Answer-page plugin: registers the pinned answer-me-with-html skill as one
 * on-demand catalog entry. The vendored skill directory is the resource base,
 * so the body's `${CLAUDE_SKILL_DIR}/scripts/am.mjs` resolves to the vendored
 * renderer. There is no always-on section, no tool, and no Client half.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-answer-page';
/** Service the registration depends on. */
export const inject = ['skills'];
/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'answer-me-with-html';
/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-answer-page';
/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600;
/**
 * Catalog description owned by this repository. The upstream prompt tells the
 * model to use the skill liberally, so the description carries the narrow bar
 * instead of advertising a default.
 */
const SKILL_DESCRIPTION = 'Render an answer as one self-contained HTML page with the bundled offline renderer. Use only when the user asks for a page or a visual explanation, or the answer is genuinely diagram-shaped; never for a code answer, a delegated report, or a one-line answer. No always-on use.';
/** Package-relative record paths the runtime needs from the provenance lock. */
const SKILL_RECORD = 'assets/answer-me-with-html/SKILL.md';
const CLI_RECORD = 'assets/answer-me-with-html/scripts/am.mjs';
const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${name}: ${field} must be a non-empty string`);
    }
    return value;
}
function requireCount(value, field) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name}: ${field} must be a non-negative integer`);
    }
    return value;
}
function requireHash(value, field) {
    const hash = requireString(value, field);
    if (!/^[0-9a-f]{64}$/u.test(hash)) {
        throw new Error(`${name}: ${field} must be a lowercase hex SHA-256`);
    }
    return hash;
}
/** Read and validate the provenance lock that describes the pinned upstream state. */
function readAnswerPageLock(directory) {
    const parsed = JSON.parse(readFileSync(join(directory, 'answer-page.lock.json'), 'utf8'));
    if (!isRecord(parsed))
        throw new Error(`${name}: answer-page.lock.json must be a JSON object`);
    if (!isRecord(parsed.upstream)) {
        throw new Error(`${name}: answer-page.lock.json is missing upstream`);
    }
    if (!isRecord(parsed.skill))
        throw new Error(`${name}: answer-page.lock.json is missing skill`);
    if (!Array.isArray(parsed.files)) {
        throw new Error(`${name}: answer-page.lock.json is missing files`);
    }
    const version = requireString(parsed.upstream.version, 'upstream.version');
    const tag = requireString(parsed.upstream.tag, 'upstream.tag');
    const commit = requireString(parsed.upstream.commit, 'upstream.commit');
    if (tag !== `v${version}`) {
        throw new Error(`${name}: upstream.tag "${tag}" must be v${version}`);
    }
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
        throw new Error(`${name}: upstream.commit must be a 40-hex-digit commit, got "${commit}"`);
    }
    const skillName = requireString(parsed.skill.name, 'skill.name');
    if (skillName !== SKILL_NAME) {
        throw new Error(`${name}: expected skill name "${SKILL_NAME}", got "${skillName}"`);
    }
    const seen = new Set();
    const files = parsed.files.map((entry, index) => {
        const at = `files[${index}]`;
        if (!isRecord(entry))
            throw new Error(`${name}: ${at} must be a JSON object`);
        const path = requireString(entry.path, `${at}.path`);
        if (seen.has(path))
            throw new Error(`${name}: duplicate vendored file "${path}"`);
        seen.add(path);
        return {
            path,
            bytes: requireCount(entry.bytes, `${at}.bytes`),
            sha256: requireHash(entry.sha256, `${at}.sha256`),
        };
    });
    for (const required of [SKILL_RECORD, CLI_RECORD]) {
        if (!files.some((file) => file.path === required)) {
            throw new Error(`${name}: proof lock is missing the vendored file "${required}"`);
        }
    }
    return {
        upstream: {
            repository: requireString(parsed.upstream.repository, 'upstream.repository'),
            version,
            tag,
            commit,
        },
        skill: { name: skillName },
        files,
    };
}
function requireFileRecord(lock, path) {
    const record = lock.files.find((file) => file.path === path);
    if (record === undefined)
        throw new Error(`${name}: proof lock is missing "${path}"`);
    return record;
}
/** Resolve one lock-recorded path, refusing anything outside the package directory. */
function recordFile(directory, record) {
    const file = resolve(directory, record.path);
    if (!file.startsWith(`${resolve(directory)}${sep}`)) {
        throw new Error(`${name}: vendored file "${record.path}" resolves outside the package`);
    }
    return file;
}
/**
 * Fail loudly when a vendored file no longer matches its provenance record.
 * Exported so the offline provenance test can prove a corrupted byte fails.
 */
export function assertVendoredBytes(record, content) {
    const actual = createHash('sha256').update(content).digest('hex');
    if (content.length !== record.bytes || actual !== record.sha256) {
        throw new Error(`${name}: "${record.path}" does not match its provenance record (expected ${record.bytes} bytes ${record.sha256}, got ${content.length} bytes ${actual})`);
    }
}
function skillAdapterNote(lock) {
    const { upstream } = lock;
    return [
        '',
        '',
        '---',
        '',
        `DeepSeek Harness adapter: this skill is packaged from answer-me-with-html ${upstream.version} (${upstream.repository}, MIT, by QingYunA), pinned at ${upstream.tag} (${upstream.commit}). The skill's base directory is the vendored skill directory; \`am\` means \`node "<base directory>/scripts/am.mjs"\` and needs Node.js 20 or newer.`,
        '',
        'Narrow the policy in this deployment: render a page only when the user asks for a page or a visual explanation, or the explanation is genuinely diagram-shaped (a flow, comparison, hierarchy, or state machine that a diagram carries). Render no page for a code answer, a delegated report, a one-line answer, small talk, or a request for plain text. There is no always-on mode: attach no page to an answer that neither asked for one nor meets the diagram-shaped bar above.',
        '',
        'Every render stays offline and inside the workspace:',
        '- Write the draft to `<workspace>/.tmp/answers/<slug>.md` and render that file path. Never pass the draft through stdin: the CLI copies a stdin draft into its data directory when the render has warnings.',
        '- Pass `-o <workspace>/.tmp/answers/<slug>.html`, `AM_HOME=<workspace>/.tmp/answers/.am`, `AM_NO_UPDATE_CHECK=1`, and `--no-open`. `AM_NO_UPDATE_CHECK=1` is required: without it the CLI may start a detached update process.',
        '- Never render a video unless the user asks for one.',
        '',
        'When the CLI rejects the draft, edit the flagged lines in the workspace draft file and render again; cap the fixes at two. If Node.js is missing or older than 20, tell the user the renderer requires Node.js 20 or newer and stop. If the render still fails after two fixes, answer in text and say that no page was produced. Do not hand-write HTML, CSS, or SVG coordinates.',
        '',
        'After a successful render, call `present` with the absolute page path and end the reply with a Markdown link to that same path (the path as the label, angle brackets around the destination). Keep the reply to 2-3 lines and do not repeat the page content. Rerender a workspace page by reusing the same `-o` path; `--replace` is only for pages the CLI wrote into its own data directory.',
    ].join('\n');
}
/** Build the provider that lists one candidate and reads its body on demand. */
function createSkillProvider(directory, lock) {
    const assetsDirectory = join(directory, 'assets', 'answer-me-with-html');
    const skillFile = join(assetsDirectory, 'SKILL.md');
    const invocation = { modelInvocable: true, userInvocable: true };
    const resourceBase = {
        kind: 'directory',
        path: assetsDirectory.replaceAll('\\', '/'),
    };
    const candidate = {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase,
        rank: BUNDLED_SKILL_RANK,
        locator: skillFile,
    };
    const skillRecord = requireFileRecord(lock, SKILL_RECORD);
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve([candidate]),
        async get(loaded, options) {
            if (loaded.name !== SKILL_NAME)
                return undefined;
            for (const record of lock.files) {
                const content = await readFile(recordFile(directory, record), { signal: options.signal });
                assertVendoredBytes(record, content);
            }
            const body = await readFile(skillFile, { encoding: 'utf8', signal: options.signal });
            assertVendoredBytes(skillRecord, Buffer.from(body, 'utf8'));
            return {
                name: candidate.name,
                description: candidate.description,
                invocation,
                provider: PROVIDER_NAME,
                source: 'bundled',
                resourceBase,
                content: `${body}${skillAdapterNote(lock)}`,
            };
        },
    };
}
/**
 * Register the pinned skill from one package directory. The lock shape, pin,
 * required records, and the bytes of every lock-listed vendored file are
 * checked here, so a tampered renderer fails the plugin load; the skill body is
 * re-checked when it is loaded. Exported so the provider lifecycle test can
 * drive a fixture package without touching the shipped assets.
 */
export function registerAnswerPage(ctx, directory) {
    const packageDir = resolve(directory);
    const lock = readAnswerPageLock(packageDir);
    for (const record of lock.files) {
        const file = recordFile(packageDir, record);
        if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
            throw new Error(`${name}: proof lock lists the missing vendored file "${record.path}"`);
        }
        assertVendoredBytes(record, readFileSync(file));
    }
    ctx.skills.registerProvider(() => createSkillProvider(packageDir, lock));
}
/** Register the skill from the package the built module ships in. */
export function apply(ctx) {
    registerAnswerPage(ctx, packageDirectory);
}
