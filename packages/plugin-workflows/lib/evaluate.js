/**
 * Pure shadow-trigger evaluation. Every observed event is evaluated against
 * every trigger and records one fixed reason; a matched shadow trigger reports
 * `would-fire` and never calls a tool or steers.
 */
export const WHY_NOT_REASONS = [
    'would-fire',
    'event-mismatch',
    'filter-mismatch',
    'dedupe',
    'disabled',
    'not-ready',
    'error',
];
/** One glob segment, where `*` matches any run of non-slash characters. */
function segmentMatches(pattern, value) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
        .replaceAll('*', '[^/]*')
        .replaceAll('?', '.');
    return new RegExp(`^${escaped}$`, 'u').test(value);
}
/** Segment glob: `*` within one segment, `**` across zero or more segments. */
export function globMatches(pattern, path) {
    const patternSegments = pattern.split('/');
    const pathSegments = path.split('/');
    const walk = (patternIndex, pathIndex) => {
        if (patternIndex === patternSegments.length)
            return pathIndex === pathSegments.length;
        const segment = patternSegments[patternIndex];
        if (segment === '**') {
            for (let index = pathIndex; index <= pathSegments.length; index += 1) {
                if (walk(patternIndex + 1, index))
                    return true;
            }
            return false;
        }
        if (pathIndex >= pathSegments.length)
            return false;
        const candidate = pathSegments[pathIndex];
        return (candidate !== undefined &&
            segmentMatches(segment ?? '', candidate) &&
            walk(patternIndex + 1, pathIndex + 1));
    };
    return walk(0, 0);
}
/** The de-duplication identity for one trigger/event pair, or undefined. */
export function evaluationKey(trigger, event) {
    if (trigger.dedupe !== 'path+content-hash')
        return undefined;
    return `${event.subject}\u0000${event.hash ?? ''}`;
}
function filterMismatch(trigger, event) {
    const filter = trigger.filter;
    if (filter.tool !== undefined && filter.tool !== event.tool) {
        return {
            matched: false,
            reason: 'filter-mismatch',
            path: event.subject,
            filter: `tool: ${filter.tool}`,
        };
    }
    if (filter.path !== undefined && !globMatches(filter.path, event.subject)) {
        return {
            matched: false,
            reason: 'filter-mismatch',
            path: event.subject,
            filter: `path: ${filter.path}`,
        };
    }
    if (filter.change !== undefined) {
        if (event.change !== 'created' && event.change !== 'modified') {
            return {
                matched: false,
                reason: 'filter-mismatch',
                path: event.subject,
                filter: `change: ${filter.change}`,
            };
        }
    }
    return undefined;
}
/**
 * Evaluate the whole catalog for one event. Keys are added to `seen` after the
 * evaluation, so a second identical event reports `dedupe` and no action runs.
 */
export function evaluateEvent(triggers, event, seen, ready = true) {
    const rows = [];
    const keys = [];
    for (const trigger of triggers) {
        const key = evaluationKey(trigger, event);
        const evaluation = evaluate(trigger, event, {
            ready,
            isDuplicate: (candidate) => seen.has(candidate),
        });
        rows.push({
            id: trigger.id,
            matched: evaluation.matched,
            reason: evaluation.reason,
            ...(evaluation.path === undefined ? {} : { path: evaluation.path }),
            ...(evaluation.filter === undefined ? {} : { filter: evaluation.filter }),
            ...(evaluation.detail === undefined ? {} : { detail: evaluation.detail }),
        });
        if (key !== undefined)
            keys.push(key);
    }
    for (const key of keys)
        seen.add(key);
    return rows;
}
export function evaluate(trigger, event, context) {
    try {
        if (trigger.mode === 'disabled')
            return { matched: false, reason: 'disabled' };
        if (!context.ready)
            return { matched: false, reason: 'not-ready' };
        if (trigger.event !== event.kind)
            return { matched: false, reason: 'event-mismatch' };
        const mismatch = filterMismatch(trigger, event);
        if (mismatch !== undefined)
            return mismatch;
        const key = evaluationKey(trigger, event);
        if (key !== undefined && context.isDuplicate(key))
            return { matched: false, reason: 'dedupe' };
        return { matched: true, reason: 'would-fire' };
    }
    catch (error) {
        return {
            matched: false,
            reason: 'error',
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}
