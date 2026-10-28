import { randomUUID } from 'node:crypto';
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-goal-continuity';
/** Services the supervisor needs. */
export const inject = ['agents', 'goals'];
/** Documented defaults; the composition fragment repeats them for the generated patch. */
export const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    resumeAfterRestart: false,
    resumeAfterUserStop: 'non-goal',
    maxSessionResumes: 20,
    roundExtension: 1000,
    maxRoundExtensions: 2,
    hardMaxGoalRounds: 5000,
});
/** Bound for one notice summary, matching the harness context-summary bound. */
const CONTEXT_SUMMARY_MAX_CHARS = 120;
/** Bound for the model-facing notice text. */
const NOTICE_TEXT_MAX_CHARS = 600;
/** Bound for one durable block reason. */
const BLOCK_MESSAGE_MAX_CHARS = 400;
/** Integer fields and their accepted inclusive range. */
const INTEGER_RANGES = {
    maxSessionResumes: [0, 1000],
    roundExtension: [1, 1_000_000],
    maxRoundExtensions: [0, 100],
    hardMaxGoalRounds: [1, 1_000_000],
};
/** Render one field diagnostic that names the field and its accepted range. */
function fieldError(field, requirement) {
    return new Error(`goal-continuity: \`${field}\` ${requirement}`);
}
/**
 * Validate the row configuration fail-loud and apply the documented defaults.
 * @param raw - the loader-supplied config object, or undefined when the row has none.
 * @returns an immutable complete configuration.
 * @throws when a field is unknown, mistyped, or outside its allowed range.
 */
