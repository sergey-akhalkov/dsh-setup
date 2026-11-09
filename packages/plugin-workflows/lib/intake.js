import { CHANGE_NAME } from './command-parse.js';
import { resolveOwnership } from './definitions.js';
import { collectEvidencePaths, describeEvidence, verifyEvidence, } from './evidence.js';
import { runHumanStep, runSubagentStep, runToolStep, } from './executors.js';
import { runDeferredStep } from './gates.js';
import { issueCompletionReceipt } from './receipts.js';
import { setRunStatus, settleStep, writeRun } from './runs.js';
/** The first step that is not done, with its state; failed steps stop the walk. */
function firstPending(run, definition) {
    for (const step of definition.steps) {
        const state = run.steps.find((entry) => entry.id === step.id)?.state;
        if (state !== 'done')
            return { step, state: state ?? 'missing' };
    }
    return undefined;
}
function waitingFor(step, context) {
    return {
        stepId: step.id,
        title: step.title,
        contract: step.evidence === undefined ? 'none' : describeEvidence(step.evidence, context),
        paths: step.evidence === undefined ? [] : collectEvidencePaths(step.evidence, context),
    };
}
/**
 * Advance the intake as far as the currently verified evidence allows. It never
 * marks a step done from text; a missing artifact or a non-zero check stops the
 * walk with the step open and names the contract and paths.
 */
export async function advanceIntake(input) {
    const at = input.now ?? Date.now();
    let run = input.run;
    const resolved = resolveOwnership(input.definition, input.installedLegacy, input.enabledLegacy);
    for (let guard = 0; guard < input.definition.steps.length + 1; guard += 1) {
        const pending = firstPending(run, input.definition);
        // Only a fully done definition completes; a failed or cancelled step stops
        // the walk instead of being skipped.
        if (pending === undefined) {
            const completedRun = run.status === 'completed' ? run : setRunStatus(run, 'completed', at);
            if (input.auth !== undefined && input.definition.id === 'change-intake') {
                const name = run.context.name;
                const digest = run.steps.find((entry) => entry.id === 'spec-review')?.evidence?.digest;
                if (typeof name === 'string' && CHANGE_NAME.test(name) && typeof digest === 'string') {
                    try {
                        if (completedRun !== run) {
                            await writeRun(input.evidenceContext.workspace, completedRun, input.auth);
                        }
                        await issueCompletionReceipt(input.evidenceContext.workspace, completedRun.id, digest, input.auth, at);
                        return { run: completedRun, completed: true };
                    }
                    catch (error) {
                        return {
                            run: completedRun,
                            completed: true,
                            receiptError: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
                        };
                    }
                }
            }
            return { run: completedRun, completed: true };
        }
        if (pending.state === 'failed' ||
            pending.state === 'cancelled' ||
            pending.state === 'missing') {
            return { run, completed: false };
        }
        const step = pending.step;
        const ownership = resolved.steps.find((entry) => entry.id === step.id)?.ownership ?? 'own';
        if (ownership === 'defer') {
            if (input.readRecord === undefined) {
                return {
                    run: setRunStatus(run, 'blocked', at),
                    completed: false,
                    waiting: waitingFor(step, input.evidenceContext),
                };
            }
            const deferred = await runDeferredStep({
                run,
                definition: input.definition,
                stepId: step.id,
                installedLegacy: input.installedLegacy,
                ...(input.enabledLegacy === undefined ? {} : { enabledLegacy: input.enabledLegacy }),
                readRecord: input.readRecord,
                now: at,
            });
            run = deferred.run;
            if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
                return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) };
            }
            continue;
        }
        if (step.executor === 'main') {
            const check = await verifyEvidence(step.evidence ?? { kind: 'declaration' }, input.evidenceContext);
            if (!check.ok)
                return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) };
            run = settleStep(run, step.id, 'done', { at, evidence: check.evidence });
            continue;
        }
        if (step.executor === 'tool') {
            const current = run.steps.find((entry) => entry.id === step.id);
            // A dispatch already happened when the step still carries its tool
            // evidence; the missing file is rechecked without dispatching again.
            const alreadyDispatched = current?.state === 'done' || current?.evidence?.kind === 'tool';
            if (!alreadyDispatched) {
                if (input.toolRunner === undefined) {
                    return {
                        run: setRunStatus(run, 'blocked', at),
                        completed: false,
                        waiting: waitingFor(step, input.evidenceContext),
                    };
                }
                run = await runToolStep({
                    run,
                    definition: input.definition,
                    step,
                    runner: input.toolRunner,
                    owned: input.owned,
                    evidenceContext: input.evidenceContext,
                    now: at,
                    ...(input.signal === undefined ? {} : { signal: input.signal }),
                });
                if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
                    return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) };
                }
            }
            const check = await verifyEvidence(step.evidence ?? { kind: 'declaration' }, input.evidenceContext);
            if (!check.ok) {
                // The owned call alone is not the contract: keep the step open with
                // its dispatch evidence so the next advance rechecks the missing file.
                const dispatched = run.steps.find((entry) => entry.id === step.id)?.evidence;
                return {
                    run: setRunStatus(dispatched === undefined
                        ? run
                        : settleStep(run, step.id, 'open', { at, evidence: dispatched }), 'blocked', at),
                    completed: false,
                    waiting: waitingFor(step, input.evidenceContext),
                };
            }
            run = settleStep(run, step.id, 'done', { at, evidence: check.evidence });
            continue;
        }
        if (step.executor === 'subagent') {
            if (input.subagentRunner === undefined) {
                return {
                    run: setRunStatus(run, 'blocked', at),
                    completed: false,
                    waiting: waitingFor(step, input.evidenceContext),
                };
            }
            run = await runSubagentStep({
                run,
                definition: input.definition,
                step,
                runner: input.subagentRunner,
                evidenceContext: input.evidenceContext,
                now: at,
                ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
            if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
                return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) };
            }
            continue;
        }
        if (step.executor === 'human') {
            if (input.questions === undefined) {
                return {
                    run: setRunStatus(run, 'blocked', at),
                    completed: false,
                    waiting: waitingFor(step, input.evidenceContext),
                };
            }
            run = await runHumanStep({
                run,
                step,
                questions: input.questions,
                evidenceContext: input.evidenceContext,
                now: at,
            });
            if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
                return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) };
            }
            continue;
        }
        return { run: setRunStatus(run, 'failed', at), completed: false };
    }
    return {
        run: setRunStatus(run, 'failed', at),
        completed: false,
    };
}
