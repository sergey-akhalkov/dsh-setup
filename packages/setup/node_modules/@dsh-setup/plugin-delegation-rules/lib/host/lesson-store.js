import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FINDING_CLASSES, hasMachinePath, sanitizeText, } from '../shared/approval.js';
import { workspaceKeyOf } from './finding-history.js';
/**
 * Local lesson store: one JSONL record per lesson revision under
 * `.dsh/review-learning/<workspaceKey>.jsonl`. The store is untracked scratch,
 * bounded, and deduped by normalized class + title. It is never an instruction:
 * only a direct user answer moves a lesson past `proposed`.
 */
export const DEFAULT_MAX_LESSONS = 200;
export const MAX_STORE_BYTES = 1_000_000;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 2_000;
const MAX_SCOPE_ITEMS = 10;
const MAX_SOURCE_HASHES = 20;
const LESSON_STATUSES = new Set([
    'proposed',
    'accepted',
    'rejected',
    'applied',
]);
/** The exact revision an answer is bound to; any field change changes this hash. */
export function lessonRevision(lesson) {
    return createHash('sha256').update(JSON.stringify(lesson)).digest('hex').slice(0, 12);
}
/** A validation problem, the bounded-store refusal, or a held store lock. */
export class LessonStoreError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'LessonStoreError';
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function clip(text, maximum) {
    return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}
function requireText(value, at, maximum) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new LessonStoreError(`${at} must be a non-empty string`, 'validation');
    }
    if (hasMachinePath(value)) {
        throw new LessonStoreError(`${at} must not contain a machine path`, 'validation');
    }
    // The review sanitizer owns the credential formats (headers, quoted JSON
    // values, key prefixes); any redaction means the value must not be stored.
    if (sanitizeText(value, value.length) !== value) {
        throw new LessonStoreError(`${at} must not contain a credential`, 'validation');
    }
    return clip(value.trim(), maximum);
}
function stringList(value, at, maximum) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > maximum) {
        throw new LessonStoreError(`${at} must be a list of at most ${maximum} strings`, 'validation');
    }
    return value.map((item) => requireText(item, at, 120));
}
function normalizeScope(value) {
    if (value === undefined)
        return { rules: [], capabilities: [] };
    if (!isRecord(value))
        throw new LessonStoreError('appliesTo must be a mapping', 'validation');
    return {
        rules: stringList(value.rules, 'appliesTo.rules', MAX_SCOPE_ITEMS),
        capabilities: stringList(value.capabilities, 'appliesTo.capabilities', MAX_SCOPE_ITEMS),
    };
}
function normalizeSource(value) {
    if (value === undefined)
        return {};
    if (!isRecord(value))
        throw new LessonStoreError('source must be a mapping', 'validation');
    const source = {};
    if (value.change !== undefined) {
        source.change = requireText(value.change, 'source.change', 120);
    }
    if (value.taskId !== undefined) {
        source.taskId = requireText(value.taskId, 'source.taskId', 32);
    }
    if (value.findingHashes !== undefined) {
        source.findingHashes = stringList(value.findingHashes, 'source.findingHashes', MAX_SOURCE_HASHES);
    }
    return source;
}
/** Lowercase, whitespace-collapsed, punctuation-trimmed class + title. */
export function lessonDedupeKey(lesson) {
    const title = lesson.title
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
    return `${lesson.class}\u0000${title}`;
}
/** Absolute path of the workspace's lesson store. */
export function lessonStorePath(workspaceRoot) {
    return join(workspaceRoot, '.dsh', 'review-learning', `${workspaceKeyOf(workspaceRoot)}.jsonl`);
}
function parseLesson(value) {
    if (!isRecord(value) || value.v !== 1)
        return undefined;
    if (typeof value.id !== 'string' || !/^lesson-[a-z0-9-]+$/u.test(value.id))
        return undefined;
    if (!FINDING_CLASSES.includes(value.class))
        return undefined;
    if (typeof value.title !== 'string' || value.title === '')
        return undefined;
    if (typeof value.body !== 'string' || value.body === '')
        return undefined;
    if (typeof value.status !== 'string' || !LESSON_STATUSES.has(value.status))
        return undefined;
    if (!isRecord(value.appliesTo) || !isRecord(value.source))
        return undefined;
    if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt))
        return undefined;
    if (value.decidedAt !== undefined && typeof value.decidedAt !== 'number')
        return undefined;
    if (value.appliedIn !== undefined && typeof value.appliedIn !== 'string')
        return undefined;
    if (value.supersedes !== undefined && typeof value.supersedes !== 'string')
        return undefined;
    const rules = value.appliesTo.rules;
    const capabilities = value.appliesTo.capabilities;
    if (!Array.isArray(rules) ||
        !rules.every((item) => typeof item === 'string') ||
        !Array.isArray(capabilities) ||
        !capabilities.every((item) => typeof item === 'string')) {
        return undefined;
    }
    const source = {};
    if (value.source.change !== undefined) {
        if (typeof value.source.change !== 'string')
            return undefined;
        source.change = clip(value.source.change, 120);
    }
    if (value.source.taskId !== undefined) {
        if (typeof value.source.taskId !== 'string')
            return undefined;
        source.taskId = clip(value.source.taskId, 32);
    }
    if (value.source.findingHashes !== undefined) {
        if (!Array.isArray(value.source.findingHashes) ||
            !value.source.findingHashes.every((item) => typeof item === 'string')) {
            return undefined;
        }
        source.findingHashes = value.source.findingHashes
            .slice(0, MAX_SOURCE_HASHES)
            .map((hash) => clip(hash, 120));
    }
    return {
        v: 1,
        id: value.id,
        class: value.class,
        title: value.title,
        body: value.body,
        appliesTo: { rules, capabilities },
        status: value.status,
        source,
        createdAt: value.createdAt,
        ...(value.decidedAt === undefined ? {} : { decidedAt: value.decidedAt }),
        ...(value.appliedIn === undefined ? {} : { appliedIn: value.appliedIn }),
        ...(value.supersedes === undefined ? {} : { supersedes: value.supersedes }),
    };
}
/** Read every lesson revision; a missing file is empty. */
export async function readLessons(workspaceRoot) {
    let raw;
    try {
        raw = await readFile(lessonStorePath(workspaceRoot), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { lessons: [], skipped: 0 };
        throw error;
    }
    const lessons = [];
    let skipped = 0;
    for (const line of raw.split(/\r?\n/)) {
        if (line.trim() === '')
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            skipped += 1;
            continue;
        }
        const lesson = parseLesson(parsed);
        if (lesson === undefined)
            skipped += 1;
        else
            lessons.push(lesson);
    }
    return { lessons, skipped };
}
/** Serialize same-process writers per file so a prune never races an append. */
const storeWrites = new Map();
const STORE_LOCK_TIMEOUT_MS = 2_000;
/** Remove the lock only while it still carries this writer's owner token. */
async function removeOwnedLock(lock, owner) {
    try {
        const current = await readFile(join(lock, 'owner'), 'utf8');
        if (current !== owner)
            return;
    }
    catch {
        return;
    }
    await rm(lock, { recursive: true, force: true }).catch(() => undefined);
}
/**
 * The store is local scratch: refuse to create it where Git could track it.
 * Only an established "not a git repository" answer allows the write; a Git
 * execution error or an unexpected status fails closed.
 */
