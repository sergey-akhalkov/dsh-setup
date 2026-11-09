import { type Definition, type Step } from './definitions.js';
import { type EvidenceCheck, type EvidenceContext } from './evidence.js';
import { type HumanQuestionService, type OwnedCalls, type SubagentRunner, type ToolRunner } from './executors.js';
import type { HostAuth } from './host-auth.js';
import { type WorkflowRun } from './runs.js';
/**
 * The intake runner. It walks the declared steps in order, completes a main
 * step only through the evidence verifier, completes `create-change` only from
 * its owned tool call plus `.openspec.yaml`, reads the deferred `spec-review`
 * record without dispatching `delegate`, and asks the user only at `approval`.
 */
export interface IntakeAdvanceInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly values: Readonly<Record<string, unknown>>;
    readonly evidenceContext: EvidenceContext;
    readonly owned: OwnedCalls;
    readonly toolRunner?: ToolRunner;
    readonly subagentRunner?: SubagentRunner;
    readonly questions?: HumanQuestionService;
    /** The deferred-step record reader; it must not call delegate. */
    readonly readRecord?: (step: Step) => Promise<EvidenceCheck>;
    readonly installedLegacy: ReadonlySet<string>;
    /** When present, a completed intake writes its host-authenticated receipt. */
    readonly auth?: HostAuth;
    readonly now?: number;
    readonly signal?: AbortSignal;
}
export interface IntakeWaiting {
    readonly stepId: string;
    readonly title: string;
    readonly contract: string;
    readonly paths: readonly string[];
}
export interface IntakeAdvanceResult {
    readonly run: WorkflowRun;
    readonly completed: boolean;
    readonly waiting?: IntakeWaiting;
    /** A completion receipt could not be issued; the run is still completed. */
    readonly receiptError?: string;
}
/**
 * Advance the intake as far as the currently verified evidence allows. It never
 * marks a step done from text; a missing artifact or a non-zero check stops the
 * walk with the step open and names the contract and paths.
 */
export declare function advanceIntake(input: IntakeAdvanceInput): Promise<IntakeAdvanceResult>;
