import { randomUUID } from 'node:crypto';
/**
 * Loop guard: cuts repeated streamed text, steers a recovery notice into the
 * next step, then escalates to a bounded turn reset and a final stop.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-loop-guard';
/** Agents are the only service read directly; events are dispatched to the fiber. */
export const inject = ['agents'];
/** Documented defaults; the composition fragment repeats them for the generated patch. */
export const DEFAULT_CONFIG = Object.freeze({
    reasoning: true,
    text: false,
    subagents: false,
    minRepeats: 5,
    minLineChars: 12,
    crossBlockWindow: 10,
    crossBlockRepeats: 4,
    maxInterventionsPerTurn: 3,
    maxResetsPerSession: 2,
    previewChars: 80,
    finalFallback: 'stop',
});
/** Render one field diagnostic that names the field and its accepted range. */
function fieldError(field, requirement) {
    return new Error(`loop-guard: \`${field}\` ${requirement}`);
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
        throw new Error('loop-guard: config must be an object');
    }
    const record = input;
    for (const key of Object.keys(record)) {
        if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
            throw new Error(`loop-guard: unknown config field "${key}"`);
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
    const integer = (field, min, max) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CONFIG[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
            throw fieldError(field, `must be an integer between ${min} and ${max}`);
        }
        return value;
    };
    const reasoning = boolean('reasoning');
    const text = boolean('text');
    if (!reasoning && !text) {
        throw fieldError('reasoning', 'and `text` cannot both be false');
    }
    const minRepeats = integer('minRepeats', 2, 100);
    const minLineChars = integer('minLineChars', 1, 1000);
    const crossBlockWindow = integer('crossBlockWindow', 1, 100);
    const crossBlockRepeats = integer('crossBlockRepeats', 1, crossBlockWindow);
    if (crossBlockRepeats > crossBlockWindow) {
        throw fieldError('crossBlockRepeats', `must be at most the resolved crossBlockWindow (${crossBlockWindow}); the default ${DEFAULT_CONFIG.crossBlockRepeats} does not fit that window`);
    }
    const maxInterventionsPerTurn = integer('maxInterventionsPerTurn', 1, 100);
    const maxResetsPerSession = integer('maxResetsPerSession', 0, 100);
    const previewChars = integer('previewChars', 1, 1000);
    const rawFallback = record.finalFallback;
    const finalFallback = rawFallback === undefined ? DEFAULT_CONFIG.finalFallback : rawFallback;
    if (finalFallback !== 'stop') {
        throw fieldError('finalFallback', 'must be "stop"');
    }
    return Object.freeze({
        reasoning,
        text,
        subagents: boolean('subagents'),
        minRepeats,
        minLineChars,
        crossBlockWindow,
        crossBlockRepeats,
        maxInterventionsPerTurn,
        maxResetsPerSession,
        previewChars,
        finalFallback,
    });
}
/** Bounded line buffer: a pathological single line cannot grow the guard's memory. */
// shortcut: only the first 4096 characters of a line are compared; raise it if a real loop hides past that prefix.
const MAX_LINE_CHARS = 4096;
/** 64-bit line identity for the cross-block ring; reasoning text itself is not retained. */
function hashLine(line) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < line.length; index += 1) {
        const code = line.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193);
        right = Math.imul(right ^ code, 0x85ebca6b);
    }
    return (BigInt(left >>> 0) << 32n) | BigInt(right >>> 0);
}
/**
 * Streaming repetition detector. Per-request state counts normalized lines
 * inside one model request; per-turn state keeps a ring of reasoning-block
 * line-hash sets and resets with the turn.
 */
