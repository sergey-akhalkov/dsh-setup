import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { InstallConflictError, installDefinition, runInstallTransaction, writeAtomic, } from './approval-store.js';
import { CHANGE_NAME } from './command-parse.js';
import { DEFINITION_ID, loadShippedDefinitions, validateDefinition, workspaceDefinitionsDirectory, } from './definitions.js';
import { DRAFTS_ROOT, readDraft } from './drafts.js';
import { isInside } from './fs-change.js';
import { isOpenRun, listRuns } from './runs.js';
/**
 * The editor's workspace-scoped write API. The Host carrier dispatches exact
 * paths only, so the editor routes live under `/api/workflows/editor/` and name
 * one resource with an `id`/`name` query parameter instead of a path segment.
 * Every write validates against the engine's own schema and, for definitions,
 * goes through the shared install/approve function, so a saved definition is
 * active under the same rules as `/workflows install`.
 */
export const EDITOR_DEFINITIONS_ROUTE = '/api/workflows/editor/definitions';
export const EDITOR_DEFINITION_ROUTE = '/api/workflows/editor/definition';
export const EDITOR_TEMPLATES_ROUTE = '/api/workflows/editor/templates';
export const EDITOR_DRAFTS_ROUTE = '/api/workflows/editor/drafts';
export const EDITOR_DRAFT_ROUTE = '/api/workflows/editor/draft';
export const EDITOR_LAYOUT_ROUTE = '/api/workflows/editor/layout';
export const LAYOUT_VERSION = 1;
export const LAYOUT_DIRECTORY = ['.dsh', 'workflows', 'layout'];
const STAGING_DIRECTORY = ['.dsh', 'workflows'];
const DEFINITION_DIRECTORY = ['.dsh', 'workflows', 'definitions'];
/**
 * Whether any ancestor of the definitions directory (or the directory itself)
 * is a link. The install path refuses links, and read/delete must match it so a
 * junction — even one pointing at another directory inside the workspace —
 * cannot make the editor read or delete a non-local definition.
 */
