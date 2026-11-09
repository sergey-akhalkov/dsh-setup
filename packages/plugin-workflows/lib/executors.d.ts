import { type Definition, type Step } from './definitions.js';
import { type EvidenceCheck, type EvidenceContext } from './evidence.js';
import { type WorkflowRun } from './runs.js';
import { type SteerTarget } from './steer.js';
/**
 * The `main` executor. It steers the root agent and never completes a step
 * itself: only a passing evidence check settles the step, so a model's text
 * claim cannot close it. A re-request happens only on a later turn stop and is
 * bounded by the step's attempt cap.
 */
export declare const DEFAULT_MAIN_ATTEMPTS = 3;
/** The largest human question the host will ask. */
export declare const MAX_HUMAN_PROMPT = 2000;
/** How long a human question may stay open before the declared action applies. */
export declare const HUMAN_QUESTION_TIMEOUT_MS: number;
/** The DSH `userQuestions` contract: one batch of questions in, one batch of answers out. */
export interface DshUserQuestions {
    ask(request: {
        readonly questions: Array<{
            readonly id: string;
            readonly question: string;
            readonly options?: Array<{
                readonly label: string;
            }>;
            readonly multiSelect?: boolean;
        }>;
        /** The live owner agent; without it no answerer accepts a human question. */
        readonly agent?: unknown;
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly answers: Array<{
            readonly id: string;
            readonly selected?: readonly string[];
            readonly custom?: string;
        }>;
    }>;
}
/**
 * Adapt the DSH question service to the single-question confirm shape the
 * executors use. A stable id echoes the answer; timeout and cancellation map to
 * the declared action. The live agent is the answerer scope, so it is passed on
 * every ask.
 */
export declare function adaptUserQuestions(raw: DshUserQuestions, agent: unknown, timeoutMs?: number): HumanQuestionService;
export interface MainStepRequest {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly agent: SteerTarget;
    readonly evidenceContext: EvidenceContext;
    readonly turn: number;
    readonly maxAttempts?: number;
    readonly now?: number;
    /** A host-computed refusal detail prepended to the step steer. */
    readonly note?: string;
}
export type MainStepResult = {
    readonly steered: true;
    readonly run: WorkflowRun;
    readonly text: string;
} | {
    readonly steered: false;
    readonly run: WorkflowRun;
    readonly reason: string;
};
/**
 * Request one main step for this turn stop. The same turn never steers twice;
 * the attempt cap ends the re-requests with a visible reason.
 */
export declare function requestMainStep(input: MainStepRequest): MainStepResult;
/**
 * Apply the verifier's result to a main step. A failed check leaves the step
 * exactly as it was; only a passing check settles it as done.
 */
export declare function settleMainStep(run: WorkflowRun, stepId: string, check: EvidenceCheck, now?: number): WorkflowRun;
export interface JsonLogicData {
    readonly context: Readonly<Record<string, unknown>>;
    readonly steps: WorkflowRun['steps'];
    readonly evidence: unknown;
    readonly trigger: WorkflowRun['trigger'];
    readonly iteration?: number;
    readonly item?: unknown;
}
/**
 * A bounded JSONLogic evaluator over plain data. It is data, not code: only a
 * small operator set is accepted, an unknown operator or malformed rule throws,
 * and the recursion depth is capped.
 */
/** Validate the whole rule tree, operand counts included, before any evaluation. */
export declare function validateJsonLogic(rule: unknown, depth?: number): void;
export declare function evaluateJsonLogic(rule: unknown, data: unknown, depth?: number): unknown;
export interface BranchStepInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly values: Readonly<Record<string, unknown>>;
    readonly now?: number;
}
export interface BranchStepResult {
    readonly run: WorkflowRun;
    readonly next?: string;
}
/** Evaluate a branch predicate and settle the step with the chosen edge. */
export declare function runBranchStep(input: BranchStepInput): BranchStepResult;
export interface LoopStepInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly values: Readonly<Record<string, unknown>>;
    readonly now?: number;
}
export interface LoopStepResult {
    readonly run: WorkflowRun;
    readonly next?: string;
}
/** Iterate until the stop predicate holds or the declared cap is reached. */
export declare function runLoopStep(input: LoopStepInput): LoopStepResult;
export interface HumanAskResult {
    readonly answer?: string;
    readonly timedOut?: boolean;
    readonly cancelled?: boolean;
}
export interface HumanQuestionService {
    ask(request: {
        readonly question: string;
        readonly accepted: readonly string[];
        readonly timeoutAction: 'block' | 'cancel';
    }): Promise<HumanAskResult>;
}
export interface HumanStepInput {
    readonly run: WorkflowRun;
    readonly step: Step;
    readonly questions: HumanQuestionService;
    readonly evidenceContext: EvidenceContext;
    readonly now?: number;
}
/** Ask the user; only the declared answer completes the step. */
export declare function runHumanStep(input: HumanStepInput): Promise<WorkflowRun>;
/** The host-owned call ids one run may dispatch; a model call is never owned. */
export declare class OwnedCalls {
    private readonly ids;
    add(callId: string): void;
    has(callId: string): boolean;
    list(): string[];
}
export interface ToolDispatchRequest {
    readonly callId: string;
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
}
export interface ToolDispatchResult {
    readonly ok: boolean;
    readonly error?: string;
}
export interface ToolRunner {
    call(request: ToolDispatchRequest, signal?: AbortSignal): Promise<ToolDispatchResult>;
}
export interface ToolStepInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly runner: ToolRunner;
    readonly owned: OwnedCalls;
    readonly evidenceContext: EvidenceContext;
    readonly now?: number;
    readonly signal?: AbortSignal;
}
/** The bounded host-generated call id; the owned set is registered before dispatch. */
export declare function newOwnedCallId(run: WorkflowRun, step: Step): string;
/**
 * Run one tool step: allowlist, validated interpolation, an owned call id
 * registered before dispatch, and a step settled only by the dispatch result.
 */
export declare function runToolStep(input: ToolStepInput): Promise<WorkflowRun>;
/** A bounded subset of JSON Schema used to validate a child's result. */
export type ResultSchema = Readonly<Record<string, unknown>>;
export interface SubagentRunResult {
    readonly childId: string;
    readonly completed: boolean;
    readonly result?: unknown;
    readonly error?: string;
}
export interface SubagentRunner {
    run(request: {
        readonly provider: string;
        readonly prompt: string;
        readonly schema?: ResultSchema;
        readonly model?: string;
        readonly reasoningEffort?: string;
    }, signal?: AbortSignal): Promise<SubagentRunResult>;
}
export interface SubagentStepInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly runner: SubagentRunner;
    readonly evidenceContext: EvidenceContext;
    readonly now?: number;
    readonly signal?: AbortSignal;
}
export declare function validateResultSchema(schema: ResultSchema, value: unknown, depth?: number): string | undefined;
/**
 * Run one subagent step: build the prompt, start exactly one child, validate
 * its result, and settle the step. A non-completion or schema mismatch marks
 * the step failed; there is no fallback to the main executor.
 */
export declare function runSubagentStep(input: SubagentStepInput): Promise<WorkflowRun>;
