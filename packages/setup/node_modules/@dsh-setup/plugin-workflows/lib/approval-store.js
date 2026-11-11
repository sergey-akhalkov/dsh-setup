import { createHash, randomBytes } from 'node:crypto';
import { link, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile, } from 'node:fs/promises';
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
/** A revision precondition failed inside the install transaction. */
export class InstallConflictError extends Error {
    revision;
    constructor(message, revision) {
        super(message);
        this.name = 'InstallConflictError';
        this.revision = revision;
    }
}
/** Workspace-scoped install transaction queue: approvals are one shared file. */
const INSTALL_QUEUES = new Map();
function serializeInstall(key, run) {
    const previous = INSTALL_QUEUES.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    INSTALL_QUEUES.set(key, next.catch(() => undefined));
    return next;
}
/** Run one filesystem transaction under the workspace install lock. */
export function runInstallTransaction(workspace, run) {
    return serializeInstall(workspace, run);
}
/**
 * Validate a definition file, copy it atomically into the workspace definitions
 * directory, and record its content hash and host signature. The caller asks
 * the user first; this function is the host-only install path and the one the
 * editor save uses. Installs of one workspace are serialized because they share
 * the approval file.
 */
export function installDefinition(workspace, sourcePath, auth, options = {}) {
    return serializeInstall(workspace, () => installOnce(workspace, sourcePath, auth, options));
}
async function installOnce(workspace, sourcePath, auth, options) {
    const move = options.rename ?? rename;
    const remove = options.unlink ?? unlink;
    const makeLink = options.link ?? link;
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
    // The revision precondition lives inside this serialized transaction, so a
    // concurrent install cannot slip between the check and the replacement.
    const createOnly = options.expectedHash === null;
    if (options.expectedHash !== undefined) {
        const current = await readFile(target).catch(() => undefined);
        const currentHash = current === undefined ? null : sha256(current);
        if (createOnly) {
            if (currentHash !== null) {
                throw new InstallConflictError(`definition "${definition.id}" already exists`, currentHash);
            }
        }
        else if (currentHash !== options.expectedHash) {
            throw new InstallConflictError(`definition "${definition.id}" changed on disk`, currentHash);
        }
    }
    // Keep the previous definition under a backup name with a hard link (the
    // target stays readable throughout), so a failed approval write can restore
    // it by rename even when the disk is full.
    const backup = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.bak`;
    let hadPrevious = false;
    let createdByUs = false;
    if (!createOnly) {
        try {
            await makeLink(target, backup);
            hadPrevious = true;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    const restore = async () => {
        if (!hadPrevious) {
            // Remove the target only when this transaction created it; a competitor's
            // file that made an exclusive create fail must stay untouched.
            if (createdByUs)
                await remove(target).catch(() => undefined);
            return;
        }
        try {
            await move(backup, target);
        }
        catch (error) {
            throw new Error(`the previous definition could not be restored after a failed install (${errorMessage(error)}); its bytes are preserved at "${backup}"`);
        }
    };
    try {
        if (createOnly) {
            // Publish complete bytes with an exclusive hard link: a file created by
            // anyone after the absence check makes the link fail instead of being
            // overwritten by a rename.
            const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`;
            await writeFile(temporary, bytes);
            try {
                await makeLink(temporary, target);
                createdByUs = true;
            }
            catch (error) {
                if (error.code === 'EEXIST') {
                    const current = await readFile(target).catch(() => undefined);
                    throw new InstallConflictError(`definition "${definition.id}" already exists`, current === undefined ? null : sha256(current));
                }
                throw error;
            }
            finally {
                await remove(temporary).catch(() => undefined);
            }
        }
        else {
            await writeAtomic(target, bytes);
            // A replace of a missing target created this file; rollback must remove
            // nothing else.
            if (!hadPrevious)
                createdByUs = true;
        }
        // A concurrent swap for a link must not be blessed: the written file itself
        // has to resolve to the exact expected name inside the definitions directory.
        const written = await realpath(target).catch(() => undefined);
        if (written === undefined ||
            dirname(written) !== directory ||
            (await lstat(target)).isSymbolicLink()) {
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
            throw new Error(`the approval store could not be written (${errorMessage(error)}); the definition was not installed`);
        }
        if (hadPrevious)
            await remove(backup).catch(() => undefined);
        return { definition, file: target, hash };
    }
    catch (error) {
        if (hadPrevious || createdByUs) {
            await restore();
        }
        throw error;
    }
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
function applyLoadRules(definitions, userConfirmed, installedLegacy, enabledLegacy, errors) {
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
        const resolution = resolveOwnership(definition, installedLegacy, enabledLegacy);
        if (resolution.issues.length === 0)
            kept.push(definition);
        else
            errors.push(...resolution.issues);
    }
    return { definitions: kept, errors };
}
/**
 * Whether a local override enforces the installed definition's declared gate
 * exactly: the same pre-execute trigger kind and match, and an active mode.
 * Changing any of these would silently bypass the installed gate.
 */
