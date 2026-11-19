import type { Definition } from './definitions.js';
import { type WorkflowRun } from './runs.js';
/**
 * The restart cleanup: a fresh review round supersedes the interrupted runs of
 * its own unit. Recovery already marked them interrupted; this write settles
 * them cancelled with a bounded reason and publishes no review record. The
 * module takes its store and lock through deps so the capture-then-lock ordering
 * is testable without the host.
 */
/** The bounded reason a fresh round records when it supersedes a restart. */
export declare const RESTART_SUPERSEDE_REASON = "superseded by a fresh review round after a host restart";
export interface RestartSupersedeDeps {
    readonly definitions: readonly Definition[];
    readonly listRuns: () => Promise<readonly WorkflowRun[]>;
    readonly readRun: (runId: string) => Promise<WorkflowRun | undefined>;
    readonly withRunLock: <T>(runId: string, action: () => Promise<T>) => Promise<T>;
    readonly writeRun: (run: WorkflowRun) => Promise<void>;
    readonly now: () => number;
}
export interface RestartSupersedeInput {
    readonly change: string;
    readonly scope: 'whole' | 'task';
    readonly phase: string;
    readonly rule: string;
    readonly taskIds: readonly string[];
    readonly freshRunId: string;
}
export declare function supersedeInterruptedReviews(deps: RestartSupersedeDeps, input: RestartSupersedeInput): Promise<void>;