export function resolveConfig(raw) {
    const input = raw === undefined ? {} : raw;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('goal-continuity: config must be an object');
    }
    const record = input;
    for (const key of Object.keys(record)) {
        if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
            throw new Error(`goal-continuity: unknown config field "${key}"`);
        }
    }
    const boolean = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CONFIG[field];
        if (typeof value !== 'boolean')
            throw fieldError(field, 'must be a boolean');
        return value;
    };
    const integer = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CONFIG[field];
        const [min, max] = INTEGER_RANGES[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
            throw fieldError(field, `must be an integer between ${min} and ${max}`);
        }
        return value;
    };
    const rawResumeAfterUserStop = record.resumeAfterUserStop;
    const resumeAfterUserStop = rawResumeAfterUserStop === undefined
        ? DEFAULT_CONFIG.resumeAfterUserStop
        : rawResumeAfterUserStop;
    if (resumeAfterUserStop !== 'non-goal' && resumeAfterUserStop !== 'never') {
        throw fieldError('resumeAfterUserStop', 'must be "non-goal" or "never"');
    }
    return Object.freeze({
        enabled: boolean('enabled'),
        resumeAfterRestart: boolean('resumeAfterRestart'),
        resumeAfterUserStop,
        maxSessionResumes: integer('maxSessionResumes'),
        roundExtension: integer('roundExtension'),
        maxRoundExtensions: integer('maxRoundExtensions'),
        hardMaxGoalRounds: integer('hardMaxGoalRounds'),
    });
}
/** Only a root session is supervised; forks and subagents are left untouched. */
function isRootAgent(agent) {
    const header = agent.session.header;
    return (header.origin !== 'subagent' &&
        (header.delegationDepth ?? 0) === 0 &&
        header.parentSession === undefined);
}
/** Classify one hook cancellation by its machine-readable reason prefix. */
function hookCause(reason) {
    if (reason.kind !== 'aborted' || reason.reason.kind !== 'hook')
        return undefined;
    if (reason.reason.reason.startsWith('loop-guard:reset:'))
        return 'reset';
    if (reason.reason.reason.startsWith('loop-guard:final:'))
        return 'final';
    return 'unknown';
}
/** Whether a cause is a specific signal that outranks a generic disarm. */
function isSpecificCause(cause) {
    return cause !== 'in-process-disarm' && cause !== 'restart';
}
/** Human-readable cause used by notices and block reasons. */
function causeLabel(cause) {
    switch (cause) {
        case 'reset':
            return 'a recoverable loop-guard reset';
        case 'non-goal-stop':
            return 'your Stop on a turn that was not a goal round';
        case 'restart':
            return 'a session restart';
        case 'in-process-disarm':
            return 'an in-process disarm';
        case 'goal-round-stop':
            return 'your Stop during a goal round';
        case 'user-stop-never':
            return 'your Stop on a turn that was not a goal round';
        case 'user-pause':
            return 'your pause';
        case 'user-clear':
            return 'your clear';
        case 'user-complete':
            return 'completion';
        case 'model-reported':
            return 'a model-reported blocker';
        case 'final-hook':
            return 'the loop-guard final stop';
        case 'unknown-hook':
            return 'an unrecognized hook cancellation';
        case 'max-tokens':
            return 'the token limit';
        case 'agent-error':
            return 'an agent error';
        case 'parent-stop':
            return 'a parent cancellation';
        case 'round-limit':
            return 'the round limit';
    }
}
/** Bound one string without splitting a multi-byte code point. */
function bound(text, max) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}
/** Exact current ref for one goal view. */
function goalRef(goal) {
    return { id: goal.id, revision: goal.revision };
}
/** Whether a rejected mutation is a compare-and-set stale reference. */
function isStale(error) {
    return (typeof error === 'object' &&
        error !== null &&
        error.code === 'GOAL_STALE_REVISION');
}
/** Build one frozen, bounded, non-waking notice. */
function createNotice(text, summary) {
    return Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: Object.freeze([{ type: 'text', text: bound(text, NOTICE_TEXT_MAX_CHARS) }]),
        source: Object.freeze({
            kind: 'goal-continuity',
            form: 'notice',
            summary: bound(summary, CONTEXT_SUMMARY_MAX_CHARS),
        }),
    });
}
/**
 * Install the supervisor. The configuration is validated at load, so a bad
 * profile fails loudly; supervision itself fails open.
 */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    if (!resolved.enabled)
        return;
    const mountedAt = Date.now();
    const states = new WeakMap();
    function stateFor(agent) {
        let state = states.get(agent);
        if (state === undefined) {
            state = {
                turn: null,
                goalRound: false,
                resumes: 0,
                extensions: new Map(),
                suppression: null,
                restartPending: false,
                observed: false,
                pending: false,
                cause: null,
                refusal: null,
            };
            states.set(agent, state);
        }
        return state;
    }
    /** Read the current goal without letting a goal-domain failure reach the session. */
    function readGoal(agent) {
        try {
            return ctx.goals.get(agent);
        }
        catch {
            return undefined;
        }
    }
    /** Deliver one non-waking notice; a disposed agent fails open. */
    function deliverNotice(agent, text, summary) {
        try {
            agent.inject(createNotice(text, summary));
        }
        catch {
            // A disposed agent simply receives no notice.
        }
    }
    /** Queue one reconciliation after the current dispatch settles. */
    function schedule(agent, state, cause) {
        if (cause !== undefined && (isSpecificCause(cause) || state.cause === null)) {
            state.cause = cause;
        }
        if (state.pending)
            return;
        state.pending = true;
        queueMicrotask(() => {
            state.pending = false;
            if (states.get(agent) !== state)
                return;
            const next = state.cause;
            state.cause = null;
            try {
                reconcile(agent, state, next);
            }
            catch {
                // Fail open: supervision must never fail a session.
            }
        });
    }
    /** Disarm an armed active goal before the driver's idle pause can see it. */
    function preventPause(agent) {
        const goal = readGoal(agent);
        if (goal === undefined || goal.phase !== 'active' || goal.activation !== 'armed')
            return;
        try {
            ctx.goals.disarm(agent);
        }
        catch {
            // Fail open: a rejected disarm leaves the driver's pause in place.
        }
    }
    /** Resume once, retrying once on a stale revision. */
    function resumeWithRetry(agent, goal) {
        try {
            return ctx.goals.resume(agent, goalRef(goal));
        }
        catch (error) {
            if (!isStale(error))
                return undefined;
            const current = readGoal(agent);
            if (current === undefined)
                return undefined;
            if (current.phase === 'active') {
                if (current.activation !== 'disarmed')
                    return undefined;
            }
            else if (current.phase !== 'blocked' || current.blockedReason?.code !== 'round-limit') {
                return undefined;
            }
            if (current.roundsStarted >= current.maxGoalRounds)
                return undefined;
            try {
                return ctx.goals.resume(agent, goalRef(current));
            }
            catch {
                return undefined;
            }
        }
    }
    /** Resume and deliver exactly one notice, or report why no resume happened. */
    function resumeAndNotify(agent, state, goal, cause, extension) {
        if (state.resumes >= resolved.maxSessionResumes)
            return 'exhausted';
        const resumed = resumeWithRetry(agent, goal);
        if (resumed === undefined)
            return 'failed';
        state.resumes += 1;
        const remaining = resolved.maxSessionResumes - state.resumes;
        const action = extension === undefined
            ? `resumed the goal after ${causeLabel(cause)}`
            : `extended the round cap from ${extension.from} to ${extension.to} (extension ${extension.used} of ${resolved.maxRoundExtensions}) and resumed the goal after ${causeLabel(cause)}`;
        deliverNotice(agent, `Goal continuity ${action}. Automatic resume ${state.resumes} of ${resolved.maxSessionResumes} for this session; ${remaining} remain. Next: continue the current objective.`, `goal-continuity: ${extension === undefined ? 'resumed' : 'extended and resumed'} after ${causeLabel(cause)}`);
        return 'resumed';
    }
    /** Edit the round cap, retrying once on a stale revision. */
    function editCap(agent, goal, expected) {
        const attempt = (current) => {
            if (current.roundsStarted < current.maxGoalRounds)
                return { kind: 'resumable', goal: current };
            const cap = current.maxGoalRounds + resolved.roundExtension;
            if (cap > resolved.hardMaxGoalRounds)
                return { kind: 'unavailable' };
            try {
                return {
                    kind: 'edited',
                    goal: ctx.goals.edit(agent, goalRef(current), { maxGoalRounds: cap }),
                };
            }
            catch {
                return { kind: 'failed' };
            }
        };
        if (goal.roundsStarted < goal.maxGoalRounds)
            return { kind: 'resumable', goal };
        const cap = goal.maxGoalRounds + resolved.roundExtension;
        if (cap > resolved.hardMaxGoalRounds)
            return { kind: 'unavailable' };
        try {
            return { kind: 'edited', goal: ctx.goals.edit(agent, goalRef(goal), { maxGoalRounds: cap }) };
        }
        catch (error) {
            if (!isStale(error))
                return { kind: 'failed' };
            const current = readGoal(agent);
            if (current === undefined)
                return { kind: 'failed' };
            if (expected === 'active') {
                if (current.phase !== 'active' || current.activation !== 'disarmed') {
                    return { kind: 'failed' };
                }
            }
            else if (current.phase !== 'blocked' || current.blockedReason?.code !== 'round-limit') {
                return { kind: 'failed' };
            }
            return attempt(current);
        }
    }
    /** Explain a resume that failed after an automatic cap decision. */
    function notifyResumeFailure(agent, goal, from) {
        const action = from === undefined
            ? 'could not resume the goal automatically'
            : `extended the round cap from ${from} to ${goal.maxGoalRounds} but could not resume the goal automatically`;
        deliverNotice(agent, `Goal continuity ${action}. Next: review the goal and resume with /goal resume.`, 'goal-continuity: resume failed');
    }
    /** Record a terminal refusal: block an active goal where allowed, keep a native block. */
    function terminate(agent, state, goal, cause, detail, nextAction) {
        const refusal = `${goal.id}:${goal.revision}`;
        if (goal.phase === 'blocked' && state.refusal === refusal)
            return;
        const remaining = resolved.maxSessionResumes - state.resumes;
        const budget = `Automatic resumes used ${state.resumes} of ${resolved.maxSessionResumes} for this session (${remaining} remain).`;
        const message = bound(`Goal continuity stopped automatic continuation after ${causeLabel(cause)}: ${detail}. ${budget} Next: ${nextAction}.`, BLOCK_MESSAGE_MAX_CHARS);
        if (goal.phase === 'active') {
            try {
                ctx.goals.block(agent, goalRef(goal), { code: 'continuity-stopped', message });
            }
            catch (error) {
                if (!isStale(error))
                    return;
                const current = readGoal(agent);
                if (current === undefined || current.phase !== 'active')
                    return;
                try {
                    ctx.goals.block(agent, goalRef(current), { code: 'continuity-stopped', message });
                }
                catch {
                    return;
                }
            }
        }
        else if (goal.phase !== 'blocked') {
            // A user pause or completion is preserved and is not explained by a notice.
            return;
        }
        if (goal.phase === 'blocked')
            state.refusal = refusal;
        deliverNotice(agent, message, `goal-continuity: stopped after ${causeLabel(cause)}`);
    }
    /** Refuse an automatic resume whose session budget is spent. */
    function stopForBudget(agent, state, goal, cause) {
        terminate(agent, state, goal, cause, 'the automatic resume budget is exhausted', 'resume manually with /goal resume after fixing the blocker, or pause with /goal pause');
    }
    /** Extend until the cap covers the admitted rounds, or stop visibly. */
    function extendToCapacity(agent, state, goal, expected, cause) {
        const from = goal.maxGoalRounds;
        let current = goal;
        let used = state.extensions.get(goal.id) ?? 0;
        let extended = 0;
        while (current.roundsStarted >= current.maxGoalRounds) {
            if (used >= resolved.maxRoundExtensions) {
                terminate(agent, state, current, cause, `the round cap (${current.maxGoalRounds}) still does not cover the ${current.roundsStarted} rounds already started after ${used} of ${resolved.maxRoundExtensions} extensions`, 'raise the goal round cap with the goal tool, then resume with /goal resume');
                return undefined;
            }
            const cap = editCap(agent, current, expected);
            if (cap.kind === 'failed') {
                if (extended > 0) {
                    terminate(agent, state, current, cause, `the round cap was extended from ${from} to ${current.maxGoalRounds} but a further extension failed`, 'review the goal and resume with /goal resume');
                }
                else {
                    notifyResumeFailure(agent, current);
                }
                return undefined;
            }
            if (cap.kind === 'unavailable') {
                terminate(agent, state, current, cause, `the round cap (${current.maxGoalRounds}) is exhausted and the hard cap (${resolved.hardMaxGoalRounds}) leaves no extension room`, 'raise the goal round cap with the goal tool, then resume with /goal resume');
                return undefined;
            }
            if (cap.kind === 'resumable') {
                current = cap.goal;
                break;
            }
            used += 1;
            extended += 1;
            state.extensions.set(goal.id, used);
            current = cap.goal;
        }
        return { goal: current, from, used, extended };
    }
    /** Extend the cap of an active goal at its limit, then resume, or refuse visibly. */
    function continueAtCap(agent, state, goal, cause) {
        if (state.resumes >= resolved.maxSessionResumes) {
            stopForBudget(agent, state, goal, cause);
            return;
        }
        if (goal.roundsStarted < goal.maxGoalRounds) {
            const result = resumeAndNotify(agent, state, goal, cause);
            if (result === 'exhausted')
                stopForBudget(agent, state, goal, cause);
            else if (result === 'failed')
                notifyResumeFailure(agent, goal);
            return;
        }
        const outcome = extendToCapacity(agent, state, goal, 'active', cause);
        if (outcome === undefined)
            return;
        const result = resumeAndNotify(agent, state, outcome.goal, cause, outcome.extended > 0
            ? { from: outcome.from, to: outcome.goal.maxGoalRounds, used: outcome.used }
            : undefined);
        if (result === 'exhausted')
            stopForBudget(agent, state, outcome.goal, cause);
        else if (result === 'failed') {
            if (outcome.extended > 0) {
                terminate(agent, state, outcome.goal, cause, `the round cap was extended from ${outcome.from} to ${outcome.goal.maxGoalRounds} but the goal could not be resumed automatically`, 'review the goal and resume with /goal resume');
            }
            else {
                notifyResumeFailure(agent, outcome.goal);
            }
        }
    }
    /** Extend a goal blocked at the round limit, or keep the native block and explain. */
    function extendBlocked(agent, state, goal) {
        if (state.suppression !== null) {
            if (state.suppression.terminal) {
                terminate(agent, state, goal, state.suppression.cause, state.suppression.detail, 'resume manually with /goal resume after fixing the blocker');
            }
            return;
        }
        if (goal.roundsStarted < goal.maxGoalRounds) {
            // A previous extension is already in place; resume without extending again.
            const result = resumeAndNotify(agent, state, goal, 'round-limit');
            if (result === 'exhausted')
                stopForBudget(agent, state, goal, 'round-limit');
            else if (result === 'failed')
                notifyResumeFailure(agent, goal);
            return;
        }
        if (state.resumes >= resolved.maxSessionResumes) {
            stopForBudget(agent, state, goal, 'round-limit');
            return;
        }
        const outcome = extendToCapacity(agent, state, goal, 'blocked', 'round-limit');
        if (outcome === undefined)
            return;
        const result = resumeAndNotify(agent, state, outcome.goal, 'round-limit', outcome.extended > 0
            ? { from: outcome.from, to: outcome.goal.maxGoalRounds, used: outcome.used }
            : undefined);
        if (result === 'exhausted')
            stopForBudget(agent, state, outcome.goal, 'round-limit');
        else if (result === 'failed') {
            if (outcome.extended > 0) {
                terminate(agent, state, outcome.goal, 'round-limit', `the round cap was extended from ${outcome.from} to ${outcome.goal.maxGoalRounds} but the goal could not be resumed automatically`, 'review the goal and resume with /goal resume');
            }
            else {
                notifyResumeFailure(agent, outcome.goal);
            }
        }
    }
    /** One deferred decision for one settled agent. */
    function reconcile(agent, state, cause) {
        if (!isRootAgent(agent))
            return;
        const restart = state.restartPending;
        state.restartPending = false;
        const goal = readGoal(agent);
        if (goal === undefined)
            return;
        if (goal.phase === 'blocked') {
            if (goal.blockedReason?.code === 'round-limit')
                extendBlocked(agent, state, goal);
            return;
        }
        if (goal.phase !== 'active')
            return;
        if (state.suppression?.terminal === true) {
            terminate(agent, state, goal, state.suppression.cause, state.suppression.detail, 'resume manually with /goal resume after fixing the blocker, or pause with /goal pause');
            return;
        }
        if (goal.activation !== 'disarmed')
            return;
        if (restart && !resolved.resumeAfterRestart)
            return;
        if (state.suppression !== null)
            return;
        const named = cause ?? 'in-process-disarm';
        if (state.resumes >= resolved.maxSessionResumes) {
            stopForBudget(agent, state, goal, named);
            return;
        }
        if (goal.roundsStarted >= goal.maxGoalRounds) {
            continueAtCap(agent, state, goal, named);
            return;
        }
        resumeAndNotify(agent, state, goal, named);
    }
    /** Track a root agent's first observation and defer its restart decision. */
    function observeAgent(agent) {
        if (!isRootAgent(agent))
            return;
        const state = stateFor(agent);
        const createdAt = agent.session.header.createdAt;
        state.restartPending = Number.isSafeInteger(createdAt) ? createdAt < mountedAt : !state.observed;
        state.observed = true;
        schedule(agent, state, 'restart');
    }
    function handleTurnEnd(agent, state, reason) {
        const goalRound = state.goalRound;
        state.goalRound = false;
        const hook = hookCause(reason);
        if (hook !== undefined) {
            const cause = hook === 'reset' ? 'reset' : hook === 'final' ? 'final-hook' : 'unknown-hook';
            if (hook !== 'reset') {
                state.suppression = {
                    cause,
                    terminal: true,
                    detail: hook === 'final' ? 'the loop guard final stop' : 'an unrecognized hook cancellation',
                };
            }
            if (goalRound)
                preventPause(agent);
            schedule(agent, state, cause);
            return;
        }
        if (reason.kind === 'aborted') {
            if (reason.reason.kind === 'user') {
                if (goalRound) {
                    state.suppression = {
                        cause: 'goal-round-stop',
                        terminal: false,
                        detail: 'your Stop during a goal round',
                    };
                    schedule(agent, state, 'goal-round-stop');
                }
                else if (resolved.resumeAfterUserStop === 'never') {
                    state.suppression = {
                        cause: 'user-stop-never',
                        terminal: false,
                        detail: 'your Stop on a turn that was not a goal round',
                    };
                    const goal = readGoal(agent);
                    if (goal !== undefined && goal.phase === 'active') {
                        deliverNotice(agent, 'Goal continuity suppressed automatic continuation after your Stop on a turn that was not a goal round. Next: send a message to clear the suppression, or pause the goal with /goal pause to stop it explicitly.', 'goal-continuity: suppressed after user Stop');
                    }
                    schedule(agent, state, 'user-stop-never');
                }
                else {
                    schedule(agent, state, 'non-goal-stop');
                }
                return;
            }
            state.suppression = {
                cause: 'parent-stop',
                terminal: false,
                detail: 'the turn was cancelled by its parent',
            };
            return;
        }
        if (reason.kind === 'completed') {
            schedule(agent, state);
            return;
        }
        if (reason.kind === 'max-tokens') {
            state.suppression = {
                cause: 'max-tokens',
                terminal: true,
                detail: 'the turn reached the token limit',
            };
            schedule(agent, state, 'max-tokens');
            return;
        }
        if (reason.kind === 'error') {
            state.suppression = {
                cause: 'agent-error',
                terminal: true,
                detail: 'the turn failed with an error',
            };
            schedule(agent, state, 'agent-error');
        }
    }
    function handleSessionEvent(session, event) {
        const agent = ctx.agents.get(session.id);
        if (agent === undefined || agent.session !== session || !isRootAgent(agent))
            return;
        const state = states.get(agent);
        if (state === undefined)
            return;
        switch (event.type) {
            case 'turn/start':
                state.turn = event.data.turn;
                state.goalRound = false;
                return;
            case 'user/message':
                if (event.data.source.kind === 'goal')
                    state.goalRound = true;
                else if (event.data.source.kind === 'user') {
                    state.suppression = null;
                    state.cause = null;
                }
                return;
            case 'turn/end':
                handleTurnEnd(agent, state, event.data.reason);
                return;
            default:
                return;
        }
    }
    for (const agent of ctx.agents.list())
        observeAgent(agent);
    ctx.on('session/event', (session, event) => {
        try {
            handleSessionEvent(session, event);
        }
        catch {
            // Fail open: supervision must never fail a session.
        }
    });
    ctx.on('goal/activation-changed', (payload) => {
        try {
            if (payload.goal === undefined || payload.goal.activation !== 'disarmed')
                return;
            const agent = ctx.agents.get(payload.sessionId);
            if (agent === undefined || agent.session.id !== payload.sessionId || !isRootAgent(agent)) {
                return;
            }
            const state = states.get(agent);
            if (state !== undefined)
                schedule(agent, state, 'in-process-disarm');
        }
        catch {
            // Fail open.
        }
    });
    ctx.on('goal/changed', ({ agent, change }) => {
        try {
            if (!isRootAgent(agent))
                return;
            const state = states.get(agent);
            if (state === undefined)
                return;
            if (change.operation === 'pause') {
                state.suppression = { cause: 'user-pause', terminal: false, detail: 'the goal is paused' };
                return;
            }
            if (change.operation === 'complete') {
                state.suppression = {
                    cause: 'user-complete',
                    terminal: false,
                    detail: 'the goal is complete',
                };
                return;
            }
            if (change.operation === 'clear') {
                state.suppression = { cause: 'user-clear', terminal: false, detail: 'the goal was cleared' };
                state.extensions.clear();
                return;
            }
            if (change.operation === 'block') {
                if (change.goal?.blockedReason?.code === 'round-limit') {
                    schedule(agent, state, 'round-limit');
                }
                else if (change.goal?.blockedReason?.code === 'model-reported') {
                    state.suppression = {
                        cause: 'model-reported',
                        terminal: false,
                        detail: 'the model reported a blocker',
                    };
                }
            }
        }
        catch {
            // Fail open.
        }
    });
    ctx.on('agent/error', ({ agent }) => {
        try {
            if (!isRootAgent(agent))
                return;
            const state = states.get(agent);
            if (state === undefined)
                return;
            state.suppression = {
                cause: 'agent-error',
                terminal: true,
                detail: 'an agent error stopped the session',
            };
            schedule(agent, state, 'agent-error');
        }
        catch {
            // Fail open.
        }
    });
    ctx.on('agent/created', ({ agent }) => {
        observeAgent(agent);
        return undefined;
    });
    ctx.on('agent/disposed', ({ agent }) => {
        states.delete(agent);
    });
}
