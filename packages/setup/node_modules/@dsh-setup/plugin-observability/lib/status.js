/** The explicit note beside `silent`: absence is not evidence of a fault. */
export const SILENT_NOTE = 'No traces in this period; absence is not evidence of a fault.';
/** The label a guidance row carries instead of a status. */
export const GUIDANCE_NOTE = 'Guidance only: this plugin contributes prompt text, which a session log cannot count.';
/** The tool names a row's predicates bind, in first-seen order. */
export function boundTools(row) {
    const tools = [];
    for (const predicate of row.match ?? []) {
        if (predicate.tool !== undefined && !tools.includes(predicate.tool))
            tools.push(predicate.tool);
    }
    return tools;
}
function totalTraces(aggregate) {
    if (aggregate === undefined)
        return 0;
    return aggregate.counts.reduce((sum, count) => sum + count, 0);
}
/**
 * Compare a signal row against the live tool registry and its own traces.
 * Guidance rows have no status at all; the caller renders their guidance label.
 */
export function rowState(row, aggregate, registry) {
    if (row.kind === 'guidance')
        return undefined;
    const missing = boundTools(row).filter((tool) => !registry.has(tool));
    if (missing.length > 0) {
        const names = missing.map((tool) => `"${tool}"`).join(', ');
        return {
            status: 'not loaded',
            note: `Configured tool ${names} is not registered by the running Host.`,
        };
    }
    const traces = totalTraces(aggregate);
    const errors = aggregate?.errors ?? 0;
    if (errors > 0) {
        return {
            status: 'error',
            note: `${errors} error trace${errors === 1 ? '' : 's'} in this period.`,
        };
    }
    if (traces > 0) {
        return { status: 'active', note: `${traces} trace${traces === 1 ? '' : 's'} in this period.` };
    }
    return { status: 'silent', note: SILENT_NOTE };
}
