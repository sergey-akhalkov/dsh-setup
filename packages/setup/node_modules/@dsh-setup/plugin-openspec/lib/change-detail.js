import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { archivedDate, artifactPresent, artifactReadMessage, canonicalRoot, capabilityReadMessage, changePhase, commitFor, containedArtifact, containedItem, deltaSpecFiles, isoMtime, listWorkspaceCapabilities, newestModified, planningRoot, proposalSummary, purposeSection, readGitLog, readWorkspaceChangeRows, requireSafeCliName, runOpenSpecJson, scanArchiveProducers, specsRoot, } from './change-list.js';
/** The requested change or capability is not in the CLI's list for the workspace. */
export class UnreportedItemError extends Error {
}
/** The requested change is not in the CLI's list for this workspace. */
export function unreportedChangeMessage(name) {
    return `The OpenSpec change "${name}" is not reported for this workspace.`;
}
/** The requested archived change is not in the CLI's archived list for this workspace. */
export function unreportedArchivedChangeMessage(name) {
    return `The archived OpenSpec change "${name}" is not reported for this workspace.`;
}
/** The requested capability is not in the CLI's inventory for this workspace. */
export function unreportedCapabilityMessage(id) {
    return `The OpenSpec capability "${id}" is not reported for this workspace.`;
}
/** The CLI's structured requirement output is not the documented shape. */
export const REQUIREMENTS_MALFORMED_MESSAGE = '`openspec show --json` returned requirement data that could not be read.';
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
/** Read a capability spec the CLI reported; a failure names the capability file. */
async function readRequiredCapability(root, path) {
    const actual = containedArtifact(root, path, capabilityReadMessage);
    const modified = actual === null ? null : isoMtime(actual, path, capabilityReadMessage);
    if (actual === null || modified === null) {
        throw new Error(capabilityReadMessage(path, 'the file is missing'));
    }
    try {
        return { body: await readFile(actual, 'utf8'), modified };
    }
    catch (error) {
        throw new Error(capabilityReadMessage(path, causeOf(error)));
    }
}
/** The workspace-relative address of a resolved artifact path. */
function workspaceRelative(workspace, path) {
    return relative(workspace, path).split(sep).join('/');
}
/** The directory one change's artifacts live in, contained under its family root. */
function changeDirectory(workspace, name, archived) {
    const changes = resolve(workspace, 'openspec', 'changes');
    return containedItem(archived ? join(changes, 'archive') : changes, name);
}
/** Every markdown file under a change's `tasks/` directory, recursively, sorted. */
function nestedTaskFiles(root, directory) {
    const files = [];
    const pending = [join(directory, 'tasks')];
    while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined)
            continue;
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        }
        catch (error) {
            if (isMissing(error))
                continue;
            throw new Error(artifactReadMessage(current, causeOf(error)));
        }
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (entry.isDirectory())
                pending.push(path);
            else if (entry.isFile() && entry.name.endsWith('.md') && artifactPresent(root, path)) {
                files.push(path);
            }
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}
/** The files the CLI counts for an active change, from `openspec status --change`. */
async function activeTaskPaths(workspace, name) {
    requireSafeCliName(name, 'change');
    const parsed = await runOpenSpecJson(workspace, ['status', '--change', name, '--json'], 'status --change', planningRoot);
    const paths = [];
    const artifacts = isRecord(parsed.artifactPaths) ? parsed.artifactPaths : undefined;
    const tasks = isRecord(artifacts?.tasks) ? artifacts.tasks : undefined;
    if (Array.isArray(tasks?.existingOutputPaths)) {
        for (const entry of tasks.existingOutputPaths) {
            if (typeof entry === 'string' && entry.trim() !== '')
                paths.push(entry);
        }
    }
    return paths;
}
/** Read every task file the checklist must parse, active or archived. */
async function readTaskFiles(workspace, root, directory, name, archived) {
    let paths;
    if (archived) {
        paths = nestedTaskFiles(root, directory);
        if (artifactPresent(root, join(directory, 'tasks.md')))
            paths.unshift(join(directory, 'tasks.md'));
    }
    else {
        let statusRead = true;
        try {
            paths = await activeTaskPaths(workspace, name);
        }
        catch {
            // The status read is an optimization for custom schemas; the default
            // artifact still answers when it is unavailable.
            paths = [];
            statusRead = false;
        }
        if (!statusRead && artifactPresent(root, join(directory, 'tasks.md'))) {
            paths.push(join(directory, 'tasks.md'));
        }
    }
    const files = [];
    for (const path of paths) {
        const actual = containedArtifact(root, path, artifactReadMessage);
        if (actual === null)
            continue;
        try {
            files.push({
                path: workspaceRelative(workspace, actual),
                body: await readFile(actual, 'utf8'),
            });
        }
        catch (error) {
            if (isMissing(error))
                continue;
            throw new Error(artifactReadMessage(path, causeOf(error)));
        }
    }
    return files;
}
/** One requirement the CLI reports, validated field by field. */
function parseRequirement(value) {
    if (!isRecord(value) ||
        typeof value.name !== 'string' ||
        typeof value.text !== 'string' ||
        !Array.isArray(value.scenarios)) {
        throw new Error(REQUIREMENTS_MALFORMED_MESSAGE);
    }
    const scenarios = value.scenarios.map((scenario) => {
        if (!isRecord(scenario) ||
            typeof scenario.name !== 'string' ||
            typeof scenario.rawText !== 'string') {
            throw new Error(REQUIREMENTS_MALFORMED_MESSAGE);
        }
        return { name: scenario.name, rawText: scenario.rawText };
    });
    return { name: value.name, text: value.text, scenarios };
}
/** One structured requirement list the CLI reports. */
function parseRequirementList(value) {
    if (!Array.isArray(value))
        throw new Error(REQUIREMENTS_MALFORMED_MESSAGE);
    return value.map(parseRequirement);
}
/** One rename pair the CLI reports. */
function parseRename(value) {
    if (!isRecord(value) || typeof value.from !== 'string' || typeof value.to !== 'string') {
        throw new Error(REQUIREMENTS_MALFORMED_MESSAGE);
    }
    return { from: value.from, to: value.to };
}
function isOperation(value) {
    return value === 'ADDED' || value === 'MODIFIED' || value === 'REMOVED' || value === 'RENAMED';
}
/**
 * The structured deltas of an active change, from the CLI.
 *
 * The CLI emits one entry per requirement; consecutive entries for the same
 * capability and operation join into one delta so the view renders one card per
 * section. Every `RENAMED` entry becomes its own pair.
 */
