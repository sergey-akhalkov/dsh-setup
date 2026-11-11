import type { Definition } from './definitions.js';
import { type ArchiveGateDecision } from './gates.js';
import type { HostAuth } from './host-auth.js';
/**
 * The one archive decision shared by the agent pre-execute gate and the
 * user-clicked archive service. Both paths must verify the same evidence or the
 * click would become an authorization bypass.
 */
/** The click path's portable task rule, or why the marker could not be read. */
export type ClickedTaskReview = {
    readonly rule: string;
} | {
    readonly invalid: string;
};
export interface ArchiveEvidenceDeps {
    /** The host key; absent means no authenticated run or receipt can count. */
    readonly auth?: HostAuth;
    /** The installed definitions, for the shipped task-review ownership. */
    readonly definitions: readonly Definition[];
    /**
     * The click path's portable-approval requirement while the legacy gate owns
     * task approvals; absent means the installed definition decides.
     */
    readonly clickedTaskReview?: ClickedTaskReview;
}
/** The archive gate's decision with the evidence already read. */
export declare function decideArchiveAuthorization(workspace: string, change: string, deps: ArchiveEvidenceDeps): Promise<ArchiveGateDecision>;
/** The host service a feature plugin reads as `workflowsArchiveGate`. */
export interface WorkflowsArchiveGateService {
    authorizeAndCheck(workspace: string, change: string): Promise<{
        readonly ok: true;
    } | {
        readonly ok: false;
        readonly reason: string;
    }>;
}
export type ArchiveAuthorizationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * The click is the authorization: verify the change artifacts and the current
 * whole-spec PASS, write the host-signed adoption receipt for the click, then
 * apply the same decision the agent archive path applies.
 */
export declare function authorizeUserArchive(workspace: string, change: string, auth: HostAuth, definitions: readonly Definition[], now?: number): Promise<ArchiveAuthorizationResult>;