function preservesGate(installed, local) {
    if (installed.trigger.kind !== local.trigger.kind)
        return false;
    if (local.trigger.mode !== 'active')
        return false;
    // An applicability gate would skip the definition on most events and thereby
    // disable enforcement; the installed gate has none.
    if (installed.trigger.applicability !== local.trigger.applicability)
        return false;
    const keys = [
        'workspace',
        'session',
        'tool',
        'command',
        'path',
        'subject',
        'verdict',
        'classifier',
        'intent',
    ];
    return keys.every((key) => installed.trigger.match[key] === local.trigger.match[key]);
}
/**
 * Load the installed definitions plus the approved local ones. A local file is
 * considered only when its id has a valid host approval for its exact content
 * hash; an approved local id overrides the installed definition. A local copy
 * that drops or weakens a declared pre-execute gate is refused. The drafts
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
        return applyLoadRules(shipped, new Set(), options.installedLegacy, options.enabledLegacy, [
            ...errors,
            'a workflow directory ancestor is a link; the workspace definitions are refused',
        ]);
    }
    const directoryInfo = await lstat(directory).catch(() => undefined);
    if (directoryInfo?.isSymbolicLink() === true) {
        return applyLoadRules(shipped, new Set(), options.installedLegacy, options.enabledLegacy, [
            ...errors,
            'the workspace definitions directory is a link and is refused; use a real directory',
        ]);
    }
    const realDirectory = await realpath(directory).catch(() => undefined);
    if (realDirectory !== undefined && (root === undefined || !isInside(root, realDirectory))) {
        return applyLoadRules(shipped, new Set(), options.installedLegacy, options.enabledLegacy, [
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
            const parsed = validateDefinition(JSON.parse(bytes.toString('utf8')), name);
            // A local copy that shadows a gated installed definition may not remove
            // the declaration; the installed definition stays effective and the user
            // re-saves a copy from the installed template.
            const installed = shipped.find((entry) => entry.id === id);
            if (installed?.settings.gate !== undefined &&
                (parsed.settings.gate !== installed.settings.gate || !preservesGate(installed, parsed))) {
                errors.push(`definition "${id}" is refused: the approved local copy drops or weakens the installed definition's declared "${installed.settings.gate}" gate (it must keep the active trigger, its exact match, settings.gate, and the {name} capture), so the installed definition remains effective; re-save a copy from the installed template and approve it (the retired <name> token cannot be used)`);
                continue;
            }
            local.set(id, parsed);
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
    return applyLoadRules(definitions, new Set(local.keys()), options.installedLegacy, options.enabledLegacy, errors);
}
/** Read one local installed definition regardless of approval; test/debug seam. */
export async function readLocalDefinition(workspace, id) {
    return readDefinitionFile(join(workspaceDefinitionsDirectory(workspace), `${id}.json`));
}
