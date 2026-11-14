import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHANGE_NAME } from './command-parse.js';
import { currentSpecDigest } from './evidence.js';
import { evaluateJsonLogic } from './executors.js';
import { worktreeDigest } from './git.js';
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
async function readTaskRecords(workspace, directories) {
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
                typeof record.verdict !== 'string' ||
                typeof record.digest !== 'string') {
                continue;
            }
            records[taskId] = { verdict: record.verdict, digest: record.digest };
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
        const legacySpec = workflowSpec === undefined
            ? await readRecord(input.workspace, `.dsh/delegation/spec-review/${change}/spec.json`)
            : undefined;
        const record = workflowSpec ?? legacySpec;
        if (record !== undefined &&
            typeof record.verdict === 'string' &&
            typeof record.digest === 'string') {
            specRecord = {
                verdict: record.verdict,
                digest: record.digest,
                current: record.digest === specDigest,
                pass: record.verdict === 'PASS',
            };
        }
        Object.assign(tasksRecords, await readTaskRecords(input.workspace, [
            `.dsh/workflows/records/task-review/${change}/tasks`,
            `.dsh/delegation/task-review/${change}/tasks`,
        ]));
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
        decisions.set(definition.id, evaluateCondition(definition.trigger.condition, context));
    }
    return decisions;
}
