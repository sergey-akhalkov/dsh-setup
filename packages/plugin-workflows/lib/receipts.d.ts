import type { HostAuth } from './host-auth.js';
/**
 * Host-authenticated completion and adoption receipts. A receipt is the durable
 * authorization that survives run-history pruning; it is signed with the host
 * key outside the workspace, so a model-written receipt is refused even after a
 * reload and even when the run it names is gone.
 */
export declare const RECEIPT_VERSION = 1;
export type ReceiptKind = 'intake' | 'adoption';
/** The signed receipt body; the signature is the only extra file field. */
export interface ReceiptBody {
    readonly v: typeof RECEIPT_VERSION;
    readonly kind: ReceiptKind;
    readonly change: string;
    readonly digest: string;
    readonly issuedAt: number;
    /** The workspace that issued this receipt; a copied receipt authorizes nothing. */
    readonly workspaceKey: string;
}
export interface WorkflowReceipt extends ReceiptBody {
    readonly signature: string;
}
/** The receipts directory for one workspace. */
export declare function receiptsDirectory(workspace: string): string;
/** The receipt file for one change name. */
export declare function receiptPath(workspace: string, change: string): string;
/** Write one signed receipt atomically; the caller has already verified. */
export declare function writeReceipt(workspace: string, input: {
    readonly kind: ReceiptKind;
    readonly change: string;
    readonly digest: string;
    readonly auth: HostAuth;
    readonly now?: number;
}): Promise<WorkflowReceipt>;
/**
 * Read and verify one receipt. A missing, unsigned, forged, or modified file
 * reads as absent, so the archive gate stays refused.
 */
export declare function readReceipt(workspace: string, change: string, auth: HostAuth): Promise<WorkflowReceipt | undefined>;
/** Every verified receipt in one workspace, newest first. */
export declare function listReceipts(workspace: string, auth: HostAuth): Promise<WorkflowReceipt[]>;
/**
 * Issue the completion receipt for a completed `change-intake` run. The run is
 * re-read and authenticated first: a forged, unsigned, or modified run, or one
 * that did not complete, issues nothing.
 */
export declare function issueCompletionReceipt(workspace: string, runId: string, digest: string, auth: HostAuth, now?: number): Promise<WorkflowReceipt>;
/** Issue the adoption receipt after the host verified the existing artifacts. */
export declare function issueAdoptionReceipt(workspace: string, change: string, digest: string, auth: HostAuth, now?: number): Promise<WorkflowReceipt>;
/** A bounded one-line receipt failure for a caller's message. */
export declare function receiptFailure(error: unknown): string;