async function activeDeltas(workspace, name) {
    requireSafeCliName(name, 'change');
    const parsed = await runOpenSpecJson(workspace, ['show', name, '--json', '--type', 'change'], 'show --type change');
    if (!Array.isArray(parsed.deltas))
        throw new Error(REQUIREMENTS_MALFORMED_MESSAGE);
    const deltas = [];
    for (const entry of parsed.deltas) {
        if (!isRecord(entry) || typeof entry.spec !== 'string' || !isOperation(entry.operation)) {
            throw new Error(REQUIREMENTS_MALFORMED_MESSAGE);
        }
        if (entry.operation === 'RENAMED') {
            deltas.push({
                capability: entry.spec,
                operation: 'RENAMED',
                requirements: [],
                rename: parseRename(entry.rename),
            });
            continue;
        }
        // The CLI's prose fallback emits description-only deltas when a change has
        // no delta sections; they still describe an operation, so keep them.
        const requirements = entry.requirements === undefined ? [] : parseRequirementList(entry.requirements);
        const last = deltas.at(-1);
        if (last !== undefined &&
            last.capability === entry.spec &&
            last.operation === entry.operation) {
            requirements.unshift(...last.requirements);
            deltas[deltas.length - 1] = { ...last, requirements };
        }
        else {
            deltas.push({ capability: entry.spec, operation: entry.operation, requirements });
        }
    }
    return deltas;
}
const DELTA_SECTION = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;
const REQUIREMENT_HEADING = /^###\s+Requirement:\s*(.*)$/i;
const ANY_HEADING = /^#{1,6}\s/;
const RENAME_FROM = /^\s*[-*+]?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/i;
const RENAME_TO = /^\s*[-*+]?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/i;
/**
 * Parse one archived delta spec file, line by line.
 *
 * The sections and headers are the delta grammar the CLI itself accepts; text
 * is preserved verbatim. A file with no delta section yields nothing, so the
 * view falls back to the raw Markdown body it already carries.
 * @param capability - the capability the delta file belongs to.
 * @param body - the delta spec Markdown.
 */
