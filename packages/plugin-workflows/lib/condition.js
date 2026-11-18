import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHANGE_NAME } from './command-parse.js';
import { currentSpecDigest } from './evidence.js';
import { evaluateJsonLogic } from './executors.js';
import { worktreeDigest } from './git.js';
import { localRecordError } from './projection.js';
import { numberedTasks, taskLanes } from './tasks.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function readRecord(workspace, path) {
    try {
        const value = JSON.parse(await readFile(join(workspace, path), 'utf8'));
        return isRecord(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
async function readTaskRecords(workspace, change, directories) {
    const records = {};
    for (const directory of directories) {
        let names;
        try {
            names = await readdir(join(workspace, directory));
        }
        catch {
            continue;
        }
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const taskId = name.slice(0, -'.json'.length);
            if (records[taskId] !== undefined)
                continue;
            const record = await readRecord(workspace, `${directory}/${name}`);
            if (record === undefined ||
                localRecordError(record) !== undefined ||
                record.rule !== 'task-review' ||
                record.change !== change ||
                record.scope !== 'task' ||
                record.taskId !== taskId) {
                continue;
            }
            records[taskId] = { verdict: String(record.verdict), digest: String(record.digest) };
        }
    }
    return records;
}
/** Build the one bounded context every condition for this event evaluates over. */
export async function buildConditionContext(input) {
    const change = input.change !== undefined && CHANGE_NAME.test(input.change) ? input.change : '';
    let markdown = '';
    if (change !== '') {
        try {
            markdown = await readFile(join(input.workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
        }
        catch {
            markdown = '';
        }
    }
    const tasks = numberedTasks(markdown);
    const lanes = taskLanes(markdown);
    const specDigest = change === '' ? undefined : await currentSpecDigest(input.workspace, change);
    const worktree = input.runGit === undefined
        ? undefined
        : await worktreeDigest(input.workspace, input.runGit).catch(() => undefined);
    let specRecord;
    const tasksRecords = {};
    if (change !== '') {
        const workflowSpec = await readRecord(input.workspace, `.dsh/workflows/records/spec-review/${change}/spec.json`);
        // Owned whole-spec review reads the workflows store only; a legacy PASS
        // must not suppress the owned definition.
        const record = workflowSpec;
        if (record !== undefined &&
            localRecordError(record) === undefined &&
            record.rule === 'spec-review' &&
            record.change === change &&
            record.phase === 'spec' &&
            record.scope === 'whole') {
            specRecord = {
                verdict: String(record.verdict),
                digest: String(record.digest),
                current: record.digest === specDigest,
                pass: record.verdict === 'PASS',
            };
        }
        Object.assign(tasksRecords, await readTaskRecords(input.workspace, change, [
            `.dsh/workflows/records/task-review/${change}/tasks`,
        ]));
    }
    // The event's own path and command and a lane's owned globs are the context
    // values that name a path input, and an absolute or traversing one must not
    // reach a predicate. Task text and lane titles are owner-authored plan prose:
    // a predicate returns a boolean and this context is never persisted, so prose
    // is carried as written.
    const startsPath = /^(?:[A-Za-z]:[\\/]|[\\/])/u;
    // A drive path needs a separator or a non-space right after the colon.
    const drivePath = /(?:^|[^A-Za-z0-9])[A-Za-z]:(?:[\\/]|[^\s])/u;
    const absolutePath = /(?:^|[\s"'`=([[{(<:;,]|[|?&!])\/[^\s'"`*]/u;
    const uncPath = /(?:^|[^A-Za-z0-9])\\\\(?:[^\\/\s]+[\\/]|\?[\\/]UNC[\\/])/u;
    // `..` counts as a traversal when a separator follows it (`../x`, `..\x`), when
    // it is a whole segment (`x/..`, a leading or trailing `..`), or when it ends a
    // segment before a delimiter (`` `safe/..` ``). Prose ranges such as
    // `f1`..`fn` are not traversals.
    const traverses = /\.\.[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)|[\\/]\.\.(?:[^A-Za-z0-9._-]|$)/u;
    // In a shell command a redirection operator can touch an absolute path.
    const redirectedPath = />{1,2}\/[^\s'"`*]/u;
    // A URL is a reference, not a machine path. In a literal value (an event path
    // or a lane's owned glob) the span runs to whitespace or an angle bracket, so
    // its query text stays inside it. In a shell command a quoted URL is one
    // argument, the closing quote of its own kind ends it (a `'` inside `"…"`
    // stays content), and an unquoted one ends at a shell operator so a
    // redirection keeps its path operand visible. `file:` URLs always stay
    // visible, and a scheme needs two or more characters so `C://x` is not one.
    const literalUrl = /[A-Za-z][A-Za-z0-9+.-]+:\/\/[^\s<>]+/gu;
    const shellUrl = /[A-Za-z][A-Za-z0-9+.-]+:\/\/[^\s<>|&;'"`()]+/gu;
    const anyUrl = /[A-Za-z][A-Za-z0-9+.-]+:\/\//u;
    const maskUrl = (match) => (/^file:/iu.test(match) ? match : ' ');
    const closingQuote = (value, from, quote) => {
        let index = from;
        while (index < value.length) {
            const char = value[index] ?? '';
            if (char === '\\') {
                index += 2;
                continue;
            }
            if (char === quote)
                return index;
            index += 1;
        }
        return -1;
    };
    // A quoted argument is one shell token: escape-aware scanning keeps an escaped
    // quote from opening a span, and a span that contains a URL is masked whole
    // unless it names a file URL, which must stay visible.
    const maskQuotedArguments = (value) => {
        let output = '';
        let index = 0;
        while (index < value.length) {
            const char = value[index] ?? '';
            if (char === '\\') {
                output += char + (value[index + 1] ?? '');
                index += 2;
                continue;
            }
            if (char === '"' || char === "'") {
                const close = closingQuote(value, index + 1, char);
                if (close !== -1) {
                    const inner = value.slice(index + 1, close);
                    const masked = anyUrl.test(inner) && !/^file:/iu.test(inner.trim()) ? ' ' : inner;
                    output += char + masked + char;
                    index = close + 1;
                    continue;
                }
            }
            output += char;
            index += 1;
        }
        return output;
    };
    const withoutUrls = (value, shell) => {
        if (!shell)
            return value.replace(literalUrl, maskUrl);
        return maskQuotedArguments(value).replace(shellUrl, maskUrl);
    };
    const violates = (text, redirection) => startsPath.test(text) ||
        drivePath.test(text) ||
        absolutePath.test(text) ||
        (redirection && redirectedPath.test(text)) ||
        uncPath.test(text) ||
        traverses.test(text);
    // shortcut: a substitution is extracted with balanced parentheses, escapes,
    // and inner quotes; a full shell grammar is not parsed, so a form it cannot
    // delimit leaves the remainder checked. Single-quoted and escaped text stays
    // literal.
    const substitutionEnd = (command, start) => {
        let depth = 0;
        let index = start + 1;
        let quote;
        while (index < command.length) {
            const char = command[index] ?? '';
            if (char === '\\') {
                index += 2;
                continue;
            }
            if (quote === "'") {
                if (char === "'")
                    quote = undefined;
                index += 1;
                continue;
            }
            if (char === "'" && quote === undefined) {
                quote = "'";
                index += 1;
                continue;
            }
            if (char === '"') {
                quote = quote === '"' ? undefined : '"';
                index += 1;
                continue;
            }
            if (quote === undefined) {
                if (char === '(')
                    depth += 1;
                if (char === ')') {
                    depth -= 1;
                    if (depth === 0)
                        return index;
                }
            }
            index += 1;
        }
        return undefined;
    };
    const activeSubstitutions = (command) => {
        const found = [];
        let index = 0;
        let quote;
        while (index < command.length) {
            const char = command[index] ?? '';
            if (char === '\\') {
                index += 2;
                continue;
            }
            if (quote === "'") {
                if (char === "'")
                    quote = undefined;
                index += 1;
                continue;
            }
            if (char === "'" && quote === undefined) {
                quote = "'";
                index += 1;
                continue;
            }
            if (char === '"') {
                quote = quote === '"' ? undefined : '"';
                index += 1;
                continue;
            }
            if (char === '$' && command[index + 1] === '(') {
                const end = substitutionEnd(command, index);
                if (end === undefined) {
                    found.push(command.slice(index + 2));
                    break;
                }
                found.push(command.slice(index + 2, end));
                index = end + 1;
                continue;
            }
            if (char === '`') {
                const end = command.indexOf('`', index + 1);
                if (end === -1) {
                    found.push(command.slice(index + 1));
                    break;
                }
                found.push(command.slice(index + 1, end));
                index = end + 1;
                continue;
            }
            index += 1;
        }
        return found;
    };
    const assertNoSubstitutions = (command) => {
        for (const inner of activeSubstitutions(command)) {
            if (violates(withoutUrls(inner, true), true)) {
                throw new Error('condition context contains a filesystem path');
            }
            // A substitution inside the body is checked before a quoted URL in that
            // body could mask it.
            assertNoSubstitutions(inner);
        }
    };
    const assertNoPath = (value, redirection = false) => {
        if (value === undefined)
            return;
        if (violates(withoutUrls(value, redirection), redirection)) {
            throw new Error('condition context contains a filesystem path');
        }
        // A quoted URL is masked as one argument, but an active command
        // substitution inside it still runs: its text is checked on its own.
        if (redirection)
            assertNoSubstitutions(value);
    };
    assertNoPath(input.event.path);
    assertNoPath(input.event.command, true);
    for (const lane of lanes) {
        for (const owned of lane.owned)
            assertNoPath(owned);
    }
    return {
        event: input.event,
        change: {
            name: change,
            tasks: {
                checked: tasks.filter((task) => task.checked).map((task) => task.id),
                unchecked: tasks.filter((task) => !task.checked).map((task) => task.id),
                items: tasks,
            },
            lanes: lanes.map((lane) => ({
                n: lane.n,
                title: lane.title,
                owned: lane.owned,
                unchecked: lane.unchecked,
            })),
        },
        records: {
            ...(specRecord === undefined ? {} : { spec: specRecord }),
            tasks: tasksRecords,
        },
        digests: {
            ...(specDigest === undefined ? {} : { spec: specDigest }),
            ...(worktree === undefined ? {} : { worktree }),
        },
        session: {
            involved: input.involved ?? true,
            changedSpec: input.changedSpec ?? false,
            // Completion is derived from the change's own task list when the caller
            // does not know better: every numbered task is checked.
            completed: input.completed ?? (tasks.length > 0 && tasks.every((task) => task.checked)),
        },
    };
}
/**
 * Whether any predicate reads `digests.worktree`. The worktree digest runs git,
 * so a close whose conditional definitions never read it skips that cost.
 */
export function conditionNeedsWorktree(condition) {
    if (condition === undefined)
        return false;
    let found = false;
    const walk = (value) => {
        if (found)
            return;
        if (Array.isArray(value)) {
            for (const entry of value)
                walk(entry);
            return;
        }
        if (typeof value !== 'object' || value === null)
            return;
        const record = value;
        const raw = record.var;
        const path = Array.isArray(raw) ? raw[0] : raw;
        if (path === 'digests.worktree') {
            found = true;
            return;
        }
        // `missing` and `missing_some` name fields as literals, not var operands.
        const missing = record.missing ?? record.missing_some;
        if (Array.isArray(missing) &&
            missing.flatMap((name) => (Array.isArray(name) ? name : [name])).includes('digests.worktree')) {
            found = true;
            return;
        }
        for (const entry of Object.values(record))
            walk(entry);
    };
    walk(condition);
    return found;
}
/** Evaluate one definition's condition over the built context; false starts no run. */
export function evaluateCondition(condition, context) {
    if (condition === undefined)
        return true;
    const value = evaluateJsonLogic(condition, context);
    // JSONLogic truthiness, not JavaScript's: an empty array is false.
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
}
/** Every condition-bearing definition's decision for one event context. */
export function evaluateConditions(definitions, context) {
    const decisions = new Map();
    for (const definition of definitions) {
        if (definition.trigger.condition === undefined)
            continue;
        try {
            decisions.set(definition.id, evaluateCondition(definition.trigger.condition, context));
        }
        catch {
            // An over-budget or malformed predicate never starts a run.
            decisions.set(definition.id, false);
        }
    }
    return decisions;
}
