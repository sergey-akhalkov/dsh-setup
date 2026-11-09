import type { Definition, Step } from './definitions.js';
import { type EvidenceContext } from './evidence.js';
import type { WorkflowRun } from './runs.js';
/**
 * The main-step steer. It names the step, the exact evidence contract, and the
 * workspace-relative path the verifier will check, using the same resolver, so
 * the model never has to guess where an artifact belongs.
 */
export declare const MAX_STEER_CHARS = 2000;
export interface MainSteerInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly evidenceContext: EvidenceContext;
}
/** Render the bounded steer for one open main step. */
export declare function renderMainSteer(input: MainSteerInput): string;
export interface SteerTarget {
    steer(message: string): void;
}
/** Steer the root agent with the rendered text and return exactly what it saw. */
export declare function steerMain(target: SteerTarget, input: MainSteerInput): string;
