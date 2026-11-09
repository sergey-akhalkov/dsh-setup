import { isAbsolute, relative, resolve } from 'node:path';
import { resolveOwnership } from './definitions.js';
import { requestMainStep } from './executors.js';
import { addViolation, incrementTurnBlocks, resetStepAttempts, resetTurnBlocks, setRunStatus, settleStep, } from './runs.js';
function stepIsOpen(run, stepId) {
    const state = run.steps.find((step) => step.id === stepId)?.state;
    return state === 'open' || state === 'blocked';
}
/**
 * The first open `blockTurnClose` owned step, unless an earlier open step is
 * deferred: an unresolved deferred prerequisite stops the selection no matter
 * whether it blocks the turn close itself, because the legacy gate is the only
 * steer for it.
 */
export function selectBlockingStep(run, definition, installedLegacy, enabledLegacy) {
    const resolved = resolveOwnership(definition, installedLegacy, enabledLegacy);
    const ownership = new Map(resolved.steps.map((step) => [step.id, step.ownership]));
    for (const step of definition.steps) {
        if (!stepIsOpen(run, step.id))
            continue;
        if (ownership.get(step.id) === 'defer')
            return undefined;
        if (step.blockTurnClose === true)
            return step;
    }
    return undefined;
}
/** Evaluate one root turn stop. */
export function evaluateTurnClose(input) {
    const at = input.now ?? Date.now();
    try {
        if (input.origin === 'subagent') {
            return { kind: 'allow', run: input.run, reason: 'a subagent turn is exempt' };
        }
        // A failed task-review dispatch is an unresolved obligation: it must not
        // let the run terminal-allow before the review retry path is used.
        if (input.definition.id === 'task-review') {
            const failed = input.definition.steps.find((step) => step.blockTurnClose === true &&
                input.run.steps.find((entry) => entry.id === step.id)?.state === 'failed');
            if (failed !== undefined) {
                const blocks = input.run.turnBlocks ?? 0;
                if (blocks >= input.maxBlocks) {
                    const detail = `step "${failed.id}" has a failed dispatch; the close is allowed once as a VIOLATION, never as a pass`;
                    return {
                        kind: 'violation',
                        run: resetTurnBlocks(addViolation(input.run, detail, { step: failed.id, at }), at),
                        detail,
                    };
                }
                return {
                    kind: 'refuse',
                    run: incrementTurnBlocks(input.run, at),
                    stepId: failed.id,
                    text: `step "${failed.id}" has a failed dispatch; retry it before the close`,
                };
            }
        }
        // A terminal run is never revived by a later steer.
        if (input.run.status === 'completed' ||
            input.run.status === 'failed' ||
            input.run.status === 'cancelled') {
            return {
                kind: 'allow',
                run: input.run,
                reason: `run "${input.run.id}" is terminal (${input.run.status}); no steer`,
            };
        }
        const step = selectBlockingStep(input.run, input.definition, input.installedLegacy, input.enabledLegacy);
        // A host-computed owned decision (completion coverage or the checkpoint
        // remedy/age rule) refuses before the generic step walk.
        const ownedText = input.checkpointIssue?.text ??
            (input.completion?.ok === false
                ? (input.completion.text ?? 'the completion coverage is incomplete')
                : undefined);
        if (ownedText !== undefined && step === undefined) {
            const blocks = input.run.turnBlocks ?? 0;
            if (blocks >= input.maxBlocks) {
                const detail = `turn close was refused ${String(blocks)} time(s) by an owned workflow rule; the close is allowed once as a VIOLATION, never as a pass`;
                const run = resetTurnBlocks(addViolation(input.run, detail, { at }), at);
                return { kind: 'violation', run, detail };
            }
            return {
                kind: 'refuse',
                run: incrementTurnBlocks(input.run, at),
                stepId: input.definition.steps.at(-1)?.id ?? 'owned-rule',
                text: ownedText,
            };
        }
        if (step === undefined) {
            return {
                kind: 'allow',
                run: input.run,
                reason: 'no open blockTurnClose step is owned by this engine',
            };
        }
        const blocks = input.run.turnBlocks ?? 0;
        if (blocks >= input.maxBlocks) {
            const detail = `turn close was refused ${String(blocks)} time(s) with step "${step.id}" open; the close is allowed once as a VIOLATION, never as a pass`;
            const run = resetStepAttempts(resetTurnBlocks(addViolation(input.run, detail, { step: step.id, at }), at), step.id);
            return { kind: 'violation', run, detail };
        }
        const steered = requestMainStep({
            run: input.run,
            definition: input.definition,
            step,
            agent: input.agent,
            evidenceContext: input.evidenceContext,
            turn: input.turn,
            maxAttempts: input.maxBlocks,
            ...(ownedText === undefined ? {} : { note: ownedText }),
            now: at,
        });
        const run = incrementTurnBlocks(steered.run, at);
        if (!steered.steered) {
            if (steered.reason.includes('request bound')) {
                const detail = `step "${step.id}" reached its request bound; the close is allowed once as a VIOLATION, never as a pass`;
                const recorded = addViolation(input.run, detail, { step: step.id, at });
                return {
                    kind: 'violation',
                    run: resetStepAttempts(resetTurnBlocks(recorded, at), step.id),
                    detail,
                };
            }
            // A failed dispatch stays an obligation until the run advances/retries;
            // never let the close pass silently on the failed step.
            if (steered.reason.includes('already failed')) {
                const blocks = input.run.turnBlocks ?? 0;
                if (blocks >= input.maxBlocks) {
                    const detail = `step "${step.id}" has a failed dispatch; the close is allowed once as a VIOLATION, never as a pass`;
                    return {
                        kind: 'violation',
                        run: resetTurnBlocks(addViolation(input.run, detail, { step: step.id, at }), at),
                        detail,
                    };
                }
                return {
                    kind: 'refuse',
                    run,
                    stepId: step.id,
                    text: `step "${step.id}" has a failed dispatch; retry it before the close`,
                };
            }
            const message = `step "${step.id}" could not be steered: ${steered.reason}`;
            return {
                kind: 'allow',
                run: addViolation(input.run, message, { step: step.id, at }),
                reason: message,
            };
        }
        return { kind: 'refuse', run, stepId: step.id, text: steered.text };
    }
    catch (error) {
        input.onError?.(error);
        const message = `the turn-close gate failed internally and the close is allowed: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`;
        return {
            kind: 'allow',
            run: addViolation(input.run, message, { at }),
            reason: message,
        };
    }
}
function intakeName(run) {
    const name = run.context.name;
    return typeof name === 'string' ? name : undefined;
}
function isCompletedIntake(run, name) {
    return (run.definition === 'change-intake' && run.status === 'completed' && intakeName(run) === name);
}
function isResumableIntake(run, name, session) {
    return (run.definition === 'change-intake' &&
        (run.status === 'interrupted' || run.status === 'blocked') &&
        intakeName(run) === name &&
        run.session === session);
}
/**
 * The pre-execute intake gate, in the required order: an authenticated
 * completed run or receipt allows; an owned create-change call allows; a
 * resumable intake resumes and is refused; an existing change directory is
 * redirected to adoption; otherwise the run starts and the call is refused.
 */
