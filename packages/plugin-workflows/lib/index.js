import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { adoptChange } from './adoption.js';
import { registerWorkflowRoutes } from './api.js';
import { installDefinition, loadApprovedDefinitions } from './approval-store.js';
import { CHANGE_NAME, parseArchiveCommand, parseOpenspecCommand } from './command-parse.js';
import { runWorkflowCommand } from './commands.js';
import { KNOWN_LEGACY_SOURCES, loadShippedDefinitions, resolveOwnership, workspaceDefinitionsDirectory, } from './definitions.js';
import { evaluateEvent } from './evaluate.js';
import { lastCodeWriteAt, verifyEvidence, } from './evidence.js';
import { adaptUserQuestions, OwnedCalls, requestMainStep, } from './executors.js';
import { startFsChangeWatcher } from './fs-change.js';
import { authorizationWriteDecision, evaluateArchiveGate, evaluateIntakeGate, evaluateTurnClose, } from './gates.js';
import { WorkflowHealth } from './health.js';
import { HostAuth } from './host-auth.js';
import { advanceIntake } from './intake.js';
import { Journal, MAX_RECORD_BYTES, toolResultText, workflowsDirectory, } from './journal.js';
import { checkpointGateIssue, parityLoadIssues, readParityReport, resolveVerifySettings, shippedParityReportPath, taskReviewCompletion, taskReviewCoverage, withVerifySettings, } from './parity.js';
import { registerActiveRunsContext } from './prompt.js';
import { listReceipts } from './receipts.js';
import { cancelRun, pendingStep, recoverRuns, resumeRun } from './resume.js';
import { completeNotApplicable, createRun, DEFAULT_MAX_RUNS, hasTamperedRuns, listAuthenticatedRuns, openRunCount, pruneRuns, readAuthenticatedRun, runFailure, storedRuns, writeRun, writeRunSync, } from './runs.js';
import { checkedTaskIds } from './tasks.js';
import { executeWorkflowsTool } from './tools.js';
import { checkpointRequired, classifyIntent, evaluateDefinitions, evaluateDefinitionTrigger, evaluateIntents, intentDedupeKey, loadCatalog, obligationDedupeKey, } from './triggers.js';
/** Workflows: a read-only Host recorder and the Workflows conversation view. */
export const name = '@dsh-setup/plugin-workflows';
/**
 * Host services the recorder needs. A host without them stays inert instead of
 * registering half a surface; the Client half independently checks its own.
 */
export const inject = ['agents', 'workingDirectory', 'fs', 'connection'];
/**
 * The tools whose presence means a legacy activation plugin is installed. The
 * row itself is not readable from a plugin, so its registered tools are the
 * mechanical proof the gate is live.
 */