function assertStoreIgnored(workspaceRoot) {
    const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
    const check = spawnSync('git', ['-C', workspaceRoot, 'check-ignore', '-q', '.dsh/review-learning'], { stdio: 'ignore', env });
    if (check.status === 0)
        return;
    if (check.status === 1) {
        throw new LessonStoreError('the lesson store path .dsh/review-learning is not git-ignored; add ".dsh/" to .gitignore so review data is never tracked', 'validation');
    }
    const inside = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', '--is-inside-work-tree'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env,
    });
    if (inside.error !== undefined || inside.status === null) {
        throw new LessonStoreError('git is unavailable, so the lesson store cannot verify that .dsh/review-learning is ignored; install git or run outside a repository', 'validation');
    }
    if (inside.status === 0 && String(inside.stdout).trim() === 'true') {
        throw new LessonStoreError(`git could not verify that .dsh/review-learning is ignored in this repository (${clip(String(inside.stderr ?? '').trim() || `git status ${check.status ?? 'unknown'}`, 200)}); fix git and retry`, 'validation');
    }
    const stderr = String(inside.stderr ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!/not a git repository/iu.test(stderr)) {
        throw new LessonStoreError(`git could not establish that this workspace is outside a repository (${clip(stderr || `status ${String(inside.status)}`, 200)}); the lesson store refuses unverifiable scratch`, 'validation');
    }
    // Established outside a repository: there is nothing to track.
}
/**
 * Cross-process lock for the read-prune-rename sequence: an atomic directory
 * create with an owner token. A crashed writer leaves the lock behind; the
 * bounded wait then fails with the lock path and a manual next action rather
 * than risking a takeover race that could lose a lesson.
 */