export async function evaluateIntakeGate(input) {
    const name = input.name;
    const completed = input.runs.find((run) => isCompletedIntake(run, name));
    if (completed !== undefined) {
        return {
            kind: 'allow',
            reason: `the change-intake run "${completed.id}" is completed`,
            runId: completed.id,
        };
    }
    const receipt = input.receipts.find((entry) => entry.change === name);
    if (receipt !== undefined) {
        return {
            kind: 'allow',
            reason: `the host-authenticated ${receipt.kind} receipt for "${name}" authorizes the call`,
        };
    }
    if (input.callId !== undefined && input.ownedCallIds.has(input.callId)) {
        return { kind: 'allow', reason: 'the call id is owned by the intake run' };
    }
    const running = input.runs.find((run) => run.definition === 'change-intake' &&
        run.status === 'running' &&
        run.session === input.session &&
        intakeName(run) === name);
    if (running !== undefined) {
        const pending = running.steps.find((step) => step.state === 'open' || step.state === 'blocked');
        const stepId = pending?.id ?? 'requirements';
        return {
            kind: 'deny',
            action: 'resumed',
            runId: running.id,
            stepId,
            reason: `the intake run "${running.id}" is already in progress; continue at step "${stepId}" and do not create the change`,
        };
    }
    const resumable = input.runs.find((run) => isResumableIntake(run, name, input.session));
    if (resumable !== undefined) {
        const resumed = await input.resumeRun(resumable.id);
        return {
            kind: 'deny',
            action: 'resumed',
            runId: resumable.id,
            stepId: resumed.stepId,
            reason: `the interrupted intake run "${resumable.id}" resumed; continue at step "${resumed.stepId}" and do not create the change`,
        };
    }
    if (input.changeExists) {
        return {
            kind: 'deny',
            action: 'adopt',
            reason: `\`openspec/changes/${name}/\` already exists and no resumable intake or authenticated receipt exists; run /workflows adopt ${name} instead`,
        };
    }
    if (!input.definition.steps.some((step) => step.id === 'create-change')) {
        throw new Error('the change-intake definition has no create-change step');
    }
    const started = await input.startRun(input.definition, name);
    const first = input.definition.steps[0]?.id ?? 'requirements';
    return {
        kind: 'deny',
        action: 'started',
        runId: started.runId,
        stepId: first,
        reason: `the intake run "${started.runId}" started; complete step "${first}" and the later steps before creating the change`,
    };
}
/**
 * Run one deferred step at runtime. It reads the existing legacy record,
 * updates its own step, and never dispatches its executor or steers. A missing
 * or mismatched record leaves the step open and the run blocked for visibility;
 * the legacy gate alone is still the enforcing path.
 */