async function hasLinkedAncestor(workspace) {
    const root = await realpath(workspace);
    let current = root;
    for (const segment of DEFINITION_DIRECTORY) {
        const candidate = join(current, segment);
        const info = await lstat(candidate).catch(() => undefined);
        if (info === undefined)
            return false;
        if (info.isSymbolicLink())
            return true;
        const real = await realpath(candidate).catch(() => undefined);
        if (real === undefined || !isInside(root, real))
            return true;
        current = real;
    }
    return false;
}
/** The workspace layout sidecar directory. */
export function layoutDirectory(workspace) {
    return join(workspace, ...LAYOUT_DIRECTORY);
}
/** The layout sidecar path for one definition id. */
export function layoutPath(workspace, id) {
    return join(layoutDirectory(workspace), `${id}.json`);
}
/** The revision of a resource is the SHA-256 of its exact file bytes. */
export function revisionOf(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
const REVISION = /^[a-f0-9]{64}$/u;
function json(status, body, headers = {}) {
    return Response.json(body, { status, headers });
}
function bounded(message) {
    return String(message instanceof Error ? message.message : message).slice(0, 300);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Map the validator's `field "x" ...` message back to a structured error. */
export function definitionErrors(error) {
    const text = errorMessage(error);
    const match = /^workflow definition "[^"]*" field "([^"]*)" (.*)$/u.exec(text);
    if (match === null)
        return [{ path: '', message: text.slice(0, 300) }];
    return [{ path: match[1] ?? '', message: (match[2] ?? '').slice(0, 300) }];
}
function resolveSession(services, request) {
    const session = new URL(request.url).searchParams.get('session');
    if (session === null || session === '') {
        // No session at all is unauthenticated; an unknown session is a bad request.
        return { response: json(401, { error: 'a session id is required' }) };
    }
    const agent = services.agents.get(session);
    if (agent === undefined) {
        return { response: json(400, { error: 'the session is not live in this host' }) };
    }
    try {
        return { workspace: services.workingDirectory.get(agent.session) };
    }
    catch {
        return { response: json(400, { error: 'the session workspace is unavailable' }) };
    }
}
async function bodyOf(request) {
    try {
        const value = await request.json();
        return isRecord(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Create (or verify) one directory segment at a time beneath the canonical
 * workspace root. A link anywhere on the way is refused, so an editor write
 * cannot be redirected outside the workspace.
 */
async function ensureDirectory(workspace, segments) {
    const root = await realpath(workspace);
    let current = root;
    for (const segment of segments) {
        const candidate = join(current, segment);
        const info = await lstat(candidate).catch(() => undefined);
        if (info === undefined) {
            // Two concurrent creates may both see the missing directory; the loser
            // of the mkdir race still lands on the same directory.
            await mkdir(candidate).catch((error) => {
                if (error.code !== 'EEXIST')
                    throw error;
            });
        }
        else if (info.isSymbolicLink()) {
            throw new Error(`the workflow directory "${segments.join('/')}" uses a link and is refused`);
        }
        const real = await realpath(candidate);
        if (!isInside(root, real)) {
            throw new Error(`the workflow directory "${segments.join('/')}" escapes the workspace`);
        }
        current = real;
    }
    return current;
}
/** The revision of a file, or null when it is absent or unreadable. */
async function fileRevision(file) {
    try {
        return revisionOf(await readFile(file));
    }
    catch {
        return null;
    }
}
/** Read one local definition file without following a link. */
async function readLocal(workspace, id) {
    if (await hasLinkedAncestor(workspace)) {
        throw new Error('a workflow directory is a link and is refused');
    }
    const directory = workspaceDefinitionsDirectory(workspace);
    const target = join(directory, `${id}.json`);
    const info = await lstat(target).catch(() => undefined);
    if (info === undefined)
        return undefined;
    if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`the definition file "${id}.json" is a link and is refused`);
    }
    const root = await realpath(workspace);
    const resolved = await realpath(target);
    if (!isInside(root, resolved)) {
        throw new Error(`the definition file "${id}.json" escapes the workspace and is refused`);
    }
    const bytes = await readFile(resolved);
    let raw;
    try {
        raw = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        throw new Error(`the definition file "${id}.json" is not valid JSON: ${errorMessage(error)}`);
    }
    return { definition: validateDefinition(raw, id), revision: revisionOf(bytes), bytes };
}
/** The editor's list entry for one definition; the description stays optional. */
function editorEntry(definition, source, revision) {
    return {
        id: definition.id,
        name: definition.name,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        trigger: definition.trigger.kind,
        version: definition.version,
        stepCount: definition.steps.length,
        source,
        revision,
    };
}
/** Local definitions plus the shipped set; a local file shadows its shipped id. */
async function listDefinitions(workspace) {
    const errors = [];
    const shipped = loadShippedDefinitions();
    const local = new Map();
    if (await hasLinkedAncestor(workspace)) {
        return {
            definitions: shipped.map((definition) => editorEntry(definition, 'shipped', null)),
            errors: ['a workflow directory is a link; local definitions are refused'],
        };
    }
    let names = [];
    try {
        names = (await readdir(workspaceDefinitionsDirectory(workspace)))
            .filter((name) => name.endsWith('.json'))
            .sort();
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            errors.push(`the definitions directory is unreadable: ${bounded(error)}`);
        }
    }
    for (const name of names) {
        const id = name.slice(0, -'.json'.length);
        if (!DEFINITION_ID.test(id)) {
            errors.push(`the definition file "${name}" has an unsafe id and is refused`);
            continue;
        }
        try {
            const read = await readLocal(workspace, id);
            if (read === undefined)
                continue;
            local.set(id, editorEntry(read.definition, 'local', read.revision));
        }
        catch (error) {
            errors.push(bounded(error));
        }
    }
    const definitions = shipped.map((definition) => {
        const override = local.get(definition.id);
        if (override !== undefined) {
            local.delete(definition.id);
            return override;
        }
        return editorEntry(definition, 'shipped', null);
    });
    for (const entry of [...local.values()].sort((left, right) => left.id.localeCompare(right.id))) {
        definitions.push(entry);
    }
    return { definitions, errors };
}
/** The document plus the revision the next update must send back. */
async function readDefinitionDocument(workspace, id) {
    if (!DEFINITION_ID.test(id))
        return undefined;
    const read = await readLocal(workspace, id);
    if (read !== undefined) {
        return { definition: read.definition, revision: read.revision, source: 'local' };
    }
    const shipped = loadShippedDefinitions().find((definition) => definition.id === id);
    if (shipped === undefined)
        return undefined;
    return { definition: shipped, revision: null, source: 'shipped' };
}
/** Validate a layout sidecar; the engine ignores it, the editor must not crash on it. */
export function validateLayout(raw, id) {
    if (!isRecord(raw))
        throw new Error('the layout must be an object');
    for (const key of Object.keys(raw)) {
        if (!['v', 'id', 'positions'].includes(key)) {
            throw new Error(`the layout field "${key}" is not a known field`);
        }
    }
    if (raw.v !== LAYOUT_VERSION)
        throw new Error(`the layout v must be ${String(LAYOUT_VERSION)}`);
    if (raw.id !== id)
        throw new Error('the layout id does not match the requested definition');
    if (!isRecord(raw.positions))
        throw new Error('the layout positions must be an object');
    const positions = Object.create(null);
    for (const [stepId, value] of Object.entries(raw.positions)) {
        // A step id is any non-empty string the definition validator accepts; the
        // layout key only names a position, so it never reaches a filesystem path.
        if (stepId.trim() === '') {
            throw new Error(`the layout position "${stepId}" has an empty step id`);
        }
        if (!isRecord(value) ||
            typeof value.x !== 'number' ||
            typeof value.y !== 'number' ||
            !Number.isFinite(value.x) ||
            !Number.isFinite(value.y)) {
            throw new Error(`the layout position "${stepId}" must carry finite x and y numbers`);
        }
        positions[stepId] = { x: value.x, y: value.y };
    }
    return { v: LAYOUT_VERSION, id, positions };
}
function serialized(value) {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
/** A per-resource serial queue: revision checks and the replacement are one step. */
const WRITE_QUEUES = new Map();
function serialize(key, run) {
    const previous = WRITE_QUEUES.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    WRITE_QUEUES.set(key, next.catch(() => undefined));
    return next;
}
function expectedOf(value) {
    if (value === null)
        return { create: true };
    if (typeof value !== 'string' || !REVISION.test(value)) {
        return json(400, { error: 'expectedRevision must be null or a SHA-256 revision' });
    }
    return { hash: value };
}
/** Write the layout sidecar: exclusive create for null, revision-checked replace otherwise. */
async function saveLayout(workspace, id, layout, expected) {
    const directory = await ensureDirectory(workspace, LAYOUT_DIRECTORY);
    const target = join(directory, `${id}.json`);
    if (dirname(target) !== directory)
        return json(400, { error: 'the layout id is unsafe' });
    const bytes = serialized(layout);
    return serialize(`layout:${target}`, async () => {
        let current;
        try {
            current = revisionOf(await readFile(target));
        }
        catch {
            current = null;
        }
        if ('create' in expected) {
            if (current !== null)
                return json(409, { revision: current });
            try {
                await writeFile(target, bytes, { flag: 'wx' });
            }
            catch (error) {
                if (error.code === 'EEXIST') {
                    return json(409, { revision: await fileRevision(target) });
                }
                throw error;
            }
            return json(200, { revision: revisionOf(bytes) });
        }
        if (current === null)
            return json(409, { revision: null });
        if (current !== expected.hash)
            return json(409, { revision: current });
        await writeAtomic(target, bytes);
        return json(200, { revision: revisionOf(bytes) });
    });
}
/**
 * Save one definition through the shared install/approve function. A
 * create-only save reserves the destination name with an exclusive file create
 * before the install (so two creators cannot both win); the install replaces
 * the placeholder and persists the matching approval, and any failure removes
 * the placeholder again.
 */
async function saveDefinition(services, workspace, id, raw, expected) {
    if (!isRecord(raw) || raw.id !== id) {
        return json(400, {
            errors: [{ path: 'id', message: 'the definition id must match the requested id' }],
        });
    }
    let definition;
    try {
        definition = validateDefinition(raw, id);
    }
    catch (error) {
        return json(400, { errors: definitionErrors(error) });
    }
    const auth = await services.auth();
    if (auth === undefined) {
        return json(503, { error: 'the host key is not ready; the definition was not saved' });
    }
    const directory = await ensureDirectory(workspace, ['.dsh', 'workflows', 'definitions']);
    const target = join(directory, `${id}.json`);
    if (dirname(target) !== directory)
        return json(400, { error: 'the definition id is unsafe' });
    // installDefinition validates, checks the revision inside its workspace
    // transaction, writes atomically, and records the approval; on failure it
    // restores the previous file, so a failed save changes nothing.
    const staging = join(await ensureDirectory(workspace, STAGING_DIRECTORY), `.editor-${String(process.pid)}-${randomBytes(4).toString('hex')}.json`);
    try {
        await writeFile(staging, serialized(definition), 'utf8');
        await (services.install ?? installDefinition)(workspace, staging, auth, {
            expectedHash: 'create' in expected ? null : expected.hash,
        });
    }
    catch (error) {
        if (error instanceof InstallConflictError) {
            return json(409, { revision: error.revision });
        }
        const text = errorMessage(error);
        if (/outside the workspace|not a file|not valid JSON/u.test(text)) {
            return json(400, { errors: definitionErrors(error) });
        }
        return json(400, { error: text.slice(0, 300) });
    }
    finally {
        await unlink(staging).catch(() => undefined);
    }
    return json(200, { revision: revisionOf(serialized(definition)) });
}
/** Delete one local definition after the revision and active-run checks. */
async function deleteDefinition(workspace, id, expected) {
    const directory = workspaceDefinitionsDirectory(workspace);
    const target = join(directory, `${id}.json`);
    if (dirname(target) !== directory)
        return json(400, { error: 'the definition id is unsafe' });
    return runInstallTransaction(workspace, async () => {
        if (await hasLinkedAncestor(workspace)) {
            return json(400, { error: 'a workflow directory is a link and is refused' });
        }
        // Resolve the file before reading or deleting it: a linked definitions
        // directory must not let a delete reach a file outside the workspace.
        let resolved;
        try {
            const root = await realpath(workspace);
            const realDirectory = await realpath(directory);
            if (!isInside(root, realDirectory)) {
                return json(400, { error: 'the definitions directory escapes the workspace' });
            }
            const info = await lstat(target);
            if (info.isSymbolicLink() || !info.isFile()) {
                return json(400, { error: 'the definition file is a link and is refused' });
            }
            resolved = await realpath(target);
            if (!isInside(root, resolved)) {
                return json(400, { error: 'the definition file escapes the workspace' });
            }
        }
        catch {
            return json(409, { revision: null });
        }
        let current;
        try {
            current = revisionOf(await readFile(resolved));
        }
        catch {
            current = null;
        }
        if (current === null)
            return json(409, { revision: null });
        if (!('hash' in expected)) {
            return json(409, { revision: current, error: 'delete must send the loaded revision' });
        }
        if (current !== expected.hash)
            return json(409, { revision: current });
        const active = (await listRuns(workspace)).filter((run) => run.definition.id === id && isOpenRun(run));
        if (active.length > 0) {
            return json(409, {
                revision: current,
                error: 'an active run references this definition; finish or cancel it first',
                runs: active.map((run) => run.id),
            });
        }
        await unlink(resolved);
        // The stale approval record no longer authorizes anything (the file is gone);
        // it is kept so a failed delete can never be half-applied.
        return json(200, { ok: true });
    });
}
/** List the definition drafts a model wrote; they are never active by themselves. */
async function listDrafts(workspace) {
    const errors = [];
    const drafts = [];
    const root = await realpath(workspace);
    let names;
    try {
        names = (await readdir(join(root, DRAFTS_ROOT), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { drafts, errors };
        return { drafts, errors: [`the drafts directory is unreadable: ${bounded(error)}`] };
    }
    for (const name of names) {
        if (!CHANGE_NAME.test(name))
            continue;
        try {
            const text = await readDraft(workspace, name, 'definition.json');
            if (text === undefined)
                continue;
            const definition = validateDefinition(JSON.parse(text), name);
            drafts.push({
                name,
                id: definition.id,
                title: definition.name,
                stepCount: definition.steps.length,
            });
        }
        catch (error) {
            errors.push(bounded(error));
        }
    }
    return { drafts, errors };
}
function route(path, handler, methods = ['GET']) {
    return {
        path,
        methods: [...new Set([...methods, 'GET'])],
        requestBody: 'buffered',
        async fetch(request) {
            if (!methods.includes(request.method)) {
                return json(405, { error: `method ${request.method} is not allowed` }, { allow: [...new Set([...methods, 'GET'])].join(', ') });
            }
            try {
                return await handler(request);
            }
            catch (error) {
                return json(500, { error: `the workflows editor request failed: ${bounded(error)}` });
            }
        },
    };
}
function idOf(request) {
    const id = new URL(request.url).searchParams.get('id');
    return id === null || id === '' ? null : id;
}
/** Read one layout sidecar, refusing a linked directory or file outside the workspace. */
async function readLayout(workspace, id) {
    const root = await realpath(workspace);
    const directory = await realpath(layoutDirectory(workspace)).catch(() => undefined);
    if (directory === undefined || !isInside(root, directory))
        return undefined;
    const target = join(directory, `${id}.json`);
    const info = await lstat(target).catch(() => undefined);
    if (info === undefined)
        return undefined;
    if (info.isSymbolicLink() || !info.isFile())
        throw new Error('the layout file is a link');
    const resolved = await realpath(target);
    if (!isInside(root, resolved))
        throw new Error('the layout file escapes the workspace');
    const text = await readFile(resolved, 'utf8');
    return { layout: validateLayout(JSON.parse(text), id), revision: revisionOf(text) };
}
/**
 * The revision of a layout the editor may replace: only a regular file reached
 * through the contained layout directory. A linked or escaped path has no
 * revision the editor may send back.
 */
async function containedLayoutRevision(workspace, id) {
    try {
        const root = await realpath(workspace);
        const directory = await realpath(layoutDirectory(workspace));
        if (!isInside(root, directory))
            return null;
        const target = join(directory, `${id}.json`);
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile())
            return null;
        const resolved = await realpath(target);
        if (!isInside(root, resolved))
            return null;
        return revisionOf(await readFile(resolved));
    }
    catch {
        return null;
    }
}
/** The editor-facing names of the read helpers the literal read routes reuse. */
export { listDefinitions as listEditorDefinitions, readDefinitionDocument as readEditorDefinitionDocument, };
/** Build the editor write routes; the caller registers them on the carrier. */
export function createEditorRoutes(services) {
    return [
        route(EDITOR_DEFINITIONS_ROUTE, async (request) => {
            const resolved = resolveSession(services, request);
            if ('response' in resolved)
                return resolved.response;
            const listed = await listDefinitions(resolved.workspace);
            return json(200, {
                definitions: listed.definitions,
                ...(listed.errors.length === 0 ? {} : { errors: listed.errors }),
            });
        }),
        route(EDITOR_TEMPLATES_ROUTE, async (request) => {
            const resolved = resolveSession(services, request);
            if ('response' in resolved)
                return resolved.response;
            const templates = loadShippedDefinitions().map((definition) => ({
                ...editorEntry(definition, 'shipped', null),
                definition,
            }));
            return json(200, { templates });
        }),
        route(EDITOR_DRAFTS_ROUTE, async (request) => {
            const resolved = resolveSession(services, request);
            if ('response' in resolved)
                return resolved.response;
            const listed = await listDrafts(resolved.workspace);
            return json(200, {
                drafts: listed.drafts,
                ...(listed.errors.length === 0 ? {} : { errors: listed.errors }),
            });
        }),
        route(EDITOR_DRAFT_ROUTE, async (request) => {
            const resolved = resolveSession(services, request);
            if ('response' in resolved)
                return resolved.response;
            const name = new URL(request.url).searchParams.get('name');
            if (name === null || name === '')
                return json(400, { error: 'a draft name is required' });
            if (!CHANGE_NAME.test(name))
                return json(400, { error: 'the draft name is unsafe' });
            const text = await readDraft(resolved.workspace, name, 'definition.json');
            if (text === undefined)
                return json(404, { error: 'the draft does not exist' });
            let raw;
            try {
                raw = JSON.parse(text);
            }
            catch {
                return json(400, { errors: [{ path: '', message: 'the draft is not valid JSON' }] });
            }
            try {
                const definition = validateDefinition(raw, name);
                return json(200, { name, definition });
            }
            catch (error) {
                return json(400, { errors: definitionErrors(error) });
            }
        }),
        route(EDITOR_LAYOUT_ROUTE, async (request) => {
            const resolved = resolveSession(services, request);
            if ('response' in resolved)
                return resolved.response;
            if (request.method === 'GET') {
                const id = idOf(request);
                if (id === null)
                    return json(400, { error: 'a definition id is required' });
                if (!DEFINITION_ID.test(id))
                    return json(400, { error: 'the definition id is unsafe' });
                try {
                    const read = await readLayout(resolved.workspace, id);
                    return json(200, read === undefined
                        ? { layout: null, revision: null }
                        : { layout: read.layout, revision: read.revision });
                }
                catch (error) {
                    // An unreadable sidecar is reported with its revision so the editor
                    // can replace it instead of being stuck on a conflict it cannot see.
                    // A linked or escaped file has no revision the editor may use.
                    const revision = await containedLayoutRevision(resolved.workspace, id);
                    return json(200, {
                        layout: null,
                        revision,
                        errors: [{ path: '', message: bounded(error) }],
                    });
                }
            }
            const body = await bodyOf(request);
            if (body === undefined)
                return json(400, { error: 'the body must be a JSON object' });
            const id = typeof body.id === 'string' ? body.id : '';
            if (!DEFINITION_ID.test(id)) {
                return json(400, { error: 'the layout id is required and safe' });
            }
            const expected = expectedOf(body.expectedRevision);
            if (expected instanceof Response)
                return expected;
            let layout;
            try {
                layout = validateLayout(body.layout, id);
            }
            catch (error) {
                return json(400, { errors: [{ path: '', message: bounded(error) }] });
            }
            return saveLayout(resolved.workspace, id, layout, expected);
        }, ['GET', 'PUT']),
        route(EDITOR_DEFINITION_ROUTE, async (request) => {
            const resolved = resolveSession(services, request);
            if ('response' in resolved)
                return resolved.response;
            if (request.method === 'GET') {
                const id = idOf(request);
                if (id === null)
                    return json(400, { error: 'a definition id is required' });
                try {
                    const document = await readDefinitionDocument(resolved.workspace, id);
                    if (document === undefined)
                        return json(404, { error: 'the definition does not exist' });
                    return json(200, document);
                }
                catch (error) {
                    return json(400, { errors: definitionErrors(error) });
                }
            }
            if (request.method === 'DELETE') {
                const body = await bodyOf(request);
                if (body === undefined)
                    return json(400, { error: 'the body must be a JSON object' });
                const id = typeof body.id === 'string' ? body.id : '';
                if (!DEFINITION_ID.test(id)) {
                    return json(400, { error: 'the definition id is required and safe' });
                }
                const expected = expectedOf(body.expectedRevision);
                if (expected instanceof Response)
                    return expected;
                return deleteDefinition(resolved.workspace, id, expected);
            }
            const body = await bodyOf(request);
            if (body === undefined)
                return json(400, { error: 'the body must be a JSON object' });
            const id = typeof body.id === 'string' ? body.id : '';
            if (!DEFINITION_ID.test(id)) {
                return json(400, { error: 'the definition id is required and safe' });
            }
            const expected = expectedOf(body.expectedRevision);
            if (expected instanceof Response)
                return expected;
            return saveDefinition(services, resolved.workspace, id, body.definition, expected);
        }, ['GET', 'PUT', 'DELETE']),
    ];
}
/** Register the editor routes on the Host Fetch carrier; absent means no writes. */
export function registerEditorRoutes(ctx, services) {
    const connection = ctx.get('connection');
    const register = connection?.fetch?.register;
    if (typeof register !== 'function')
        return false;
    for (const routeDefinition of createEditorRoutes(services)) {
        ctx.effect(() => register(routeDefinition));
    }
    return true;
}
