import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkspaceCapabilityRows, readWorkspaceCapability, readWorkspaceChange, UnreportedItemError, } from './change-detail.js';
import { archiveWorkspaceChange, listWorkspaceChanges } from './change-list.js';
import { registerWorkflowsContribution } from './workflows.js';
/**
 * OpenSpec plugin: registers the six generated core skills from a pinned
 * upstream release as on-demand catalog entries in the profile's global skill
 * layer. The skill bodies load from the vendored assets only when invoked.
 *
 * The OpenSpec CLI is a machine prerequisite, not a bundle dependency: this
 * module never installs, downloads, or fetches it. The Web-only change-list
 * route runs the documented CLI on demand for the `/openspec-apply` picker;
 * the adapter note carried by every loaded skill states the prerequisite and
 * the project-local root/cleanup rules at the point of use, and the
 * task-lifecycle skills also carry the plugin-owned task-lane guidance.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-openspec';
/** Service the registration depends on. */
export const inject = ['skills'];
/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-openspec';
/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600;
/** Exact number of skills the pinned core profile generates. */
const SKILL_COUNT = 6;
const OPENSPEC_REPOSITORY = 'https://github.com/Fission-AI/OpenSpec';
const OPENSPEC_PACKAGE = '@fission-ai/openspec';
const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const assetsDirectory = join(packageDirectory, 'assets', 'openspec');
const guidanceFile = join(packageDirectory, 'assets', 'guidance', 'task-lanes.md');
const lockFile = join(packageDirectory, 'openspec.lock.json');
/** Skills whose loaded body carries the plugin-owned task-lane guidance. */
const GUIDANCE_SKILLS = new Set([
    'openspec-apply-change',
    'openspec-propose',
    'openspec-update-change',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${name}: ${field} must be a non-empty string`);
    }
    return value;
}
/** Read and validate the vendored provenance lock that describes the pin. */
function readLock() {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf8'));
    if (!isRecord(parsed))
        throw new Error(`${name}: openspec.lock.json must be a JSON object`);
    if (!isRecord(parsed.upstream))
        throw new Error(`${name}: openspec.lock.json is missing upstream`);
    if (!Array.isArray(parsed.skills))
        throw new Error(`${name}: openspec.lock.json is missing skills`);
    const version = requireString(parsed.upstream.version, 'upstream.version');
    const skills = parsed.skills.map((entry, index) => {
        if (!isRecord(entry))
            throw new Error(`${name}: skills[${index}] must be a JSON object`);
        return {
            name: requireString(entry.name, `skills[${index}].name`),
            description: requireString(entry.description, `skills[${index}].description`),
            path: requireString(entry.path, `skills[${index}].path`),
        };
    });
    if (skills.length !== SKILL_COUNT) {
        throw new Error(`${name}: expected ${SKILL_COUNT} skills, found ${skills.length}`);
    }
    const seen = new Set();
    for (const skill of skills) {
        if (seen.has(skill.name))
            throw new Error(`${name}: duplicate skill "${skill.name}"`);
        seen.add(skill.name);
    }
    return { version, skills };
}
/** Read the plugin-owned guidance appended to the task-lifecycle skill bodies. */
function readGuidance() {
    const text = readFileSync(guidanceFile, 'utf8');
    if (text.trim() === '')
        throw new Error(`${name}: guidance asset ${guidanceFile} is empty`);
    return text;
}
/** Refuse a lock that no longer contains every skill the guidance targets. */
export function assertGuidanceTargets(skills) {
    for (const skillName of GUIDANCE_SKILLS) {
        if (!skills.some((skill) => skill.name === skillName)) {
            throw new Error(`${name}: task-lane guidance targets missing skill "${skillName}"`);
        }
    }
}
/** Resolve one recorded skill path, refusing anything outside the vendored assets directory. */
function skillFile(record) {
    const file = resolve(packageDirectory, record.path);
    if (!file.startsWith(`${assetsDirectory}${sep}`)) {
        throw new Error(`${name}: skill "${record.name}" resolves outside ${assetsDirectory}`);
    }
    return file;
}
function resourceBase(file) {
    return { kind: 'directory', path: dirname(file).replaceAll('\\', '/') };
}
function stripFrontmatter(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '');
}
function adapterNote(version) {
    return [
        '',
        '',
        '---',
        '',
        `DeepSeek Harness adapter: this skill is packaged from OpenSpec ${version} (${OPENSPEC_REPOSITORY}, MIT) and is available in every workspace of this profile.`,
        "Specs live in the workspace's own `openspec/` root. When none exists, run `openspec init --tools none` at the workspace root; do not install skills into the project, because these skills are already global.",
        'Delete any project-local `.dsh/skills/openspec-*` copies left by an earlier `openspec init --tools dsh`; they shadow this packaged set and drift on every OpenSpec update.',
        `The OpenSpec CLI is a machine prerequisite. If \`openspec\` is not found, ask the user to run \`npm install -g ${OPENSPEC_PACKAGE}@${version}\`; the setup does not install runtime prerequisites.`,
    ].join('\n');
}
/** Build the provider that lists the pinned candidates and reads their bodies on demand. */
function createSkillProvider(lock, guidance) {
    const invocation = { modelInvocable: true, userInvocable: true };
    const candidates = new Map();
    for (const record of lock.skills) {
        const file = skillFile(record);
        candidates.set(record.name, {
            name: record.name,
            description: record.description,
            invocation,
            provider: PROVIDER_NAME,
            source: 'bundled',
            resourceBase: resourceBase(file),
            rank: BUNDLED_SKILL_RANK,
            locator: file,
        });
    }
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve([...candidates.values()]),
        async get(loaded, options) {
            const candidate = candidates.get(loaded.name);
            if (candidate === undefined)
                return undefined;
            const file = String(candidate.locator);
            const raw = await readFile(file, { encoding: 'utf8', signal: options.signal });
            return {
                name: candidate.name,
                description: candidate.description,
                invocation,
                provider: PROVIDER_NAME,
                source: 'bundled',
                resourceBase: resourceBase(file),
                content: `${stripFrontmatter(raw)}${GUIDANCE_SKILLS.has(candidate.name) ? `\n\n${guidance}` : ''}${adapterNote(lock.version)}`,
            };
        },
    };
}
/** Register the pinned skill set from the committed lock. */
export function apply(ctx) {
    const lock = readLock();
    assertGuidanceTargets(lock.skills);
    const guidance = readGuidance();
    ctx.skills.registerProvider(() => createSkillProvider(lock, guidance));
    registerChangeRoute(ctx);
    registerWorkflowsContribution(ctx);
}
/**
 * Read-only fetch routes the Client picker and panel ask for the session
 * workspace's OpenSpec data. They live under `/api` so the carrier-neutral
 * `connection.fetch` registry serves them: the Web carrier through the `/api`
 * bridge and the desktop shell carrier through its directly dispatched Fetch
 * handler.
 */