export async function runDeferredStep(input) {
    const at = input.now ?? Date.now();
    const resolved = resolveOwnership(input.definition, input.installedLegacy, input.enabledLegacy);
    const ownership = resolved.steps.find((step) => step.id === input.stepId);
    const step = input.definition.steps.find((entry) => entry.id === input.stepId);
    if (step === undefined)
        throw new Error(`the definition has no step "${input.stepId}"`);
    if (ownership === undefined || ownership.ownership !== 'defer') {
        throw new Error(`step "${input.stepId}" is not deferred; an owned step must run its executor`);
    }
    if (ownership.legacy === undefined) {
        return {
            run: setRunStatus(settleStep(input.run, input.stepId, 'blocked', {
                at,
                reason: 'the deferred step declares no legacy source',
            }), 'blocked', at),
            dispatched: false,
            steered: false,
            stepId: input.stepId,
        };
    }
    const signalEnabled = input.enabledLegacy === undefined
        ? input.installedLegacy.has(ownership.legacy.plugin)
        : input.enabledLegacy.has(`${ownership.legacy.plugin}/${ownership.legacy.signal}`);
    if (!signalEnabled) {
        return {
            run: setRunStatus(settleStep(input.run, input.stepId, 'blocked', {
                at,
                reason: `the legacy source "${ownership.legacy.plugin}/${ownership.legacy.signal}" is not enabled; the retire-legacy-gates change owns the transition`,
            }), 'blocked', at),
            dispatched: false,
            steered: false,
            stepId: input.stepId,
        };
    }
    let check;
    try {
        check = await input.readRecord(step);
    }
    catch (error) {
        return {
            run: setRunStatus(settleStep(input.run, input.stepId, 'blocked', {
                at,
                reason: `the legacy record could not be read: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`,
            }), 'blocked', at),
            dispatched: false,
            steered: false,
            stepId: input.stepId,
        };
    }
    if (!check.ok) {
        return {
            run: setRunStatus(settleStep(input.run, input.stepId, 'blocked', {
                at,
                reason: `waiting for the legacy gate: ${check.failure.reason} (${check.failure.detail.slice(0, 200)})`,
            }), 'blocked', at),
            dispatched: false,
            steered: false,
            stepId: input.stepId,
        };
    }
    return {
        run: settleStep(input.run, input.stepId, 'done', { at, evidence: check.evidence }),
        dispatched: false,
        steered: false,
        stepId: input.stepId,
    };
}
/* ------------------------------------------------------------------ */
/* authorization write guard                                           */
/* ------------------------------------------------------------------ */
/** The write tools the guard recognizes; a shell write is the stated bypass. */
const WRITE_TOOLS = new Set(['write', 'edit']);
/** The host-owned directories and store a model write may never target. */
export const PROTECTED_WRITE_PREFIXES = [
    '.dsh/workflows/definitions/',
    '.dsh/workflows/approved.json',
    '.dsh/workflows/receipts/',
    '.dsh/workflows/runs/',
];
/** The file-write intent of one tool execution, when it is a recognized write. */
export function recognizeFileWrite(exec) {
    if (!WRITE_TOOLS.has(exec.name))
        return undefined;
    if (typeof exec.arguments !== 'object' || exec.arguments === null)
        return undefined;
    const args = exec.arguments;
    const paths = [args.path, args.file_path].filter((value) => typeof value === 'string' && value.trim() !== '');
    if (paths.length === 0)
        return undefined;
    return { tool: exec.name, paths, conflict: paths.some((path) => path !== paths[0]) };
}
/** Normalize a model path into a workspace-relative slash path, or refuse it. */
function workspaceRelativePath(workspace, path) {
    const normalized = path.replaceAll('\\', '/');
    // A drive-relative target (D:foo) resolves against that drive's current
    // directory and a UNC or extended-length prefix names another namespace;
    // neither can be compared safely with the workspace prefixes, so refuse them.
    if (/^[A-Za-z]:(?!\/)/u.test(normalized) || normalized.startsWith('//'))
        return undefined;
    // On Windows a colon also qualifies an NTFS directory stream; `.dsh::$INDEX_ALLOCATION`
    // names the same directory, so only a leading drive designator may keep one.
    // A component ending in a dot or space is stripped by Win32 and aliases the
    // real name; an 8.3 short name (DSH~1) aliases it too, so both are refused.
    if (process.platform === 'win32') {
        const rest = normalized.replace(/^[A-Za-z]:\//u, '');
        if (rest.includes(':') ||
            rest
                .split('/')
                .some((part) => part !== '' &&
                part !== '.' &&
                part !== '..' &&
                (part.endsWith('.') || part.endsWith(' ') || /~\d/u.test(part)))) {
            return undefined;
        }
    }
    const absolute = isAbsolute(normalized) || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized);
    if (absolute) {
        // An absolute target inside the workspace is the same file as its relative
        // form; one outside is not this guard's store.
        const root = resolve(workspace);
        const relativePath = relative(root, resolve(root, normalized)).replaceAll('\\', '/');
        if (relativePath === '' || relativePath === '..' || relativePath.startsWith('../')) {
            return relativePath === '' ? '' : normalized;
        }
        return relativePath;
    }
    const parts = [];
    for (const segment of normalized.split('/')) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..') {
            if (parts.length === 0)
                return undefined;
            parts.pop();
            continue;
        }
        parts.push(segment);
    }
    return parts.join('/');
}
/** The path comparison follows the filesystem's case semantics. */
function foldPath(value) {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}
function isProtectedWritePath(relative) {
    const folded = foldPath(relative);
    return PROTECTED_WRITE_PREFIXES.some((prefix) => {
        const expected = foldPath(prefix);
        return folded === expected || folded.startsWith(expected);
    });
}
/**
 * The pre-execute authorization write guard. A model-originated write to a
 * definition, the approval store, a receipt, or a run file is refused; an
 * owned host call is allowed. Returns undefined when the call is untouched.
 */