async function withStoreProcessLock(path, work) {
    const lock = `${path}.lock`;
    assertStoreIgnored(dirname(dirname(dirname(path))));
    await mkdir(dirname(path), { recursive: true });
    const owner = randomUUID();
    const deadline = Date.now() + STORE_LOCK_TIMEOUT_MS;
    for (;;) {
        try {
            await mkdir(lock);
            try {
                await writeFile(join(lock, 'owner'), owner, 'utf8');
            }
            catch (error) {
                await rm(lock, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
            break;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            if (Date.now() >= deadline) {
                throw new LessonStoreError(`lesson store is locked by another writer (${lock.replaceAll('\\', '/')}); if no other host is writing, remove that lock and retry`, 'locked');
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    try {
        return await work();
    }
    finally {
        await removeOwnedLock(lock, owner);
    }
}
function serialized(path, work) {
    const previous = storeWrites.get(path) ?? Promise.resolve();
    // A failed writer must not cancel the writes queued behind it.
    const next = previous.catch(() => undefined).then(() => withStoreProcessLock(path, work));
    storeWrites.set(path, next);
    return next.finally(() => {
        if (storeWrites.get(path) === next)
            storeWrites.delete(path);
    });
}
async function writeLessons(path, lessons) {
    await mkdir(dirname(path), { recursive: true });
    const body = lessons.map((lesson) => JSON.stringify(lesson)).join('\n');
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, lessons.length === 0 ? '' : `${body}\n`, 'utf8');
    await rename(temporary, path);
}
function storeBytes(lessons) {
    let total = 0;
    for (const lesson of lessons)
        total += Buffer.byteLength(JSON.stringify(lesson), 'utf8') + 1;
    return total;
}
/** Evict the oldest non-applied lesson until the store fits; the written record is never a victim. */
function enforceCapacity(lessons, maxLessons, protectedId) {
    const next = [...lessons];
    while (next.length > maxLessons || storeBytes(next) > MAX_STORE_BYTES) {
        const victim = next
            .filter((lesson) => lesson.status !== 'applied' && lesson.id !== protectedId)
            .sort((left, right) => left.createdAt - right.createdAt)[0];
        if (victim === undefined) {
            throw new LessonStoreError(`lesson store is at capacity (${next.length} lessons, ${storeBytes(next)} bytes) and no non-applied lesson can be evicted; reject or apply a lesson elsewhere, or raise reviewLearning.maxLessons`, 'capacity');
        }
        next.splice(next.indexOf(victim), 1);
    }
    return next;
}
/**
 * Store a proposed lesson. The same normalized class + title updates a proposed
 * record; a duplicate of an accepted or applied lesson creates a new proposed
 * revision with a `supersedes` link and never changes the accepted content.
 */
export async function proposeLesson(workspaceRoot, input) {
    const lessonClass = input.class;
    if (typeof input.class !== 'string' || !FINDING_CLASSES.includes(lessonClass)) {
        throw new LessonStoreError(`lesson class must be one of the fixed vocabulary: ${FINDING_CLASSES.join(', ')}`, 'validation');
    }
    const title = requireText(input.title, 'lesson.title', MAX_TITLE_CHARS);
    const body = requireText(input.body, 'lesson.body', MAX_BODY_CHARS);
    const appliesTo = normalizeScope(input.appliesTo);
    const source = normalizeSource(input.source);
    const key = lessonDedupeKey({ class: lessonClass, title });
    const path = lessonStorePath(workspaceRoot);
    const maxLessons = input.maxLessons ?? DEFAULT_MAX_LESSONS;
    return serialized(path, async () => {
        const { lessons } = await readLessons(workspaceRoot);
        const matches = lessons.filter((lesson) => lessonDedupeKey(lesson) === key);
        // Prefer an existing proposed revision so repeated proposals keep updating
        // one record instead of appending a new revision beside the accepted one.
        const existing = matches
            .filter((lesson) => lesson.status === 'proposed')
            .sort((left, right) => right.createdAt - left.createdAt)[0] ??
            matches.find((lesson) => lesson.status === 'accepted' || lesson.status === 'applied') ??
            matches[0];
        const record = {
            v: 1,
            id: `lesson-${randomUUID().slice(0, 16)}`,
            class: lessonClass,
            title,
            body,
            appliesTo,
            status: 'proposed',
            source,
            createdAt: input.now,
        };
        if (existing !== undefined && existing.status === 'proposed') {
            const updated = {
                ...existing,
                class: lessonClass,
                title,
                body,
                appliesTo,
                source,
                createdAt: input.now,
            };
            const next = enforceCapacity(lessons.map((lesson) => (lesson.id === existing.id ? updated : lesson)), maxLessons, updated.id);
            await writeLessons(path, next);
            return { lesson: updated, kind: 'updated', replaced: existing };
        }
        if (existing !== undefined &&
            (existing.status === 'accepted' || existing.status === 'applied')) {
            const revision = { ...record, supersedes: existing.id };
            const next = enforceCapacity([...lessons, revision], maxLessons, revision.id);
            await writeLessons(path, next);
            return { lesson: revision, kind: 'revision' };
        }
        const replaced = existing;
        const next = enforceCapacity(existing === undefined
            ? [...lessons, record]
            : lessons.map((lesson) => (lesson.id === existing.id ? record : lesson)), maxLessons, record.id);
        await writeLessons(path, next);
        return {
            lesson: record,
            kind: 'created',
            ...(replaced === undefined ? {} : { replaced }),
        };
    });
}
async function findLesson(workspaceRoot, id) {
    const { lessons } = await readLessons(workspaceRoot);
    const lesson = lessons.find((entry) => entry.id === id);
    if (lesson === undefined) {
        throw new LessonStoreError(`lesson "${id}" was not found; use list to see the current ids`, 'not-found');
    }
    return { lessons, lesson };
}
function assertExpectedRevision(lesson, expected) {
    if (expected === undefined)
        return;
    const current = lessonRevision(lesson);
    if (current !== expected) {
        throw new LessonStoreError(`lesson "${lesson.id}" changed while the question was open (current revision ${current}); ask again for the current revision`, 'transition');
    }
}
/** Apply a direct user decision; the caller supplies the answer, never the model. */
export async function decideLesson(workspaceRoot, id, decision, now, options = {}) {
    const path = lessonStorePath(workspaceRoot);
    return serialized(path, async () => {
        const { lessons, lesson } = await findLesson(workspaceRoot, id);
        assertExpectedRevision(lesson, options.expectedRevision);
        if (lesson.status !== 'proposed') {
            throw new LessonStoreError(`lesson "${id}" is ${lesson.status}; only a proposed lesson can be accepted or rejected`, 'transition');
        }
        const next = { ...lesson, status: decision, decidedAt: now };
        await writeLessons(path, enforceCapacity(lessons.map((entry) => (entry.id === id ? next : entry)), options.maxLessons ?? DEFAULT_MAX_LESSONS, id));
        return next;
    });
}
/** Validate and bound an application target before any question or write. */
export function validateLessonTarget(target) {
    return requireText(target, 'lesson target', 300);
}
/** Mark an accepted lesson applied against a named target. */
export async function applyLesson(workspaceRoot, id, target, now, options = {}) {
    const appliedIn = validateLessonTarget(target);
    const path = lessonStorePath(workspaceRoot);
    return serialized(path, async () => {
        const { lessons, lesson } = await findLesson(workspaceRoot, id);
        assertExpectedRevision(lesson, options.expectedRevision);
        if (lesson.status !== 'accepted') {
            throw new LessonStoreError(`lesson "${id}" is ${lesson.status}; only an accepted lesson can be applied`, 'transition');
        }
        const next = { ...lesson, status: 'applied', appliedIn, decidedAt: now };
        await writeLessons(path, enforceCapacity(lessons.map((entry) => (entry.id === id ? next : entry)), options.maxLessons ?? DEFAULT_MAX_LESSONS, id));
        return next;
    });
}
/** Accepted and applied lessons only; proposed and rejected are never injected. */
export function injectableLessons(lessons) {
    return lessons.filter((lesson) => lesson.status === 'accepted' || lesson.status === 'applied');
}
/** Delta capability directory names a change declares under `specs/`. */
export async function changeCapabilities(changeDir) {
    try {
        const entries = await readdir(join(changeDir, 'specs'), { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    }
    catch {
        return [];
    }
}
/** Lessons whose rule and capability scope matches this review; proposed/rejected never match. */
export function matchingLessons(lessons, rule, capabilities) {
    return injectableLessons(lessons).filter((lesson) => {
        const rules = lesson.appliesTo.rules;
        const scoped = lesson.appliesTo.capabilities;
        const ruleMatches = rules.length === 0 || rules.includes('*') || rules.includes(rule);
        const capabilityMatches = scoped.length === 0 || scoped.some((capability) => capabilities.includes(capability));
        return ruleMatches && capabilityMatches;
    });
}