export const CHANGES_ROUTE = '/api/plugins/dsh-setup-openspec/changes';
/** One change's artifact bodies and progress, addressed by its CLI-reported name. */
export const CHANGE_DETAIL_ROUTE = '/api/plugins/dsh-setup-openspec/change';
/** The capability inventory, or one capability's spec body when `id` is given. */
export const SPECS_ROUTE = '/api/plugins/dsh-setup-openspec/specs';
/**
 * The one authorized write: archive a completed change after the user clicked
 * `Archive`. The click is the confirmation; the body names the live session and
 * the change, never a path.
 */
export const ARCHIVE_ROUTE = '/api/plugins/dsh-setup-openspec/archive';
function changeRouteServices(ctx) {
    const connection = ctx.get('connection');
    const fetch = connection?.fetch;
    const agents = ctx.get('agents');
    const workingDirectory = ctx.get('workingDirectory');
    if (fetch === undefined ||
        typeof fetch.register !== 'function' ||
        agents === undefined ||
        workingDirectory === undefined) {
        return undefined;
    }
    return { connection: { fetch }, agents, workingDirectory };
}
function jsonResponse(status, body) {
    return Response.json(body, { status });
}
/** The readable 500 body a failed read returns. */
function errorResponse(error, fallback) {
    return jsonResponse(500, {
        error: error instanceof Error ? error.message : fallback,
    });
}
/** The 400 for an item the CLI did not report, otherwise the readable 500. */
function readErrorResponse(error, fallback) {
    if (error instanceof UnreportedItemError) {
        return jsonResponse(400, { error: error.message });
    }
    return errorResponse(error, fallback);
}
/**
 * Resolve one live session id to its workspace. A returned `Response` is the
 * refusal; the workspace always comes from the session, never from request
 * text other than the session id.
 */