export function parseArchivedDeltas(capability, body) {
    const lines = body
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .split('\n');
    const deltas = [];
    let operation;
    let requirements;
    let requirement;
    let scenario;
    let renameFrom;
    let fence;
    const flushScenario = () => {
        if (scenario === undefined || requirement === undefined)
            return;
        requirement.scenarios.push({
            name: scenario.name,
            rawText: scenario.rawText.join('\n').trim(),
        });
        scenario = undefined;
    };
    const flushRequirement = () => {
        flushScenario();
        if (requirement === undefined || requirements === undefined)
            return;
        requirements.push({
            name: requirement.name,
            text: requirement.text.join('\n').trim(),
            scenarios: requirement.scenarios,
        });
        requirement = undefined;
    };
    const append = (line) => {
        if (requirement === undefined || operation === 'RENAMED')
            return;
        if (scenario !== undefined)
            scenario.rawText.push(line);
        else
            requirement.text.push(line);
    };
    for (const line of lines) {
        const trimmed = line.trim();
        const fenceStart = /^\s*(`{3,}|~{3,})/.exec(line);
        if (fence === undefined) {
            if (fenceStart !== null) {
                const run = fenceStart[1] ?? '```';
                fence = { char: run.slice(0, 1), length: run.length };
                append(line);
                continue;
            }
        }
        else {
            // A shorter run inside the block (a nested example fence) never closes
            // it; only a same-character run at least as long as the opener does.
            const closer = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
            if (closer !== null &&
                (closer[1] ?? '').slice(0, 1) === fence.char &&
                (closer[1] ?? '').length >= fence.length) {
                fence = undefined;
                append(line);
                continue;
            }
            append(line);
            continue;
        }
        const sectionMatch = DELTA_SECTION.exec(trimmed);
        if (sectionMatch !== null) {
            flushRequirement();
            operation = (sectionMatch[1] ?? '').toUpperCase();
            requirements = [];
            renameFrom = undefined;
            if (operation !== 'RENAMED')
                deltas.push({ capability, operation, requirements });
            continue;
        }
        if (/^#{1,2}\s+/.test(trimmed)) {
            // Any other level-1/2 heading ends the delta section; requirements after
            // it are not part of the preceding operation.
            flushRequirement();
            operation = undefined;
            requirements = undefined;
            renameFrom = undefined;
            continue;
        }
        if (operation === 'RENAMED') {
            const to = RENAME_TO.exec(line);
            if (to !== null) {
                if (renameFrom !== undefined) {
                    deltas.push({
                        capability,
                        operation: 'RENAMED',
                        requirements: [],
                        rename: { from: renameFrom, to: (to[1] ?? '').trim() },
                    });
                }
                renameFrom = undefined;
                continue;
            }
            const from = RENAME_FROM.exec(line);
            if (from !== null)
                renameFrom = (from[1] ?? '').trim();
            continue;
        }
        if (requirements === undefined)
            continue;
        const requirementMatch = REQUIREMENT_HEADING.exec(trimmed);
        if (requirementMatch !== null) {
            flushRequirement();
            requirement = { name: (requirementMatch[1] ?? '').trim(), text: [], scenarios: [] };
            continue;
        }
        const headingMatch = /^####\s+(.*)$/.exec(trimmed);
        if (headingMatch !== null && requirement !== undefined) {
            // The CLI treats every level-4 child of a requirement as a scenario;
            // keeping its body here preserves the same content.
            flushScenario();
            const title = (headingMatch[1] ?? '').trim();
            scenario = { name: title.replace(/^Scenario:\s*/i, ''), rawText: [] };
            continue;
        }
        // A stray `###` divider and level-5/6 headings are verbatim body text.
        if (ANY_HEADING.test(trimmed)) {
            append(line);
            continue;
        }
        if (requirement === undefined)
            continue;
        append(line);
    }
    flushRequirement();
    return deltas;
}
/** One archived change's delta specs, parsed into deltas and raw bodies. */
function archivedDeltas(files, bodies) {
    const deltas = [];
    for (const spec of files) {
        const body = bodies.get(spec.capability);
        if (body === undefined)
            continue;
        deltas.push(...parseArchivedDeltas(spec.capability, body));
    }
    return deltas;
}
/** Join archived producers with the CLI row counts and the batched commit facts. */
function historyEntries(producers, archivedRows, git) {
    const entries = [];
    for (const producer of producers) {
        const row = archivedRows.get(producer.name);
        if (row === undefined)
            continue;
        entries.push({
            name: producer.name,
            date: producer.date ?? '',
            completedTasks: row.completedTasks,
            totalTasks: row.totalTasks,
            commit: commitFor(git, `openspec/changes/archive/${producer.name}`),
        });
    }
    return entries;
}
/**
 * Read one change's artifact bodies, deltas, task files and progress.
 * @param workspace - absolute session working directory.
 * @param name - a change name the CLI reports for the matching family.
 * @param archived - resolve the name against the archived list only.
 * @throws a readable error when the change is unreported, escapes the root, or an artifact is unreadable.
 */
