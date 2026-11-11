import type { Definition } from './definitions.js';
import { type ArchiveGateDecision } from './gates.js';
import type { HostAuth } from './host-auth.js';
/**
 * The one archive decision for the agent pre-execute gate. The user-clicked
 * service does not call it: the click is the final authorization.
 */
export interface ArchiveEvidenceDeps {
    /** The host key; absent means no authenticated run or receipt can count. */
    readonly auth?: HostAuth;
    /** The installed definitions, for the shipped task-review ownership. */
    readonly definitions: readonly Definition[];
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
 * The click is the final authorization: verify the change artifacts and the
 * current whole-spec PASS, then write the host-signed adoption receipt for the
 * click. The agent command path still applies the full archive gate, but a stuck
 * review run or a pending task approval can no longer block the user's explicit
 * click.
 */
export declare function authorizeUserArchive(workspace: string, change: string, auth: HostAuth, now?: number): Promise<ArchiveAuthorizationResult>;
