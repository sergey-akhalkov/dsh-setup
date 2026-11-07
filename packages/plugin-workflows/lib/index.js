import { registerWorkflowRoutes } from './api.js';
import { evaluateEvent } from './evaluate.js';
import { startFsChangeWatcher } from './fs-change.js';
import { WorkflowHealth } from './health.js';
import { Journal, MAX_RECORD_BYTES, toolResultText, workflowsDirectory, } from './journal.js';
import { loadCatalog } from './triggers.js';
/** Workflows: a read-only Host recorder and the Workflows conversation view. */
export const name = '@dsh-setup/plugin-workflows';
/**
 * Host services the recorder needs. A host without them stays inert instead of
 * registering half a surface; the Client half independently checks its own.
 */
export const inject = ['agents', 'workingDirectory', 'fs', 'connection'];
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
/**
 * Register the recorder. Every listener is observe-only: it never calls
 * `agent.steer`, `agent.inject`, or a tool, and a thrown observation is
 * contained so the turn is unaffected.
 */
export function apply(ctx) {
    // A malformed shipped trigger refuses the plugin load, naming the field.
    const triggers = loadCatalog();
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
    /** Begin health for a session workspace as soon as the session is known. */
    const observeSession = (session) => {
        try {
            const workspace = workspaceFor(services, session);
            if (workspace !== undefined) {
                activeSession.set(workspace, String(session.id));
                healthFor(workspace);
                watchChanges(workspace);
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
    const record = (workspace, input, event) => {
        const health = healthFor(workspace);
        activeSession.set(workspace, input.session);
        const sessionSeen = seen.get(input.session) ?? new Map();
        seen.set(input.session, sessionSeen);
        const records = evaluateEvent(triggers, event, sessionSeen, true, input.at);
        const { record: bounded } = journal.record({
            ...input,
            ...(records.length === 0 ? {} : { triggers: records }),
        });
        // The event was observed even if its record cannot be written.
        health.markEvent(bounded.at);
        void journal.append(workspace, bounded).then((result) => {
            if (result.ok)
                return;
            health.setJournalWritable(false);
            health.recordError(result.error);
            console.error(`workflows: the session journal could not be written (${result.error})`);
        });
        watchChanges(workspace);
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
    listen(() => ctx.on('agent/pre-step', (payload, next) => {
        let workspace;
        try {
            const session = payload.agent.session;
            workspace = workspaceFor(services, session);
            if (workspace !== undefined) {
                turns.set(String(session.id), payload.turn);
                const origin = session.header.origin === 'subagent' ? 'subagent' : 'root';
                const summary = `step ${String(payload.step)}`;
                record(workspace, {
                    at: journal.time(),
                    session: String(session.id),
                    turn: payload.turn,
                    kind: 'agent/pre-step',
                    subject: origin,
                    summary,
                    bytes: Buffer.byteLength(summary, 'utf8'),
                    truncated: false,
                }, { kind: 'agent.turn-start', subject: origin });
            }
        }
        catch (error) {
            // An observer never fails a step, but its failure stays visible.
            publishListenerError(workspace, error);
        }
        return next();
    }));
    listen(() => ctx.on('agent/turn-stopping', (payload) => {
        let workspace;
        try {
            const session = payload.agent.session;
            workspace = workspaceFor(services, session);
            if (workspace === undefined)
                return;
            turns.set(String(session.id), payload.turn);
            const summary = `turn ${String(payload.turn)} stop attempt`;
            record(workspace, {
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
            const text = toolResultText(result);
            const summary = toolSummary(exec.name, result.isError, text);
            const bytes = Buffer.byteLength(text, 'utf8');
            record(workspace, {
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
            }, { kind: 'tool.result', subject: exec.name, tool: exec.name });
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
        record(workspace, {
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
        });
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
    // The read-only API is optional at runtime but present on the Web host that
    // also carries the Client view; a host without Fetch keeps recording only.
    registerWorkflowRoutes(ctx, {
        agents: services.agents,
        workingDirectory: services.workingDirectory,
        journal,
        healthFor,
        triggers,
    });
}
