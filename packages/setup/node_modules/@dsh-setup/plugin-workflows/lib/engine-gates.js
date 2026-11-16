import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lastCodeWriteAt } from './evidence.js';
import { evaluateLaneParity, evaluateProgressParity } from './gates.js';
import { defaultGit, worktreeDigest } from './git.js';
import { readProgressNote } from './notes.js';
import { reviewerBinding, taskReviewCoverage } from './parity.js';
import { checkedTaskIds, numberedTasks, taskLanes } from './tasks.js';
import { normalizedWorkspacePath } from './write-attribution.js';
const WORKER_LANE_TOOLS = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow']);
const LANE_TAG = /(?<![A-Za-z0-9_-])lane-tag:\s*([a-z0-9][a-z0-9-]*)#([1-9][0-9]*)(?![0-9A-Za-z_])/gu;
/** The plan markdown of one change, or undefined when it is unreadable. */
async function readPlan(workspace, change) {
    try {
        return await readFile(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
    }
    catch {
        return undefined;
    }
}
/** Whether the turn wrote a non-documentation file. */
export function codeChangedThisTurn(calls, workspace, turn) {
    const current = calls.filter((call) => turn === undefined || call.turn === undefined || call.turn === turn);
    return lastCodeWriteAt(current, workspace) !== undefined;
}
/** The task ids one turn's canonical `tasks.md` writes newly checked. */
export function newlyCheckedTaskIds(calls, workspace, change, turn) {
    const wanted = `openspec/changes/${change}/tasks.md`;
    const ids = new Set();
    for (const call of calls) {
        if (turn !== undefined && call.turn !== undefined && call.turn !== turn)
            continue;
        if (call.name !== 'write' && call.name !== 'edit')
            continue;
        if (call.ok === false || call.after === undefined)
            continue;
        const raw = call.arguments.file_path ?? call.arguments.path;
        if (typeof raw !== 'string')
            continue;
        if (normalizedWorkspacePath(workspace, raw) !== wanted)
            continue;
        const before = new Set(checkedTaskIds(call.before ?? ''));
        for (const id of checkedTaskIds(call.after))
            if (!before.has(id))
                ids.add(id);
    }
    return [...ids];
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Whether one task has a matching task-review PASS/ERROR record in the active
 * review owner's store. The native record is a superset of the legacy one, so
 * one predicate covers both; a record that changed its reviewed inputs or
 * failed internally never approves.
 */
export async function taskReviewEvidence(workspace, change, taskId, owner) {
    const relative = owner === 'workflows'
        ? `.dsh/workflows/records/task-review/${change}/tasks/${taskId}.json`
        : `.dsh/delegation/task-review/${change}/tasks/${taskId}.json`;
    let value;
    try {
        value = JSON.parse(await readFile(join(workspace, relative), 'utf8'));
    }
    catch {
        return false;
    }
    if (!isRecord(value))
        return false;
    if (value.rule !== 'task-review' ||
        value.change !== change ||
        value.scope !== 'task' ||
        value.taskId !== taskId ||
        (value.verdict !== 'PASS' && value.verdict !== 'ERROR') ||
        (value.verdict === 'ERROR' &&
            (value.failureClass === 'reviewed-inputs-changed' ||
                value.failureClass === 'queue-internal-error')) ||
        typeof value.digest !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(value.digest) ||
        !Array.isArray(value.findings) ||
        !isRecord(value.target) ||
        typeof value.target.provider !== 'string' ||
        typeof value.time !== 'string') {
        return false;
    }
    if (owner === 'workflows' && value.phase !== 'task')
        return false;
    if (value.verdict === 'PASS' && value.findings.length !== 0)
        return false;
    const binding = reviewerBinding(workspace);
    if (binding?.invalid !== undefined)
        return false;
    if (binding?.provider !== undefined && value.target.provider !== binding.provider)
        return false;
    if (binding?.model !== undefined && value.target.model !== binding.model)
        return false;
    return true;
}
/**
 * The owned work-progress gate: a code-changing turn needs a newly checked and
 * reviewed task or a note whose digest matches the current worktree. A stale
 * note, a note for a completed task, and a note from another path refuse.
 */
export async function evaluateOwnedProgressGate(input) {
    const ticked = newlyCheckedTaskIds(input.calls, input.workspace, input.change, input.turn);
    let tickedReviewed = false;
    for (const taskId of ticked) {
        if (await taskReviewEvidence(input.workspace, input.change, taskId, input.reviewOwner)) {
            tickedReviewed = true;
            break;
        }
    }
    let note;
    let stale;
    if (input.codeChanged && !tickedReviewed) {
        const saved = await readProgressNote(input.workspace, input.change, input.noteOwner);
        if (saved !== undefined) {
            const plan = await readPlan(input.workspace, input.change);
            const current = plan === undefined
                ? undefined
                : numberedTasks(plan).find((task) => task.id === saved.taskId);
            if (current !== undefined && !current.checked) {
                const digest = await worktreeDigest(input.workspace, input.runGit ?? defaultGit);
                note = { digest: saved.worktreeDigest, currentDigest: digest };
                if (digest !== undefined && digest !== saved.worktreeDigest) {
                    stale = ` The last note is stale: it names worktree digest ${saved.worktreeDigest.slice(0, 12)}, current ${digest.slice(0, 12)}.`;
                }
            }
        }
    }
    const decision = evaluateProgressParity({
        codeChanged: input.codeChanged,
        tickedReviewed,
        ...(note === undefined ? {} : { note }),
    });
    if (decision.decision === 'allow')
        return decision;
    const next = (await readPlan(input.workspace, input.change)) ?? '';
    const task = numberedTasks(next).find((entry) => !entry.checked);
    const noteCall = task === undefined
        ? `workflows { action: "note", change: "${input.change}", task: "<task text>", status: "in-progress", reason: "..." }`
        : `workflows { action: "note", change: "${input.change}", task: "${task.number} ${task.text}", status: "in-progress", reason: "..." }`;
    const reviewCall = task === undefined
        ? `workflows status`
        : `delegate(rule: "task-review", change: "${input.change}", task: "${task.id}")`;
    const digest = note?.currentDigest === undefined ? '(unavailable)' : note.currentDigest.slice(0, 12);
    return {
        decision: 'refuse',
        reason: decision.reason,
        steer: `rule "task-progress": this turn changed implementation files in change "${input.change}" without a newly checked-and-reviewed task and without a current progress note for worktree digest ${digest}.${stale ?? ''} Tick the task and run ${reviewCall}, or record ${noteCall}. Only a matching record or a note whose worktree digest matches the current worktree satisfies this gate; a text claim does not.`,
    };
}
/** The lane titles covered by a successful tagged worker start in this session. */
export function taggedLaneTitles(calls, change, lanes) {
    const titles = new Set();
    for (const call of calls) {
        if (!WORKER_LANE_TOOLS.has(call.name) || call.ok === false)
            continue;
        const text = JSON.stringify(call.arguments);
        for (const match of text.matchAll(LANE_TAG)) {
            if (match[1] !== change)
                continue;
            const lane = lanes.find((entry) => entry.n === Number(match[2]));
            if (lane !== undefined)
                titles.add(lane.title);
        }
    }
    return [...titles];
}
/**
 * The owned lane-assignment gate. A serial note naming a task in a lane decides
 * only that lane; every other unassigned lane stays reported. The gate fails
 * open on an unreadable plan, a plan without level-2 headings, and a lane
 * without owned paths (the shared parity table enforces the last one).
 */
export async function evaluateOwnedLaneGate(input) {
    const plan = await readPlan(input.workspace, input.change);
    if (plan === undefined) {
        return {
            decision: 'allow',
            reason: 'the tasks.md plan is unreadable and the lane gate fails open',
        };
    }
    const lanes = taskLanes(plan);
    if (lanes.length === 0) {
        return { decision: 'allow', reason: 'the plan has no level-2 lane headings' };
    }
    const tasks = numberedTasks(plan);
    const ticked = new Set(newlyCheckedTaskIds(input.calls, input.workspace, input.change, input.turn)
        .map((taskId) => tasks.find((task) => task.id === taskId)?.number)
        .filter((number) => number !== undefined));
    const assigned = new Set(taggedLaneTitles(input.calls, input.change, lanes));
    const note = await readProgressNote(input.workspace, input.change, input.noteOwner);
    if (note !== undefined) {
        const task = tasks.find((entry) => entry.id === note.taskId);
        if (task !== undefined) {
            const lane = lanes.find((entry) => entry.checked.includes(task.number) || entry.unchecked.includes(task.number));
            if (lane !== undefined)
                assigned.add(lane.title);
        }
    }
    const decision = evaluateLaneParity({
        plan,
        ticked: [...ticked],
        assigned: [...assigned],
        implementationChanged: input.codeChanged,
    });
    if (decision.decision === 'allow')
        return decision;
    const lines = [
        `rule "lane-assignment": lane assignment is missing in change "${input.change}": ${String(decision.lanes?.length ?? 0)} unassigned non-serial lane(s) with owned paths and unchecked tasks; this turn ticked a task or changed implementation files, and no tagged worker start or serial note covers them.`,
    ];
    for (const lane of decision.lanes ?? []) {
        const planLane = lanes.find((entry) => entry.title === lane.title);
        const nextNumber = planLane?.unchecked.at(0);
        const task = tasks.find((entry) => entry.number === nextNumber);
        lines.push(`- lane "${lane.title}" (owns ${lane.owned.join(', ')}): start a worker whose prompt carries lane-tag: ${input.change}#${String(lane.n)}`);
        if (task !== undefined) {
            lines.push(`  or record a serial decision: workflows { action: "note", change: "${input.change}", task: "${task.number} ${task.text}", status: "in-progress", reason: "why this lane stays serial" }`);
        }
    }
    return {
        decision: 'refuse',
        reason: decision.reason,
        steer: lines.join('\n'),
        ...(decision.lanes === undefined ? {} : { lanes: decision.lanes }),
    };
}
/**
 * The goal-complete guard: completing a goal is refused while an active change
 * has a checked task without a portable task-review PASS. The check is the same
 * portable-approval coverage the archive gate uses.
 */
export async function goalCompletionRefusal(input) {
    if (input.exec.name !== 'update_goal')
        return undefined;
    if (!isRecord(input.exec.arguments) || input.exec.arguments.action !== 'complete') {
        return undefined;
    }
    if (!input.definitions.some((definition) => definition.id === 'task-review'))
        return undefined;
    let names;
    try {
        names = await readdir(join(input.workspace, 'openspec', 'changes'));
    }
    catch {
        return undefined;
    }
    const gaps = [];
    for (const name of names) {
        if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || name === 'archive')
            continue;
        let markdown;
        try {
            markdown = await readFile(join(input.workspace, 'openspec', 'changes', name, 'tasks.md'), 'utf8');
        }
        catch {
            return `goal completion refused: change "${name}" has no readable tasks.md; repair it or archive the change. The goal stays active.`;
        }
        if (checkedTaskIds(markdown).length === 0)
            continue;
        const coverage = taskReviewCoverage(input.workspace, name);
        if (coverage.ok)
            continue;
        gaps.push(`goal completion refused: change "${name}" is not approval-complete:`, ...coverage.gaps.map((gap) => `  ${gap}`));
    }
    if (gaps.length === 0)
        return undefined;
    gaps.push('The goal stays active. Run the delegate calls above and complete the goal again; to close the work instead, archive the change.');
    return gaps.join('\n');
}
