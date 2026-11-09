import { link, rename, unlink } from 'node:fs/promises';
import { type Definition } from './definitions.js';
import type { HostAuth } from './host-auth.js';
/**
 * The host approval store. A local definition or override is active only when
 * its content hash matches a record signed by the host key; a model-written
 * file, an unsigned approval, or a file changed after approval is refused.
 */
export declare const APPROVALS_FILE = "approved.json";
export declare const APPROVAL_VERSION = 1;
/** One persisted approval. */
export interface StoredApproval {
    readonly hash: string;
    readonly signature: string;
}
/** The approved.json shape. */
export interface ApprovalStore {
    readonly v: typeof APPROVAL_VERSION;
    readonly approvals: Readonly<Record<string, StoredApproval>>;
}
/** The approval store path for one workspace. */
export declare function approvalsPath(workspace: string): string;
/** Write a file atomically: temp in the same directory, then rename. */
export declare function writeAtomic(file: string, bytes: string | Buffer): Promise<void>;
/** Verify one approval record against its id and hash. */
export declare function verifyApproval(auth: HostAuth | undefined, id: string, hash: string, record: StoredApproval | undefined): boolean;
export interface ApprovalRead {
    readonly approvals: ReadonlyMap<string, StoredApproval>;
    readonly error?: string;
}
/**
 * Read the approval store. A missing file is an empty store; an unreadable or
 * malformed one reports an error and approves nothing.
 */
export declare function readApprovals(workspace: string): Promise<ApprovalRead>;
export interface InstallResult {
    readonly definition: Definition;
    readonly file: string;
    readonly hash: string;
}
export interface InstallOptions {
    /** Test seam: the approval-store writer; production writes the real store. */
    readonly writeApprovals?: (workspace: string, approvals: ReadonlyMap<string, StoredApproval>) => Promise<void>;
    /** Test seam: the backup-link primitive; production hard-links. */
    readonly link?: typeof link;
    /** Test seam: the restore primitive; production renames. */
    readonly rename?: typeof rename;
    /** Test seam: the cleanup primitive; production unlinks. */
    readonly unlink?: typeof unlink;
    /**
     * The revision precondition, checked inside the install transaction: null
     * creates only, a hash replaces only the loaded bytes.
     */
    readonly expectedHash?: string | null;
}
/** A revision precondition failed inside the install transaction. */
export declare class InstallConflictError extends Error {
    readonly revision: string | null;
    constructor(message: string, revision: string | null);
}
/** Run one filesystem transaction under the workspace install lock. */
export declare function runInstallTransaction<T>(workspace: string, run: () => Promise<T>): Promise<T>;
/**
 * Validate a definition file, copy it atomically into the workspace definitions
 * directory, and record its content hash and host signature. The caller asks
 * the user first; this function is the host-only install path and the one the
 * editor save uses. Installs of one workspace are serialized because they share
 * the approval file.
 */
export declare function installDefinition(workspace: string, sourcePath: string, auth: HostAuth, options?: InstallOptions): Promise<InstallResult>;
export interface ApprovedDefinitions {
    readonly definitions: readonly Definition[];
    /** One bounded line per refused local file; never file content. */
    readonly errors: readonly string[];
}
/**
 * Load the shipped definitions plus the approved local ones. A local file is
 * considered only when its id has a valid host approval for its exact content
 * hash; an approved local id overrides the shipped definition. The drafts
 * directory is never read.
 */
export declare function loadApprovedDefinitions(workspace: string, options: {
    /** Absent when no local definition exists; shipped definitions need no key. */
    readonly auth?: HostAuth;
    readonly shipped?: readonly Definition[];
    /** The legacy sources the profile installs; absent skips ownership checks. */
    readonly installedLegacy?: ReadonlySet<string>;
    /** The legacy signals that would actually steer; absent means installed = enabled. */
    readonly enabledLegacy?: ReadonlySet<string>;
}): Promise<ApprovedDefinitions>;
/** Read one local installed definition regardless of approval; test/debug seam. */
export declare function readLocalDefinition(workspace: string, id: string): Promise<Definition>;