function liveWorkspace(services, sessionId) {
    if (sessionId === null || sessionId === '') {
        return { response: jsonResponse(400, { error: 'A session id is required.' }) };
    }
    const agent = services.agents.get(sessionId);
    if (agent === undefined) {
        return { response: jsonResponse(400, { error: 'The session is not live in this host.' }) };
    }
    return { workspace: services.workingDirectory.get(agent.session) };
}
function sessionWorkspace(services, request) {
    return liveWorkspace(services, new URL(request.url).searchParams.get('session'));
}
/** Read the optional engine service at request time; a host without it skips the engine checks. */
function archiveGateOf(ctx) {
    try {
        const gate = ctx.get('workflowsArchiveGate');
        return gate !== undefined && typeof gate.authorizeAndCheck === 'function' ? gate : undefined;
    }
    catch {
        return undefined;
    }
}
/** A bounded one-line reason, never the whole request body. */
function boundedReason(text) {
    return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}
/**
 * Register the workspace-scoped OpenSpec routes on the Host's fetch registry:
 * the picker's change list (now carrying artifact presence), one change's
 * artifacts, the capability inventory or one spec body, and the one authorized
 * write — archiving a completed change after its user-clicked authorization.
 * Every request carries a session id and at most an item name; the workspace
 * comes from that live session, never from the request. The carrier admits each
 * request (origin/cookie fence) before dispatching to these handlers. Each
 * registration is an effect, so disposal removes the routes with the context
 * that owns them.
 */
