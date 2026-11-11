import type { HumanQuestionService } from './executors.js';
import type { HostAuth } from './host-auth.js';
import { type WorkflowReceipt } from './receipts.js';
/**
 * Adoption of a change that predates the workflow engine. The user-started
 * `/workflows adopt <name>` command and the model-facing `workflows` tool action
 * `adopt` both reach this module: it verifies the existing artifacts and the
 * current whole-spec PASS record, asks the user through the host question
 * service, and writes the host-authenticated receipt without recreating the
 * directory and without calling `openspec new change`. The interactive user
 * answer is the authorization; the model cannot supply it.
 */
export interface AdoptionInput {
    readonly workspace: string;
    readonly change: string;
    readonly auth: HostAuth;
    readonly questions?: HumanQuestionService;
    readonly now?: number;
}
export type AdoptionResult = {
    readonly ok: true;
    readonly receipt: WorkflowReceipt;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Verify the four change artifacts and the current whole-spec `PASS` record.
 * Returns the verified spec digest when the change is adoptable.
 */
export declare function verifyAdoptionEvidence(workspace: string, change: string): Promise<{
    readonly ok: true;
    readonly digest: string;
} | {
    readonly ok: false;
    readonly reason: string;
}>;
/**
 * Adopt one existing change. The receipt is written only after the artifacts
 * and the current PASS record verify and the user answers yes.
 */
export declare function adoptChange(input: AdoptionInput): Promise<AdoptionResult>;
