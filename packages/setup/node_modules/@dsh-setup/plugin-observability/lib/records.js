/** The tool that records a work checkpoint. */
const CHECKPOINT_TOOL = 'work_checkpoint';
/** Every field the checkpoint producer accepts; anything else makes the call malformed. */
const CHECKPOINT_FIELDS = new Set([
    'outcome',
    'verified',
    'remaining',
    'parallel',
    'serialReason',
    'next',
    'speedup',
]);
/** The producer's list bound; a longer list is malformed. */
const MAX_CHECKPOINT_ITEMS = 8;
/** A list's length when the producer would accept it, or undefined when malformed. */
function checkpointListLength(value) {
    if (value === undefined)
        return 0;
    if (!Array.isArray(value) || value.length > MAX_CHECKPOINT_ITEMS)
        return undefined;
    for (const item of value) {
        if (typeof item !== 'string' || item.trim() === '')
            return undefined;
    }
    return value.length;
}
/** One optional text field: present-but-empty is malformed, absent is fine. */
function checkpointTextIsValid(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() !== '');
}
/**
 * Read a checkpoint's counts and flags. A call is valid only as the producer
 * validated it; any malformed field makes the whole call contribute zero, so
 * no partial or unvalidated text ever reaches a record.
 */
function checkpointFacts(raw) {
    if (raw === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    const source = asRecord(parsed);
    if (source === undefined)
        return undefined;
    if (!Object.keys(source).every((key) => CHECKPOINT_FIELDS.has(key)))
        return undefined;
    const outcome = source.outcome;
    if (outcome !== 'done' && outcome !== 'continue')
        return undefined;
    if (source.parallel !== undefined && typeof source.parallel !== 'boolean')
        return undefined;
    if (typeof source.next !== 'string' || source.next.trim() === '')
        return undefined;
    if (!checkpointTextIsValid(source.serialReason) || !checkpointTextIsValid(source.speedup)) {
        return undefined;
    }
    const parallel = source.parallel === true;
    if (outcome === 'continue' && !parallel && source.serialReason == null)
        return undefined;
    const verified = checkpointListLength(source.verified);
    const remaining = checkpointListLength(source.remaining);
    if (verified === undefined || remaining === undefined)
        return undefined;
    return { outcome, verified, remaining, parallel };
}
/**
 * The configured argument fields of a checkpoint, read from validated facts.
 * Raw checkpoint arguments are never copied, so malformed text cannot leak.
 */
function checkpointArgumentValues(facts, fields) {
    if (facts === undefined || fields === undefined)
        return undefined;
    const values = {};
    if (fields.has('outcome'))
        values.outcome = facts.outcome;
    if (fields.has('parallel'))
        values.parallel = String(facts.parallel);
    return Object.keys(values).length === 0 ? undefined : values;
}
/** The five usage fields, with a missing field counting as zero, never an estimate. */
function tokenUsage(value) {
    const usage = asRecord(value);
    if (usage === undefined)
        return undefined;
    return {
        input: number(usage.inputTokens) ?? 0,
        output: number(usage.outputTokens) ?? 0,
        cacheRead: number(usage.cacheReadTokens) ?? 0,
        cacheWrite: number(usage.cacheWriteTokens) ?? 0,
        total: number(usage.totalTokens) ?? 0,
    };
}
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function text(value) {
    return typeof value === 'string' ? value : undefined;
}
function number(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Keep only the configured argument fields, as strings, so no raw arguments survive. */
function argumentValues(raw, fields) {
    if (raw === undefined || fields === undefined || fields.size === 0)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    const source = asRecord(parsed);
    if (source === undefined)
        return undefined;
    const values = {};
    for (const field of fields) {
        const value = source[field];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            values[field] = String(value);
        }
    }
    return Object.keys(values).length === 0 ? undefined : values;
}
/**
 * Extract the aggregation records a session owns.
 *
 * `start` is the session's durable inheritance boundary: a fork seed copies a
 * parent prefix and owns only what follows it. `fields` names the argument
 * fields a configured predicate reads; anything else in the arguments is dropped.
 */
export function extractRecords(sessionId, events, start = 0, fields) {
    const records = [];
    const callById = new Map();
    let currentTurn;
    for (const event of events.slice(start)) {
        const data = asRecord(event.data) ?? {};
        const type = event.type;
        const explicitTurn = number(data.turn);
        if (type === 'turn/start')
            currentTurn = explicitTurn;
        const turn = explicitTurn ?? currentTurn;
        let failed;
        let abortPrefix;
        let tool;
        let sourceKind;
        let command;
        let values;
        let callId;
        let errorName;
        let errorCode;
        let turnEnd;
        let usage;
        let goalOperation;
        let goalId;
        let goalPhase;
        let goalRounds;
        let checkpointOutcome;
        let checkpointVerifiedCount;
        let checkpointRemainingCount;
        let checkpointParallel;
        switch (type) {
            case 'tool/call': {
                tool = text(data.name);
                callId = text(data.callId);
                if (tool === CHECKPOINT_TOOL) {
                    const facts = checkpointFacts(text(data.arguments));
                    checkpointOutcome = facts?.outcome;
                    checkpointVerifiedCount = facts?.verified ?? 0;
                    checkpointRemainingCount = facts?.remaining ?? 0;
                    checkpointParallel = facts?.parallel;
                    values = checkpointArgumentValues(facts, fields?.get(tool));
                }
                else {
                    values = argumentValues(text(data.arguments), tool === undefined ? undefined : fields?.get(tool));
                }
                if (tool !== undefined && callId !== undefined) {
                    callById.set(callId, values === undefined ? { tool } : { tool, values });
                }
                break;
            }
            case 'tool/result': {
                const message = asRecord(data.message);
                const source = asRecord(message?.source);
                callId = text(source?.callId) ?? text(message?.toolCallId);
                const call = callId === undefined ? undefined : callById.get(callId);
                tool = call?.tool;
                // The result owns the call's configured argument fields, so an
                // argument-scoped signal can own the failure without message text.
                values = call?.values;
                // Only the failure identity is kept; the raw reason is user-facing text.
                const error = asRecord(data.error);
                errorName = text(error?.name);
                errorCode = text(error?.code);
                if (message?.isError === true || data.error !== undefined)
                    failed = true;
                break;
            }
            case 'user/message': {
                // The event data is the UserMessage itself: source sits at data.source.
                sourceKind = text(asRecord(data.source)?.kind);
                break;
            }
            case 'command/run': {
                command = text(data.name);
                break;
            }
            case 'assistant/message': {
                usage = tokenUsage(data.usage);
                break;
            }
            case 'goal/change': {
                goalOperation = text(data.operation);
                goalId = text(asRecord(data.goal)?.id);
                goalPhase = text(asRecord(data.goal)?.phase);
                goalRounds = number(data.roundsStarted);
                break;
            }
            case 'turn/end': {
                const reason = asRecord(data.reason);
                turnEnd = text(reason?.kind);
                if (reason?.kind === 'error') {
                    failed = true;
                    errorCode = text(asRecord(reason.error)?.code);
                }
                if (reason?.kind === 'aborted') {
                    const cause = asRecord(reason.reason);
                    abortPrefix = cause?.kind === 'hook' ? text(cause.reason) : undefined;
                }
                break;
            }
            default:
                break;
        }
        records.push({
            sessionId,
            seq: event.seq,
            time: event.time,
            eventType: event.type,
            ...(turn === undefined ? {} : { turn }),
            ...(number(data.step) === undefined ? {} : { step: number(data.step) }),
            ...(tool === undefined ? {} : { tool }),
            ...(sourceKind === undefined ? {} : { sourceKind }),
            ...(abortPrefix === undefined ? {} : { abortPrefix }),
            ...(command === undefined ? {} : { command }),
            ...(values === undefined ? {} : { argumentValues: values }),
            ...(failed === undefined ? {} : { failed }),
            ...(callId === undefined ? {} : { callId }),
            ...(errorName === undefined ? {} : { errorName }),
            ...(errorCode === undefined ? {} : { errorCode }),
            ...(turnEnd === undefined ? {} : { turnEnd }),
            ...(usage === undefined ? {} : { usage }),
            ...(goalOperation === undefined ? {} : { goalOperation }),
            ...(goalId === undefined ? {} : { goalId }),
            ...(goalPhase === undefined ? {} : { goalPhase }),
            ...(goalRounds === undefined ? {} : { goalRounds }),
            ...(checkpointOutcome === undefined ? {} : { checkpointOutcome }),
            ...(checkpointVerifiedCount === undefined ? {} : { checkpointVerifiedCount }),
            ...(checkpointRemainingCount === undefined ? {} : { checkpointRemainingCount }),
            ...(checkpointParallel === undefined ? {} : { checkpointParallel }),
        });
        if (type === 'turn/end')
            currentTurn = undefined;
    }
    return records;
}