export async function readWorkspaceChange(workspace, name, archived = false) {
    const rows = await readWorkspaceChangeRows(workspace);
    const family = archived ? rows.archived : rows.changes;
    const row = family.find((change) => change.name === name);
    if (row === undefined) {
        throw new UnreportedItemError(archived ? unreportedArchivedChangeMessage(name) : unreportedChangeMessage(name));
    }
    const root = canonicalRoot(workspace);
    const directory = changeDirectory(workspace, name, archived);
    if (containedArtifact(root, directory, artifactReadMessage) === null) {
        throw new Error(artifactReadMessage(directory, 'the change directory is missing'));
    }
    const [proposal, design, tasks] = await Promise.all([
        readOptionalArtifact(root, join(directory, 'proposal.md')),
        readOptionalArtifact(root, join(directory, 'design.md')),
        readOptionalArtifact(root, join(directory, 'tasks.md')),
    ]);
    const specFiles = deltaSpecFiles(root, directory);
    const specs = await Promise.all(specFiles.map(async ({ capability, file }) => ({
        capability,
        ...(await readRequiredArtifact(root, file)),
    })));
    const specBodies = new Map(specs.map((spec) => [spec.capability, spec.body]));
    const deltas = archived
        ? archivedDeltas(specFiles, specBodies)
        : proposal === null
            ? []
            : await activeDeltas(workspace, name);
    const taskFiles = await readTaskFiles(workspace, root, directory, name, archived);
    const path = archived ? `openspec/changes/archive/${name}` : `openspec/changes/${name}`;
    const git = await readGitLog(workspace, [path]);
    return {
        name: row.name,
        status: row.status,
        phase: changePhase({ ...row, archived }),
        completedTasks: row.completedTasks,
        totalTasks: row.totalTasks,
        archived,
        archivedAt: archived ? archivedDate(name) : null,
        summary: proposalSummary(proposal?.body ?? null),
        modified: newestModified([
            ...(proposal === null ? [] : [proposal.modified]),
            ...(design === null ? [] : [design.modified]),
            ...(tasks === null ? [] : [tasks.modified]),
            ...specs.map((spec) => spec.modified),
        ]),
        commit: commitFor(git, path),
        presence: {
            proposal: proposal !== null,
            design: design !== null,
            tasks: tasks !== null,
            specs: specs.length,
        },
        artifacts: {
            proposal: proposal?.body ?? null,
            design: design?.body ?? null,
            tasks: tasks?.body ?? null,
        },
        specs,
        deltas,
        taskFiles,
    };
}
/** The capability rows for the Specs segment, with purpose and provenance. */
async function capabilityRows(workspace) {
    const [inventory, changes, producers] = await Promise.all([
        listWorkspaceCapabilities(workspace),
        readWorkspaceChangeRows(workspace),
        Promise.resolve().then(() => scanArchiveProducers(workspace)),
    ]);
    const archivedRows = new Map(changes.archived.map((row) => [row.name, row]));
    const git = await readGitLog(workspace, ['openspec/specs', 'openspec/changes/archive']);
    const root = canonicalRoot(workspace);
    const rows = await Promise.all(inventory.map(async (capability) => {
        const file = join(specsRoot(workspace), capability.id, 'spec.md');
        const actual = containedArtifact(root, file, capabilityReadMessage);
        let body = '';
        let modified = null;
        if (actual !== null) {
            modified = isoMtime(actual, file, capabilityReadMessage);
            if (modified !== null) {
                try {
                    body = await readFile(actual, 'utf8');
                }
                catch (error) {
                    if (!isMissing(error))
                        throw new Error(capabilityReadMessage(file, causeOf(error)));
                    modified = null;
                }
            }
        }
        const history = historyEntries(producers.get(capability.id) ?? [], archivedRows, git);
        return {
            id: capability.id,
            requirementCount: capability.requirementCount,
            purpose: purposeSection(body) ?? (await capabilityOverview(workspace, capability.id)),
            modified,
            lastChange: history[0] ?? null,
            commit: commitFor(git, `openspec/specs/${capability.id}`),
        };
    }));
    return rows;
}
/** The CLI's normalized overview for a capability, or '' when it cannot be read. */
async function capabilityOverview(workspace, id) {
    try {
        requireSafeCliName(id, 'capability');
        const parsed = await runOpenSpecJson(workspace, ['show', id, '--json', '--type', 'spec'], 'show --type spec');
        return typeof parsed.overview === 'string' ? parsed.overview.replace(/\s+/g, ' ').trim() : '';
    }
    catch {
        // The inventory row still renders without its one-line purpose.
        return '';
    }
}
/**
 * List the capability inventory with purpose, last modification and provenance.
 * @param workspace - absolute session working directory.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function listWorkspaceCapabilityRows(workspace) {
    return capabilityRows(workspace);
}
/**
 * Read one capability's accepted spec, structured requirements and history.
 * @param workspace - absolute session working directory.
 * @param id - a capability id the CLI reports for this workspace.
 * @throws a readable error when the capability is unreported, escapes the root, or an artifact is unreadable.
 */
