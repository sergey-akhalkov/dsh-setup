import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
export const WORK_CHECKPOINT_DIR = join('.dsh', 'work-checkpoints');
export const DELEGATION_DIR = join('.dsh', 'delegation');
export const WORKFLOW_EVENTS_DIR = join('.dsh', 'workflows', 'events');
/** The producer's checkpoint directory name: sha256 of the session id, first 16 hex. */
export function hashSession(sessionId) {
    return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function parseTime(value) {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return 0;
}
async function readJson(file) {
    try {
        return { value: JSON.parse(await readFile(file, 'utf8')) };
    }
    catch (error) {
        return { error: errorMessage(error) };
    }
}
async function listFiles(directory) {
    try {
        return await readdir(directory);
    }
    catch {
        return [];
    }
}
function displayPath(workspace, file) {
    return file.slice(workspace.length).replaceAll('\\', '/').replace(/^\//u, '');
}
function errorRun(id, source, workspace, file, attribution, session, error) {
    return {
        id,
        source,
        attribution,
        title: `Unreadable ${source} record`,
        startedAt: 0,
        status: 'unknown',
        steps: [],
        error: `${displayPath(workspace, file)}: ${error}`,
        record: displayPath(workspace, file),
        ...(session === undefined ? {} : { session }),
    };
}
function laneSteps(value) {
    if (!Array.isArray(value))
        return [];
    const steps = [];
    for (const entry of value) {
        if (!isRecord(entry) || typeof entry.id !== 'string')
            continue;
        const scope = Array.isArray(entry.scope)
            ? entry.scope.filter((item) => typeof item === 'string').join(', ')
            : undefined;
        steps.push({
            id: `lane:${entry.id}`,
            title: typeof entry.owner === 'string' ? `${entry.id} (${entry.owner})` : entry.id,
            state: typeof entry.state === 'string' ? entry.state : 'unknown',
            ...(scope === undefined || scope === '' ? {} : { evidence: scope }),
        });
    }
    return steps;
}
/**
 * Checkpoints for the requesting session only. The directory is the producer's
 * hash of the session id; the directory name and the redacted `session` field
 * are never read back as a session identity.
 */
export async function checkpointRuns(workspace, sessionId) {
    const directory = join(workspace, WORK_CHECKPOINT_DIR, hashSession(sessionId));
    const runs = [];
    for (const name of await listFiles(directory)) {
        if (!name.endsWith('.json'))
            continue;
        const file = join(directory, name);
        const turn = name.slice(0, -'.json'.length);
        const parsed = await readJson(file);
        if ('error' in parsed) {
            runs.push(errorRun(`checkpoint:${turn}`, 'checkpoint', workspace, file, 'local', sessionId, parsed.error));
            continue;
        }
        if (!isRecord(parsed.value)) {
            runs.push(errorRun(`checkpoint:${turn}`, 'checkpoint', workspace, file, 'local', sessionId, 'the record is not an object'));
            continue;
        }
        const record = parsed.value;
        const recordedTurn = typeof record.turn === 'number' ? record.turn : Number(turn);
        const startedAt = parseTime(record.time);
        const steps = [
            {
                id: 'outcome',
                title: 'Outcome',
                state: typeof record.outcome === 'string' ? record.outcome : 'unknown',
                ...(startedAt === 0 ? {} : { at: startedAt }),
            },
            ...laneSteps(record.lanes),
        ];
        if (isRecord(record.bottleneck) && typeof record.bottleneck.id === 'string') {
            const targets = Array.isArray(record.bottleneck.targets)
                ? record.bottleneck.targets
                    .filter((item) => typeof item === 'string')
                    .join(', ')
                : undefined;
            steps.push({
                id: 'bottleneck',
                title: `Bottleneck ${record.bottleneck.id}`,
                state: typeof record.bottleneck.action === 'string' ? record.bottleneck.action : 'unknown',
                ...(targets === undefined || targets === '' ? {} : { evidence: targets }),
            });
        }
        if (typeof record.next === 'string') {
            steps.push({ id: 'next', title: 'Next', state: 'next', evidence: record.next });
        }
        runs.push({
            id: `checkpoint:${String(recordedTurn)}`,
            source: 'checkpoint',
            session: sessionId,
            attribution: 'local',
            title: `Checkpoint turn ${String(recordedTurn)}`,
            startedAt,
            status: record.outcome === 'done' ? 'done' : 'running',
            steps,
            record: displayPath(workspace, file),
        });
    }
    return runs;
}
const LOCAL_SKIP = new Set(['runs', 'sessions', 'task-progress', 'worktrees', 'owners']);
/** Read every settled local review record; malformed files are not runs. */
export async function readLocalReviewRecords(workspace) {
    const delegation = join(workspace, DELEGATION_DIR);
    const records = [];
    for (const rule of await listFiles(delegation)) {
        if (LOCAL_SKIP.has(rule))
            continue;
        const ruleDirectory = join(delegation, rule);
        for (const change of await listFiles(ruleDirectory)) {
            const changeDirectory = join(ruleDirectory, change);
            for (const name of await listFiles(changeDirectory)) {
                const candidates = [];
                if (name.endsWith('.json'))
                    candidates.push(join(changeDirectory, name));
                if (name === 'tasks') {
                    for (const task of await listFiles(join(changeDirectory, name))) {
                        if (task.endsWith('.json'))
                            candidates.push(join(changeDirectory, name, task));
                    }
                }
                for (const file of candidates) {
                    const parsed = await readJson(file);
                    if ('error' in parsed || !isRecord(parsed.value))
                        continue;
                    records.push({ file, record: parsed.value });
                }
            }
        }
    }
    return records;
}
const RUN_STATES = new Set(['queued', 'running', 'completed', 'failed', 'discarded']);
function runStatus(state) {
    if (state === 'queued' || state === 'running')
        return 'running';
    if (state === 'completed')
        return 'done';
    if (state === 'failed' || state === 'discarded')
        return 'failed';
    return 'unknown';
}
/**
 * Delegation runs. Session attribution comes from an observed starting/queuing
 * result or a settled record whose `runId` equals the run id; the run's record
 * path is a display hint only.
 */
export async function delegationRuns(workspace, observedSessions, localRecords) {
    const directory = join(workspace, DELEGATION_DIR, 'runs');
    const byRunId = new Map();
    for (const local of localRecords) {
        if (typeof local.record.runId === 'string')
            byRunId.set(local.record.runId, local);
    }
    const runs = [];
    for (const name of await listFiles(directory)) {
        if (!name.endsWith('.json'))
            continue;
        const file = join(directory, name);
        const id = name.slice(0, -'.json'.length);
        const parsed = await readJson(file);
        if ('error' in parsed) {
            runs.push(errorRun(`delegation:${id}`, 'delegation', workspace, file, 'unattributed', undefined, parsed.error));
            continue;
        }
        if (!isRecord(parsed.value)) {
            runs.push(errorRun(`delegation:${id}`, 'delegation', workspace, file, 'unattributed', undefined, 'the record is not an object'));
            continue;
        }
        const record = parsed.value;
        const runId = typeof record.id === 'string' ? record.id : id;
        if (typeof record.rule !== 'string' ||
            typeof record.change !== 'string' ||
            !RUN_STATES.has(record.state)) {
            runs.push(errorRun(`delegation:${id}`, 'delegation', workspace, file, 'unattributed', undefined, 'missing or invalid id, rule, change, or state'));
            continue;
        }
        const joined = byRunId.get(runId);
        const session = observedSessions.get(runId) ??
            (typeof joined?.record.session === 'string' ? joined.record.session : undefined);
        const steps = [
            { id: 'rule', title: record.rule, state: String(record.state) },
            {
                id: 'change',
                title: typeof record.taskId === 'string' ? record.taskId : record.change,
                state: 'review',
                evidence: record.change,
            },
            { id: 'state', title: 'Run state', state: String(record.state) },
        ];
        if (joined !== undefined) {
            const verdict = typeof joined.record.verdict === 'string' ? joined.record.verdict : 'unknown';
            steps.push({
                id: 'record',
                title: 'Review verdict',
                state: verdict,
                at: parseTime(joined.record.time),
                evidence: displayPath(workspace, joined.file),
            });
        }
        const status = runStatus(record.state);
        runs.push({
            id: `delegation:${runId}`,
            source: 'delegation',
            ...(session === undefined ? {} : { session }),
            attribution: session === undefined ? 'unattributed' : 'local',
            title: `${record.rule} ${record.change}`,
            startedAt: parseTime(record.startedAt),
            status,
            steps,
            ...(typeof record.detail === 'string' && (status === 'failed' || status === 'unknown')
                ? { error: record.detail }
                : {}),
            record: displayPath(workspace, file),
        });
    }
    return runs;
}
/** Portable task approvals under `openspec/changes/*\/reviews/*.json`. */
export async function portableReviewRuns(workspace, localRecords) {
    const changesDirectory = join(workspace, 'openspec', 'changes');
    const runs = [];
    for (const change of await listFiles(changesDirectory)) {
        const reviews = join(changesDirectory, change, 'reviews');
        for (const name of await listFiles(reviews)) {
            if (!name.endsWith('.json'))
                continue;
            const file = join(reviews, name);
            const taskId = name.slice(0, -'.json'.length);
            const parsed = await readJson(file);
            if ('error' in parsed) {
                runs.push(errorRun(`review:${change}/${taskId}`, 'review', workspace, file, 'unattributed', undefined, parsed.error));
                continue;
            }
            if (!isRecord(parsed.value)) {
                runs.push(errorRun(`review:${change}/${taskId}`, 'review', workspace, file, 'unattributed', undefined, 'the record is not an object'));
                continue;
            }
            const record = parsed.value;
            if (typeof record.change !== 'string' ||
                typeof record.taskId !== 'string' ||
                typeof record.digest !== 'string' ||
                typeof record.verdict !== 'string') {
                runs.push(errorRun(`review:${change}/${taskId}`, 'review', workspace, file, 'unattributed', undefined, 'missing or invalid change, taskId, digest, or verdict'));
                continue;
            }
            const match = localRecords.find((local) => local.record.change === record.change &&
                local.record.taskId === record.taskId &&
                local.record.digest === record.digest &&
                typeof local.record.session === 'string');
            const session = match?.record.session;
            const startedAt = parseTime(record.time);
            runs.push({
                id: `review:${record.change}/${record.taskId}`,
                source: 'review',
                ...(session === undefined ? {} : { session }),
                attribution: session === undefined ? 'unattributed' : 'portable',
                title: `Review ${record.change} ${record.taskId}`,
                startedAt,
                status: record.verdict === 'PASS' ? 'done' : record.verdict === 'ERROR' ? 'failed' : 'unknown',
                steps: [
                    { id: 'verdict', title: 'Verdict', state: record.verdict },
                    {
                        id: 'target',
                        title: 'Target',
                        state: 'target',
                        evidence: isRecord(record.target) ? JSON.stringify(record.target) : undefined,
                    },
                    { id: 'digest', title: 'Digest', state: 'digest', evidence: record.digest },
                    { id: 'task', title: 'Task', state: record.taskId },
                ],
                record: displayPath(workspace, file),
            });
        }
    }
    return runs;
}
/**
 * Observed delegation ownership from the journal: the earliest `delegate`
 * result that reported starting or queuing a run. An `already pending` result
 * names the run but must not establish or transfer ownership.
 */
export async function delegationObservations(workspace) {
    const directory = join(workspace, WORKFLOW_EVENTS_DIR);
    const observed = new Map();
    for (const name of await listFiles(directory)) {
        if (!name.endsWith('.jsonl'))
            continue;
        let raw = '';
        try {
            raw = await readFile(join(directory, name), 'utf8');
        }
        catch {
            continue;
        }
        for (const line of raw.split('\n')) {
            if (line.trim() === '')
                continue;
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (!isRecord(value) || value.kind !== 'tools/result' || value.subject !== 'delegate')
                continue;
            if (typeof value.session !== 'string' || typeof value.summary !== 'string')
                continue;
            const started = /delegate review (started|queued); run: (run-[a-z0-9]+-[a-f0-9]{8})/u.exec(value.summary);
            if (started === null || started[2] === undefined)
                continue;
            const at = typeof value.at === 'number' ? value.at : 0;
            const current = observed.get(started[2]);
            if (current === undefined || at < current.at) {
                observed.set(started[2], { session: value.session, at });
            }
        }
    }
    const sessions = new Map();
    for (const [runId, entry] of observed)
        sessions.set(runId, entry.session);
    return sessions;
}
/** Every projected run in one workspace, unattributed runs included. */
export async function workspaceRuns(workspace) {
    const [observations, localRecords] = await Promise.all([
        delegationObservations(workspace),
        readLocalReviewRecords(workspace),
    ]);
    const [delegation, reviews] = await Promise.all([
        delegationRuns(workspace, observations, localRecords),
        portableReviewRuns(workspace, localRecords),
    ]);
    return [...delegation, ...reviews].sort(compareRuns);
}
/** The requesting session's timeline: only attributed runs, in time order. */
export async function sessionRuns(workspace, sessionId) {
    const [checkpoints, workspaceRunsList] = await Promise.all([
        checkpointRuns(workspace, sessionId),
        workspaceRuns(workspace),
    ]);
    return [...checkpoints, ...workspaceRunsList]
        .filter((run) => run.attribution !== 'unattributed' && run.session === sessionId)
        .sort(compareRuns);
}
function compareRuns(left, right) {
    if (left.startedAt !== right.startedAt)
        return left.startedAt - right.startedAt;
    return left.id.localeCompare(right.id);
}
/** Whether a path is inside the workspace; adapters never read outside it. */
export function insideWorkspace(workspace, path) {
    const relative = path.slice(workspace.length);
    return path.startsWith(workspace) && (relative === '' || /^[\\/]/u.test(relative));
}
/** A file's age, used only to display and order error rows. */
export async function fileTime(file) {
    try {
        return (await stat(file)).mtimeMs;
    }
    catch {
        return 0;
    }
}