export function authorizationWriteDecision(input) {
    const intent = recognizeFileWrite(input.exec);
    if (intent === undefined)
        return undefined;
    if (input.callId !== undefined && input.ownedCallIds.has(input.callId)) {
        return { kind: 'allow' };
    }
    if (intent.conflict) {
        return {
            kind: 'deny',
            reason: 'the write call names conflicting "path" and "file_path" targets; nothing was written',
        };
    }
    const relative = workspaceRelativePath(input.workspace, intent.paths[0] ?? '');
    if (relative === undefined) {
        return {
            kind: 'deny',
            reason: `the write target "${intent.paths[0] ?? ''}" escapes the workspace; nothing was written`,
        };
    }
    if (!isProtectedWritePath(relative))
        return undefined;
    return {
        kind: 'deny',
        reason: `the model cannot write "${relative}"; definitions are installed with /workflows install <path>, and approvals and receipts are written only by the host`,
    };
}
function openRequiredStep(run) {
    const step = run.steps.find((entry) => entry.state === 'open' || entry.state === 'blocked' || entry.state === 'failed');
    return step === undefined ? undefined : { step: step.id };
}
/**
 * The archive gate. It refuses while a related run has an open required step,
 * no authenticated completed intake run and no verified receipt exist, or the
 * current whole-spec PASS record is missing or stale. A text claim is never an
 * input; only the authenticated run, receipt, and record can allow.
 */
