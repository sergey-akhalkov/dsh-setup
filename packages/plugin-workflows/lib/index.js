import { Journal, MAX_RECORD_BYTES, toolResultText } from './journal.js';
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
    const services = hostServices(ctx);
    if (services === undefined) {
        console.error('workflows: required Host services are unavailable; the recorder is inert');
        return;
    }
    const journal = new Journal();
    /** Latest turn per session, so a tool result belongs to a turn. */
    const turns = new Map();
    const record = (workspace, input) => {
        const { record: bounded } = journal.record(input);
        void journal.append(workspace, bounded).then((result) => {
            if (!result.ok) {
                console.error(`workflows: the session journal could not be written (${result.error})`);
            }
        });
    };
    ctx.on('agent/pre-step', (payload, next) => {
        try {
            const session = payload.agent.session;
            const workspace = workspaceFor(services, session);
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
                });
            }
        }
        catch {
            // An observer never fails a step.
        }
        return next();
    });
    ctx.on('agent/turn-stopping', (payload) => {
        try {
            const session = payload.agent.session;
            const workspace = workspaceFor(services, session);
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
            });
        }
        catch {
            // An observer never fails a turn.
        }
    });
    ctx.on('tools/result', (exec, result) => {
        try {
            const agent = exec.agent;
            if (agent === undefined)
                return;
            const session = agent.session;
            const workspace = workspaceFor(services, session);
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
            });
        }
        catch {
            // Observability never breaks tool dispatch.
        }
    });
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
        bindings.push(agent.ctx.on('subagent/start', (info) => {
            try {
                recordSubagent(agent, 'subagent/start', info);
            }
            catch {
                // An observer never fails a worker start.
            }
        }), agent.ctx.on('subagent/end', (info) => {
            try {
                recordSubagent(agent, 'subagent/end', info);
            }
            catch {
                // An observer never fails a worker settlement.
            }
        }));
    };
    ctx.on('agent/created', ({ agent }) => {
        try {
            bindLifecycle(agent);
        }
        catch {
            // A listener that cannot bind leaves the rest of the host working.
        }
        return undefined;
    });
    // A reload or late mount keeps observing agents that are already live.
    try {
        for (const agent of services.agents.list())
            bindLifecycle(agent);
    }
    catch {
        // An unreadable registry leaves the recorder inert for existing agents.
    }
}