const LEGACY_TOOL_NAMES = {
    'delegation-rules': ['delegate', 'task_progress', 'delegation_status'],
    'goal-continuity': ['work_checkpoint'],
};
/** Whether a workspace carries any installed local definition file. */
async function hasLocalDefinitionFiles(workspace) {
    try {
        const names = await readdir(workspaceDefinitionsDirectory(workspace));
        return names.some((name) => name.endsWith('.json'));
    }
    catch {
        return false;
    }
}
/** The verdict a review record carries, read for the review trigger filter. */
function reviewVerdict(workspace, path) {
    try {
        const raw = JSON.parse(readFileSync(join(workspace, path), 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
            const verdict = raw.verdict;
            return typeof verdict === 'string' ? verdict : undefined;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
/** Normalize one observed plugin event into definition trigger events. */
export function definitionEventsOf(input, event, workspace) {
    const base = {
        workspace,
        session: input.session,
        ...(input.turn === undefined ? {} : { turn: input.turn }),
    };
    switch (event.kind) {
        case 'agent.turn-stop':
            return [{ kind: 'turn.stopping', subject: 'stop-attempt', ...base }];
        case 'tool.result':
            return event.tool === undefined
                ? []
                : [
                    {
                        kind: 'tool.result',
                        subject: event.tool,
                        tool: event.tool,
                        ...(input.callId === undefined ? {} : { callId: input.callId }),
                        ...base,
                    },
                ];
        case 'fs.change': {
            const path = event.subject;
            const changeName = /^openspec\/changes\/([^/]+)\//u.exec(path)?.[1];
            const events = [
                {
                    kind: 'fs.change',
                    subject: path,
                    path,
                    ...(changeName === undefined ? {} : { name: changeName }),
                    ...(event.hash === undefined ? {} : { hash: event.hash }),
                    ...base,
                },
            ];
            if (/(?:^|\/)reviews\/[^/]+\.json$/u.test(path)) {
                const verdict = reviewVerdict(workspace, path);
                events.push({
                    kind: 'review.record',
                    subject: path,
                    path,
                    ...(verdict === undefined ? {} : { verdict }),
                    ...(event.hash === undefined ? {} : { hash: event.hash }),
                    ...base,
                });
            }
            return events;
        }
        case 'subagent.end':
            return [{ kind: 'subagent.end', subject: event.subject, ...base }];
        default:
            return [];
    }
}
/** The bounded text of the latest user message in a step payload. */
function lastUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (typeof message !== 'object' || message === null)
            continue;
        const record = message;
        if (record.role !== 'user')
            continue;
        if (typeof record.content === 'string')
            return record.content.slice(0, 2000);
        if (!Array.isArray(record.content))
            return undefined;
        const text = record.content
            .map((part) => {
            if (typeof part !== 'object' || part === null)
                return '';
            const block = part;
            return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
        })
            .filter((part) => part !== '')
            .join('\n');
        return text === '' ? undefined : text.slice(0, 2000);
    }
    return undefined;
}
/** Probe every required service; `undefined` means the plugin stays inert. */
function hostServices(ctx) {
    const agents = ctx.get('agents');
    const workingDirectory = ctx.get('workingDirectory');
    const fs = ctx.get('fs');
    const connection = ctx.get('connection');
    if (agents === undefined ||
        typeof agents.get !== 'function' ||
        typeof agents.list !== 'function' ||
        workingDirectory === undefined ||
        typeof workingDirectory.get !== 'function' ||
        fs === undefined ||
        typeof fs.watch !== 'function' ||
        connection === undefined ||
        typeof connection.fetch?.register !== 'function') {
        return undefined;
    }
    return { agents, workingDirectory, fs, connection };
}
/** The workspace one session's local files belong to, or undefined if it is gone. */
function workspaceFor(services, session) {
    try {
        return services.workingDirectory.get(session);
    }
    catch {
        return undefined;
    }
}
/** Render an unknown stop reason as one bounded line. */
function describe(value) {
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
const WORKER_TOOL_NAMES = new Set([
    'subagent',
    'subagent_fork',
    'spawn_teammate',
    'workflow',
    'delegate',
]);
/** Whether a delegate result's first line reports a started run rather than reuse. */
function delegateStarted(resultText) {
    // Answer-contract results always ran a target and END with this trailer; a
    // cached record may quote it inside its evidence, which proves nothing.
    if (resultText
        .trimEnd()
        .endsWith('(no gate record: this answer does not satisfy a strict review rule)')) {
        return true;
    }
    const first = resultText.split(/\r?\n/u)[0] ?? '';
    if (/^rule "[^"]+" review (?:already pending|queued)$/u.test(first))
        return false;
    // Only the engine's own cached-record envelope is a reuse.
    return !/^rule "[^"]+" (?:PASS|FINDINGS|ERROR) \(reused record /u.test(first);
}
/** Characters a tool name may keep in a journal summary. */
const SAFE_NAME = /[^A-Za-z0-9._-]+/gu;
/** The handle `delegate` mints: `run-<base36>-<8 hex>`. */
const RUN_ID = /^run-[a-z0-9]+-[a-f0-9]{8}$/u;
/**
 * The journal stores an index, never the tool's output text. Only fixed,
 * validated identity fields are kept; the raw payload stays in the session log,
 * so a credential in a tool result cannot reach the journal at all. A delegate
 * result keeps its run handle because the run projection attributes it.
 */
function toolSummary(name, isError, text) {
    const tool = name.replace(SAFE_NAME, '_').slice(0, 80);
    if (tool === 'delegate') {
        const lines = text.split('\n').slice(0, 6);
        const mode = lines
            .map((line) => /\brule\s+"[^"]*"\s+review\s+(started|queued|already pending)\b/u.exec(line)?.[1])
            .find((value) => value !== undefined);
        const runLine = lines.find((line) => line.trimStart().startsWith('run:'));
        const run = runLine?.replace(/^\s*run:\s*/u, '').trim();
        if (mode !== undefined && run !== undefined && RUN_ID.test(run)) {
            return `delegate review ${mode}; run: ${run}`;
        }
    }
    return `${tool} ${isError ? 'failed' : 'ok'}; output omitted`;
}
export const DEFAULT_CHECKPOINT_APPLICABILITY = Object.freeze({
    minToolCalls: 4,
    requireWrite: true,
    bottleneckAge: 2,
});
/** Validate the row's checkpoint applicability fail-loud, naming the field. */
function resolveCheckpointApplicability(raw) {
    if (raw === undefined)
        return DEFAULT_CHECKPOINT_APPLICABILITY;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('workflows checkpointApplicability must be an object');
    }
    const record = raw;
    for (const key of Object.keys(record)) {
        if (key !== 'minToolCalls' && key !== 'requireWrite' && key !== 'bottleneckAge') {
            throw new Error(`workflows checkpointApplicability has an unknown field "${key}"`);
        }
    }
    const minToolCalls = record.minToolCalls;
    if (minToolCalls !== undefined &&
        (typeof minToolCalls !== 'number' ||
            !Number.isSafeInteger(minToolCalls) ||
            minToolCalls < 1 ||
            minToolCalls > 1000)) {
        throw new Error('workflows checkpointApplicability.minToolCalls must be an integer between 1 and 1000');
    }
    const requireWrite = record.requireWrite;
    if (requireWrite !== undefined && typeof requireWrite !== 'boolean') {
        throw new Error('workflows checkpointApplicability.requireWrite must be a boolean');
    }
    const bottleneckAge = record.bottleneckAge;
    if (bottleneckAge !== undefined &&
        (typeof bottleneckAge !== 'number' ||
            !Number.isSafeInteger(bottleneckAge) ||
            bottleneckAge < 1 ||
            bottleneckAge > 1000)) {
        throw new Error('workflows checkpointApplicability.bottleneckAge must be an integer between 1 and 1000');
    }
    return {
        minToolCalls: minToolCalls ?? DEFAULT_CHECKPOINT_APPLICABILITY.minToolCalls,
        requireWrite: requireWrite ?? DEFAULT_CHECKPOINT_APPLICABILITY.requireWrite,
        bottleneckAge: bottleneckAge ?? DEFAULT_CHECKPOINT_APPLICABILITY.bottleneckAge,
    };
}
export function apply(ctx, config = {}) {
    if (config.allowIntent !== undefined && typeof config.allowIntent !== 'boolean') {
        throw new Error('workflows allowIntent must be a boolean');
    }
    if (config.maxRuns !== undefined && (!Number.isInteger(config.maxRuns) || config.maxRuns < 1)) {
        throw new Error('workflows maxRuns must be a positive integer');
    }
    const engineAllowIntent = config.allowIntent === true;
    const maxRuns = config.maxRuns ?? DEFAULT_MAX_RUNS;
    const checkpointApplicability = resolveCheckpointApplicability(config.checkpointApplicability);
    const verifySettings = resolveVerifySettings(config.verify);
    // A malformed shipped trigger refuses the plugin load, naming the field.
    const triggers = loadCatalog();
    // A malformed or duplicate shipped definition refuses the plugin load too.
    loadShippedDefinitions();
    const services = hostServices(ctx);
    if (services === undefined) {
        console.error('workflows: required Host services are unavailable; the recorder is inert');
        return;
    }
    const journal = new Journal();
    /** Latest turn per session, so a tool result belongs to a turn. */
    const turns = new Map();
    /** De-duplication identities already evaluated for one session. */
    const seen = new Map();
    /** One health writer per workspace, created on its first event. */
    const healths = new Map();
    let pluginDisposed = false;
    /** The session most recently observed in each workspace. */
    const activeSession = new Map();
    /** Whether a session is a root agent; the legacy gates exclude children. */
    const rootSessions = new Map();
    /** One change-tree watcher per workspace, started on its first event. */
    const watchers = new Map();
    const watching = new Set();
    /** Whether a workspace's change source started successfully. */
    const watchHealthy = new Map();
    let listenerCount = 0;
    let scopedFailures = 0;
    let registrationError;
    const triggerCount = triggers.length;
    /** The count every published health file must use right now. */
    const publishedListenerCount = (workspace) => Math.max(0, listenerCount + (watchHealthy.get(workspace) === true ? 1 : 0) - scopedFailures);
    const healthFor = (workspace) => {
        const existing = healths.get(workspace);
        if (existing !== undefined)
            return existing;
        const health = new WorkflowHealth({
            root: workflowsDirectory(workspace),
            triggerCount,
        });
        health.setListenerCount(publishedListenerCount(workspace));
        if (registrationError !== undefined)
            health.recordError(registrationError);
        void health.start().catch((error) => {
            console.error(`workflows: health could not start (${String(error)})`);
        });
        healths.set(workspace, health);
        return health;
    };
    /** Register one required observer, publishing a failure instead of throwing. */
    const listen = (register) => {
        try {
            register();
            listenerCount += 1;
        }
        catch (error) {
            registrationError ??= error;
        }
    };
    /** The engine gates register without changing the observability listener count. */
    const listenEngine = (register) => {
        try {
            register();
        }
        catch (error) {
            registrationError ??= error;
        }
    };
    /** A scoped per-agent registration failure is visible and lowers the count. */
    const failScopedListener = (error) => {
        scopedFailures += 1;
        registrationError ??= error;
        for (const [workspace, health] of healths) {
            health.recordError(error);
            health.setListenerCount(publishedListenerCount(workspace));
        }
    };
    /** Publish one contained observer failure as the health's last error. */
    const publishListenerError = (workspace, error) => {
        if (workspace === undefined)
            return;
        try {
            healthFor(workspace).recordError(error);
        }
        catch {
            // Health reporting never breaks dispatch.
        }
    };
    /** Approved definitions per workspace, loaded once on first observation. */
    const definitionsByWorkspace = new Map();
    let storedAuth;
    let authPromise;
    /** Load the host key once; a failure is reported and leaves runs unsigned. */
    const ensureAuth = () => {
        authPromise ??= HostAuth.load()
            .then((auth) => {
            storedAuth = auth;
            return auth;
        })
            .catch((error) => {
            console.error(`workflows: the host key could not be loaded (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`);
            return undefined;
        });
        return authPromise;
    };
    /** The legacy sources the installed profile proves through its tools. */
    const installedLegacySources = () => {
        const installed = new Set();
        try {
            const tools = ctx.get('tools');
            for (const plugin of KNOWN_LEGACY_SOURCES) {
                const names = LEGACY_TOOL_NAMES[plugin] ?? [];
                if (names.some((name) => tools?.get?.(name) !== undefined))
                    installed.add(plugin);
            }
        }
        catch {
            // An unreadable tool registry proves nothing; ownership then refuses defer.
        }
        return installed;
    };
    /**
     * The legacy per-signal state: installed providers plus the signals whose
     * gate-only switch is on. The legacy plugins publish their switch through a
     * small status service; a missing service means the signal does not steer.
     */
    const legacySignalState = () => {
        const installed = installedLegacySources();
        const enabled = new Set();
        try {
            if (installed.has('delegation-rules')) {
                // The spec-review, progress, and lane gates stay on under either switch
                // value; only the task-review rule and the archive gate follow it. The
                // spec-review signal exists only while a steering rule is configured.
                const status = ctx.get('delegationRulesStatus');
                for (const signal of ['task-progress', 'lane-assignment', 'lane-boundary']) {
                    enabled.add(`delegation-rules/${signal}`);
                }
                if (status?.specReview !== false)
                    enabled.add('delegation-rules/spec-review');
                if (status?.workflowOwned !== false) {
                    enabled.add('delegation-rules/task-review');
                    enabled.add('delegation-rules/archive');
                }
            }
            const checkpoint = ctx.get('goalContinuityStatus');
            if (checkpoint?.automation === true) {
                enabled.add('goal-continuity/work_checkpoint');
            }
            const verification = ctx.get('verificationGateStatus');
            if (verification !== undefined) {
                installed.add('verification-gate');
                if (verification.steering === true)
                    enabled.add('verification-gate/verification-gate');
            }
        }
        catch {
            // An unreadable status service proves nothing; the signal stays disabled.
        }
        return { installed, enabled };
    };
    /** Load the shipped set plus the approved local overrides for one workspace. */
    const definitionLoads = new Map();
    const loadDefinitions = (workspace) => {
        const existing = definitionLoads.get(workspace);
        if (existing !== undefined)
            return existing;
        if (pluginDisposed)
            return Promise.resolve();
        const promise = (async () => {
            try {
                if (await hasLocalDefinitionFiles(workspace))
                    await ensureAuth();
                const legacy = legacySignalState();
                const loaded = await loadApprovedDefinitions(workspace, {
                    ...(storedAuth === undefined ? {} : { auth: storedAuth }),
                    installedLegacy: legacy.installed,
                    enabledLegacy: legacy.enabled,
                });
                // The release-bound parity report gates every `own` definition; the
                // verified profile settings are applied only after its template check.
                const parity = readParityReport();
                const parityCheck = parityLoadIssues(loaded.definitions, parity.report, shippedParityReportPath(), parity.error);
                const loadErrors = [...loaded.errors, ...parityCheck.issues];
                const accepted = loaded.definitions
                    .filter((definition) => !parityCheck.refused.has(definition.id))
                    .map((definition) => withVerifySettings(definition, verifySettings));
                if (pluginDisposed)
                    return;
                definitionsByWorkspace.set(workspace, accepted);
                // A run is authoritative only when signed, so an active definition
                // needs the host key ready before its first event.
                if (accepted.some((definition) => definition.trigger.mode === 'active')) {
                    void ensureAuth();
                }
                // Definition-load refusals are diagnostics, not listener failures: they
                // must not overwrite the health strip's single last-error slot.
                for (const message of loadErrors) {
                    console.error(`workflows: ${message.slice(0, 300)}`);
                }
            }
            catch (error) {
                if (!pluginDisposed) {
                    definitionsByWorkspace.set(workspace, []);
                    console.error(`workflows: the definitions could not be loaded (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`);
                }
            }
        })();
        definitionLoads.set(workspace, promise);
        return promise;
    };
    /** The approved definitions of one workspace, loaded on first use. */
    const definitionsFor = async (workspace) => {
        await loadDefinitions(workspace);
        return [...(definitionsByWorkspace.get(workspace) ?? [])];
    };
    /** Start one run for an active trigger; persistence happens before success. */
    const startDefinitionRun = (workspace, definition, event, blocked = false, extraContext = {}) => {
        const auth = storedAuth;
        if (auth === undefined) {
            void ensureAuth();
            return {
                ok: false,
                reason: 'the host key is not ready yet; no unsigned run is created',
            };
        }
        if (blocked) {
            return {
                ok: false,
                reason: `the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`,
            };
        }
        reserveStart(workspace);
        try {
            const dedupeKey = obligationDedupeKey(definition.id, definition.trigger, event);
            const run = createRun({
                definition: definition.id,
                trigger: definition.trigger.kind,
                session: event.session ?? '',
                workspace,
                context: {
                    ...(event.name === undefined ? {} : { name: event.name }),
                    ...extraContext,
                },
                steps: definition.steps.map((step) => step.id),
                now: journal.time(),
                ...(dedupeKey === undefined ? {} : { dedupeKey }),
            });
            writeRunSync(workspace, run, auth);
            void refreshPromptRuns(workspace);
            return { ok: true, runId: run.id };
        }
        catch (error) {
            return { ok: false, reason: runFailure(error) };
        }
        finally {
            releaseStart(workspace);
        }
    };
    /** The prompt's active runs per workspace, refreshed after every transition. */
    const promptRunsByWorkspace = new Map();
    const sessionWorkspaces = new Map();
    let promptWorkspace;
    const refreshPromptRuns = async (workspace) => {
        const auth = storedAuth;
        if (auth === undefined)
            return;
        try {
            const runs = await listAuthenticatedRuns(workspace, auth);
            promptRunsByWorkspace.set(workspace, runs.filter((run) => run.status === 'running' || run.status === 'blocked' || run.status === 'interrupted'));
            promptWorkspace = workspace;
        }
        catch {
            // Keep the last good prompt when a refresh cannot read the store.
        }
    };
    /** The session a prompt assembly scope names, when the engine supplies one. */
    const scopeSession = (scope) => {
        if (typeof scope === 'string')
            return scope;
        if (scope === null || typeof scope !== 'object')
            return undefined;
        const record = scope;
        for (const key of ['sessionId', 'session', 'id']) {
            if (typeof record[key] === 'string')
                return record[key];
        }
        return undefined;
    };
    /** The active runs for the assembly's session, or the last refreshed workspace. */
    const activePromptRuns = (context) => {
        const session = scopeSession(context?.scope);
        const workspace = session === undefined ? promptWorkspace : (sessionWorkspaces.get(session) ?? promptWorkspace);
        return workspace === undefined ? [] : (promptRunsByWorkspace.get(workspace) ?? []);
    };
    /** Mark unfinished runs from a previous process interrupted, never completed. */
    const recoveries = new Map();
    /** One startup recovery per workspace; later agents must not re-interrupt live runs. */
    const recoverIfNeeded = (workspace) => {
        const existing = recoveries.get(workspace);
        if (existing !== undefined)
            return existing;
        const promise = (async () => {
            try {
                if ((await storedRuns(workspace)).length === 0 || pluginDisposed)
                    return;
                const auth = await ensureAuth();
                if (auth === undefined || pluginDisposed)
                    return;
                const result = await recoverRuns(workspace, auth);
                if (result.recovered.length > 0) {
                    console.error(`workflows: ${String(result.recovered.length)} unfinished run(s) marked interrupted; resume or cancel them instead of auto-completing`);
                }
                if (!pluginDisposed) {
                    // Retention runs at boot, before the next session adds history.
                    await pruneRuns(workspace, { auth });
                    await refreshPromptRuns(workspace);
                }
            }
            catch (error) {
                console.error(`workflows: run recovery failed (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`);
            }
        })();
        recoveries.set(workspace, promise);
        return promise;
    };
    /** Begin health for a session workspace as soon as the session is known. */
    const observeSession = (session) => {
        try {
            const workspace = workspaceFor(services, session);
            if (workspace !== undefined) {
                activeSession.set(workspace, String(session.id));
                sessionWorkspaces.set(String(session.id), workspace);
                const header = session.header;
                rootSessions.set(String(session.id), header.origin !== 'subagent' &&
                    (header.delegationDepth ?? 0) === 0 &&
                    header.parentSession === undefined);
                seedCheckedTasks(workspace, String(session.id));
                healthFor(workspace);
                watchChanges(workspace);
                void loadDefinitions(workspace);
                recoverIfNeeded(workspace);
            }
        }
        catch {
            // A session without a usable workspace keeps the rest of the host working.
        }
    };
    ctx.effect(() => () => {
        pluginDisposed = true;
        for (const health of healths.values())
            health.dispose();
        healths.clear();
        for (const watcher of watchers.values())
            void watcher.dispose();
        watchers.clear();
        watching.clear();
    });
    const sessionEventAt = new Map();
    const turnMetrics = new Map();
    /** Bounded per-session observations the evidence verifier may consume. */
    const sessionToolCalls = new Map();
    const sessionShellResults = new Map();
    /** The checked task ids last seen per session and change, for the delta. */
    const checkedTasksSeen = new Map();
    /** Every newly-checked task id for a tasks.md change, newest last. */
    const checkedTaskDelta = (workspace, session, change, path) => {
        try {
            const markdown = readFileSync(join(workspace, path), 'utf8');
            const ids = checkedTaskIds(markdown);
            const key = `${session}\u0000${change}`;
            const previous = checkedTasksSeen.get(key);
            checkedTasksSeen.set(key, new Set(ids));
            if (previous === undefined)
                return [];
            return ids.filter((id) => !previous.has(id));
        }
        catch {
            return [];
        }
    };
    /** The goal-continuity session key: a SHA-256 prefix of the session id. */
    const sessionHash = (session) => createHash('sha256').update(session).digest('hex').slice(0, 16);
    /** Seed the checked-task baselines from the current workspace changes. */
    const seedCheckedTasks = (workspace, session) => {
        let changes;
        try {
            changes = readdirSync(join(workspace, 'openspec', 'changes'));
        }
        catch {
            // No readable change tree yet; the first event seeds the baseline.
            return;
        }
        for (const change of changes) {
            // The archive collection is not an active change, and one incomplete
            // change must not stop the remaining baselines from seeding.
            if (!CHANGE_NAME.test(change) || change === 'archive')
                continue;
            try {
                const markdown = readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
                checkedTasksSeen.set(`${session}\u0000${change}`, new Set(checkedTaskIds(markdown)));
            }
            catch {
                // An incomplete change has no tasks.md; keep seeding the rest.
            }
        }
    };
    /** The session's current main-step owner; a second run waits for it to settle. */
    const mainStepOwners = new Map();
    /** The last turn whose user message was classified, one classification per turn. */
    const intentTurns = new Map();
    const metricsFor = (session, turn) => {
        const existing = turnMetrics.get(session);
        if (existing !== undefined && existing.turn === turn)
            return existing;
        const fresh = { turn, toolCalls: 0, written: 0, workers: 0 };
        turnMetrics.set(session, fresh);
        return fresh;
    };
    /** Record one engine-only evaluation in the same journal the recorder writes. */
    const recordEngineEvaluation = async (workspace, session, turn, kind, subject, summary, rows) => {
        const { record: bounded } = journal.record({
            at: journal.time(),
            session,
            ...(turn === undefined ? {} : { turn }),
            kind,
            subject,
            summary,
            bytes: Buffer.byteLength(summary, 'utf8'),
            truncated: false,
            ...(rows.length === 0 ? {} : { triggers: rows }),
        });
        healthFor(workspace).markEvent(bounded.at);
        sessionEventAt.set(session, bounded.at);
        const result = await journal.append(workspace, bounded);
        if (!result.ok) {
            healthFor(workspace).setJournalWritable(false);
            healthFor(workspace).recordError(result.error);
        }
    };
    const recordNow = async (workspace, input, event) => {
        const health = healthFor(workspace);
        activeSession.set(workspace, input.session);
        await loadDefinitions(workspace);
        await recoverIfNeeded(workspace);
        try {
            await seedTriggerIdentities(workspace, input.session);
        }
        catch {
            // A later event retries the seed; evaluation still proceeds.
        }
        const sessionSeen = seen.get(input.session) ?? new Map();
        seen.set(input.session, sessionSeen);
        if ((definitionsByWorkspace.get(workspace) ?? []).some((definition) => definition.trigger.mode === 'active')) {
            try {
                await ensureAuth();
            }
            catch {
                // A run start is suppressed and journaled if the key cannot load.
            }
        }
        const releaseAdmission = await acquireAdmission(workspace);
        try {
            const knownRuns = storedAuth === undefined ? [] : await listAuthenticatedRuns(workspace, storedAuth);
            const runLimitReached = storedAuth !== undefined && atRunLimit(workspace, knownRuns);
            let startedThisEvent = 0;
            const records = evaluateEvent(triggers, event, sessionSeen, true, input.at);
            const metrics = input.turn === undefined ? undefined : turnMetrics.get(input.session);
            // The checked-task delta names the task a task-review run reads. It is
            // computed here, not added to the observed fs.change event.
            const changedName = event.kind === 'fs.change'
                ? /^openspec\/changes\/([^/]+)\//u.exec(event.subject)?.[1]
                : undefined;
            const taskReviewTaskIds = changedName !== undefined && /(?:^|\/)tasks\.md$/u.test(event.subject)
                ? checkedTaskDelta(workspace, input.session, changedName, event.subject)
                : [];
            const definitionRows = definitionEventsOf(input, event, workspace).flatMap((definitionEvent) => evaluateDefinitions(definitionsByWorkspace.get(workspace) ?? [], definitionEvent, {
                isDuplicate: (key) => sessionSeen.has(key),
                markKey: (key) => sessionSeen.set(key, input.at),
                startRun: (definition, matched) => {
                    const limited = () => storedAuth !== undefined &&
                        (runLimitReached || openRunCount(knownRuns) + startedThisEvent >= maxRuns);
                    if (definition.id === 'task-review') {
                        // The watcher coalesces writes, so every newly checked task
                        // gets its own observational run.
                        if (taskReviewTaskIds.length === 0) {
                            return { ok: false, reason: 'no newly checked task in this tasks.md change' };
                        }
                        let first;
                        for (const taskId of taskReviewTaskIds) {
                            const outcome = startDefinitionRun(workspace, definition, matched, limited(), {
                                taskId,
                            });
                            if (outcome.ok)
                                startedThisEvent += 1;
                            first ??= outcome;
                        }
                        return first ?? { ok: false, reason: 'the observational run was not started' };
                    }
                    const extraContext = definition.id === 'retro' &&
                        matched.turn !== undefined &&
                        matched.session !== undefined
                        ? {
                            checkpoint: `.dsh/work-checkpoints/${sessionHash(String(matched.session))}/${String(matched.turn)}.json`,
                        }
                        : {};
                    const outcome = startDefinitionRun(workspace, definition, matched, limited(), extraContext);
                    if (outcome.ok)
                        startedThisEvent += 1;
                    return outcome;
                },
                resolveApplicability: (definition) => {
                    if (definition.trigger.applicability !== 'checkpoint-required')
                        return undefined;
                    // The legacy checkpoint gate excludes subagent sessions.
                    if (rootSessions.get(input.session) !== true)
                        return false;
                    const current = input.turn !== undefined && metrics !== undefined && metrics.turn === input.turn
                        ? metrics
                        : undefined;
                    return checkpointRequired({
                        toolCalls: current?.toolCalls ?? 0,
                        ...(current?.lastTool === undefined ? {} : { lastTool: current.lastTool }),
                        written: current?.written ?? 0,
                        workers: current?.workers ?? 0,
                        minToolCalls: checkpointApplicability.minToolCalls,
                        requireWrite: checkpointApplicability.requireWrite,
                    });
                },
            }).map((row) => ({
                id: `definition:${row.definition}`,
                matched: row.matched,
                reason: row.reason,
                ...(row.path === undefined ? {} : { path: row.path }),
                ...(row.filter === undefined ? {} : { filter: row.filter }),
                ...(row.detail === undefined ? {} : { detail: row.detail }),
                ...(row.runId === undefined ? {} : { runId: row.runId }),
            })));
            const evaluations = [...records, ...definitionRows];
            // A deferred observational run whose trigger later evaluates as not
            // applicable is completed so retention can prune it, never left blocked.
            if (storedAuth !== undefined) {
                for (const row of definitionRows) {
                    if (row.reason !== 'not-applicable')
                        continue;
                    const definitionId = row.id.slice('definition:'.length);
                    const existing = knownRuns.find((run) => run.definition === definitionId &&
                        run.session === input.session &&
                        (run.status === 'running' || run.status === 'blocked'));
                    if (existing === undefined)
                        continue;
                    await writeRun(workspace, completeNotApplicable(existing, input.at), storedAuth);
                }
            }
            const { record: bounded } = journal.record({
                ...input,
                ...(evaluations.length === 0 ? {} : { triggers: evaluations }),
            });
            // The event was observed even if its record cannot be written.
            health.markEvent(bounded.at);
            sessionEventAt.set(input.session, bounded.at);
            void journal.append(workspace, bounded).then((result) => {
                if (result.ok)
                    return;
                health.setJournalWritable(false);
                health.recordError(result.error);
                console.error(`workflows: the session journal could not be written (${result.error})`);
            });
            watchChanges(workspace);
        }
        finally {
            releaseAdmission();
        }
    };
    /** Preserve observation order per session while definitions and keys load. */
    const recordQueues = new Map();
    const record = (workspace, input, event) => {
        const previous = recordQueues.get(input.session) ?? Promise.resolve();
        const next = previous
            .then(async () => recordNow(workspace, input, event))
            .catch((error) => publishListenerError(workspace, error));
        recordQueues.set(input.session, next);
        return next;
    };
    // One change-tree watcher per workspace; it starts on the workspace's first
    // observed event and attributes a change to the session active there.
    const watchChanges = (workspace) => {
        if (watchers.has(workspace) || watching.has(workspace))
            return;
        watching.add(workspace);
        let watchFailed = false;
        void startFsChangeWatcher({
            workspace,
            fs: services.fs,
            onChange: (event) => {
                if (pluginDisposed)
                    return;
                const session = activeSession.get(workspace);
                if (session === undefined)
                    return;
                const summary = `${event.change} ${event.path}`;
                record(workspace, {
                    at: journal.time(),
                    session,
                    ...(turns.get(session) === undefined ? {} : { turn: turns.get(session) }),
                    kind: 'fs.change',
                    subject: event.path,
                    summary,
                    bytes: Buffer.byteLength(summary, 'utf8'),
                    truncated: false,
                }, {
                    kind: 'fs.change',
                    subject: event.path,
                    change: event.change,
                    ...(event.hash === undefined ? {} : { hash: event.hash }),
                });
            },
            onError: (error) => {
                if (pluginDisposed)
                    return;
                watchFailed = true;
                watchHealthy.set(workspace, false);
                healthFor(workspace).recordError(error);
                healthFor(workspace).setListenerCount(publishedListenerCount(workspace));
                console.error(`workflows: the change watcher reported an error (${error.message})`);
            },
            onRescan: (reason) => {
                if (pluginDisposed)
                    return;
                healthFor(workspace).recordError(new Error(reason));
            },
        })
            .then((watcher) => {
            if (pluginDisposed) {
                void watcher.dispose();
                return;
            }
            watching.delete(workspace);
            watchers.set(workspace, watcher);
            watchHealthy.set(workspace, !watchFailed);
            healthFor(workspace).setListenerCount(publishedListenerCount(workspace));
        })
            .catch((error) => {
            if (pluginDisposed)
                return;
            watching.delete(workspace);
            watchHealthy.set(workspace, false);
            healthFor(workspace).recordError(error);
            healthFor(workspace).setListenerCount(publishedListenerCount(workspace));
            console.error(`workflows: the change watcher could not start (${error instanceof Error ? error.message : String(error)})`);
        });
    };
    listen(() => ctx.on('agent/pre-step', async (payload, next) => {
        let workspace;
        try {
            const session = payload.agent.session;
            workspace = workspaceFor(services, session);
            if (workspace !== undefined) {
                const activeWorkspace = workspace;
                turns.set(String(session.id), payload.turn);
                metricsFor(String(session.id), payload.turn);
                const origin = session.header.origin === 'subagent' ? 'subagent' : 'root';
                const summary = `step ${String(payload.step)}`;
                await record(workspace, {
                    at: journal.time(),
                    session: String(session.id),
                    turn: payload.turn,
                    kind: 'agent/pre-step',
                    subject: origin,
                    summary,
                    bytes: Buffer.byteLength(summary, 'utf8'),
                    truncated: false,
                }, { kind: 'agent.turn-start', subject: origin });
                const sessionId = String(session.id);
                const text = lastUserText(payload.messages);
                if (text !== undefined && intentTurns.get(sessionId) !== payload.turn) {
                    intentTurns.set(sessionId, payload.turn);
                    const classification = classifyIntent(text);
                    const definitions = await definitionsFor(activeWorkspace);
                    const intentDefinitions = definitions.filter((definition) => definition.trigger.kind === 'intent');
                    if (classification !== undefined && intentDefinitions.length > 0) {
                        await recoverIfNeeded(activeWorkspace);
                        const releaseIntentAdmission = await acquireAdmission(activeWorkspace);
                        try {
                            const intentAuth = storedAuth;
                            const intentRuns = intentAuth === undefined
                                ? []
                                : await listAuthenticatedRuns(activeWorkspace, intentAuth);
                            const intentFull = intentAuth !== undefined && atRunLimit(activeWorkspace, intentRuns);
                            let intentStarted = 0;
                            const sessionSeen = seen.get(sessionId) ?? new Map();
                            seen.set(sessionId, sessionSeen);
                            const rows = evaluateIntents(intentDefinitions, classification, {
                                allowIntent: engineAllowIntent,
                                confirmed: true,
                                enabled: true,
                                ready: true,
                                session: sessionId,
                                workspace: activeWorkspace,
                                turn: payload.turn,
                                isDuplicate: (key) => sessionSeen.has(key),
                                markKey: (key) => sessionSeen.set(key, journal.time()),
                                startRun: (definition) => {
                                    const auth = storedAuth;
                                    if (auth === undefined) {
                                        return {
                                            ok: false,
                                            reason: 'the host key is unavailable; no run was created',
                                        };
                                    }
                                    if (intentFull || openRunCount(intentRuns) + intentStarted >= maxRuns) {
                                        return {
                                            ok: false,
                                            reason: `the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`,
                                        };
                                    }
                                    reserveStart(activeWorkspace);
                                    try {
                                        const key = intentDedupeKey(definition, classification, {
                                            session: sessionId,
                                            turn: payload.turn,
                                        });
                                        const run = createRun({
                                            definition: definition.id,
                                            trigger: 'intent',
                                            session: sessionId,
                                            workspace: activeWorkspace,
                                            context: {
                                                intent: classification.intent,
                                                confidence: classification.confidence,
                                                classifier: classification.classifier,
                                            },
                                            steps: definition.steps.map((step) => step.id),
                                            now: journal.time(),
                                            ...(key === undefined ? {} : { dedupeKey: key }),
                                        });
                                        writeRunSync(activeWorkspace, run, auth);
                                        intentStarted += 1;
                                        return { ok: true, runId: run.id };
                                    }
                                    catch (error) {
                                        return { ok: false, reason: runFailure(error) };
                                    }
                                    finally {
                                        releaseStart(activeWorkspace);
                                    }
                                },
                            });
                            await recordEngineEvaluation(activeWorkspace, sessionId, payload.turn, 'intent', classification.intent, `intent ${classification.intent} (${classification.confidence.toFixed(2)})`, rows.map((row) => ({
                                id: `definition:${row.definition}`,
                                matched: row.matched,
                                reason: row.reason,
                                ...(row.path === undefined ? {} : { path: row.path }),
                                ...(row.filter === undefined ? {} : { filter: row.filter }),
                                ...(row.detail === undefined ? {} : { detail: row.detail }),
                                ...(row.runId === undefined ? {} : { runId: row.runId }),
                            })));
                        }
                        finally {
                            releaseIntentAdmission();
                        }
                    }
                }
            }
        }
        catch (error) {
            // An observer never fails a step, but its failure stays visible.
            publishListenerError(workspace, error);
        }
        return next();
    }));
    listen(() => ctx.on('agent/turn-stopping', async (payload) => {
        let workspace;
        try {
            const session = payload.agent.session;
            workspace = workspaceFor(services, session);
            if (workspace === undefined)
                return;
            turns.set(String(session.id), payload.turn);
            const summary = `turn ${String(payload.turn)} stop attempt`;
            void record(workspace, {
                at: journal.time(),
                session: String(session.id),
                turn: payload.turn,
                kind: 'agent/turn-stopping',
                subject: 'stop-attempt',
                summary,
                bytes: Buffer.byteLength(summary, 'utf8'),
                truncated: false,
            }, { kind: 'agent.turn-stop', subject: 'stop-attempt' });
        }
        catch (error) {
            // An observer never fails a turn, but its failure stays visible.
            publishListenerError(workspace, error);
        }
    }));
    listen(() => ctx.on('tools/result', (exec, result) => {
        let workspace;
        try {
            const agent = exec.agent;
            if (agent === undefined)
                return;
            const session = agent.session;
            workspace = workspaceFor(services, session);
            if (workspace === undefined)
                return;
            const metrics = metricsFor(String(session.id), turns.get(String(session.id)) ?? 0);
            metrics.toolCalls += 1;
            metrics.lastTool = exec.name;
            const text = toolResultText(result);
            const args = typeof exec.arguments === 'object' && exec.arguments !== null
                ? exec.arguments
                : {};
            // Match the goal-continuity evidence collection: only a successful
            // write with a path and a successfully started worker count.
            if (!result.isError) {
                if ((exec.name === 'write' || exec.name === 'edit') &&
                    typeof args.file_path === 'string') {
                    metrics.written += 1;
                }
                if (WORKER_TOOL_NAMES.has(exec.name) &&
                    (exec.name !== 'delegate' || delegateStarted(text))) {
                    metrics.workers += 1;
                }
            }
            const summary = toolSummary(exec.name, result.isError, text);
            const bytes = Buffer.byteLength(text, 'utf8');
            const sessionId = String(session.id);
            const shellOutcome = shellOutcomeOf(result);
            const isShellTool = exec.name === 'pwsh' || exec.name === 'bash';
            const observed = sessionToolCalls.get(sessionId) ?? [];
            observed.push({
                callId: String(exec.callId),
                name: exec.name,
                arguments: args,
                ok: isShellTool ? shellOutcome.ok : !result.isError,
                at: journal.time(),
                ...(turns.get(sessionId) === undefined ? {} : { turn: turns.get(sessionId) }),
            });
            if (observed.length > 100)
                observed.shift();
            sessionToolCalls.set(sessionId, observed);
            const command = isShellTool ? shellCommandOf(exec) : undefined;
            // A background or unreadable shell result cannot satisfy a check.
            if (command !== undefined && shellOutcome.background !== true) {
                const results = sessionShellResults.get(sessionId) ?? [];
                results.push({
                    callId: String(exec.callId),
                    command,
                    at: journal.time(),
                    foreground: true,
                    exitCode: shellOutcome.exitCode,
                    ok: shellOutcome.ok,
                    ...(shellOutcome.timedOut === true ? { timedOut: true } : {}),
                    ...(shellOutcome.signal === undefined ? {} : { signal: shellOutcome.signal }),
                    ...(shellOutcome.sandboxDenied === true ? { sandboxDenied: true } : {}),
                    ...(shellOutcome.cwd === undefined ? {} : { cwd: shellOutcome.cwd }),
                });
                if (results.length > 50)
                    results.shift();
                sessionShellResults.set(sessionId, results);
            }
            void record(workspace, {
                at: journal.time(),
                session: String(session.id),
                ...(turns.get(String(session.id)) === undefined
                    ? {}
                    : { turn: turns.get(String(session.id)) }),
                kind: 'tools/result',
                subject: exec.name,
                callId: String(exec.callId),
                ok: !result.isError,
                summary,
                bytes,
                truncated: bytes > MAX_RECORD_BYTES,
            }, { kind: 'tool.result', subject: exec.name, tool: exec.name }).catch((error) => publishListenerError(workspace, error));
        }
        catch (error) {
            // Observability never breaks tool dispatch; the failure is published.
            publishListenerError(workspace, error);
        }
    }));
    // DSH dispatches `subagent/start` and `subagent/end` inside the delegating
    // parent's scoped context and passes only the run info to listeners. A
    // listener bound to one agent's context sees that agent's own delegations;
    // bind every created agent (subagents included), prefer the child session's
    // recorded direct parent, and de-duplicate by run so an enclosing scope that
    // also sees a descendant's event cannot add a second record.
    const parentByRun = new Map();
    const recordedLifecycles = new Set();
    const parentSessionFor = (info, fallback) => {
        const remembered = parentByRun.get(String(info.runId));
        if (remembered !== undefined)
            return remembered;
        try {
            const child = services.agents.get(String(info.id));
            const direct = child?.session.header.parentSession;
            if (direct !== undefined) {
                parentByRun.set(String(info.runId), String(direct));
                return String(direct);
            }
        }
        catch {
            // A provider without a live child falls back to the scoped owner.
        }
        return String(fallback.session.id);
    };
    const recordSubagent = (owner, kind, info) => {
        const lifecycle = `${kind}:${String(info.runId)}`;
        if (recordedLifecycles.has(lifecycle))
            return;
        const sessionId = parentSessionFor(info, owner);
        const parent = services.agents.get(sessionId);
        const session = parent?.session ?? owner.session;
        const workspace = workspaceFor(services, session);
        if (workspace === undefined)
            return;
        recordedLifecycles.add(lifecycle);
        const summary = kind === 'subagent/start'
            ? `child ${String(info.id)} started via ${info.provider}`
            : `child ${String(info.id)} ended: ${describe(info.stopReason)}`;
        const turn = turns.get(sessionId);
        void record(workspace, {
            at: journal.time(),
            session: sessionId,
            ...(turn === undefined ? {} : { turn }),
            kind,
            subject: String(info.id),
            summary,
            bytes: Buffer.byteLength(summary, 'utf8'),
            truncated: false,
        }, {
            kind: kind === 'subagent/start' ? 'subagent.start' : 'subagent.end',
            subject: String(info.id),
        }).catch((error) => publishListenerError(workspace, error));
    };
    const bindings = [];
    const boundAgents = new WeakSet();
    ctx.effect(() => () => {
        for (const dispose of bindings.splice(0)) {
            try {
                dispose();
            }
            catch {
                // A listener that cannot unbind cannot stop the recorder's disposal.
            }
        }
    });
    const bindLifecycle = (agent) => {
        if (boundAgents.has(agent))
            return;
        boundAgents.add(agent);
        try {
            bindings.push(agent.ctx.on('subagent/start', (info) => {
                try {
                    recordSubagent(agent, 'subagent/start', info);
                }
                catch (error) {
                    publishListenerError(workspaceFor(services, agent.session), error);
                }
            }));
        }
        catch (error) {
            failScopedListener(error);
        }
        try {
            bindings.push(agent.ctx.on('subagent/end', (info) => {
                try {
                    recordSubagent(agent, 'subagent/end', info);
                }
                catch (error) {
                    publishListenerError(workspaceFor(services, agent.session), error);
                }
            }));
        }
        catch (error) {
            failScopedListener(error);
        }
    };
    listen(() => ctx.on('agent/created', ({ agent }) => {
        try {
            bindLifecycle(agent);
            observeSession(agent.session);
        }
        catch {
            // A listener that cannot bind leaves the rest of the host working.
        }
        return undefined;
    }));
    // A reload or late mount keeps observing agents that are already live; a
    // quiet workspace still gets its health file and self-check at boot.
    try {
        for (const agent of services.agents.list()) {
            bindLifecycle(agent);
            observeSession(agent.session);
        }
    }
    catch {
        // An unreadable registry leaves the recorder inert for existing agents.
    }
    // The four main observers are registered; the per-workspace change source is
    // the fifth expected listener. A failed registration lowers the count so
    // health reports listener-down instead of healthy.
    for (const [workspace, health] of healths) {
        health.setListenerCount(publishedListenerCount(workspace));
    }
    /* ------------------------------------------------------------------ */
    /* obligation engine wiring                                            */
    /* ------------------------------------------------------------------ */
    const ownedCalls = new OwnedCalls();
    /** In-flight run starts count against maxRuns until their write settles. */
    const reservedStarts = new Map();
    const reserveStart = (workspace) => {
        reservedStarts.set(workspace, (reservedStarts.get(workspace) ?? 0) + 1);
    };
    const releaseStart = (workspace) => {
        const left = (reservedStarts.get(workspace) ?? 1) - 1;
        if (left <= 0)
            reservedStarts.delete(workspace);
        else
            reservedStarts.set(workspace, left);
    };
    const atRunLimit = (workspace, runs) => openRunCount(runs) + (reservedStarts.get(workspace) ?? 0) >= maxRuns;
    /** Serialize capacity read, admission, and persistence across sessions. */
    const admissionTails = new Map();
    const acquireAdmission = async (workspace) => {
        const previous = admissionTails.get(workspace) ?? Promise.resolve();
        let release;
        const hold = new Promise((resolve) => {
            release = resolve;
        });
        admissionTails.set(workspace, previous.then(() => hold));
        await previous;
        return release;
    };
    /** Dedupe keys whose triggering call has not finished starting its run yet. */
    const inFlightTriggers = new Set();
    const optionalService = (name) => {
        try {
            return ctx.get?.(name);
        }
        catch {
            return undefined;
        }
    };
    const subagentRuntime = optionalService('subagents');
    /** The host subagent runner for the subagent executor; absent without the seam. */
    const hostSubagentRunner = (agent) => {
        if (subagentRuntime === undefined)
            return undefined;
        return {
            run: async (request, signal) => {
                const controller = signal ?? new AbortController().signal;
                const activation = await subagentRuntime.startActivation({
                    provider: request.provider,
                    label: `workflows ${request.provider}`.slice(0, 120),
                    request: {
                        parent: agent,
                        prompt: [{ type: 'text', text: request.prompt }],
                        ...(request.schema === undefined ? {} : { outputSchema: request.schema }),
                    },
                    signal: controller,
                    delivery: 'caller',
                });
                const result = await activation.result;
                return {
                    childId: String(activation.childId),
                    completed: result.stopReason === 'completed',
                    ...(result.structured === undefined ? {} : { result: result.structured }),
                    ...(result.diagnostic === undefined ? {} : { error: result.diagnostic }),
                };
            },
        };
    };
    const rawUserQuestions = optionalService('userQuestions');
    const userQuestions = rawUserQuestions === undefined ? undefined : adaptUserQuestions(rawUserQuestions);
    const shellWorkdirOf = (exec) => {
        const args = exec.arguments;
        if (typeof args !== 'object' || args === null)
            return undefined;
        const record = args;
        const workdir = record.workdir ?? record.cwd;
        return typeof workdir === 'string' && workdir !== '' ? workdir : undefined;
    };
    const shellCommandOf = (exec) => {
        const args = exec.arguments;
        if (typeof args !== 'object' || args === null)
            return undefined;
        const record = args;
        if (exec.name === 'terminal_send') {
            return typeof record.text === 'string' ? record.text : undefined;
        }
        if (exec.name === 'pwsh' || exec.name === 'bash') {
            return typeof record.command === 'string' ? record.command : undefined;
        }
        return undefined;
    };
    const changeDirectoryExists = async (workspace, name) => {
        try {
            return (await stat(join(workspace, 'openspec', 'changes', name))).isDirectory();
        }
        catch {
            return false;
        }
    };
    const shellOutcomeOf = (result) => {
        const record = typeof result === 'object' && result !== null
            ? result
            : undefined;
        const value = record !== undefined && typeof record.value === 'object' && record.value !== null
            ? record.value
            : undefined;
        const unreadable = {
            readable: false,
            ok: false,
            exitCode: 1,
        };
        if (record === undefined || value === undefined)
            return unreadable;
        if (value.kind !== 'foreground')
            return { ...unreadable, background: true };
        const exitCode = value.exitCode;
        const signal = value.signal;
        if (typeof exitCode !== 'number' && exitCode !== null)
            return unreadable;
        if (typeof signal !== 'string' && signal !== null)
            return unreadable;
        if (typeof value.timedOut !== 'boolean' || typeof value.aborted !== 'boolean') {
            return unreadable;
        }
        let denied = false;
        let runnerFailed = false;
        if (value.sandbox !== undefined) {
            const sandbox = value.sandbox;
            if (typeof sandbox !== 'object' ||
                sandbox === null ||
                typeof sandbox.denied !== 'boolean') {
                return unreadable;
            }
            const sandboxRecord = sandbox;
            denied = sandboxRecord.denied === true;
            runnerFailed = sandboxRecord.runnerFailed === true;
        }
        const ok = record.isError !== true &&
            exitCode === 0 &&
            signal === null &&
            value.timedOut === false &&
            value.aborted === false &&
            !denied &&
            !runnerFailed;
        return {
            readable: true,
            ok,
            exitCode: typeof exitCode === 'number' ? exitCode : 1,
            ...(value.timedOut === true ? { timedOut: true } : {}),
            ...(typeof signal === 'string' ? { signal } : {}),
            ...(denied ? { sandboxDenied: true } : {}),
            ...(typeof value.cwd === 'string' && value.cwd !== '' ? { cwd: value.cwd } : {}),
        };
    };
    /** A host-owned tool dispatch through the registered tool service, if present. */
    const liveToolRunner = (agent) => {
        const tools = ctx.get('tools');
        if (typeof tools?.execute !== 'function')
            return undefined;
        const execute = tools.execute.bind(tools);
        return {
            async call(request) {
                const batch = await execute({
                    calls: [{ id: request.callId, name: request.name, arguments: request.arguments }],
                    signal: AbortSignal.timeout(60_000),
                    agent,
                });
                const first = batch.results[0];
                if (first === undefined) {
                    return { ok: false, error: `the ${request.name} tool call failed` };
                }
                const isShellTool = request.name === 'pwsh' || request.name === 'bash' || request.name === 'terminal_send';
                const shell = isShellTool ? shellOutcomeOf(first.result) : undefined;
                if (shell !== undefined && (shell.background === true || !shell.ok)) {
                    return { ok: false, error: `the ${request.name} tool call failed` };
                }
                if (shell === undefined &&
                    first.result?.isError === true) {
                    return { ok: false, error: `the ${request.name} tool call failed` };
                }
                // The host already observed its own dispatch; record it for evidence
                // verification even if the result event is delivered later.
                const sessionId = String(agent.session.id);
                const observed = sessionToolCalls.get(sessionId) ?? [];
                observed.push({
                    callId: request.callId,
                    name: request.name,
                    arguments: { ...request.arguments },
                    ok: true,
                    at: journal.time(),
                    ...(turns.get(sessionId) === undefined ? {} : { turn: turns.get(sessionId) }),
                });
                if (observed.length > 100)
                    observed.shift();
                sessionToolCalls.set(sessionId, observed);
                const command = request.arguments.command;
                if (typeof command === 'string' && (request.name === 'pwsh' || request.name === 'bash')) {
                    const results = sessionShellResults.get(sessionId) ?? [];
                    results.push({
                        callId: request.callId,
                        command,
                        at: journal.time(),
                        foreground: true,
                        exitCode: shell?.exitCode ?? 0,
                        ...(shell?.timedOut === true ? { timedOut: true } : {}),
                        ...(shell?.signal === undefined ? {} : { signal: shell.signal }),
                        ...(shell?.sandboxDenied === true ? { sandboxDenied: true } : {}),
                        ...(shell?.cwd === undefined ? {} : { cwd: shell.cwd }),
                    });
                    if (results.length > 50)
                        results.shift();
                    sessionShellResults.set(sessionId, results);
                }
                return { ok: true };
            },
        };
    };
    /** Advance one run through its verified evidence; a deferred step never steers. */
    const advanceRun = async (workspace, run, definition, agent, auth, installedLegacy, enabledLegacy, turn) => {
        // Only a fully applicable deferred observation advances; a run whose
        // trigger is no longer applicable becomes terminal and pruneable.
        if (definition.trigger.applicability === 'checkpoint-required') {
            const metrics = turnMetrics.get(String(agent.session.id));
            const current = metrics !== undefined && metrics.turn === turn ? metrics : undefined;
            const applicable = checkpointRequired({
                toolCalls: current?.toolCalls ?? 0,
                ...(current?.lastTool === undefined ? {} : { lastTool: current.lastTool }),
                written: current?.written ?? 0,
                workers: current?.workers ?? 0,
                minToolCalls: checkpointApplicability.minToolCalls,
                requireWrite: checkpointApplicability.requireWrite,
            });
            if (!applicable) {
                const completed = completeNotApplicable(run, journal.time());
                await writeRun(workspace, completed, auth);
                return completed;
            }
        }
        if (definition.trigger.applicability === 'code-write') {
            // The verify definition observes only a turn that wrote code; a
            // documentation-only or inspection turn completes the run as inapplicable.
            const calls = (sessionToolCalls.get(String(agent.session.id)) ?? []).filter((call) => call.turn === undefined || call.turn === turn);
            if (lastCodeWriteAt(calls) === undefined) {
                const completed = completeNotApplicable(run, journal.time());
                await writeRun(workspace, completed, auth);
                return completed;
            }
        }
        const pending = run.steps.find((step) => step.state === 'open' || step.state === 'blocked');
        const sessionId = String(agent.session.id);
        // The host dispatch records into these live arrays, and the verifier must
        // read the same arrays it was handed.
        const toolCalls = sessionToolCalls.get(sessionId) ?? [];
        const shellResults = sessionShellResults.get(sessionId) ?? [];
        sessionToolCalls.set(sessionId, toolCalls);
        sessionShellResults.set(sessionId, shellResults);
        const runner = liveToolRunner(agent);
        const subagentRunner = hostSubagentRunner(agent);
        const result = await advanceIntake({
            run,
            definition,
            values: run.context,
            evidenceContext: {
                workspace,
                values: run.context,
                toolCalls,
                shellResults,
                checkCommands: verifySettings.commands,
                ...(lastCodeWriteAt(toolCalls) === undefined
                    ? {}
                    : { lastWriteAt: lastCodeWriteAt(toolCalls) }),
                ...(pending?.requestedAt === undefined ? {} : { stepStartedAt: pending.requestedAt }),
            },
            owned: ownedCalls,
            ...(runner === undefined ? {} : { toolRunner: runner }),
            ...(subagentRunner === undefined ? {} : { subagentRunner }),
            ...(userQuestions === undefined ? {} : { questions: userQuestions }),
            readRecord: (step) => verifyEvidence(step.evidence ?? { kind: 'declaration' }, {
                workspace,
                values: run.context,
            }),
            installedLegacy,
            enabledLegacy,
            auth,
            now: journal.time(),
        });
        if (result.run !== run)
            await writeRun(workspace, result.run, auth);
        return result.run;
    };
    const boundedError = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
    const startRunForUnlocked = async (workspace, sessionId, auth, definition, context = {}, dedupeKey) => {
        const runs = await listAuthenticatedRuns(workspace, auth);
        if (atRunLimit(workspace, runs)) {
            throw new Error(`the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`);
        }
        reserveStart(workspace);
        try {
            const run = createRun({
                definition: definition.id,
                trigger: definition.trigger.kind,
                session: sessionId,
                workspace,
                context,
                steps: definition.steps.map((step) => step.id),
                now: journal.time(),
                ...(dedupeKey === undefined ? {} : { dedupeKey }),
            });
            await writeRun(workspace, run, auth);
            void refreshPromptRuns(workspace);
            return run;
        }
        finally {
            releaseStart(workspace);
        }
    };
    const startRunFor = async (workspace, sessionId, auth, definition, context = {}, dedupeKey) => {
        const release = await acquireAdmission(workspace);
        try {
            return await startRunForUnlocked(workspace, sessionId, auth, definition, context, dedupeKey);
        }
        finally {
            release();
        }
    };
    const seeding = new Map();
    /** Restore persisted trigger identities after a reload; one shared read per session. */
    const seedTriggerIdentities = (workspace, sessionId) => {
        const existing = seeding.get(sessionId);
        if (existing !== undefined)
            return existing;
        const promise = (async () => {
            let auth = storedAuth;
            if (auth === undefined) {
                try {
                    auth = await ensureAuth();
                }
                catch {
                    auth = undefined;
                }
            }
            if (auth === undefined)
                throw new Error('the host key is unavailable');
            const runs = await listAuthenticatedRuns(workspace, auth);
            const map = seen.get(sessionId) ?? new Map();
            seen.set(sessionId, map);
            for (const run of runs) {
                if (run.session === sessionId && run.dedupeKey !== undefined) {
                    map.set(run.dedupeKey, run.updatedAt);
                }
            }
        })();
        seeding.set(sessionId, promise);
        void promise.catch(() => {
            seeding.delete(sessionId);
        });
        return promise;
    };
    // Tools pre-execute: intake, archive, and the authorization write guard.
    listenEngine(() => ctx.on('tools/pre-execute', async (exec, next) => {
        try {
            const agent = exec.agent;
            if (agent === undefined)
                return await next();
            const workspace = workspaceFor(services, agent.session);
            if (workspace === undefined)
                return await next();
            let auth = storedAuth;
            if (auth === undefined) {
                try {
                    auth = await ensureAuth();
                }
                catch {
                    auth = undefined;
                }
            }
            const command = shellCommandOf(exec);
            const create = command === undefined ? undefined : parseOpenspecCommand(command);
            const sessionId = String(agent.session.id);
            const definitions = await definitionsFor(workspace);
            await recoverIfNeeded(workspace);
            await seedTriggerIdentities(workspace, sessionId).catch(() => undefined);
            const releaseAdmission = await acquireAdmission(workspace);
            try {
                const knownRuns = auth === undefined ? [] : await listAuthenticatedRuns(workspace, auth);
                const sessionSeen = seen.get(sessionId) ?? new Map();
                seen.set(sessionId, sessionSeen);
                const observed = {
                    kind: 'tool.pre-execute',
                    subject: exec.name,
                    tool: exec.name,
                    workspace,
                    session: sessionId,
                    ...(exec.callId === undefined ? {} : { callId: String(exec.callId) }),
                    ...(turns.get(sessionId) === undefined ? {} : { turn: turns.get(sessionId) }),
                    ...(create?.kind === 'create-change'
                        ? { command: 'openspec new change <name>', name: create.name }
                        : create?.kind === 'archive'
                            ? { command: 'openspec archive <name>', name: create.change }
                            : {}),
                };
                const currentMetrics = turnMetrics.get(sessionId);
                const triggerRows = [];
                let startedThisEvent = 0;
                let concurrentIntakeReason;
                let capacityReason;
                let keyUnavailableReason;
                let intakeDecision;
                for (const definition of definitions) {
                    const applicability = definition.trigger.applicability === 'checkpoint-required'
                        ? checkpointRequired({
                            toolCalls: currentMetrics?.toolCalls ?? 0,
                            ...(currentMetrics?.lastTool === undefined
                                ? {}
                                : { lastTool: currentMetrics.lastTool }),
                            written: currentMetrics?.written ?? 0,
                            workers: currentMetrics?.workers ?? 0,
                        })
                        : undefined;
                    const evaluation = evaluateDefinitionTrigger(definition, observed, {
                        ...(applicability === undefined ? {} : { applicability }),
                        isDuplicate: (key) => sessionSeen.has(key),
                    });
                    const row = {
                        id: `definition:${definition.id}`,
                        matched: evaluation.matched,
                        reason: evaluation.reason,
                        ...(evaluation.path === undefined ? {} : { path: evaluation.path }),
                        ...(evaluation.filter === undefined ? {} : { filter: evaluation.filter }),
                        ...(evaluation.detail === undefined ? {} : { detail: evaluation.detail }),
                    };
                    const createsIntake = definition.id === 'change-intake' && create?.kind === 'create-change';
                    if (!evaluation.matched && evaluation.reason !== 'dedupe') {
                        triggerRows.push(row);
                        continue;
                    }
                    if (definition.trigger.mode === 'shadow') {
                        if (!evaluation.matched) {
                            // A duplicate shadow event keeps the dedupe reason instead of
                            // being reported as a fresh would-fire.
                            triggerRows.push(row);
                            continue;
                        }
                        const key = obligationDedupeKey(definition.id, definition.trigger, observed);
                        if (key !== undefined)
                            sessionSeen.set(key, journal.time());
                        triggerRows.push({ ...row, reason: 'would-fire' });
                        continue;
                    }
                    const repeats = definition.trigger.repeat === true;
                    const dedupeKey = obligationDedupeKey(definition.id, definition.trigger, observed);
                    // A concurrent call that already reserved the key must not start a
                    // second run or invoke the intake gate again, unless the trigger
                    // repeats on every matching event.
                    if (!repeats && dedupeKey !== undefined && inFlightTriggers.has(dedupeKey)) {
                        triggerRows.push({
                            ...row,
                            matched: true,
                            reason: 'run-suppressed',
                            detail: 'a matching event is already being evaluated',
                        });
                        if (createsIntake) {
                            concurrentIntakeReason = `an intake evaluation for "${create.name}" is already in progress; no second run was created`;
                        }
                        continue;
                    }
                    const reserve = !repeats && evaluation.matched && dedupeKey !== undefined;
                    if (reserve)
                        inFlightTriggers.add(dedupeKey);
                    try {
                        // An intake call is authorized only after the active trigger
                        // matched (or deduped to an existing intake); a shadow or filtered
                        // trigger never creates a run and must not invoke the intake gate.
                        if (createsIntake && (evaluation.matched || evaluation.reason === 'dedupe')) {
                            if (auth === undefined) {
                                triggerRows.push({
                                    ...row,
                                    matched: true,
                                    reason: 'run-suppressed',
                                    detail: 'the host key is unavailable; no run was created',
                                });
                                keyUnavailableReason = `workflows: the host key is unavailable, so the intake run for "${create.name}" was not created; the call was refused`;
                                continue;
                            }
                            let decision;
                            try {
                                decision = await evaluateIntakeGate({
                                    name: create.name,
                                    session: sessionId,
                                    workspace,
                                    callId: String(exec.callId),
                                    definition,
                                    runs: knownRuns,
                                    receipts: await listReceipts(workspace, auth),
                                    ownedCallIds: new Set(ownedCalls.list()),
                                    changeExists: await changeDirectoryExists(workspace, create.name),
                                    startRun: async (entry, name) => {
                                        if (atRunLimit(workspace, knownRuns) ||
                                            openRunCount(knownRuns) + startedThisEvent >= maxRuns) {
                                            throw new Error('workflows-run-limit');
                                        }
                                        const run = await startRunForUnlocked(workspace, sessionId, auth, entry, { name }, dedupeKey);
                                        startedThisEvent += 1;
                                        return { runId: run.id };
                                    },
                                    resumeRun: async (runId) => {
                                        const resumed = await resumeRun(workspace, runId, auth, Date.now(), sessionId);
                                        await writeRun(workspace, resumed.run, auth);
                                        return { stepId: resumed.stepId };
                                    },
                                });
                            }
                            catch (error) {
                                if (error instanceof Error && error.message === 'workflows-run-limit') {
                                    triggerRows.push({
                                        ...row,
                                        matched: true,
                                        reason: 'run-suppressed',
                                        detail: 'the run limit is reached; no intake run was created',
                                    });
                                    capacityReason = `workflows: the run limit (${String(maxRuns)}) is reached, so the intake run for "${create.name}" was not created; the call was refused`;
                                    continue;
                                }
                                throw error;
                            }
                            intakeDecision = decision;
                            if (decision.kind === 'deny' && decision.action === 'started') {
                                if (dedupeKey !== undefined)
                                    sessionSeen.set(dedupeKey, journal.time());
                                triggerRows.push({
                                    ...row,
                                    matched: true,
                                    reason: 'run-created',
                                    ...(decision.runId === undefined ? {} : { runId: decision.runId }),
                                    detail: decision.reason,
                                });
                            }
                            else if (decision.kind === 'deny') {
                                triggerRows.push({
                                    ...row,
                                    matched: true,
                                    reason: 'run-suppressed',
                                    ...(decision.runId === undefined ? {} : { runId: decision.runId }),
                                    detail: decision.reason,
                                });
                            }
                            else {
                                triggerRows.push({
                                    ...row,
                                    matched: true,
                                    reason: 'run-suppressed',
                                    detail: decision.reason,
                                });
                            }
                            continue;
                        }
                        if (!evaluation.matched) {
                            triggerRows.push(row);
                            continue;
                        }
                        // A non-intake active definition starts its own observational run.
                        if (auth === undefined) {
                            triggerRows.push({
                                ...row,
                                matched: true,
                                reason: 'run-suppressed',
                                detail: 'the host key is unavailable; no run was created',
                            });
                            continue;
                        }
                        if (atRunLimit(workspace, knownRuns) ||
                            openRunCount(knownRuns) + startedThisEvent >= maxRuns) {
                            triggerRows.push({
                                ...row,
                                matched: true,
                                reason: 'run-suppressed',
                                detail: 'the run limit is reached; no run was created',
                            });
                            continue;
                        }
                        try {
                            const run = await startRunForUnlocked(workspace, sessionId, auth, definition, {}, dedupeKey);
                            startedThisEvent += 1;
                            if (!repeats && dedupeKey !== undefined)
                                sessionSeen.set(dedupeKey, journal.time());
                            triggerRows.push({ ...row, matched: true, reason: 'run-created', runId: run.id });
                        }
                        catch (error) {
                            if (reserve && dedupeKey !== undefined)
                                sessionSeen.delete(dedupeKey);
                            triggerRows.push({
                                ...row,
                                matched: true,
                                reason: 'run-suppressed',
                                detail: boundedError(error),
                            });
                        }
                    }
                    finally {
                        if (reserve && dedupeKey !== undefined)
                            inFlightTriggers.delete(dedupeKey);
                    }
                }
                await recordEngineEvaluation(workspace, sessionId, turns.get(sessionId), 'tools/pre-execute', exec.name, `pre-execute ${exec.name}`, triggerRows);
                if (intakeDecision?.kind === 'deny') {
                    return { kind: 'deny', reason: intakeDecision.reason };
                }
                if (concurrentIntakeReason !== undefined) {
                    return { kind: 'deny', reason: concurrentIntakeReason };
                }
                if (keyUnavailableReason !== undefined) {
                    return { kind: 'deny', reason: keyUnavailableReason };
                }
                if (capacityReason !== undefined) {
                    return { kind: 'deny', reason: capacityReason };
                }
            }
            finally {
                releaseAdmission();
            }
            if (command !== undefined) {
                const declaredWorkdir = shellWorkdirOf(exec);
                const resolvedWorkdir = declaredWorkdir === undefined
                    ? normalize(workspace)
                    : normalize(isAbsolute(declaredWorkdir) ? declaredWorkdir : join(workspace, declaredWorkdir));
                const relativeWorkdir = relative(normalize(workspace), resolvedWorkdir);
                const inside = relativeWorkdir === '' ||
                    (!isAbsolute(relativeWorkdir) &&
                        relativeWorkdir !== '..' &&
                        !relativeWorkdir.startsWith(`..${sep}`) &&
                        !relativeWorkdir.startsWith('../') &&
                        !relativeWorkdir.startsWith('..\\'));
                const archive = parseArchiveCommand(command, workspace, inside ? resolvedWorkdir : undefined);
                const normalizedCommand = command.replaceAll('\\', '/');
                const relativeArchiveWorkdir = relativeWorkdir.replaceAll('\\', '/') === 'openspec/changes';
                const mentionsOpenSpecArchive = /openspec\/changes\/archive(?:\/|$)/iu.test(normalizedCommand) ||
                    (relativeArchiveWorkdir &&
                        /(?:^|\s)["']?archive\/?["']?(?:\s|$)/iu.test(normalizedCommand));
                const looksLikeMove = /(?:^|\s)(?:git\s+mv|mv|move-item)\s/iu.test(command) && mentionsOpenSpecArchive;
                if (archive === undefined &&
                    /^\s*(?:rtk\s+|pnpm\s+exec\s+)?openspec\s+archive\b/iu.test(command)) {
                    return {
                        kind: 'deny',
                        reason: 'the archive command could not be parsed safely; use openspec archive <name> with a valid change name',
                    };
                }
                if (archive === undefined && looksLikeMove) {
                    return {
                        kind: 'deny',
                        reason: 'the archive move could not be parsed safely; use openspec archive <name> or a plain move of openspec/changes/<name> into openspec/changes/archive/',
                    };
                }
                if (archive?.kind === 'archive' && archive.form === 'openspec') {
                    if (/--store(?:=|\s)/iu.test(command)) {
                        return {
                            kind: 'deny',
                            reason: 'the archive command selects a different OpenSpec store; workflow evidence is read only for the session workspace store',
                        };
                    }
                    let cursor = resolvedWorkdir;
                    for (;;) {
                        const hasOpenSpec = await stat(join(cursor, 'openspec'))
                            .then((info) => info.isDirectory())
                            .catch(() => false);
                        if (hasOpenSpec) {
                            const foldPath = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
                            if (foldPath(normalize(cursor)) !== foldPath(normalize(workspace))) {
                                return {
                                    kind: 'deny',
                                    reason: `the archive command targets the nested OpenSpec project "${cursor}"; evidence is read only for the session workspace "${normalize(workspace)}"`,
                                };
                            }
                            break;
                        }
                        const parent = dirname(cursor);
                        if (parent === cursor || relative(workspace, parent).startsWith('..'))
                            break;
                        cursor = parent;
                    }
                }
                if (archive?.kind === 'archive') {
                    if (archive.multipleSources === true) {
                        return {
                            kind: 'deny',
                            reason: 'a multi-source archive move cannot be authorized as one obligation; archive each change separately',
                        };
                    }
                    if (!inside) {
                        return {
                            kind: 'deny',
                            reason: `the archive command runs in "${resolvedWorkdir}", outside the session workspace "${normalize(workspace)}"; its evidence cannot authorize this archive`,
                        };
                    }
                    const specRecord = await verifyEvidence({
                        kind: 'record',
                        rule: 'spec-review',
                        change: archive.change,
                        phase: 'spec',
                        scope: 'whole',
                        verdict: 'PASS',
                        digest: 'current',
                    }, { workspace, values: { name: archive.change } });
                    const taskReviewOwned = definitions.some((definition) => definition.id === 'task-review' && definition.settings.gateOwnership === 'own');
                    const coverage = taskReviewOwned
                        ? taskReviewCoverage(workspace, archive.change)
                        : undefined;
                    const decision = evaluateArchiveGate({
                        change: archive.change,
                        tamperedRuns: auth === undefined ? false : await hasTamperedRuns(workspace, auth),
                        runs: auth === undefined ? [] : await listAuthenticatedRuns(workspace, auth),
                        receipts: auth === undefined ? [] : await listReceipts(workspace, auth),
                        specRecord,
                        ...(coverage === undefined
                            ? {}
                            : {
                                taskReview: {
                                    ok: coverage.ok,
                                    ...(coverage.gaps.length === 0 ? {} : { text: coverage.gaps.join('; ') }),
                                },
                            }),
                    });
                    if (decision.kind === 'deny')
                        return { kind: 'deny', reason: decision.reason };
                }
            }
            const writeDecision = authorizationWriteDecision({
                workspace,
                exec: { name: exec.name, arguments: exec.arguments },
                ownedCallIds: new Set(ownedCalls.list()),
                callId: String(exec.callId),
            });
            if (writeDecision?.kind === 'deny')
                return { kind: 'deny', reason: writeDecision.reason };
            return await next();
        }
        catch (error) {
            return {
                kind: 'deny',
                reason: `workflows: the pre-execute gate failed internally (${boundedError(error)}); the call was not run`,
            };
        }
    }));
    // Turn close: steer the first owned open blockTurnClose step, bounded.
    listenEngine(() => ctx.on('agent/turn-stopping', async (payload) => {
        try {
            if (payload.agent.session.header.origin === 'subagent')
                return;
            const workspace = workspaceFor(services, payload.agent.session);
            if (workspace === undefined)
                return;
            // The journal record that creates an observational run is queued before
            // this listener; settle it so a run created by this stop is advanced now.
            const queuedRecord = recordQueues.get(String(payload.agent.session.id));
            if (queuedRecord !== undefined)
                await queuedRecord.catch(() => undefined);
            await ensureAuth();
            const auth = storedAuth;
            if (auth === undefined)
                return;
            const definitions = await definitionsFor(workspace);
            const runs = await listAuthenticatedRuns(workspace, auth);
            const sessionId = String(payload.agent.session.id);
            const eligible = runs.filter((run) => run.session === sessionId && (run.status === 'running' || run.status === 'blocked'));
            const ownerId = mainStepOwners.get(sessionId);
            const owner = ownerId === undefined ? undefined : eligible.find((run) => run.id === ownerId);
            if (ownerId !== undefined && owner === undefined)
                mainStepOwners.delete(sessionId);
            const ordered = owner === undefined ? eligible : [owner, ...eligible.filter((run) => run.id !== owner.id)];
            const legacy = legacySignalState();
            // Advance every run first: an owned tool step (the review start) must
            // dispatch for every newly checked task before one close is refused.
            const advanced = new Map();
            const definitionOf = new Map();
            for (const run of ordered) {
                const definition = definitions.find((entry) => entry.id === run.definition);
                if (definition === undefined)
                    continue;
                // A retro run must not complete on the record alone: while the host
                // checkpoint remedy/age rule fails, keep the run open and steer.
                if (definition.id === 'retro' && typeof run.context.checkpoint === 'string') {
                    const calls = (sessionToolCalls.get(sessionId) ?? []).map((call) => ({
                        toolName: call.name,
                        arguments: call.arguments,
                        ok: call.ok,
                    }));
                    if (checkpointGateIssue(workspace, run.context.checkpoint, calls, checkpointApplicability.bottleneckAge) !== undefined) {
                        advanced.set(run.id, run);
                        definitionOf.set(run.id, definition);
                        continue;
                    }
                }
                const current = await advanceRun(workspace, run, definition, payload.agent, auth, legacy.installed, legacy.enabled, payload.turn);
                advanced.set(run.id, current);
                definitionOf.set(run.id, definition);
            }
            for (const run of ordered) {
                const current = advanced.get(run.id);
                const definition = definitionOf.get(run.id);
                if (current === undefined || definition === undefined)
                    continue;
                const sessionCalls = sessionToolCalls.get(sessionId) ?? [];
                const observations = sessionCalls.map((call) => ({
                    toolName: call.name,
                    arguments: call.arguments,
                    ok: call.ok,
                }));
                const completion = definition.id === 'task-review' && typeof current.context.name === 'string'
                    ? taskReviewCompletion(workspace, current.context.name)
                    : undefined;
                const checkpointIssue = definition.id === 'retro' && typeof current.context.checkpoint === 'string'
                    ? checkpointGateIssue(workspace, current.context.checkpoint, observations, checkpointApplicability.bottleneckAge)
                    : undefined;
                const outcome = evaluateTurnClose({
                    run: current,
                    definition,
                    agent: {
                        steer: (text) => payload.agent.steer({
                            id: randomUUID(),
                            role: 'user',
                            content: [{ type: 'text', text }],
                            source: { kind: 'workflows-gate' },
                        }),
                    },
                    evidenceContext: { workspace, values: current.context },
                    turn: payload.turn,
                    maxBlocks: definition.settings.maxBlocks,
                    installedLegacy: legacy.installed,
                    enabledLegacy: legacy.enabled,
                    ...(completion === undefined ? {} : { completion }),
                    ...(checkpointIssue === undefined ? {} : { checkpointIssue }),
                    onError: (error) => publishListenerError(workspace, error),
                });
                if (outcome.run !== current)
                    await writeRun(workspace, outcome.run, auth);
                // Keep the session's main-step owner until its step settles; a
                // second run may take over only after that.
                if (outcome.kind !== 'allow') {
                    mainStepOwners.set(sessionId, run.id);
                    break;
                }
                if (owner !== undefined && run.id === owner.id) {
                    mainStepOwners.delete(sessionId);
                }
            }
            await refreshPromptRuns(workspace);
        }
        catch (error) {
            publishListenerError(workspaceFor(services, payload.agent.session), error);
        }
    }));
    const toolHostFor = (agent, workspace, auth, definitions) => ({
        workspace,
        session: String(agent.session.id),
        definitions,
        auth,
        maxRuns,
        ...(userQuestions === undefined ? {} : { questions: userQuestions }),
        now: () => journal.time(),
        evidenceContext: (run, step) => {
            const sessionId = String(agent.session.id);
            const state = run.steps.find((entry) => entry.id === step.id);
            return {
                toolCalls: sessionToolCalls.get(sessionId) ?? [],
                shellResults: sessionShellResults.get(sessionId) ?? [],
                ...(state?.requestedAt === undefined ? {} : { stepStartedAt: state.requestedAt }),
                ...(typeof state?.evidence?.answer === 'string'
                    ? { answers: [{ answer: state.evidence.answer }] }
                    : {}),
            };
        },
        listRuns: async () => {
            await recoverIfNeeded(workspace);
            return listAuthenticatedRuns(workspace, auth);
        },
        readRun: async (runId) => {
            await recoverIfNeeded(workspace);
            return readAuthenticatedRun(workspace, runId, auth);
        },
        startRun: async (definition) => {
            await recoverIfNeeded(workspace);
            const run = await startRunFor(workspace, String(agent.session.id), auth, definition);
            return { run, firstStep: definition.steps[0]?.id ?? 'end' };
        },
        resumeRun: async (runId) => {
            await recoverIfNeeded(workspace);
            const resumed = await resumeRun(workspace, runId, auth, Date.now(), String(agent.session.id));
            await writeRun(workspace, resumed.run, auth);
            void refreshPromptRuns(workspace);
            return { run: resumed.run, stepId: resumed.stepId };
        },
        cancelRun: async (runId) => {
            await recoverIfNeeded(workspace);
            const cancelled = await cancelRun(workspace, runId, auth, Date.now(), String(agent.session.id));
            await writeRun(workspace, cancelled, auth);
            void refreshPromptRuns(workspace);
            return cancelled;
        },
    });
    // The model-facing tool is optional; a host without a tool registry keeps the
    // gates and the recorder.
    const toolsService = optionalService('tools');
    if (toolsService?.register !== undefined) {
        ctx.effect(() => toolsService.register({
            name: 'workflows',
            description: 'List, start, resume, inspect, evidence-check, or cancel a stored workflow run. It never accepts a script or definition, never installs a definition, never starts an adoption, and never writes an approval or receipt.',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'start', 'resume', 'status', 'evidence', 'cancel'],
                        description: 'The bounded action to run.',
                    },
                    definitionId: { type: 'string', description: 'A stored definition id.' },
                    runId: { type: 'string', description: 'A workflow run id.' },
                    stepId: { type: 'string', description: 'A step id of the run.' },
                    evidence: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string' },
                            ref: { type: 'string' },
                        },
                        required: ['kind', 'ref'],
                        additionalProperties: false,
                        description: 'The evidence the host verifier must check; a text claim is refused.',
                    },
                },
                required: ['action'],
                additionalProperties: false,
            },
            output: {
                schema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                },
                render: (_args, value) => [
                    { type: 'text', text: String(value.text ?? '') },
                ],
            },
            execute: async (args, exec) => {
                const agent = exec.agent;
                if (agent === undefined)
                    throw new Error('workflows: the tool needs a live session');
                const workspace = workspaceFor(services, agent.session);
                if (workspace === undefined)
                    throw new Error('workflows: the session workspace is unavailable');
                await ensureAuth();
                const auth = storedAuth;
                if (auth === undefined)
                    throw new Error('workflows: the host key is unavailable');
                const definitions = await definitionsFor(workspace);
                return {
                    text: await executeWorkflowsTool(args, toolHostFor(agent, workspace, auth, definitions)),
                };
            },
        }));
    }
    // The user-started `/workflows` command.
    const commandsService = optionalService('commands');
    if (commandsService?.register !== undefined) {
        ctx.effect(() => commandsService.register({
            definitionId: '@dsh-setup/plugin-workflows/workflows',
            name: 'workflows',
            description: 'Open the Workflows view, run/resume a workflow, install a definition after confirmation, adopt an existing change, or print a bounded status.',
            handler: async (invocation) => {
                try {
                    const workspace = workspaceFor(services, invocation.agent.session);
                    if (workspace === undefined) {
                        return { kind: 'error', text: 'the session workspace is unavailable' };
                    }
                    await ensureAuth();
                    const auth = storedAuth;
                    if (auth === undefined) {
                        return { kind: 'error', text: 'the workflows host key is unavailable' };
                    }
                    const definitions = await definitionsFor(workspace);
                    const sessionId = String(invocation.agent.session.id);
                    // DSH passes the exact text after the command name as rawInput;
                    // arguments/text stay for older callers and tests.
                    const input = typeof invocation.rawInput === 'string'
                        ? invocation.rawInput
                        : typeof invocation.arguments === 'string'
                            ? invocation.arguments
                            : typeof invocation.text === 'string'
                                ? invocation.text
                                : '';
                    // An idle driver starts a turn from steer; request the pending
                    // main step so the turn-close gate can advance the run.
                    const steerPending = async (agent, runId) => {
                        const run = await readAuthenticatedRun(workspace, runId, auth);
                        if (run === undefined)
                            return;
                        const definition = definitions.find((entry) => entry.id === run.definition);
                        if (definition === undefined)
                            return;
                        const step = definition.steps.find((entry) => entry.id === pendingStep(run));
                        if (step === undefined)
                            return;
                        // A deferred step is never steered; only its legacy gate steers.
                        const state = legacySignalState();
                        const resolved = resolveOwnership(definition, state.installed, state.enabled).steps.find((entry) => entry.id === step.id);
                        if (resolved?.ownership !== 'own')
                            return;
                        // An explicit user run or resume gets a fresh bounded budget.
                        const budgeted = {
                            ...run,
                            steps: run.steps.map((entry) => entry.id === step.id ? { ...entry, attempts: 0 } : entry),
                        };
                        const steered = requestMainStep({
                            run: budgeted,
                            definition,
                            step,
                            agent: {
                                steer: (text) => agent.steer({
                                    id: randomUUID(),
                                    role: 'user',
                                    content: [{ type: 'text', text }],
                                    source: { kind: 'workflows-gate' },
                                }),
                            },
                            evidenceContext: { workspace, values: run.context },
                            turn: turns.get(String(agent.session.id)) ?? 0,
                            maxAttempts: definition.settings.maxBlocks,
                            now: journal.time(),
                        });
                        if (!steered.steered) {
                            throw new Error(`the pending step "${step.id}" could not be steered: ${steered.reason}`);
                        }
                        await writeRun(workspace, steered.run, auth);
                    };
                    const host = {
                        workspace,
                        session: sessionId,
                        ...(userQuestions === undefined ? {} : { questions: userQuestions }),
                        openView: () => 'The Workflows tab is the entry point; a Host command result cannot open a client view.',
                        run: async (definitionId) => {
                            await recoverIfNeeded(workspace);
                            const definition = definitions.find((entry) => entry.id === definitionId);
                            if (definition === undefined)
                                throw new Error(`no definition "${definitionId}"`);
                            const run = await startRunFor(workspace, sessionId, auth, definition);
                            await steerPending(invocation.agent, run.id);
                            return { runId: run.id, firstStep: definition.steps[0]?.id ?? 'end' };
                        },
                        resume: async (runId) => {
                            await recoverIfNeeded(workspace);
                            const resumed = await resumeRun(workspace, runId, auth, Date.now(), sessionId);
                            await writeRun(workspace, resumed.run, auth);
                            void refreshPromptRuns(workspace);
                            await steerPending(invocation.agent, runId);
                            return { stepId: resumed.stepId };
                        },
                        install: async (path) => {
                            const installed = await installDefinition(workspace, path, auth);
                            // The next command must see the definition without a restart.
                            definitionLoads.delete(workspace);
                            definitionsByWorkspace.delete(workspace);
                            return { id: installed.definition.id };
                        },
                        adopt: async (name) => {
                            const adopted = await adoptChange({
                                workspace,
                                change: name,
                                auth,
                                userStarted: true,
                                ...(userQuestions === undefined ? {} : { questions: userQuestions }),
                                now: journal.time(),
                            });
                            return adopted.ok ? { ok: true } : { ok: false, reason: adopted.reason };
                        },
                        status: async () => {
                            await recoverIfNeeded(workspace);
                            const runs = await listAuthenticatedRuns(workspace, auth);
                            const open = runs.filter((run) => run.status === 'running' || run.status === 'blocked');
                            return `definitions: ${String(definitions.length)}; open runs: ${String(open.length)}; receipts: ${String((await listReceipts(workspace, auth)).length)}`;
                        },
                    };
                    const result = await runWorkflowCommand(input, host);
                    return { kind: result.kind === 'error' ? 'error' : 'success', text: result.text };
                }
                catch (error) {
                    return { kind: 'error', text: boundedError(error) };
                }
            },
        }));
    }
    // The bounded active-run system-prompt context.
    registerActiveRunsContext(ctx, activePromptRuns);
    // The read-only API is optional at runtime but present on the Web host that
    // also carries the Client view; a host without Fetch keeps recording only.
    registerWorkflowRoutes(ctx, {
        agents: services.agents,
        workingDirectory: services.workingDirectory,
        journal,
        healthFor,
        lastEventAtFor: (session) => sessionEventAt.get(session),
        triggers,
        definitionsFor: (workspace) => definitionsByWorkspace.get(workspace) ?? [],
        receiptsFor: async (workspace) => {
            const auth = storedAuth;
            return auth === undefined ? [] : listReceipts(workspace, auth);
        },
    });
}
