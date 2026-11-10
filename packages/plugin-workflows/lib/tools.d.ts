import type { Definition, Step } from './definitions.js';
import { type EvidenceContext } from './evidence.js';
import type { HumanQuestionService } from './executors.js';
import type { HostAuth } from './host-auth.js';
import { type WorkflowRun } from './runs.js';
/**
 * The model-facing `workflows` tool. It is a bounded control surface: list,
 * start an allowed definition, resume, status, host-verified evidence, cancel.
 * It never accepts a script, a definition body, an install, an adoption, a
 * receipt write, or a text claim.
 */
export declare const WORKFLOWS_TOOL_ACTIONS: readonly ["list", "start", "resume", "status", "evidence", "cancel"];
export type WorkflowsToolAction = (typeof WORKFLOWS_TOOL_ACTIONS)[number];
export interface WorkflowsToolRequest {
    readonly action: WorkflowsToolAction;
    readonly definitionId?: string;
    readonly runId?: string;
    readonly stepId?: string;
    /** The host resolves and verifies the declared evidence; text is never it. */
    readonly evidence?: {
        readonly kind: string;
        readonly ref: string;
    };
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
    startRun(definition: Definition, at: number): Promise<{
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
}
/** Parse and validate the tool arguments; an unknown field is refused. */
export declare function parseWorkflowsToolArgs(value: unknown): WorkflowsToolRequest;
/** Execute one tool action. */
export declare function executeWorkflowsTool(value: unknown, host: WorkflowsToolHost): Promise<string>;