export class LoopDetector {
    #config;
    #lineCounts = new Map();
    #blocks = new Map();
    #recent = [];
    #active = false;
    constructor(config) {
        this.#config = config;
    }
    /** Start one model request: request counts and the open block set reset; the cross-block ring survives. */
    beginRequest() {
        this.#lineCounts.clear();
        this.#blocks.clear();
        this.#active = true;
    }
    /** Start a new turn: request state and the recent-block ring start empty. */
    resetTurn() {
        this.beginRequest();
        this.#recent = [];
    }
    /** Finish the request, committing every open reasoning block to the cross-block ring. */
    endRequest() {
        if (!this.#active)
            return;
        for (const index of [...this.#blocks.keys()])
            this.#finishBlock(index);
        this.#active = false;
    }
    /** Feed one chunk and return the first repetition it completes, if any. */
    observe(chunk) {
        switch (chunk.type) {
            case 'block-start':
                if (chunk.blockType !== 'reasoning' && chunk.blockType !== 'text')
                    return undefined;
                this.#finishBlock(chunk.index);
                this.#blocks.set(chunk.index, {
                    type: chunk.blockType,
                    partial: '',
                    fence: null,
                    hashes: new Set(),
                });
                return undefined;
            case 'block-end': {
                if (!this.#blocks.has(chunk.index))
                    return undefined;
                return this.#finishBlock(chunk.index);
            }
            case 'reasoning-delta': {
                if (!this.#config.reasoning)
                    return undefined;
                const state = this.#blocks.get(chunk.index) ?? this.#startBlock(chunk.index, 'reasoning');
                if (state.type !== 'reasoning')
                    return undefined;
                return this.#consume(state, chunk.text);
            }
            case 'text-delta': {
                if (!this.#config.text)
                    return undefined;
                const state = this.#blocks.get(chunk.index) ?? this.#startBlock(chunk.index, 'text');
                if (state.type !== 'text')
                    return undefined;
                return this.#consume(state, chunk.text);
            }
            case 'finish': {
                let detection;
                for (const index of [...this.#blocks.keys()]) {
                    detection ??= this.#finishBlock(index);
                }
                return detection;
            }
            default:
                return undefined;
        }
    }
    #startBlock(index, type) {
        const state = { type, partial: '', fence: null, hashes: new Set() };
        this.#blocks.set(index, state);
        return state;
    }
    #consume(state, text) {
        const pieces = text.split('\n');
        for (let index = 0; index < pieces.length; index += 1) {
            const combined = state.partial + (pieces[index] ?? '');
            state.partial =
                combined.length > MAX_LINE_CHARS ? combined.slice(0, MAX_LINE_CHARS) : combined;
            if (index === pieces.length - 1)
                break;
            const line = state.partial;
            state.partial = '';
            const detection = this.#line(state, line);
            if (detection !== undefined)
                return detection;
        }
        return undefined;
    }
    #finishBlock(index) {
        const state = this.#blocks.get(index);
        if (state === undefined)
            return undefined;
        let detection;
        if (state.partial !== '') {
            detection = this.#line(state, state.partial);
            state.partial = '';
        }
        if (state.type === 'reasoning') {
            // Empty reasoning blocks still advance the window; otherwise an old
            // occurrence survives many non-matching blocks and falsely fires.
            this.#recent.push(state.hashes);
            const previousLimit = Math.max(0, this.#config.crossBlockWindow - 1);
            while (this.#recent.length > previousLimit)
                this.#recent.shift();
        }
        this.#blocks.delete(index);
        return detection;
    }
    #line(state, raw) {
        const trimmed = raw.trim();
        const fence = /^(`{3,}|~{3,})(.*)$/u.exec(trimmed);
        if (fence !== null) {
            const marker = fence[1];
            const suffix = fence[2] ?? '';
            const char = marker[0];
            const length = marker.length;
            if (state.fence === null) {
                state.fence = { char, length };
                return undefined;
            }
            // Close only with the same character, sufficient length, and no code
            // after the marker; `~~~value` inside a tilde fence is code.
            if (state.fence.char === char && length >= state.fence.length && suffix.trim() === '') {
                state.fence = null;
            }
            return undefined;
        }
        if (state.fence !== null)
            return undefined;
        const line = trimmed.replace(/\s+/gu, ' ');
        if (line.length < this.#config.minLineChars)
            return undefined;
        const hash = hashLine(line);
        if (state.type === 'reasoning')
            state.hashes.add(hash);
        const count = (this.#lineCounts.get(line) ?? 0) + 1;
        this.#lineCounts.set(line, count);
        if (count >= this.#config.minRepeats) {
            return { line, count, kind: state.type, acrossBlocks: false };
        }
        if (state.type === 'reasoning') {
            let previous = 0;
            for (const block of this.#recent)
                if (block.has(hash))
                    previous += 1;
            if (previous + 1 >= this.#config.crossBlockRepeats) {
                return { line, count: previous + 1, kind: state.type, acrossBlocks: true };
            }
        }
        return undefined;
    }
}
/** Maximum characters of the context `notice` summary, matching the harness bound. */
const CONTEXT_SUMMARY_MAX_CHARS = 120;
/** Build a frozen user message carrying the guard's capped notice text. */
function createNotice(text, summary) {
    const message = {
        id: randomUUID(),
        role: 'user',
        content: Object.freeze([{ type: 'text', text }]),
        source: Object.freeze({
            kind: 'loop-guard',
            form: 'notice',
            summary: summary.slice(0, CONTEXT_SUMMARY_MAX_CHARS),
        }),
    };
    return Object.freeze(message);
}
/** Quote at most the configured preview characters; the returned text never exceeds the cap. */
function cappedPreview(line, previewChars) {
    if (line.length <= previewChars)
        return line;
    if (previewChars <= 1)
        return line.slice(0, previewChars);
    return `${line.slice(0, previewChars - 1)}…`;
}
/** Describe the repetition without quoting more than the preview. */
function repetitionText(detection, config) {
    if (detection.acrossBlocks) {
        return `appeared in ${detection.count} of the last ${config.crossBlockWindow} reasoning blocks`;
    }
    return `repeated ${detection.count} times in this response`;
}
/** Build the recovery notice for one cut, with stronger wording as interventions accumulate. */
function recoveryNotice(detection, intervention, config) {
    const next = intervention >= 3
        ? 'Do not plan any further: make the next tool call you already identified, or write the final answer now.'
        : intervention === 2
            ? 'Stop planning and act: run the next tool call you already identified, or produce the final answer now.'
            : 'Use the latest tool result and take the next concrete action, or finish with the final answer if the task is done.';
    return createNotice([
        `Loop guard: the same streamed ${detection.kind} line ${repetitionText(detection, config)}, so the response was ended early.`,
        `Repeated line: "${cappedPreview(detection.line, config.previewChars)}"`,
        `Recovery ${intervention} of ${config.maxInterventionsPerTurn}: ${next} Do not restate the repeated line.`,
    ].join('\n\n'), `loop-guard: repeated ${detection.kind} line × ${detection.count}`);
}
/** Build the notice for the turn that the reset starts. */
function resetNotice(detection, resetsUsed, config) {
    return createNotice([
        `Loop guard reset the previous turn after ${config.maxInterventionsPerTurn} recovery notices did not break the loop.`,
        `Repeated line: "${cappedPreview(detection.line, config.previewChars)}"`,
        `This is reset ${resetsUsed} of ${config.maxResetsPerSession} for this session. From the latest tool results, reply with exactly three bullets:`,
        '- done: what is already complete\n- verified: what the latest tool result proves\n- next: the next concrete action',
        'Then continue the task and do not repeat the line.',
    ].join('\n\n'), `loop-guard: reset ${resetsUsed}/${config.maxResetsPerSession}`);
}
/** The step-end cancel reason for a reset; it becomes the durable turn-end reason. */
function resetReason(detection, config) {
    return `loop-guard:reset: reset the turn after ${config.maxInterventionsPerTurn} recovery notices; repeated line: "${cappedPreview(detection.line, config.previewChars)}"`;
}
/** The final stop reason; it names the repeated line and the configured limits. */
function finalStopReason(detection, config) {
    return `loop-guard:final: the streamed ${detection.kind} kept repeating after ${config.maxInterventionsPerTurn} recovery notices and ${config.maxResetsPerSession} turn resets; repeated line: "${cappedPreview(detection.line, config.previewChars)}"`;
}
/** A subagent session is excluded unless the row enables subagent coverage. */
function isSubagent(agent) {
    const header = agent.session.header;
    return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0;
}
/** Record the open block kinds so a cut never truncates a tool call in progress. */
function trackBlocks(open, chunk) {
    switch (chunk.type) {
        case 'block-start':
            open.set(chunk.index, chunk.blockType);
            return;
        case 'block-end':
            open.delete(chunk.index);
            return;
        case 'tool-call-delta':
            if (!open.has(chunk.index))
                open.set(chunk.index, 'tool-call');
            return;
        default:
            return;
    }
}
/** A tool-call block anywhere in the stream keeps the stream open to completion. */
function hasOpenToolCall(open) {
    for (const kind of open.values())
        if (kind === 'tool-call')
            return true;
    return false;
}
/** Only the guard's own hook cancellation may start the reset turn. */
function isOwnHook(reason, expected) {
    if (typeof reason !== 'object' || reason === null)
        return false;
    const candidate = reason;
    return candidate.kind === 'hook' && candidate.reason === expected;
}
/** Install the detector, stream guard, and step-end reset. */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const states = new WeakMap();
    function stateFor(agent) {
        let state = states.get(agent);
        if (state === undefined) {
            state = {
                turn: null,
                interventions: 0,
                resets: 0,
                detectedThisTurn: false,
                noticeId: null,
                pending: null,
                detector: new LoopDetector(resolved),
            };
            states.set(agent, state);
        }
        return state;
    }
    /** Reset per-turn state at a turn boundary; a clean turn clears the reset budget. */
    function syncTurn(state, turn) {
        if (state.turn === turn)
            return;
        if (state.turn !== null && !state.detectedThisTurn)
            state.resets = 0;
        state.turn = turn;
        state.interventions = 0;
        state.detectedThisTurn = false;
        state.noticeId = null;
        state.pending = null;
        state.detector.resetTurn();
    }
    function handleDetection(detection, options, agent, state) {
        state.detectedThisTurn = true;
        // A turn already cancelled by the user (or its parent) must not be woken.
        if (options.signal?.aborted === true)
            return;
        if (state.pending !== null)
            return;
        if (state.interventions < resolved.maxInterventionsPerTurn) {
            state.interventions += 1;
            const notice = recoveryNotice(detection, state.interventions, resolved);
            try {
                agent.steer(notice);
                state.noticeId = notice.id;
            }
            catch {
                // Fail open: a failed notice must not fail the model request.
            }
            return;
        }
        const final = state.resets >= resolved.maxResetsPerSession;
        state.pending = {
            turn: state.turn ?? -1,
            signal: options.signal,
            final,
            reason: final ? finalStopReason(detection, resolved) : resetReason(detection, resolved),
            detection,
            noticeId: state.noticeId,
        };
    }
    /** The one deferred action after the step-end publication unwinds. */
    function finishReset(agent, state, pending) {
        const signal = pending.signal;
        if (signal?.aborted === true && !isOwnHook(signal.reason, pending.reason))
            return;
        if (pending.noticeId !== null) {
            try {
                agent.inbox.remove(pending.noticeId);
            }
            catch {
                // A claimed or disposed notice needs no removal.
            }
        }
        state.resets += 1;
        try {
            agent.followup(resetNotice(pending.detection, state.resets, resolved));
        }
        catch {
            // Fail open: a disposed agent simply receives no follow-up.
        }
    }
    ctx.on('agent/pre-step', (payload, next) => {
        try {
            if (resolved.subagents || !isSubagent(payload.agent)) {
                syncTurn(stateFor(payload.agent), payload.turn);
            }
        }
        catch {
            // Fail open: lookups must never block a step.
        }
        return next();
    });
    ctx.on('llm/stream', (options, next) => {
        const stream = next();
        try {
            if (options.purpose !== undefined || options.sessionId === undefined)
                return stream;
            const agent = ctx.agents.get(options.sessionId);
            if (agent === undefined)
                return stream;
            if (!resolved.subagents && isSubagent(agent))
                return stream;
            const state = stateFor(agent);
            return guardStream(stream, options, agent, state);
        }
        catch {
            return stream;
        }
    });
    async function* guardStream(stream, options, agent, state) {
        state.detector.beginRequest();
        const open = new Map();
        let handled = false;
        let disabled = false;
        try {
            for await (const chunk of stream) {
                if (!disabled) {
                    try {
                        trackBlocks(open, chunk);
                        const detection = state.detector.observe(chunk);
                        if (detection !== undefined && !handled) {
                            handled = true;
                            handleDetection(detection, options, agent, state);
                            // One intervention per request: stop feeding the detector, but
                            // keep passing chunks through when a tool call forbids a cut.
                            disabled = true;
                            if (!hasOpenToolCall(open) && options.signal?.aborted !== true)
                                return;
                        }
                    }
                    catch {
                        // Fail open: a detector error leaves the model stream untouched.
                        disabled = true;
                    }
                }
                yield chunk;
            }
        }
        finally {
            try {
                state.detector.endRequest();
            }
            catch {
                // Detector teardown is best effort.
            }
        }
    }
    ctx.on('session/event', (session, event) => {
        if (event.type !== 'step/end')
            return;
        let agent;
        try {
            agent = ctx.agents.get(session.id);
        }
        catch {
            return;
        }
        if (agent === undefined)
            return;
        if (agent.session !== session)
            return;
        const state = states.get(agent);
        if (state === undefined)
            return;
        const pending = state.pending;
        if (pending === null || pending.turn !== event.data.turn)
            return;
        state.pending = null;
        try {
            agent.cancel({ kind: 'hook', reason: pending.reason }, { keepInbox: true });
        }
        catch {
            return;
        }
        if (pending.final)
            return;
        state.noticeId = null;
        queueMicrotask(() => finishReset(agent, state, pending));
    });
}
