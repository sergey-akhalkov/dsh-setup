import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile, } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { loadShippedDefinitions, readDefinitionFile, resolveOwnership, validateDefinition, workspaceDefinitionsDirectory, } from './definitions.js';
import { isInside } from './fs-change.js';
/**
 * The host approval store. A local definition or override is active only when
 * its content hash matches a record signed by the host key; a model-written
 * file, an unsigned approval, or a file changed after approval is refused.
 */
export const APPROVALS_FILE = 'approved.json';
export const APPROVAL_VERSION = 1;
/** Domain separation for a definition approval signature. */
const APPROVAL_DOMAIN = 'workflows/definition-approval/v1';
/** The approval store path for one workspace. */
export function approvalsPath(workspace) {
    return join(workspace, '.dsh', 'workflows', APPROVALS_FILE);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Write a file atomically: temp in the same directory, then rename. */
export async function writeAtomic(file, bytes) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, bytes);
    try {
        await rename(temporary, file);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
/** The signature a host install records for one id and content hash. */
function approvalSignature(auth, id, hash) {
    return auth.sign(APPROVAL_DOMAIN, { v: APPROVAL_VERSION, id, hash });
}
/** Verify one approval record against its id and hash. */
export function verifyApproval(auth, id, hash, record) {
    if (auth === undefined || record === undefined || record.hash !== hash)
        return false;
    return auth.verify(APPROVAL_DOMAIN, { v: APPROVAL_VERSION, id, hash }, record.signature);
}
/**
 * Read the approval store. A missing file is an empty store; an unreadable or
 * malformed one reports an error and approves nothing.
 */
export async function readApprovals(workspace) {
    let raw;
    try {
        raw = await readFile(approvalsPath(workspace), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { approvals: new Map() };
        }
        return {
            approvals: new Map(),
            error: `the approval store is unreadable: ${errorMessage(error)}`,
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        return {
            approvals: new Map(),
            error: `the approval store is not valid JSON: ${errorMessage(error)}`,
        };
    }
    if (!isRecord(parsed) || parsed.v !== APPROVAL_VERSION || !isRecord(parsed.approvals)) {
        return { approvals: new Map(), error: 'the approval store has an unknown shape' };
    }
    const approvals = new Map();
    for (const [id, entry] of Object.entries(parsed.approvals)) {
        if (!isRecord(entry) ||
            typeof entry.hash !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(entry.hash) ||
            typeof entry.signature !== 'string') {
            continue;
        }
        approvals.set(id, { hash: entry.hash, signature: entry.signature });
    }
    return { approvals };
}
/** Persist the whole store atomically; only valid approvals are kept. */
async function writeApprovals(workspace, approvals) {
    const record = {};
    for (const id of [...approvals.keys()].sort()) {
        const entry = approvals.get(id);
        if (entry !== undefined)
            record[id] = entry;
    }
    const store = { v: APPROVAL_VERSION, approvals: record };
    await writeAtomic(approvalsPath(workspace), `${JSON.stringify(store, null, 2)}\n`);
}
/**
 * Validate a definition file, copy it atomically into the workspace definitions
 * directory, and record its content hash and host signature. The caller asks
 * the user first; this function is the host-only install path and the one the
 * editor save uses.
 */
export async function installDefinition(workspace, sourcePath, auth, options = {}) {
    const root = await realpath(workspace);
    const source = await realpath(isAbsolute(sourcePath) ? sourcePath : join(root, sourcePath)).catch(() => undefined);
    if (source === undefined) {
        throw new Error(`the definition file "${sourcePath}" does not exist`);
    }
    if (!isInside(root, source)) {
        throw new Error(`the definition file "${sourcePath}" is outside the workspace`);
    }
    const info = await stat(source);
    if (!info.isFile())
        throw new Error(`the definition path "${sourcePath}" is not a file`);
    const bytes = await readFile(source);
    let raw;
    try {
        raw = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        throw new Error(`the definition file "${sourcePath}" is not valid JSON: ${errorMessage(error)}`);
    }
    const definition = validateDefinition(raw, relative(root, source).replaceAll('\\', '/'));
    const existing = await readApprovals(workspace);
    if (existing.error !== undefined) {
        throw new Error(`${existing.error}; fix or remove ${APPROVALS_FILE} before installing`);
    }
    const directory = await ensureDefinitionsDirectory(workspace);
    const target = join(directory, `${definition.id}.json`);
    if (!isInside(directory, target) || dirname(target) !== directory) {
        throw new Error(`definition "${definition.id}" resolves outside the definitions directory`);
    }
    // The definition bytes and its approval are one install: on any later
    // failure the previous file is restored, so neither half is left changed.
    const previous = await readFile(target).catch(() => undefined);
    await writeAtomic(target, bytes);
    const rollback = async () => {
        if (previous === undefined)
            await unlink(target).catch(() => undefined);
        else
            await writeAtomic(target, previous).catch(() => undefined);
    };
    // A concurrent swap for a link must not be blessed: the written file itself
    // has to resolve to the exact expected name inside the definitions directory.
    const written = await realpath(target).catch(() => undefined);
    if (written === undefined ||
        dirname(written) !== directory ||
        (await lstat(target)).isSymbolicLink()) {
        await rollback();
        throw new Error(`definition "${definition.id}" was replaced while installing; the approval was not recorded`);
    }
    // Sign the exact validated source bytes. Never re-read the writable
    // destination: a write between the copy and the re-read must not be blessed.
    const hash = sha256(bytes);
    const record = {
        hash,
        signature: approvalSignature(auth, definition.id, hash),
    };
    const approvals = new Map(existing.approvals);
    approvals.set(definition.id, record);
    try {
        await (options.writeApprovals ?? writeApprovals)(workspace, approvals);
    }
    catch (error) {
        await rollback();
        throw new Error(`the approval store could not be written (${errorMessage(error)}); the definition was not installed`);
    }
    return { definition, file: target, hash };
}
/**
 * Refuse any linked ancestor between the canonical workspace root and the
 * target components. A `.dsh` or `.dsh/workflows` junction can otherwise point
 * the install at the shipped assets while every final-path check still passes.
 */
async function unlinkedAncestors(root, segments) {
    for (let index = 1; index <= segments.length; index += 1) {
        const candidate = join(root, ...segments.slice(0, index));
        const info = await lstat(candidate).catch(() => undefined);
        if (info === undefined)
            return true;
        if (info.isSymbolicLink())
            return false;
    }
    return true;
}
const DEFINITION_SEGMENTS = ['.dsh', 'workflows', 'definitions'];
/**
 * The definitions directory, proven to stay inside the workspace. A symlinked
 * directory that points elsewhere is refused instead of followed.
 */
async function ensureDefinitionsDirectory(workspace) {
    const root = await realpath(workspace);
    if (!(await unlinkedAncestors(root, DEFINITION_SEGMENTS.slice(0, 2)))) {
        throw new Error('a workflow directory ancestor is a link; the definitions directory is refused');
    }
    const directory = workspaceDefinitionsDirectory(workspace);
    await mkdir(directory, { recursive: true });
    if (!(await unlinkedAncestors(root, DEFINITION_SEGMENTS))) {
        throw new Error('the workspace definitions directory is a link; remove it and use a real directory');
    }
    const real = await realpath(directory);
    if (!isInside(root, real)) {
        throw new Error('the workspace definitions directory escapes the workspace; remove the link');
    }
    return real;
}
/**
 * Every load path ends here: an active intent needs a user-confirmed definition,
 * and an installed-legacy profile refuses every illegal ownership combination.
 * The fallback paths (a linked directory, an unreadable directory) must not
 * bypass these rules, so they call this too.
 */
function applyLoadRules(definitions, userConfirmed, installedLegacy, errors) {
    const confirmed = [];
    for (const definition of definitions) {
        if (definition.trigger.kind === 'intent' &&
            definition.trigger.mode === 'active' &&
            !userConfirmed.has(definition.id)) {
            errors.push(`definition "${definition.id}": an active intent trigger requires a user-confirmed definition; run /workflows install <path> and confirm`);
            continue;
        }
        confirmed.push(definition);
    }
    if (installedLegacy === undefined)
        return { definitions: confirmed, errors };
    const kept = [];
    for (const definition of confirmed) {
        const resolution = resolveOwnership(definition, installedLegacy);
        if (resolution.issues.length === 0)
            kept.push(definition);
        else
            errors.push(...resolution.issues);
    }
    return { definitions: kept, errors };
}
/**
 * Load the shipped definitions plus the approved local ones. A local file is
 * considered only when its id has a valid host approval for its exact content
 * hash; an approved local id overrides the shipped definition. The drafts
 * directory is never read.
 */
export async function loadApprovedDefinitions(workspace, options) {
    const shipped = options.shipped ?? loadShippedDefinitions();
    const errors = [];
    const store = await readApprovals(workspace);
    if (store.error !== undefined)
        errors.push(store.error);
    const local = new Map();
    const directory = workspaceDefinitionsDirectory(workspace);
    const root = await realpath(workspace).catch(() => undefined);
    if (root !== undefined && !(await unlinkedAncestors(root, DEFINITION_SEGMENTS))) {
        return applyLoadRules(shipped, new Set(), options.installedLegacy, [
            ...errors,
            'a workflow directory ancestor is a link; the workspace definitions are refused',
        ]);
    }
    const directoryInfo = await lstat(directory).catch(() => undefined);
    if (directoryInfo?.isSymbolicLink() === true) {
        return applyLoadRules(shipped, new Set(), options.installedLegacy, [
            ...errors,
            'the workspace definitions directory is a link and is refused; use a real directory',
        ]);
    }
    const realDirectory = await realpath(directory).catch(() => undefined);
    if (realDirectory !== undefined && (root === undefined || !isInside(root, realDirectory))) {
        return applyLoadRules(shipped, new Set(), options.installedLegacy, [
            ...errors,
            'the workspace definitions directory escapes the workspace and is refused',
        ]);
    }
    let names;
    try {
        names = (await readdir(realDirectory ?? directory))
            .filter((name) => name.endsWith('.json'))
            .sort();
    }
    catch (error) {
        if (error.code === 'ENOENT')
            names = [];
        else {
            errors.push(`the definitions directory is unreadable: ${errorMessage(error)}`);
            names = [];
        }
    }
    for (const name of names) {
        const file = join(realDirectory ?? directory, name);
        const fileInfo = await lstat(file).catch(() => undefined);
        if (fileInfo?.isSymbolicLink() === true) {
            errors.push(`definition file "${name}" is a link and is refused`);
            continue;
        }
        let bytes;
        try {
            bytes = await readFile(file);
        }
        catch (error) {
            errors.push(`definition file "${name}" is unreadable: ${errorMessage(error)}`);
            continue;
        }
        let rawId;
        try {
            const raw = JSON.parse(bytes.toString('utf8'));
            rawId = isRecord(raw) ? raw.id : undefined;
        }
        catch {
            errors.push(`definition file "${name}" is not valid JSON and is refused`);
            continue;
        }
        if (typeof rawId !== 'string' || rawId.trim() === '') {
            errors.push(`definition file "${name}" has no id and is refused`);
            continue;
        }
        const id = rawId;
        const approval = store.approvals.get(id);
        const hash = sha256(bytes);
        if (!verifyApproval(options.auth, id, hash, approval)) {
            errors.push(`definition "${id}" is not approved by the host (${name}); run /workflows install <path> and confirm, or remove the file`);
            continue;
        }
        if (local.has(id)) {
            errors.push(`definition "${id}" is declared by more than one local file; the first is used`);
            continue;
        }
        try {
            local.set(id, validateDefinition(JSON.parse(bytes.toString('utf8')), name));
        }
        catch (error) {
            errors.push(`approved definition "${id}" is invalid: ${errorMessage(error)}`);
        }
    }
    const definitions = shipped.map((definition) => local.get(definition.id) ?? definition);
    for (const [id, definition] of local) {
        if (!shipped.some((entry) => entry.id === id))
            definitions.push(definition);
    }
    return applyLoadRules(definitions, new Set(local.keys()), options.installedLegacy, errors);
}
/** Read one local installed definition regardless of approval; test/debug seam. */
export async function readLocalDefinition(workspace, id) {
    return readDefinitionFile(join(workspaceDefinitionsDirectory(workspace), `${id}.json`));
}
