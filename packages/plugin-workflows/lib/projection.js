import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isInside } from './fs-change.js';
import { redactPayload, redactText } from './redact.js';
import { definitionRefOf } from './runs.js';
export const KNOWN_STEP_STATES = new Set(['open', 'done', 'blocked', 'failed', 'cancelled']);
const WORK_CHECKPOINT_DIR = join('.dsh', 'work-checkpoints');
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
/** A record-derived display string with credential shapes removed. */
function safeText(value) {
    return value === undefined ? undefined : redactText(value);
}
/** A failure detail that may carry arbitrary structured credentials. */
function safeError(value) {
    return value === undefined ? undefined : redactPayload(value);
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
/** Canonical target when it stays inside the workspace; undefined otherwise. */
async function containedFile(workspace, file) {
    const root = await realpath(workspace).catch(() => undefined);
    if (root === undefined)
        return undefined;
    const target = await realpath(file).catch(() => undefined);
    if (target === undefined || !isInside(root, target))
        return undefined;
    return target;
}
async function readJson(workspace, file) {
    try {
        const target = await containedFile(workspace, file);
        if (target === undefined)
            return { error: 'the record path escapes the workspace or is unreadable' };
        return { value: JSON.parse(await readFile(target, 'utf8')) };
    }
    catch (error) {
        return { error: errorMessage(error) };
    }
}
async function listFiles(workspace, directory) {
    try {
        const target = await realpath(directory);
        const root = await realpath(workspace);
        if (!isInside(root, target))
            return [];
        return await readdir(target);
    }
    catch {
        return [];
    }
}
function displayPath(workspace, file) {
    return file.slice(workspace.length).replaceAll('\\', '/').replace(/^\//u, '');
}
function errorRun(id, source, workspace, file, attribution, session, error) {
    const display = file === undefined ? undefined : displayPath(workspace, file);
    return {
        id,
        source,
        attribution,
        title: `Unreadable ${source} record`,
        startedAt: 0,
        status: 'unknown',
        steps: [],
        error: safeError(display === undefined ? error : `${display}: ${error}`),
        ...(display === undefined ? {} : { record: display }),
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
            ...(scope === undefined || scope === '' ? {} : { evidence: safeText(scope) }),
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
    for (const name of await listFiles(workspace, directory)) {
        if (!name.endsWith('.json'))
            continue;
        const file = join(directory, name);
        const turn = name.slice(0, -'.json'.length);
        const parsed = await readJson(workspace, file);
        if ('error' in parsed) {
            runs.push(errorRun(`checkpoint:${turn}`, 'checkpoint', workspace, file, 'local', sessionId, parsed.error));
            continue;
        }
        if (!isRecord(parsed.value)) {
            runs.push(errorRun(`checkpoint:${turn}`, 'checkpoint', workspace, file, 'local', sessionId, 'the record is not an object'));
            continue;
        }
        const record = parsed.value;
        const invalid = checkpointRecordError(record);
        if (invalid !== undefined) {
            runs.push(errorRun(`checkpoint:${turn}`, 'checkpoint', workspace, file, 'local', sessionId, invalid));
            continue;
        }
        const recordedTurn = record.turn;
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
                ...(targets === undefined || targets === '' ? {} : { evidence: safeText(targets) }),
            });
        }
        if (typeof record.next === 'string') {
            steps.push({
                id: 'next',
                title: 'Next',
                state: 'next',
                evidence: safeText(record.next),
            });
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
const LANE_STATES = new Set(['running', 'blocked', 'done']);
/** Every required lane field the producer guarantees. */
function validLanes(value) {
    return (Array.isArray(value) &&
        value.every((lane) => isRecord(lane) &&
            typeof lane.id === 'string' &&
            typeof lane.owner === 'string' &&
            typeof lane.state === 'string' &&
            LANE_STATES.has(lane.state) &&
            Array.isArray(lane.scope) &&
            lane.scope.every((entry) => typeof entry === 'string')));
}
const BOTTLENECK_ACTIONS = new Set(['worker_start', 'lead_action', 'user_decision']);
function validBottleneck(value) {
    if (!isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.owner !== 'string' ||
        typeof value.action !== 'string' ||
        !BOTTLENECK_ACTIONS.has(value.action)) {
        return false;
    }
    if (value.targets !== undefined &&
        (!Array.isArray(value.targets) || !value.targets.every((entry) => typeof entry === 'string'))) {
        return false;
    }
    if (value.action === 'lead_action') {
        if (!Array.isArray(value.targets) || value.targets.length === 0)
            return false;
    }
    if (value.blockingLanes !== undefined &&
        (!Array.isArray(value.blockingLanes) ||
            !value.blockingLanes.every((entry) => typeof entry === 'string'))) {
        return false;
    }
    return true;
}
const LOCAL_SKIP = new Set([
    'runs',
    'sessions',
    'task-progress',
    'worktrees',
    'owners',
    'snapshots',
]);
const TASK_ID = /^[a-f0-9]{16}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const VERDICTS = new Set(['PASS', 'FINDINGS', 'ERROR']);
const LOCAL_SCOPES = new Set(['whole', 'task']);
function nonEmpty(value) {
    return typeof value === 'string' && value.trim() !== '';
}
function validFinding(value) {
    return (isRecord(value) &&
        (value.severity === 'P0' || value.severity === 'P1') &&
        nonEmpty(value.title) &&
        nonEmpty(value.evidence) &&
        nonEmpty(value.fix));
}
function validTarget(value) {
    if (!isRecord(value) || typeof value.provider !== 'string' || value.provider === '')
        return false;
    for (const field of ['model', 'reasoningEffort']) {
        if (value[field] !== undefined && typeof value[field] !== 'string')
            return false;
    }
    return true;
}
/** The producer contract for a settled local review record. */
/** The goal-continuity checkpoint record shape every reader accepts. */
export function checkpointRecordError(record) {
    if (typeof record.outcome !== 'string' ||
        (record.outcome !== 'done' && record.outcome !== 'continue') ||
        typeof record.turn !== 'number' ||
        !validLanes(record.lanes) ||
        typeof record.next !== 'string') {
        return 'missing or invalid outcome, turn, lanes, or next';
    }
    if ((record.outcome === 'continue' && !validBottleneck(record.bottleneck)) ||
        (record.bottleneck !== undefined && !validBottleneck(record.bottleneck))) {
        return 'missing or invalid bottleneck for the checkpoint outcome';
    }
    return undefined;
}
export function localRecordError(record) {
    for (const field of ['rule', 'change', 'phase', 'scope', 'digest', 'verdict', 'time']) {
        if (typeof record[field] !== 'string' || record[field] === '') {
            return `missing or invalid field "${field}"`;
        }
    }
    if (!DIGEST.test(record.digest))
        return 'field "digest" must be 64 hex characters';
    if (!VERDICTS.has(record.verdict)) {
        return 'field "verdict" must be PASS, FINDINGS, or ERROR';
    }
    if (!LOCAL_SCOPES.has(record.scope)) {
        return 'field "scope" must be "whole" or "task"';
    }
    if (!Array.isArray(record.findings) || !record.findings.every(validFinding)) {
        return 'field "findings" must be a list of P0/P1 findings';
    }
    if (record.verdict === 'PASS' && record.findings.length > 0) {
        return 'a PASS record must have zero findings';
    }
    if (record.verdict === 'FINDINGS' && record.findings.length === 0) {
        return 'a FINDINGS record must have at least one finding';
    }
    if (!validTarget(record.target))
        return 'field "target" must carry a provider';
    if (record.scope === 'task') {
        if (typeof record.taskId !== 'string' || !TASK_ID.test(record.taskId)) {
            return 'task-scoped record needs a 16-hex taskId';
        }
    }
    if (record.session !== undefined && typeof record.session !== 'string') {
        return 'field "session" must be a string';
    }
    if (record.runId !== undefined && typeof record.runId !== 'string') {
        return 'field "runId" must be a string';
    }
    return undefined;
}
/** The producer contract for a portable task approval. */
export function portableRecordError(record) {
    for (const field of ['rule', 'change', 'scope', 'taskId', 'digest', 'verdict', 'time']) {
        if (typeof record[field] !== 'string' || record[field] === '') {
            return `missing or invalid field "${field}"`;
        }
    }
    if (record.scope !== 'task')
        return 'field "scope" must be "task"';
    if (!DIGEST.test(record.digest))
        return 'field "digest" must be 64 hex characters';
    if (!TASK_ID.test(record.taskId))
        return 'field "taskId" must be 16 hex characters';
    if (record.verdict !== 'PASS')
        return 'a portable approval must be a PASS';
    if (!Array.isArray(record.findings) || record.findings.length !== 0) {
        return 'a portable approval must have zero findings';
    }
    if (!validTarget(record.target))
        return 'field "target" must carry a provider';
    return undefined;
}
/** Read every settled local review record; malformed and invalid files are reported. */
export async function readLocalReviewRecords(workspace) {
    const delegation = join(workspace, DELEGATION_DIR);
    const records = [];
    const failures = [];
    for (const rule of await listFiles(workspace, delegation)) {
        if (LOCAL_SKIP.has(rule))
            continue;
        const ruleDirectory = join(delegation, rule);
        for (const change of await listFiles(workspace, ruleDirectory)) {
            const changeDirectory = join(ruleDirectory, change);
            for (const name of await listFiles(workspace, changeDirectory)) {
                const candidates = [];
                if (name.endsWith('.json'))
                    candidates.push(join(changeDirectory, name));
                if (name === 'tasks') {
                    for (const task of await listFiles(workspace, join(changeDirectory, name))) {
                        if (task.endsWith('.json'))
                            candidates.push(join(changeDirectory, name, task));
                    }
                }
                for (const file of candidates) {
                    const parsed = await readJson(workspace, file);
                    if ('error' in parsed) {
                        failures.push({ file, error: parsed.error });
                        continue;
                    }
                    if (!isRecord(parsed.value)) {
                        failures.push({ file, error: 'the record is not an object' });
                        continue;
                    }
                    const invalid = localRecordError(parsed.value);
                    if (invalid !== undefined) {
                        failures.push({ file, error: invalid });
                        continue;
                    }
                    records.push({ file, record: parsed.value });
                }
            }
        }
    }
    return { records, failures };
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
    for (const name of await listFiles(workspace, directory)) {
        if (!name.endsWith('.json'))
            continue;
        const file = join(directory, name);
        const id = name.slice(0, -'.json'.length);
        const parsed = await readJson(workspace, file);
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
        const invalidField = ['id', 'rule', 'change', 'state', 'record', 'startedAt'].find((field) => typeof record[field] !== 'string' || record[field] === '');
        if (invalidField !== undefined ||
            !RUN_STATES.has(record.state) ||
            typeof record.id !== 'string') {
            runs.push(errorRun(`delegation:${id}`, 'delegation', workspace, file, 'unattributed', undefined, `missing or invalid field "${invalidField ?? (typeof record.id !== 'string' ? 'id' : 'state')}"`));
            continue;
        }
        const joined = byRunId.get(runId);
        const session = observedSessions.get(runId) ??
            (typeof joined?.record.session === 'string' ? joined.record.session : undefined);
        const rule = record.rule;
        const change = record.change;
        const state = record.state;
        const steps = [
            { id: 'rule', title: rule, state },
            {
                id: 'change',
                title: typeof record.taskId === 'string' ? record.taskId : change,
                state: 'review',
                evidence: change,
            },
            { id: 'state', title: 'Run state', state },
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
            if (isRecord(joined.record.target)) {
                const provider = joined.record.target.provider;
                const model = joined.record.target.model;
                const parts = [];
                if (typeof provider === 'string')
                    parts.push(provider);
                if (typeof model === 'string')
                    parts.push(model);
                steps.push({
                    id: 'target',
                    title: 'Review target',
                    state: 'target',
                    evidence: safeError(parts.join(' / ')),
                });
            }
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
                ? { error: safeError(record.detail) }
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
    for (const change of await listFiles(workspace, changesDirectory)) {
        const reviews = join(changesDirectory, change, 'reviews');
        for (const name of await listFiles(workspace, reviews)) {
            if (!name.endsWith('.json'))
                continue;
            const file = join(reviews, name);
            const taskId = name.slice(0, -'.json'.length);
            const parsed = await readJson(workspace, file);
            if ('error' in parsed) {
                runs.push(errorRun(`review:${change}/${taskId}`, 'review', workspace, file, 'unattributed', undefined, parsed.error));
                continue;
            }
            if (!isRecord(parsed.value)) {
                runs.push(errorRun(`review:${change}/${taskId}`, 'review', workspace, file, 'unattributed', undefined, 'the record is not an object'));
                continue;
            }
            const record = parsed.value;
            const invalid = portableRecordError(record);
            if (invalid !== undefined) {
                runs.push(errorRun(`review:${change}/${taskId}`, 'review', workspace, file, 'unattributed', undefined, invalid));
                continue;
            }
            const match = localRecords.find((local) => local.record.change === record.change &&
                local.record.taskId === record.taskId &&
                local.record.digest === record.digest &&
                typeof local.record.session === 'string');
            const session = match?.record.session;
            const startedAt = parseTime(record.time);
            const changeName = record.change;
            const stableTask = record.taskId;
            const verdict = record.verdict;
            const digest = record.digest;
            runs.push({
                id: `review:${changeName}/${stableTask}`,
                source: 'review',
                ...(session === undefined ? {} : { session }),
                attribution: session === undefined ? 'unattributed' : 'portable',
                title: `Review ${changeName} ${stableTask}`,
                startedAt,
                status: verdict === 'PASS' ? 'done' : verdict === 'ERROR' ? 'failed' : 'unknown',
                steps: [
                    { id: 'verdict', title: 'Verdict', state: verdict, at: startedAt },
                    {
                        id: 'target',
                        title: 'Target',
                        state: 'target',
                        evidence: isRecord(record.target)
                            ? safeError(JSON.stringify(record.target))
                            : undefined,
                    },
                    { id: 'digest', title: 'Digest', state: 'digest', evidence: safeText(digest) },
                    { id: 'task', title: 'Task', state: stableTask },
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
    for (const name of await listFiles(workspace, directory)) {
        if (!/\.jsonl(?:\.1)?$/u.test(name))
            continue;
        let raw = '';
        try {
            const target = await containedFile(workspace, join(directory, name));
            if (target === undefined)
                continue;
            raw = await readFile(target, 'utf8');
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
/**
 * Engine obligation runs from `.dsh/workflows/runs/`. They are display-only
 * here; authority reads authenticate them separately. A malformed or unsigned
 * file is shown as an unreadable row, never silently dropped.
 */
export async function engineRuns(workspace) {
    const directory = join(workspace, '.dsh', 'workflows', 'runs');
    const runs = [];
    for (const name of await listFiles(workspace, directory)) {
        if (!name.endsWith('.json'))
            continue;
        const file = join(directory, name);
        const display = displayPath(workspace, file);
        // A credential-shaped filename is redacted and never linked.
        const id = redactText(name.slice(0, -'.json'.length));
        const recordPath = redactText(display) === display ? display : undefined;
        const parsed = await readJson(workspace, file);
        if ('error' in parsed) {
            runs.push(errorRun(`workflow:${id}`, 'workflow', workspace, recordPath === undefined ? undefined : file, 'unattributed', undefined, parsed.error));
            continue;
        }
        if (!isRecord(parsed.value) ||
            parsed.value.v !== 1 ||
            typeof parsed.value.id !== 'string' ||
            // A parseable file that is not a run record is a diagnostic, not a run.
            (typeof parsed.value.definition !== 'string' &&
                !(isRecord(parsed.value.definition) && typeof parsed.value.definition.id === 'string')) ||
            typeof parsed.value.status !== 'string' ||
            typeof parsed.value.session !== 'string' ||
            !Array.isArray(parsed.value.steps)) {
            runs.push(errorRun(`workflow:${id}`, 'workflow', workspace, recordPath === undefined ? undefined : file, 'unattributed', undefined, 'the run record is missing required fields'));
            continue;
        }
        const record = parsed.value;
        const session = typeof record.session === 'string' ? record.session : undefined;
        const statusValue = record.status;
        const status = statusValue === 'completed'
            ? 'done'
            : statusValue === 'failed' || statusValue === 'cancelled'
                ? 'failed'
                : statusValue === 'running' || statusValue === 'blocked' || statusValue === 'interrupted'
                    ? 'running'
                    : 'unknown';
        const steps = [];
        for (const entry of Array.isArray(record.steps) ? record.steps : []) {
            if (!isRecord(entry) || typeof entry.id !== 'string')
                continue;
            const evidence = isRecord(entry.evidence) ? entry.evidence : undefined;
            const evidenceRef = evidence === undefined ? undefined : structuredEvidence(evidence);
            steps.push({
                id: redactText(entry.id),
                title: redactText(entry.id),
                state: typeof entry.state === 'string' && KNOWN_STEP_STATES.has(entry.state)
                    ? entry.state
                    : 'unknown',
                ...(typeof entry.at === 'number' ? { at: entry.at } : {}),
                ...(typeof entry.reason === 'string' ? { reason: safeError(entry.reason) } : {}),
                ...(typeof entry.failureClass === 'string'
                    ? { failureClass: safeText(entry.failureClass) }
                    : {}),
                ...(evidence === undefined
                    ? {}
                    : {
                        evidence: typeof evidence.path === 'string'
                            ? safeText(evidence.path)
                            : typeof evidence.kind === 'string'
                                ? (safeText(evidence.kind) ?? 'evidence')
                                : 'evidence',
                    }),
                ...(evidenceRef === undefined ? {} : { evidenceRef }),
            });
        }
        const violations = Array.isArray(record.violations) ? record.violations : [];
        const violationViews = [];
        for (const [index, violation] of violations.entries()) {
            if (!isRecord(violation))
                continue;
            // The record persists { stepId, at, reason }; older files wrote
            // { kind, detail, step }, so both shapes are readable.
            const reason = typeof violation.reason === 'string'
                ? (safeError(violation.reason) ?? 'violation')
                : typeof violation.detail === 'string'
                    ? (safeError(violation.detail) ?? 'violation')
                    : typeof violation.kind === 'string'
                        ? (safeText(violation.kind) ?? 'violation')
                        : 'violation';
            const stepId = typeof violation.stepId === 'string'
                ? violation.stepId
                : typeof violation.step === 'string'
                    ? violation.step
                    : undefined;
            violationViews.push({
                ...(stepId === undefined ? {} : { stepId: safeText(stepId) }),
                at: typeof violation.at === 'number' ? violation.at : 0,
                reason,
            });
            steps.push({
                id: `violation:${String(index)}`,
                title: 'VIOLATION',
                state: typeof violation.kind === 'string' ? redactText(violation.kind) : 'VIOLATION',
                synthetic: true,
                ...(typeof violation.at === 'number' ? { at: violation.at } : {}),
                evidence: reason,
            });
        }
        const definitionRef = definitionRefOf(parsed.value.definition, parsed.value.definitionName, parsed.value.definitionVersion);
        const definitionId = redactText(definitionRef.id);
        const definitionName = definitionRef.name;
        const definition = {
            id: definitionId,
            name: safeText(definitionName) ?? definitionId,
            version: definitionRef.version,
        };
        runs.push({
            id: `workflow:${redactText(typeof record.id === 'string' ? record.id : id)}`,
            source: 'workflow',
            ...(session === undefined ? {} : { session }),
            attribution: session === undefined ? 'unattributed' : 'local',
            title: `${definitionId} intake`,
            startedAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
            status,
            steps,
            definition,
            ...(violationViews.length === 0 ? {} : { violations: violationViews }),
            ...(typeof record.reason === 'string' && status === 'failed'
                ? { error: safeError(record.reason) }
                : {}),
            ...(recordPath === undefined ? {} : { record: recordPath }),
        });
    }
    return runs;
}
/** The overlay's structured evidence: the recorded kind plus its reference. */
function structuredEvidence(evidence) {
    const stringOf = (key) => typeof evidence[key] === 'string' && evidence[key] !== ''
        ? evidence[key]
        : undefined;
    const rawRef = stringOf('ref') ??
        stringOf('path') ??
        stringOf('callId') ??
        stringOf('digest') ??
        stringOf('answer') ??
        stringOf('detail');
    const ref = rawRef === undefined ? undefined : (safeError(rawRef) ?? undefined);
    return {
        kind: typeof evidence.kind === 'string' ? (safeText(evidence.kind) ?? 'evidence') : 'evidence',
        ...(ref === undefined ? {} : { ref }),
        ...(typeof evidence.at === 'number' ? { at: evidence.at } : {}),
    };
}
/** Every projected run in one workspace, unattributed runs included. */
export async function workspaceRuns(workspace) {
    const [observations, local] = await Promise.all([
        delegationObservations(workspace),
        readLocalReviewRecords(workspace),
    ]);
    const [delegation, reviews] = await Promise.all([
        delegationRuns(workspace, observations, local.records),
        portableReviewRuns(workspace, local.records),
    ]);
    const failures = local.failures.map((failure) => errorRun(`local-review:${displayPath(workspace, failure.file)}`, 'review', workspace, failure.file, 'unattributed', undefined, failure.error));
    const engine = await engineRuns(workspace);
    return [...delegation, ...reviews, ...failures, ...engine].sort(compareRuns);
}
/** The requesting session's timeline: only attributed runs, in time order. */
export async function sessionRuns(workspace, sessionId) {
    const [checkpoints, workspaceRunsList] = await Promise.all([
        checkpointRuns(workspace, sessionId),
        workspaceRuns(workspace),
    ]);
    return [...checkpoints, ...workspaceRunsList]
        .filter((run) => (run.attribution !== 'unattributed' && run.session === sessionId) ||
        // Only unattributed malformed workflow records are workspace diagnostics.
        (run.attribution === 'unattributed' &&
            run.source === 'workflow' &&
            run.error !== undefined))
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
