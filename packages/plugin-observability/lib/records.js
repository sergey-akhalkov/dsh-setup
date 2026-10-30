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
/**
 * Extract the aggregation records a session owns.
 *
 * `start` is the session's durable inheritance boundary: a fork seed copies a
 * parent prefix and owns only what follows it.
 */
export function extractRecords(sessionId, events, start = 0) {
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
        let args;
        switch (type) {
            case 'tool/call': {
                tool = text(data.name);
                args = text(data.arguments);
                const callId = text(data.callId);
                if (tool !== undefined && callId !== undefined) {
                    callById.set(callId, args === undefined ? { tool } : { tool, arguments: args });
                }
                break;
            }
            case 'tool/result': {
                const message = asRecord(data.message);
                const source = asRecord(message?.source);
                const callId = text(source?.callId);
                const call = callId === undefined ? undefined : callById.get(callId);
                tool = call?.tool;
                // Keep the originating call's arguments with its result, so an
                // argument-scoped signal can own the failure without message text.
                args = call?.arguments;
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
                if (reason?.kind === 'error')
                    failed = true;
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
            ...(args === undefined ? {} : { arguments: args }),
            ...(failed === undefined ? {} : { failed }),
        });
        if (type === 'turn/end')
            currentTurn = undefined;
    }
    return records;
}
