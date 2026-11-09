import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile, } from 'node:fs/promises';
import { join } from 'node:path';
import { isInside } from './fs-change.js';
/**
 * Durable workflow obligation runs. A run is one JSON file under
 * `.dsh/workflows/runs/`; every transition replaces the file atomically so a
 * crash leaves the previous readable state, never a torn one. An authoritative
 * run carries a host HMAC signature over its persisted state; an unsigned or
 * modified file is refused for resume, gate admission, and receipt issuance.
 */
export const RUN_VERSION = 1;
/** Domain separation for a run signature. */
const RUN_DOMAIN = 'workflows/run/v1';
export const RUN_STATUSES = [
    'running',
    'blocked',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
];
export const STEP_STATES = ['open', 'done', 'blocked', 'failed', 'cancelled'];
/**
 * The producer-owned failure vocabulary. The editor renders the stored value
 * verbatim and never derives a class from a message; executors and gates embed
 * their structured reason in the message, so a known reason token wins before
 * the fallback wording checks.
 */
const FAILURE_CLASSES = [
    'missing-file',
    'record-mismatch',
    'no-answer',
    'no-call',
    'invalid-result',
    'rejected-answer',
    'check-failed',
];
export function classifyFailure(reason) {
    const raw = (reason ?? '').toLowerCase();
    // A parenthesized detail is context, not the cause; classify the leading
    // reason so a detail token cannot override the actual failure class.
    const text = raw.includes(' (') ? raw.slice(0, raw.indexOf(' (')) : raw;
    for (const failureClass of FAILURE_CLASSES) {
        if (text.includes(failureClass))
            return failureClass;
    }
    if (/missing-file|does not exist|not found|enoent/u.test(text))
        return 'missing-file';
    if (/not one of|rejected|not accepted|does not match/u.test(text))
        return 'rejected-answer';
    // A missing call's detail may mention a recorded call; classify it first.
    if (/no call|not observed|no evidence|not recorded/u.test(text))
        return 'no-call';
    if (/digest|hash|signature|tampered|record[- ]?mismatch/u.test(text))
        return 'record-mismatch';
    if (/answer|question/u.test(text))
        return 'no-answer';
    if (/schema|invalid|result/u.test(text))
        return 'invalid-result';
    return 'check-failed';
}
/** The run directory for one workspace. */
export function runsDirectory(workspace) {
    return join(workspace, '.dsh', 'workflows', 'runs');
}
/** The run file for one id. */
export function runPath(workspace, id) {
    return join(runsDirectory(workspace), `${id}.json`);
}
/** A fresh stable run id. */
export function newRunId(now = Date.now()) {
    return `run-${now.toString(36)}-${randomBytes(4).toString('hex')}`;
}
/** Normalize an input or stored definition identity to the persisted object. */
export function definitionRefOf(definition, legacyName, legacyVersion) {
    if (typeof definition === 'string') {
        return {
            id: definition,
            name: typeof legacyName === 'string' && legacyName !== '' ? legacyName : definition,
            version: typeof legacyVersion === 'number' ? legacyVersion : 0,
        };
    }
    if (typeof definition === 'object' && definition !== null) {
        const record = definition;
        if (typeof record.id === 'string') {
            return {
                id: record.id,
                name: typeof record.name === 'string' && record.name !== '' ? record.name : record.id,
                version: typeof record.version === 'number' ? record.version : 0,
            };
        }
    }
    return { id: 'workflow', name: 'workflow', version: 0 };
}
/** Build a new running run with every step open. */
export function createRun(input) {
    const at = input.now ?? Date.now();
    return {
        v: RUN_VERSION,
        id: input.id ?? newRunId(at),
        definition: definitionRefOf(input.definition, input.definitionName, input.definitionVersion),
        trigger: input.trigger,
        session: input.session,
        workspaceKey: input.workspace,
        status: 'running',
        createdAt: at,
        updatedAt: at,
        context: boundContext(input.context ?? {}),
        steps: input.steps.map((id) => ({ id, state: 'open' })),
        violations: [],
        ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
    };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function writeRunSync(workspace, run, auth, options = {}) {
    const directory = runsDirectory(workspace);
    mkdirSync(directory, { recursive: true });
    if (!isInside(realpathSync(workspace), realpathSync(directory))) {
        throw new Error('run refused: the runs directory escapes the workspace');
    }
    const stored = {
        ...run,
        signature: auth.sign(RUN_DOMAIN, run),
    };
    const target = runPath(workspace, run.id);
    const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    try {
        ;
        (options.renameSync ?? renameSync)(temporary, target);
    }
    catch (error) {
        try {
            unlinkSync(temporary);
        }
        catch {
            // The temporary file is best-effort cleanup.
        }
        throw error;
    }
}
export async function writeRun(workspace, run, auth, options = {}) {
    const directory = runsDirectory(workspace);
    await mkdir(directory, { recursive: true });
    if (!isInside(await realpath(workspace), await realpath(directory))) {
        throw new Error('run refused: the runs directory escapes the workspace');
    }
    const stored = {
        ...run,
        signature: auth.sign(RUN_DOMAIN, run),
    };
    const target = runPath(workspace, run.id);
    const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    try {
        await (options.rename ?? rename)(temporary, target);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
/**
 * Read one stored record. Legacy files wrote `definition` as an id string plus
 * separate name/version fields; the record is normalized on read so every
 * consumer sees the structured identity, while the raw shape still verifies.
 */
function normalizeStoredRun(record) {
    const definition = record.definition;
    const legacy = typeof definition === 'string';
    if (!legacy && !(typeof definition === 'object' && definition !== null))
        return undefined;
    const { definitionName, definitionVersion, ...rest } = record;
    return {
        ...rest,
        definition: definitionRefOf(definition, definitionName, definitionVersion),
    };
}
function parseStored(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    const { signature, ...rest } = record;
    if (rest.v !== RUN_VERSION ||
        typeof rest.id !== 'string' ||
        !Array.isArray(rest.steps) ||
        (typeof rest.definition !== 'string' &&
            !(typeof rest.definition === 'object' &&
                rest.definition !== null &&
                typeof rest.definition.id === 'string')) ||
        typeof rest.status !== 'string' ||
        !RUN_STATUSES.includes(rest.status)) {
        return undefined;
    }
    const run = normalizeStoredRun(rest);
    return run === undefined ? undefined : { raw: rest, run, signature };
}
/**
 * Read and authenticate one run. An unsigned, modified, or forged file reads as
 * absent: no caller may resume, admit, or issue a receipt from it.
 */
/** Compare the run's bound workspace with the workspace asking for it. */
export function sameWorkspace(left, right) {
    const normalize = (value) => value.replaceAll('\\', '/').replace(/\/+$/u, '');
    const a = normalize(left);
    const b = normalize(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
export async function readAuthenticatedRun(workspace, id, auth) {
    const read = await readStored(workspace, id);
    if (read === undefined)
        return undefined;
    // Verify the bytes as written: a legacy string record's signature covers its
    // legacy shape, then the normalized run is safe to use.
    if (!auth.verify(RUN_DOMAIN, read.raw, read.signature))
        return undefined;
    // The host key is shared by every workspace, so a signed run copied into
    // another workspace must not authorize anything there.
    return sameWorkspace(read.run.workspaceKey, workspace) ? read.run : undefined;
}
/** Read one run for display only; never use this for authority. */
export async function readRunUnverified(workspace, id) {
    return (await readStored(workspace, id))?.run;
}
async function readStored(workspace, id) {
    try {
        const root = await realpath(workspace);
        const target = await realpath(runPath(workspace, id));
        if (!isInside(root, target))
            return undefined;
        const parsed = parseStored(JSON.parse(await readFile(target, 'utf8')));
        if (parsed === undefined || parsed.run.id !== id)
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
/**
 * Every run file on disk, oldest first, as retention sees it. Only `ENOENT`
 * means absent history; any other listing or stat failure propagates so a gate
 * cannot read an unreadable store as an empty one.
 */
export async function storedRuns(workspace) {
    let names;
    try {
        names = await readdir(runsDirectory(workspace));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const entries = [];
    for (const name of names) {
        if (!name.endsWith('.json'))
            continue;
        try {
            const info = await stat(join(runsDirectory(workspace), name));
            entries.push({ id: name.slice(0, -'.json'.length), size: info.size, mtimeMs: info.mtimeMs });
        }
        catch (error) {
            // A file another pass removed is simply gone; anything else is a fault.
            if (error.code === 'ENOENT')
                continue;
            throw error;
        }
    }
    return entries.sort((left, right) => left.mtimeMs - right.mtimeMs || left.id.localeCompare(right.id));
}
/** Every readable run in one workspace, oldest first (display only). */
export async function listRuns(workspace) {
    const runs = [];
    for (const entry of await storedRuns(workspace)) {
        const run = await readRunUnverified(workspace, entry.id);
        if (run !== undefined)
            runs.push(run);
    }
    return runs.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}
/** Every run that authenticates against the host key. */
export async function listAuthenticatedRuns(workspace, auth) {
    const runs = [];
    for (const entry of await storedRuns(workspace)) {
        const run = await readAuthenticatedRun(workspace, entry.id, auth);
        if (run !== undefined)
            runs.push(run);
    }
    return runs.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}
/** The structured evidence shape persisted on a step: kind plus a reference. */
function withEvidenceRef(evidence) {
    if (evidence.ref !== undefined)
        return evidence;
    const reference = evidence.path ?? evidence.callId ?? evidence.detail ?? evidence.answer ?? evidence.digest;
    return reference === undefined ? evidence : { ...evidence, ref: reference };
}
/** Replace one step's state and stamp the run. Pure. */
export function settleStep(run, stepId, state, patch = {}) {
    if (!run.steps.some((step) => step.id === stepId)) {
        throw new Error(`run "${run.id}" has no step "${stepId}"`);
    }
    const at = patch.at ?? Date.now();
    const evidence = patch.evidence === undefined ? undefined : withEvidenceRef(patch.evidence);
    const failed = state === 'blocked' || state === 'failed';
    const failureClass = failed ? (patch.failureClass ?? classifyFailure(patch.reason)) : undefined;
    const previous = run.steps.find((step) => step.id === stepId);
    // A step that leaves blocked/failed keeps neither the stale class nor the
    // obsolete failure reason; only an explicit new reason survives a success.
    const reason = failed ? (patch.reason ?? previous?.reason) : patch.reason;
    return {
        ...run,
        updatedAt: at,
        steps: run.steps.map((step) => step.id === stepId
            ? (({ failureClass: _oldClass, reason: _oldReason, ...base }) => ({
                ...base,
                state,
                at,
                ...(evidence === undefined ? {} : { evidence }),
                ...(reason === undefined ? {} : { reason }),
                ...(failureClass === undefined ? {} : { failureClass }),
            }))(step)
            : step),
    };
}
/** Move a run to a terminal or blocked status and stamp it. Pure. */
export function setRunStatus(run, status, now = Date.now(), reason) {
    return {
        ...run,
        status,
        updatedAt: now,
        ...(reason === undefined ? {} : { reason }),
    };
}
/** Append a visible violation; a violation is never a pass. Pure. */
export function resetStepAttempts(run, stepId) {
    return {
        ...run,
        steps: run.steps.map((step) => step.id === stepId
            ? (({ lastTurn: _lastTurn, ...rest }) => ({ ...rest, attempts: 0 }))(step)
            : step),
    };
}
export function addViolation(run, detail, options = {}) {
    const at = options.at ?? Date.now();
    return {
        ...run,
        updatedAt: at,
        violations: [
            ...run.violations,
            {
                at,
                kind: options.kind ?? 'VIOLATION',
                detail,
                ...(options.step === undefined ? {} : { step: options.step }),
            },
        ],
    };
}
/** Count one turn-close refusal on the run. Pure. */
export function incrementTurnBlocks(run, now = Date.now()) {
    return { ...run, updatedAt: now, turnBlocks: (run.turnBlocks ?? 0) + 1 };
}
/** Reset the refusal count after the visible violation allows one close. Pure. */
export function resetTurnBlocks(run, now = Date.now()) {
    return { ...run, updatedAt: now, turnBlocks: 0 };
}
/**
 * Terminally classify a run whose trigger later evaluates as not applicable.
 * The unexecuted required steps are released so retention can prune it; it is
 * never a pass.
 */
export function completeNotApplicable(run, now = Date.now()) {
    let settled = run;
    for (const step of run.steps) {
        if (step.state === 'open' || step.state === 'blocked' || step.state === 'failed') {
            settled = settleStep(settled, step.id, 'cancelled', { at: now, reason: 'not-applicable' });
        }
    }
    return setRunStatus(settled, 'completed', now, 'not-applicable');
}
/** Retention defaults: 30 days and 20 MB of run files. */
export const RUN_RETENTION_DAYS = 30;
export const RUN_RETENTION_BYTES = 20 * 1024 * 1024;
export const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Prune terminal runs first: expired (30 days) then, while the workspace is over
 * its byte cap, the oldest terminal run. A running or blocked run is retained.
 * Receipts live outside this directory and are never touched.
 */
export async function hasTamperedRuns(workspace, auth) {
    for (const entry of await storedRuns(workspace)) {
        if ((await readAuthenticatedRun(workspace, entry.id, auth)) === undefined)
            return true;
    }
    return false;
}
export async function pruneRuns(workspace, options) {
    const now = options.now ?? Date.now();
    const retentionMs = options.retentionMs ?? RUN_RETENTION_DAYS * DAY_MS;
    const maxBytes = options.maxBytes ?? RUN_RETENTION_BYTES;
    const entries = await storedRuns(workspace);
    const runs = new Map();
    for (const entry of entries) {
        runs.set(entry.id, await readAuthenticatedRun(workspace, entry.id, options.auth));
    }
    const terminal = (id) => {
        const run = runs.get(id);
        if (run === undefined)
            return false;
        // Unresolved required work is a durable blocker, not prunable history.
        if (run.steps.some((step) => step.state === 'open' || step.state === 'blocked' || step.state === 'failed')) {
            return false;
        }
        // An interrupted run is resumable state, so it is retained like an open run.
        return run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed';
    };
    const removal = options.unlink ?? unlink;
    /** A failed deletion is not a removal; a missing file already satisfies it. */
    const remove = async (id) => {
        try {
            await removal(runPath(workspace, id));
            return true;
        }
        catch (error) {
            return error.code === 'ENOENT';
        }
    };
    const removed = [];
    const kept = [];
    for (const entry of entries) {
        if (terminal(entry.id) && now - entry.mtimeMs > retentionMs && (await remove(entry.id))) {
            removed.push(entry.id);
        }
        else {
            kept.push(entry);
        }
    }
    let total = kept.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of kept) {
        if (total <= maxBytes)
            break;
        if (!terminal(entry.id))
            continue;
        if (!(await remove(entry.id)))
            continue;
        total -= entry.size;
        removed.push(entry.id);
    }
    return {
        removed,
        retained: kept.filter((entry) => !removed.includes(entry.id)).map((entry) => entry.id),
    };
}
/** A run id's content identity for diagnostics; never a secret. */
export function runDigest(run) {
    return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}
/** A bounded one-line failure reason for a run record. */
export function runFailure(error) {
    return errorMessage(error).slice(0, 300);
}
/** Run limits: concurrent open runs and the serialized context cap. */
export const DEFAULT_MAX_RUNS = 20;
export const MAX_CONTEXT_BYTES = 4096;
/** A run is open while it can still be resumed or steered. */
export function isOpenRun(run) {
    return run.status === 'running' || run.status === 'blocked' || run.status === 'interrupted';
}
/** The number of open runs; terminal runs do not consume a slot. */
export function openRunCount(runs) {
    return runs.filter(isOpenRun).length;
}
/** Whether one more run would exceed the configured limit. */
export function runLimitExceeded(runs, maxRuns) {
    return openRunCount(runs) >= maxRuns;
}
/** The open runs of one session; a different session cannot satisfy them. */
export function sessionRunsFor(runs, session) {
    return runs.filter((run) => run.session === session && isOpenRun(run));
}
/**
 * A step belongs to the run's session. Another session may see the run in the
 * view but cannot satisfy its step.
 */
export function assertRunSession(run, session) {
    if (run.session !== session) {
        throw new Error(`run "${run.id}" belongs to session "${run.session}"; session "${session}" cannot satisfy its step`);
    }
}
/** The step currently requested and still open, if any. */
export function activeStep(run) {
    return run.steps.find((step) => (step.state === 'open' || step.state === 'blocked') && step.requestedAt !== undefined);
}
/**
 * Request one step. A run executes one main step at a time: requesting a second
 * step while another request is still open is refused. Re-requesting the same
 * step increments its bounded attempt count instead.
 */
export function requestStep(run, stepId, now = Date.now()) {
    const target = run.steps.find((step) => step.id === stepId);
    if (target === undefined)
        throw new Error(`run "${run.id}" has no step "${stepId}"`);
    if (target.state !== 'open' && target.state !== 'blocked') {
        throw new Error(`run "${run.id}" step "${stepId}" is ${target.state}; it cannot be requested`);
    }
    const active = activeStep(run);
    if (active !== undefined && active.id !== stepId) {
        throw new Error(`run "${run.id}" already has step "${active.id}" requested; one main step runs at a time`);
    }
    return {
        ...run,
        status: 'running',
        updatedAt: now,
        steps: run.steps.map((step) => step.id === stepId
            ? {
                ...step,
                state: 'open',
                requestedAt: step.requestedAt ?? now,
                attempts: (step.attempts ?? 0) + 1,
            }
            : step),
    };
}
/** A bounded copy of a run context: an oversized value keeps its keys and a marker. */
export function boundContext(context, maxBytes = MAX_CONTEXT_BYTES) {
    const text = JSON.stringify(context);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes <= maxBytes)
        return context;
    const candidate = { truncated: true, bytes };
    const keys = [];
    for (const key of Object.keys(context).slice(0, 20)) {
        if (keys.length >= 20)
            break;
        const name = key.slice(0, 32);
        const next = { ...candidate, keys: [...keys, name] };
        if (Buffer.byteLength(JSON.stringify(next), 'utf8') > maxBytes)
            break;
        keys.push(name);
        candidate.keys = keys;
    }
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > maxBytes) {
        return { truncated: true };
    }
    return candidate;
}
