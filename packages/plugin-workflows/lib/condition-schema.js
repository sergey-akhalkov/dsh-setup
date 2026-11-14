import { validateJsonLogic } from './jsonlogic.js';
/**
 * The bounded condition schema. A trigger's `condition` is JSONLogic over a
 * closed context: the event, the change's tasks and lanes, the current records
 * and digests, and the session's involvement. A path outside that vocabulary
 * fails the definition load with its field.
 */
export const CONDITION_ROOTS = ['event', 'change', 'records', 'digests', 'session'];
const STATIC_PATHS = new Set([
    'event.kind',
    'event.tool',
    'event.command',
    'event.path',
    'change.name',
    'change.tasks',
    'change.tasks.checked',
    'change.tasks.unchecked',
    'change.tasks.items',
    'change.lanes',
    'change.lanes.n',
    'change.lanes.title',
    'change.lanes.owned',
    'change.lanes.unchecked',
    'records.spec',
    'records.spec.verdict',
    'records.spec.digest',
    'records.spec.current',
    'records.spec.pass',
    'records.tasks',
    'digests.spec',
    'digests.worktree',
    'session.involved',
    'session.changedSpec',
    'session.completed',
]);
const ROOT_SET = new Set(CONDITION_ROOTS);
function checkPath(raw, field) {
    if (/[\\/]|(?:^|\.)\.\.(?:\.|$)|:/u.test(raw)) {
        throw new Error(`condition.${field} "var" path "${raw}" must not name a path`);
    }
    const segments = raw.split('.');
    if (segments.some((segment) => segment === '')) {
        throw new Error(`condition.${field} "var" path "${raw}" has an empty segment`);
    }
    if (segments.length > 8) {
        throw new Error(`condition.${field} "var" path "${raw}" nests too deeply`);
    }
    const root = segments[0] ?? '';
    if (!ROOT_SET.has(root)) {
        throw new Error(`condition.${field} "var" path "${raw}" names an unknown context field; use one of: ${CONDITION_ROOTS.join(', ')}`);
    }
    if (raw === root)
        return;
    if (STATIC_PATHS.has(raw))
        return;
    // The per-task record map is keyed by task id; its values carry these fields.
    if (segments[0] === 'records' && segments[1] === 'tasks') {
        if (segments.length === 2)
            return;
        if (segments.length === 4 && (segments[3] === 'verdict' || segments[3] === 'digest'))
            return;
    }
    throw new Error(`condition.${field} "var" path "${raw}" names an unknown context field; use one of the documented fields`);
}
function varPath(rule, field, depth = 0) {
    if (depth > 32)
        throw new Error(`condition.${field} nests too deeply`);
    if (rule === null || typeof rule !== 'object')
        return;
    if (Array.isArray(rule)) {
        for (const entry of rule)
            varPath(entry, field, depth + 1);
        return;
    }
    const record = rule;
    const keys = Object.keys(record);
    if (keys.length !== 1)
        return;
    const operator = keys[0] ?? '';
    if (operator === 'var') {
        const args = Array.isArray(record.var) ? record.var : [record.var];
        const raw = args[0];
        if (raw !== undefined) {
            if (typeof raw !== 'string') {
                throw new Error(`condition.${field} "var" path must be a string`);
            }
            if (raw !== '')
                checkPath(raw, field);
        }
        for (const arg of args.slice(1))
            varPath(arg, field, depth + 1);
        return;
    }
    if (operator === 'missing' || operator === 'missing_some') {
        const operands = Array.isArray(record[operator])
            ? record[operator]
            : [record[operator]];
        for (const operand of operands) {
            const names = Array.isArray(operand) ? operand : [operand];
            for (const name of names) {
                if (typeof name === 'string') {
                    if (/^\d+$/u.test(name))
                        continue;
                    checkPath(name, field);
                }
                else {
                    varPath(name, field, depth + 1);
                }
            }
        }
        return;
    }
    const args = Array.isArray(record[operator])
        ? record[operator]
        : [record[operator]];
    for (const arg of args)
        varPath(arg, field, depth + 1);
}
/** Validate a trigger condition at load: JSONLogic only, closed context paths. */
export function validateCondition(rule, field = 'trigger.condition') {
    try {
        validateJsonLogic(rule);
    }
    catch (error) {
        throw new Error(`${field}: ${error instanceof Error ? error.message : String(error)}`);
    }
    varPath(rule, field);
}