export function evaluateArchiveGate(input) {
    if (input.tamperedRuns === true) {
        return {
            kind: 'deny',
            reason: `the archive of "${input.change}" is refused: a workflow run file failed authentication; fix or remove it before archiving`,
        };
    }
    const related = input.runs.filter((run) => run.status !== 'cancelled' && intakeName(run) === input.change);
    const blocked = related
        .map((run) => ({ run, open: openRequiredStep(run) }))
        .find((entry) => entry.open !== undefined);
    if (blocked !== undefined && blocked.open !== undefined) {
        const coverage = input.taskReview !== undefined && !input.taskReview.ok
            ? `; ${input.taskReview.text ?? 'a checked task has no portable task-review PASS'}`
            : '';
        return {
            kind: 'deny',
            reason: `the archive of "${input.change}" is refused: run "${blocked.run.id}" step "${blocked.open.step}" is open and has no verified evidence${coverage}`,
        };
    }
    const completed = related.find((run) => isCompletedIntake(run, input.change));
    const receipt = input.receipts.find((entry) => entry.change === input.change);
    if (completed === undefined && receipt === undefined) {
        return {
            kind: 'deny',
            reason: `the archive of "${input.change}" is refused: no authenticated completed change-intake run and no authenticated receipt exists; complete the intake or run /workflows adopt ${input.change}`,
        };
    }
    if (!input.specRecord.ok) {
        return {
            kind: 'deny',
            reason: `the archive of "${input.change}" is refused: the current whole-spec PASS record is ${input.specRecord.failure.reason === 'missing-file' ? 'missing' : 'stale or invalid'} (${input.specRecord.failure.detail.slice(0, 200)})`,
        };
    }
    if (input.taskReview !== undefined && !input.taskReview.ok) {
        const relatedRun = related.find((run) => run.definition === 'task-review');
        return {
            kind: 'deny',
            reason: `the archive of "${input.change}" is refused: ${input.taskReview.text ?? 'a checked task has no portable task-review PASS'}${relatedRun === undefined ? '' : ` (related review run "${relatedRun.id}")`}`,
        };
    }
    return {
        kind: 'allow',
        reason: `the archive of "${input.change}" is allowed: the authenticated intake ${completed === undefined ? 'receipt' : 'run'} and the current whole-spec PASS record are present`,
    };
}
