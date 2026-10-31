/**
 * Declarative signal rows. A row is inert data: an id, a label, a kind, and a
 * match over session-event facts. Nothing here is executed.
 */
/** A configuration error that names the offending field or row. */
export class RowConfigError extends Error {
    constructor(message) {
        super(`observability config: ${message}`);
        this.name = 'RowConfigError';
    }
}
const ROW_FIELDS = new Set([
    'id',
    'label',
    'kind',
    'match',
    'trigger',
    'goal',
    'eligible',
    'mounted',
]);
const MOUNTED_FIELDS = new Set(['section', 'skill']);
const PREDICATE_FIELDS = new Set([
    'eventType',
    'tool',
    'sourceKind',
    'abortPrefix',
    'command',
    'argument',
]);
const ARGUMENT_FIELDS = new Set(['field', 'value']);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rejectUnknownFields(value, allowed, at) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            throw new RowConfigError(`${at}: unknown field "${key}"`);
    }
}
function readText(value, at) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new RowConfigError(`${at} must be a non-empty string`);
    }
    return value;
}
function readArgument(value, at) {
    if (!isRecord(value))
        throw new RowConfigError(`${at} must be a mapping`);
    rejectUnknownFields(value, ARGUMENT_FIELDS, at);
    return {
        field: readText(value.field, `${at}.field`),
        value: readText(value.value, `${at}.value`),
    };
}
function readPredicate(value, at) {
    if (!isRecord(value))
        throw new RowConfigError(`${at} must be a mapping`);
    rejectUnknownFields(value, PREDICATE_FIELDS, at);
    const predicate = {};
    for (const field of ['eventType', 'tool', 'sourceKind', 'abortPrefix', 'command']) {
        if (value[field] !== undefined)
            predicate[field] = readText(value[field], `${at}.${field}`);
    }
    if (value.argument !== undefined) {
        if (predicate.tool === undefined) {
            throw new RowConfigError(`${at}.argument requires "${at}.tool" to name the tool`);
        }
        predicate.argument = readArgument(value.argument, `${at}.argument`);
    }
    if (Object.keys(predicate).length === 0) {
        throw new RowConfigError(`${at} names no predicate field`);
    }
    return predicate;
}
function readMounted(value, at) {
    if (!isRecord(value))
        throw new RowConfigError(`${at} must be a mapping`);
    rejectUnknownFields(value, MOUNTED_FIELDS, at);
    const mounted = {};
    for (const field of ['section', 'skill']) {
        if (value[field] !== undefined)
            mounted[field] = readText(value[field], `${at}.${field}`);
    }
    if (Object.keys(mounted).length === 0) {
        throw new RowConfigError(`${at} must name "section" or "skill"`);
    }
    return mounted;
}
function readPredicateList(value, at) {
    if (!Array.isArray(value))
        throw new RowConfigError(`${at} must be an array`);
    if (value.length === 0)
        throw new RowConfigError(`${at} must not be empty`);
    return value.map((predicate, index) => readPredicate(predicate, `${at}[${index}]`));
}
function readRow(value, at) {
    if (!isRecord(value))
        throw new RowConfigError(`${at} must be a mapping`);
    rejectUnknownFields(value, ROW_FIELDS, at);
    const id = readText(value.id, `${at}.id`);
    const label = readText(value.label, `${at}.label`);
    const kind = value.kind;
    if (kind !== 'signal' && kind !== 'guidance') {
        throw new RowConfigError(`${at}.kind must be "signal" or "guidance"`);
    }
    const descriptors = {
        ...(value.trigger === undefined ? {} : { trigger: readText(value.trigger, `${at}.trigger`) }),
        ...(value.goal === undefined ? {} : { goal: readText(value.goal, `${at}.goal`) }),
    };
    if (kind === 'guidance') {
        if (value.match !== undefined) {
            throw new RowConfigError(`${at}.match is not allowed on a guidance row`);
        }
        if (value.eligible !== undefined) {
            throw new RowConfigError(`${at}.eligible is not allowed on a guidance row`);
        }
        if (value.mounted !== undefined) {
            descriptors.mounted = readMounted(value.mounted, `${at}.mounted`);
        }
        return { id, label, kind, ...descriptors };
    }
    if (value.mounted !== undefined) {
        throw new RowConfigError(`${at}.mounted is not allowed on a signal row`);
    }
    if (value.match === undefined) {
        throw new RowConfigError(`${at}.match is required on a signal row`);
    }
    const raw = Array.isArray(value.match) ? value.match : [value.match];
    if (raw.length === 0)
        throw new RowConfigError(`${at}.match must not be empty`);
    const match = raw.map((predicate, index) => readPredicate(predicate, `${at}.match[${index}]`));
    const eligible = value.eligible === undefined ? undefined : readPredicateList(value.eligible, `${at}.eligible`);
    return {
        id,
        label,
        kind,
        match,
        ...descriptors,
        ...(eligible === undefined ? {} : { eligible }),
    };
}
/** Validate a bare row list. */
export function readRows(rows) {
    if (!Array.isArray(rows))
        throw new RowConfigError('config.rows must be an array');
    const parsed = [];
    const seen = new Set();
    rows.forEach((value, index) => {
        const row = readRow(value, `rows[${index}]`);
        if (seen.has(row.id))
            throw new RowConfigError(`rows[${index}].id "${row.id}" is not unique`);
        seen.add(row.id);
        parsed.push(row);
    });
    return parsed;
}
/**
 * Validate the configured row list. An absent list is valid: the built-in
 * signal sets still work on a profile with no configuration.
 */
export function parseRows(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!isRecord(raw))
        throw new RowConfigError('config must be a mapping');
    for (const key of Object.keys(raw)) {
        if (key !== 'rows')
            throw new RowConfigError(`config: unknown field "${key}"`);
    }
    return readRows(raw.rows ?? []);
}
/**
 * The argument fields configured predicates read, per tool. Extraction keeps
 * only these values, so raw tool arguments never enter a neutral record.
 */
export function configuredArgumentFields(rows) {
    const fields = new Map();
    for (const row of rows) {
        for (const predicate of [...(row.match ?? []), ...(row.eligible ?? [])]) {
            if (predicate.tool === undefined || predicate.argument === undefined)
                continue;
            let names = fields.get(predicate.tool);
            if (names === undefined) {
                names = new Set();
                fields.set(predicate.tool, names);
            }
            names.add(predicate.argument.field);
        }
    }
    return fields;
}
