/** The tool that records a work checkpoint. */
const CHECKPOINT_TOOL = 'work_checkpoint';
/**
 * The tools that start a worker. The plugin gate additionally requires the
 * checkpoint id in the arguments; this metric does not, so it stays metadata.
 */
export const WORKER_START_TOOLS = new Set([
    'subagent',
    'subagent_fork',
    'spawn_teammate',
    'workflow',
    'delegate',
]);
/** Every field the checkpoint producer accepts; a removed or unknown field is malformed. */
const CHECKPOINT_FIELDS = new Set([
    'outcome',
    'verified',
    'lanes',
    'bottleneck',
    'next',
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
/** A present string list, or undefined when it holds a non-string or empty entry. */
function checkpointStringList(value) {
    if (!Array.isArray(value))
        return undefined;
    const items = [];
    for (const item of value) {
        if (typeof item !== 'string' || item.trim() === '')
            return undefined;
        items.push(item);
    }
    return items;
}
/** Validate the lane plan; a duplicate id or an unknown `blockedBy` is malformed. */
function checkpointLanes(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > MAX_CHECKPOINT_ITEMS)
        return undefined;
    const lanes = [];
    const ids = new Set();
    for (const item of value) {
        const lane = asRecord(item);
        if (lane === undefined)
            return undefined;
        const id = text(lane.id);
        const owner = text(lane.owner);
        const state = lane.state;
        if (id === undefined || id.trim() === '')
            return undefined;
        if (owner === undefined || owner.trim() === '')
            return undefined;
        if (state !== 'running' && state !== 'blocked' && state !== 'done')
            return undefined;
        const scope = checkpointStringList(lane.scope);
        if (scope === undefined || scope.length === 0)
            return undefined;
        const blockedBy = lane.blockedBy === undefined ? [] : checkpointStringList(lane.blockedBy);
        if (blockedBy === undefined || ids.has(id))
            return undefined;
        ids.add(id);
        lanes.push({ id, owner, scope, state, blockedBy });
    }
    for (const lane of lanes) {
        for (const id of lane.blockedBy) {
            if (!ids.has(id))
                return undefined;
        }
    }
    return lanes;
}
/** Validate the bottleneck; absent is undefined and malformed is null. */
function checkpointBottleneck(value) {
    if (value === undefined)
        return undefined;
    const source = asRecord(value);
    if (source === undefined)
        return null;
    const id = text(source.id);
    const owner = text(source.owner);
    const action = source.action;
    if (id === undefined || id.trim() === '')
        return null;
    if (owner === undefined || owner.trim() === '')
        return null;
    if (action !== 'worker_start' && action !== 'lead_action' && action !== 'user_decision') {
        return null;
    }
    const blockingLaneIds = source.blockingLanes === undefined ? [] : checkpointStringList(source.blockingLanes);
    const targets = source.targets === undefined ? [] : checkpointStringList(source.targets);
    if (blockingLaneIds === undefined || targets === undefined)
        return null;
    if (action === 'lead_action' && targets.length === 0)
        return null;
    return { owner, action, blockingLaneIds, targets };
}
/**
 * Read a checkpoint's validated plan. A call is valid only as the producer
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
    if (typeof source.next !== 'string' || source.next.trim() === '')
        return undefined;
    const verified = checkpointListLength(source.verified);
    if (verified === undefined)
        return undefined;
    const lanes = checkpointLanes(source.lanes);
    if (lanes === undefined)
        return undefined;
    const bottleneck = checkpointBottleneck(source.bottleneck);
    if (bottleneck === null)
        return undefined;
    // A `continue` checkpoint carries the plan; a `done` close may omit it.
    if (outcome === 'continue' && (source.lanes === undefined || bottleneck === undefined)) {
        return undefined;
    }
    if (lanes.length > 0 && bottleneck !== undefined) {
        const ids = new Set(lanes.map((lane) => lane.id));
        if (!bottleneck.blockingLaneIds.every((id) => ids.has(id)))
            return undefined;
    }
    return { outcome, verified, lanes, ...(bottleneck === undefined ? {} : { bottleneck }) };
}
/** Normalize a path-like scope for component-wise comparison. */
function normalizedPath(path) {
    return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
/** Whether two scopes overlap; a `resource:` scope is compared exactly. */
function scopesOverlap(left, right) {
    const a = left.trim();
    const b = right.trim();
    if (a.startsWith('resource:') || b.startsWith('resource:'))
        return a === b;
    const normalizedLeft = normalizedPath(a);
    const normalizedRight = normalizedPath(b);
    return (normalizedLeft === normalizedRight ||
        normalizedLeft.startsWith(`${normalizedRight}/`) ||
        normalizedRight.startsWith(`${normalizedLeft}/`));
}
function laneScopesOverlap(left, right) {
    return left.scope.some((a) => right.scope.some((b) => scopesOverlap(a, b)));
}
/** A lane is runnable when it runs and every lane it waits on is done. */
function laneIsRunnable(lane, byId) {
    return lane.state === 'running' && lane.blockedBy.every((id) => byId.get(id)?.state === 'done');
}
/** Two runnable lanes with different owners and disjoint scopes compute parallel work. */
function planComputesParallel(lanes) {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    const runnable = lanes.filter((lane) => laneIsRunnable(lane, byId));
    for (let left = 0; left < runnable.length; left += 1) {
        for (let right = left + 1; right < runnable.length; right += 1) {
            const a = runnable[left];
            const b = runnable[right];
            if (a === undefined || b === undefined)
                continue;
            if (a.owner !== b.owner && !laneScopesOverlap(a, b))
                return true;
        }
    }
    return false;
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
    return Object.keys(values).length === 0 ? undefined : values;
}
/** One call's identity across a session, so a call and its result join. */
function callKey(sessionId, callId) {
    return `${sessionId}\u0000${callId}`;
}
/** A write destination, read only to match a bottleneck target and never kept. */
function filePathOf(raw) {
    if (raw === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    return text(asRecord(parsed)?.file_path);
}
/** Whether a write destination equals a declared target or lies beneath it by component. */
function matchesTargets(filePath, targets) {
    const normalized = normalizedPath(filePath);
    return targets.some((target) => {
        const normalizedTarget = normalizedPath(target);
        return normalized === normalizedTarget || normalized.startsWith(`${normalizedTarget}/`);
    });
}
/**
 * Whether the bottleneck's remedy was matched in the window between the
 * checkpoint and the next one. Only a recorded successful result is evidence;
 * the plugin gate's exact tagged-id rule is not part of this metric.
 */
function remedyMatches(records, start, end, bottleneck, filePaths) {
    const results = new Set();
    const failed = new Set();
    for (let index = start + 1; index < end; index += 1) {
        const record = records[index];
        if (record === undefined || record.eventType !== 'tool/result')
            continue;
        if (record.callId === undefined)
            continue;
        const key = callKey(record.sessionId, record.callId);
        results.add(key);
        if (record.failed === true)
            failed.add(key);
    }
    for (let index = start + 1; index < end; index += 1) {
        const record = records[index];
        if (record === undefined || record.eventType !== 'tool/call' || record.tool === undefined) {
            continue;
        }
        // A user decision is the question itself; it needs no completed result.
        if (record.tool === 'ask_user_question') {
            if (bottleneck.action === 'user_decision')
                return true;
            continue;
        }
        if (record.callId === undefined)
            continue;
        const key = callKey(record.sessionId, record.callId);
        if (!results.has(key) || failed.has(key))
            continue;
        if (bottleneck.action === 'worker_start' && WORKER_START_TOOLS.has(record.tool))
            return true;
        if (bottleneck.action === 'lead_action' &&
            (record.tool === 'edit' || record.tool === 'write')) {
            const filePath = filePaths.get(key);
            if (filePath !== undefined && matchesTargets(filePath, bottleneck.targets))
                return true;
        }
    }
    return false;
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
    const checkpointFactsByIndex = new Map();
    const lastBottleneck = new Map();
    // The write destination is read for remedy matching only; it never reaches a record.
    const filePaths = new Map();
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
        let checkpointLaneCount;
        let checkpointBlockedLaneCount;
        let checkpointParallelComputed;
        let checkpointBottleneckAction;
        let checkpointBottleneckAge;
        switch (type) {
            case 'tool/call': {
                tool = text(data.name);
                callId = text(data.callId);
                if (tool === CHECKPOINT_TOOL) {
                    const facts = checkpointFacts(text(data.arguments));
                    checkpointOutcome = facts?.outcome;
                    checkpointVerifiedCount = facts?.verified ?? 0;
                    if (facts !== undefined) {
                        checkpointFactsByIndex.set(records.length, facts);
                        checkpointLaneCount = facts.lanes.length;
                        checkpointBlockedLaneCount = facts.lanes.filter((lane) => lane.state === 'blocked').length;
                        checkpointParallelComputed = planComputesParallel(facts.lanes);
                        checkpointBottleneckAction = facts.bottleneck?.action;
                        if (facts.bottleneck === undefined) {
                            lastBottleneck.delete(sessionId);
                        }
                        else {
                            const blocking = [...new Set(facts.bottleneck.blockingLaneIds)].sort().join('\u0000');
                            const previous = lastBottleneck.get(sessionId);
                            const age = previous !== undefined &&
                                previous.owner === facts.bottleneck.owner &&
                                previous.blocking === blocking
                                ? previous.age + 1
                                : 1;
                            checkpointBottleneckAge = age;
                            lastBottleneck.set(sessionId, { owner: facts.bottleneck.owner, blocking, age });
                        }
                    }
                    values = checkpointArgumentValues(facts, fields?.get(tool));
                }
                else {
                    values = argumentValues(text(data.arguments), tool === undefined ? undefined : fields?.get(tool));
                    if ((tool === 'edit' || tool === 'write') && callId !== undefined) {
                        const filePath = filePathOf(text(data.arguments));
                        if (filePath !== undefined)
                            filePaths.set(callKey(sessionId, callId), filePath);
                    }
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
            ...(checkpointLaneCount === undefined ? {} : { checkpointLaneCount }),
            ...(checkpointBlockedLaneCount === undefined ? {} : { checkpointBlockedLaneCount }),
            ...(checkpointParallelComputed === undefined ? {} : { checkpointParallelComputed }),
            ...(checkpointBottleneckAction === undefined ? {} : { checkpointBottleneckAction }),
            ...(checkpointBottleneckAge === undefined ? {} : { checkpointBottleneckAge }),
        });
        if (type === 'turn/end')
            currentTurn = undefined;
    }
    // The remedy window ends at the next checkpoint, or at the turn end when this
    // is the last one; an absent bottleneck needs no remedy.
    const indices = [...checkpointFactsByIndex.keys()].sort((left, right) => left - right);
    for (let position = 0; position < indices.length; position += 1) {
        const index = indices[position];
        if (index === undefined)
            continue;
        const facts = checkpointFactsByIndex.get(index);
        const checkpoint = records[index];
        if (facts?.outcome !== 'continue' || facts.bottleneck === undefined)
            continue;
        if (checkpoint === undefined)
            continue;
        const next = indices[position + 1];
        let end = next ?? records.length;
        if (next === undefined) {
            for (let cursor = index + 1; cursor < records.length; cursor += 1) {
                const record = records[cursor];
                if (record === undefined || record.eventType !== 'turn/end')
                    continue;
                if (checkpoint.turn !== undefined && record.turn !== checkpoint.turn)
                    continue;
                end = cursor;
                break;
            }
        }
        records[index] = {
            ...checkpoint,
            checkpointRemedyResolved: remedyMatches(records, index, end, facts.bottleneck, filePaths),
        };
    }
    return records;
}