export async function readWorkspaceCapability(workspace, id) {
    const inventory = await listWorkspaceCapabilities(workspace);
    const capability = inventory.find((entry) => entry.id === id);
    if (capability === undefined)
        throw new UnreportedItemError(unreportedCapabilityMessage(id));
    requireSafeCliName(id, 'capability');
    const root = canonicalRoot(workspace);
    const file = join(containedItem(specsRoot(workspace), id), 'spec.md');
    const artifact = await readRequiredCapability(root, file);
    const parsed = await runOpenSpecJson(workspace, ['show', id, '--json', '--type', 'spec'], 'show --type spec');
    const requirements = parseRequirementList(parsed.requirements);
    const overview = typeof parsed.overview === 'string' ? parsed.overview : null;
    const changes = await readWorkspaceChangeRows(workspace);
    const archivedRows = new Map(changes.archived.map((row) => [row.name, row]));
    const producers = scanArchiveProducers(workspace).get(id) ?? [];
    const git = await readGitLog(workspace, [
        `openspec/specs/${id}`,
        ...producers.map((producer) => `openspec/changes/archive/${producer.name}`),
    ]);
    const history = historyEntries(producers, archivedRows, git);
    return {
        id: capability.id,
        requirementCount: capability.requirementCount,
        purpose: purposeSection(artifact.body) ??
            (overview === null ? '' : overview.replace(/\s+/g, ' ').trim()),
        modified: artifact.modified,
        lastChange: history[0] ?? null,
        commit: commitFor(git, `openspec/specs/${id}`),
        body: artifact.body,
        requirements,
        history,
    };
}
