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
        switch (type) {
            case 'tool/call': {
                tool = text(data.name);
                callId = text(data.callId);
                values = argumentValues(text(data.arguments), tool === undefined ? undefined : fields?.get(tool));
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
        });
        if (type === 'turn/end')
            currentTurn = undefined;
    }
    return records;
}