function registerRoutes(ctx) {
    const services = changeRouteServices(ctx);
    if (services === undefined)
        return;
    const routes = [
        {
            path: CHANGES_ROUTE,
            methods: ['GET'],
            requestBody: 'buffered',
            async fetch(request) {
                const resolved = sessionWorkspace(services, request);
                if ('response' in resolved)
                    return resolved.response;
                try {
                    return jsonResponse(200, await listWorkspaceChanges(resolved.workspace));
                }
                catch (error) {
                    return errorResponse(error, 'The change list could not be read.');
                }
            },
        },
        {
            path: CHANGE_DETAIL_ROUTE,
            methods: ['GET'],
            requestBody: 'buffered',
            async fetch(request) {
                const resolved = sessionWorkspace(services, request);
                if ('response' in resolved)
                    return resolved.response;
                const name = new URL(request.url).searchParams.get('name');
                if (name === null || name === '') {
                    return jsonResponse(400, { error: 'A change name is required.' });
                }
                const archived = new URL(request.url).searchParams.get('archived') === '1';
                try {
                    const change = await readWorkspaceChange(resolved.workspace, name, archived);
                    return jsonResponse(200, { change });
                }
                catch (error) {
                    return readErrorResponse(error, 'The change could not be read.');
                }
            },
        },
        {
            path: SPECS_ROUTE,
            methods: ['GET'],
            requestBody: 'buffered',
            async fetch(request) {
                const resolved = sessionWorkspace(services, request);
                if ('response' in resolved)
                    return resolved.response;
                const id = new URL(request.url).searchParams.get('id');
                if (id === '') {
                    return jsonResponse(400, { error: 'A capability id is required.' });
                }
                try {
                    if (id === null) {
                        const capabilities = await listWorkspaceCapabilityRows(resolved.workspace);
                        return jsonResponse(200, { capabilities });
                    }
                    const capability = await readWorkspaceCapability(resolved.workspace, id);
                    return jsonResponse(200, { capability });
                }
                catch (error) {
                    return readErrorResponse(error, 'The capability could not be read.');
                }
            },
        },
        {
            path: ARCHIVE_ROUTE,
            methods: ['POST'],
            requestBody: 'buffered',
            async fetch(request) {
                let body;
                try {
                    body = await request.json();
                }
                catch {
                    return jsonResponse(400, { error: 'The archive request body must be JSON.' });
                }
                const sessionId = isRecord(body) && typeof body.session === 'string' ? body.session : '';
                const name = isRecord(body) && typeof body.name === 'string' ? body.name.trim() : '';
                if (sessionId === '' || name === '') {
                    return jsonResponse(400, { error: 'A session id and a change name are required.' });
                }
                const resolved = liveWorkspace(services, sessionId);
                if ('response' in resolved)
                    return resolved.response;
                let listed;
                try {
                    listed = await listWorkspaceChanges(resolved.workspace);
                }
                catch (error) {
                    return errorResponse(error, 'The change list could not be read.');
                }
                const change = listed.changes.find((row) => row.name === name);
                if (change === undefined) {
                    return jsonResponse(409, {
                        error: boundedReason(`The change "${name}" is not an active change in this workspace.`),
                    });
                }
                if (change.totalTasks === 0 || change.completedTasks !== change.totalTasks) {
                    return jsonResponse(409, {
                        error: boundedReason(`The change "${name}" is not complete (${String(change.completedTasks)}/${String(change.totalTasks)} tasks done); every task must be complete before it can be archived.`),
                    });
                }
                const gate = archiveGateOf(ctx);
                if (gate !== undefined) {
                    let decision;
                    try {
                        decision = await gate.authorizeAndCheck(resolved.workspace, name);
                    }
                    catch (error) {
                        return errorResponse(error, 'The archive gate could not be evaluated.');
                    }
                    if (!decision.ok)
                        return jsonResponse(409, { error: boundedReason(decision.reason) });
                }
                // The archive family before the CLI call distinguishes the newly added
                // row from a pre-existing archive with the same base name.
                let archivedBefore;
                try {
                    archivedBefore = new Set((await listWorkspaceChanges(resolved.workspace)).archived.map((row) => row.name));
                }
                catch {
                    archivedBefore = undefined;
                }
                try {
                    await archiveWorkspaceChange(resolved.workspace, name);
                }
                catch (error) {
                    return jsonResponse(409, {
                        error: boundedReason(error instanceof Error ? error.message : String(error)),
                    });
                }
                // The CLI renames the directory `<date>-<name>`; report the newly added
                // row so the client can open the real archived tab. A failed confirmation
                // read, or no identifiable new row, succeeds without an address: a
                // fabricated name is not a valid archived address.
                let archivedName;
                if (archivedBefore !== undefined) {
                    try {
                        archivedName = (await listWorkspaceChanges(resolved.workspace)).archived
                            .filter((row) => !archivedBefore?.has(row.name))
                            .find((row) => row.name.replace(/^\d{4}-\d{2}-\d{2}-/u, '') === name)?.name;
                    }
                    catch {
                        archivedName = undefined;
                    }
                }
                return jsonResponse(200, archivedName === undefined ? { ok: true } : { ok: true, name: archivedName });
            },
        },
    ];
    for (const route of routes) {
        const register = () => services.connection.fetch.register(route);
        if (typeof ctx.effect === 'function') {
            ctx.effect(register);
        }
        else {
            // A minimal host stub exposes get() only; registering is still safe.
            register();
        }
    }
}
/**
 * Register the OpenSpec routes when the Host services exist.
 *
 * The plain Web profile provides `connection`, `agents`, and
 * `workingDirectory` after this row mounts, so an absent probe waits through
 * cordis `inject` instead of silently registering nothing; the child context
 * owns the registrations. A host without `inject` (or an older host without
 * `connection.fetch`) keeps the six skills and registers nothing.
 */
export function registerChangeRoute(ctx) {
    if (changeRouteServices(ctx) !== undefined) {
        registerRoutes(ctx);
        return;
    }
    if (typeof ctx.inject !== 'function')
        return;
    ctx.inject(['connection', 'agents', 'workingDirectory'], (serviceCtx) => {
        registerRoutes(serviceCtx);
    });
}
