import type { Definition, Step } from './definitions.js';
import { type EvidenceContext } from './evidence.js';
import type { HumanQuestionService } from './executors.js';
import type { HostAuth } from './host-auth.js';
import { type NoteInput, type ProgressStatus } from './notes.js';
import { type WorkflowRun } from './runs.js';
/**
 * The model-facing `workflows` tool. It is a bounded control surface: list,
 * start an allowed definition, resume, status, host-verified evidence, cancel,
 * a progress note, and a user-confirmed adoption of an existing change. It never
 * accepts a script, a definition body, an install, a receipt write outside the
 * adoption path, or a text claim.
 */
export declare const WORKFLOWS_TOOL_ACTIONS: readonly ["list", "start", "resume", "status", "evidence", "cancel", "adopt", "note"];
export type WorkflowsToolAction = (typeof WORKFLOWS_TOOL_ACTIONS)[number];
export interface WorkflowsToolRequest {
    readonly action: WorkflowsToolAction;
    readonly definitionId?: string;
    readonly runId?: string;
    readonly stepId?: string;
    /** The existing change whose adoption the user must confirm, or the note's change. */
    readonly change?: string;
    /** The host resolves and verifies the declared evidence; text is never it. */
    readonly evidence?: {
        readonly kind: string;
        readonly ref: string;
    };
    /** The note action's task text or stable task id, or a review start's selector. */
    readonly task?: string;
    /** A task-scoped review start's section selector (the tasks.md level-2 key). */
    readonly section?: string;
    readonly status?: ProgressStatus;
    readonly reason?: string;
}
export interface WorkflowsToolHost {
    readonly workspace: string;
    readonly session: string;
    readonly definitions: readonly Definition[];
    readonly auth: HostAuth;
    readonly questions?: HumanQuestionService;
    readonly maxRuns?: number;
    readonly now?: () => number;
    /** Whether a session still has a live agent; absent means "treat it as live". */
    readonly sessionLive?: (session: string) => boolean;
    /** The host-owned starter; it persists the run before returning. */
    startRun(definition: Definition, at: number, selection?: {
        readonly change?: string;
        readonly task?: string;
        readonly section?: string;
    }): Promise<{
        readonly run: WorkflowRun;
        readonly firstStep: string;
    }>;
    resumeRun(runId: string, at: number): Promise<{
        readonly run: WorkflowRun;
        readonly stepId: string;
    }>;
    cancelRun(runId: string, at: number): Promise<WorkflowRun>;
    /** Every authenticated run in the workspace. */
    listRuns(): Promise<readonly WorkflowRun[]>;
    /** One authenticated run in the workspace, or undefined. */
    readRun(runId: string): Promise<WorkflowRun | undefined>;
    /** Trusted session observations the evidence verifier may consume. */
    evidenceContext?(run: WorkflowRun, step: Step): Partial<EvidenceContext>;
    /** Write the owned progress note; absent means this host cannot record one. */
    note?(input: NoteInput): Promise<string>;
}
/** Parse and validate the tool arguments; an unknown field is refused. */
export declare function parseWorkflowsToolArgs(value: unknown): WorkflowsToolRequest;
/** Execute one tool action. */
export declare function executeWorkflowsTool(value: unknown, host: WorkflowsToolHost): Promise<string>;
