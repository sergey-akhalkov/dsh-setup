import { readdirSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { listWorkspaceChanges, runOpenSpecJson } from './change-list.js';
/** The requested change or capability is not in the CLI's list for the workspace. */
export class UnreportedItemError extends Error {
}
/** The requested change is not in the CLI's list for this workspace. */
export function unreportedChangeMessage(name) {
    return `The OpenSpec change "${name}" is not reported for this workspace.`;
}
/** The requested capability is not in the CLI's inventory for this workspace. */
export function unreportedCapabilityMessage(id) {
    return `The OpenSpec capability "${id}" is not reported for this workspace.`;
}
/** A request-named item resolves outside the workspace's own OpenSpec root. */
export const OUTSIDE_ROOT_MESSAGE = 'The requested OpenSpec item resolves outside the workspace OpenSpec root.';
/** A change artifact could not be read. */
export function artifactReadMessage(path, cause) {
    return `Could not read the OpenSpec artifact ${path}: ${cause}`;
}
/** A capability spec file could not be read. */
export function capabilityReadMessage(path, cause) {
    return `Could not read the OpenSpec capability spec ${path}: ${cause}`;
}
/** The CLI's `list --specs --json` output is not the documented shape. */
export const CAPABILITIES_MALFORMED_MESSAGE = '`openspec list --specs --json` returned output that could not be read.';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isMissing(error) {
    const code = error?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
function causeOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** The workspace's change directory root, resolved once per read. */
function changesRoot(workspace) {
    return resolve(workspace, 'openspec', 'changes');
}
/** The workspace's accepted-capability root, resolved once per read. */
function specsRoot(workspace) {
    return resolve(workspace, 'openspec', 'specs');
}
/** Whether a resolved path is strictly under a directory; case-insensitive on Windows. */
function insidePath(base, target) {
    const boundary = `${base}${sep}`;
    return process.platform === 'win32'
        ? target.toLowerCase().startsWith(boundary.toLowerCase())
        : target.startsWith(boundary);
}
/** Resolve one request-named item under an OpenSpec root, refusing a lexical escape. */
function containedItem(root, item) {
    const base = resolve(root);
    const target = resolve(base, item);
    if (!insidePath(base, target))
        throw new Error(OUTSIDE_ROOT_MESSAGE);
    return target;
}
/** Canonical real path of the workspace's own `openspec/` root. */
function canonicalRoot(workspace) {
    const root = resolve(workspace, 'openspec');
    try {
        return realpathSync.native(root);
    }
    catch (error) {
        if (isMissing(error))
            return root;
        throw new Error(`Could not resolve the OpenSpec root ${root}: ${causeOf(error)}`);
    }
}
/** Refuse a canonical path that escaped the canonical OpenSpec root. */
function requireInsideRoot(root, actual) {
    if (!insidePath(root, actual))
        throw new Error(OUTSIDE_ROOT_MESSAGE);
}
/** Realpath one artifact path; null when absent, a readable error otherwise. */
function realArtifactPath(path, message) {
    try {
        return realpathSync.native(path);
    }
    catch (error) {
        if (isMissing(error))
            return null;
        throw new Error(message(path, causeOf(error)));
    }
}
/** Contain one existing artifact path under the canonical root; null stays absent. */
function containedArtifact(root, path, message) {
    const actual = realArtifactPath(path, message);
    if (actual !== null)
        requireInsideRoot(root, actual);
    return actual;
}
/** ISO mtime of a contained artifact; null when it disappeared, readable error otherwise. */
function isoMtime(actual, path, message) {
    try {
        return new Date(statSync(actual).mtimeMs).toISOString();
    }
    catch (error) {
        if (isMissing(error))
            return null;
        throw new Error(message(path, causeOf(error)));
    }
}
/** The newest ISO timestamp among the given ones, or null when there are none. */
function newestModified(times) {
    let newest = null;
    for (const time of times) {
        if (newest === null || Date.parse(time) > Date.parse(newest))
            newest = time;
    }
    return newest;
}
/** The delta spec files under one change directory, sorted by capability. */
function deltaSpecFiles(root, changeDirectory) {
    const directory = join(changeDirectory, 'specs');
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    }
    catch (error) {
        if (isMissing(error))
            return [];
        throw new Error(`Could not read the OpenSpec delta specs directory ${directory}: ${causeOf(error)}`);
    }
    const files = [];
    for (const entry of entries) {
        const file = join(directory, entry.name, 'spec.md');
        const actual = realArtifactPath(file, artifactReadMessage);
        if (actual === null)
            continue;
        requireInsideRoot(root, actual);
        let present = false;
        try {
            present = statSync(actual).isFile();
        }
        catch (error) {
            if (isMissing(error))
                continue;
            throw new Error(artifactReadMessage(file, causeOf(error)));
        }
        if (!present)
            continue;
        files.push({ capability: entry.name, file });
    }
    return files.sort((left, right) => left.capability.localeCompare(right.capability));
}
/** Whether one artifact path canonically exists under the OpenSpec root. */
function artifactPresent(root, path) {
    return containedArtifact(root, path, artifactReadMessage) !== null;
}
/** Read an optional artifact; a missing artifact is null, other errors are readable. */
async function readOptionalArtifact(root, path) {
    const actual = containedArtifact(root, path, artifactReadMessage);
    if (actual === null)
        return null;
    const modified = isoMtime(actual, path, artifactReadMessage);
    if (modified === null)
        return null;
    try {
        return { body: await readFile(actual, 'utf8'), modified };
    }
    catch (error) {
        if (isMissing(error))
            return null;
        throw new Error(artifactReadMessage(path, causeOf(error)));
    }
}
/** Read an artifact the directory walk just found; a failure is a real error. */
async function readRequiredArtifact(root, path) {
    const actual = containedArtifact(root, path, artifactReadMessage);
    const modified = actual === null ? null : isoMtime(actual, path, artifactReadMessage);
    if (actual === null || modified === null) {
        throw new Error(artifactReadMessage(path, 'the file is missing'));
    }
    try {
        return { body: await readFile(actual, 'utf8'), modified };
    }
    catch (error) {
        throw new Error(artifactReadMessage(path, causeOf(error)));
    }
}
/**
 * The artifacts one CLI-reported change already carries.
 * @param workspace - absolute session working directory.
 * @param name - a change name; the changes route passes CLI rows only.
 */
export function changePresence(workspace, name) {
    const root = canonicalRoot(workspace);
    const directory = containedItem(changesRoot(workspace), name);
    if (containedArtifact(root, directory, artifactReadMessage) === null) {
        return { proposal: false, design: false, tasks: false, specs: 0 };
    }
    return {
        proposal: artifactPresent(root, join(directory, 'proposal.md')),
        design: artifactPresent(root, join(directory, 'design.md')),
        tasks: artifactPresent(root, join(directory, 'tasks.md')),
        specs: deltaSpecFiles(root, directory).length,
    };
}
/**
 * Read one change's artifact bodies and progress.
 * @param workspace - absolute session working directory.
 * @param name - a change name the CLI reports for this workspace.
 * @throws a readable error when the change is unreported, escapes the root, or an artifact is unreadable.
 */
export async function readWorkspaceChange(workspace, name) {
    const row = (await listWorkspaceChanges(workspace)).find((change) => change.name === name);
    if (row === undefined)
        throw new UnreportedItemError(unreportedChangeMessage(name));
    const root = canonicalRoot(workspace);
    const directory = containedItem(changesRoot(workspace), name);
    if (containedArtifact(root, directory, artifactReadMessage) === null) {
        throw new Error(artifactReadMessage(directory, 'the change directory is missing'));
    }
    const [proposal, design, tasks] = await Promise.all([
        readOptionalArtifact(root, join(directory, 'proposal.md')),
        readOptionalArtifact(root, join(directory, 'design.md')),
        readOptionalArtifact(root, join(directory, 'tasks.md')),
    ]);
    const specs = await Promise.all(deltaSpecFiles(root, directory).map(async ({ capability, file }) => ({
        capability,
        ...(await readRequiredArtifact(root, file)),
    })));
    return {
        name: row.name,
        status: row.status,
        completedTasks: row.completedTasks,
        totalTasks: row.totalTasks,
        presence: {
            proposal: proposal !== null,
            design: design !== null,
            tasks: tasks !== null,
            specs: specs.length,
        },
        modified: newestModified([
            ...(proposal === null ? [] : [proposal.modified]),
            ...(design === null ? [] : [design.modified]),
            ...(tasks === null ? [] : [tasks.modified]),
            ...specs.map((spec) => spec.modified),
        ]),
        artifacts: {
            proposal: proposal?.body ?? null,
            design: design?.body ?? null,
            tasks: tasks?.body ?? null,
        },
        specs,
    };
}
/**
 * List the capability specs of the workspace's own OpenSpec root.
 * @param workspace - absolute session working directory.
 * @returns the `{id, requirementCount}` rows `openspec list --specs --json` reports.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function listWorkspaceCapabilities(workspace) {
    const parsed = await runOpenSpecJson(workspace, ['list', '--specs', '--json'], 'list --specs');
    if (!Array.isArray(parsed.specs))
        throw new Error(CAPABILITIES_MALFORMED_MESSAGE);
    return parsed.specs.map((entry) => {
        if (!isRecord(entry) ||
            typeof entry.id !== 'string' ||
            entry.id.trim() === '' ||
            typeof entry.requirementCount !== 'number' ||
            !Number.isInteger(entry.requirementCount) ||
            entry.requirementCount < 0) {
            throw new Error(CAPABILITIES_MALFORMED_MESSAGE);
        }
        return { id: entry.id, requirementCount: entry.requirementCount };
    });
}
/**
 * Read one capability's accepted spec body.
 * @param workspace - absolute session working directory.
 * @param id - a capability id the CLI reports for this workspace.
 * @throws a readable error when the capability is unreported, escapes the root, or its spec is unreadable.
 */
export async function readWorkspaceCapability(workspace, id) {
    const capability = (await listWorkspaceCapabilities(workspace)).find((entry) => entry.id === id);
    if (capability === undefined)
        throw new UnreportedItemError(unreportedCapabilityMessage(id));
    const root = canonicalRoot(workspace);
    const file = join(containedItem(specsRoot(workspace), id), 'spec.md');
    const actual = containedArtifact(root, file, capabilityReadMessage);
    const modified = actual === null ? null : isoMtime(actual, file, capabilityReadMessage);
    if (actual === null || modified === null) {
        throw new Error(capabilityReadMessage(file, 'the file is missing'));
    }
    try {
        return {
            id: capability.id,
            requirementCount: capability.requirementCount,
            body: await readFile(actual, 'utf8'),
            modified,
        };
    }
    catch (error) {
        throw new Error(capabilityReadMessage(file, causeOf(error)));
    }
}
