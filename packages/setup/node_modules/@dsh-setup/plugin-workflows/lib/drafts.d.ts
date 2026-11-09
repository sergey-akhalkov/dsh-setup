import { rename } from 'node:fs/promises';
/**
 * Intake drafts. A draft lives under `.dsh/workflows/drafts/<name>/` until the
 * `create-change` step runs; no `openspec/changes/<name>/` directory may appear
 * before it. Names and artifact paths are validated, writes are atomic, and a
 * link cannot move the target outside the workspace.
 */
export declare const DRAFTS_ROOT = ".dsh/workflows/drafts";
/** The workspace-relative draft directory for one change name. */
export declare function draftDirectory(name: string): string;
/** The workspace-relative draft file path; the artifact must stay beneath it. */
export declare function draftPath(name: string, artifact: string): string;
export interface DraftWrite {
    readonly path: string;
    readonly bytes: number;
}
/** A test seam for the atomic replacement. */
export interface DraftWriteOptions {
    readonly rename?: typeof rename;
}
/** Write one draft artifact atomically and never create the change directory. */
export declare function writeDraft(workspace: string, name: string, artifact: string, content: string, options?: DraftWriteOptions): Promise<DraftWrite>;
/** Read one draft artifact; undefined when it is missing or escapes the workspace. */
export declare function readDraft(workspace: string, name: string, artifact: string): Promise<string | undefined>;
/** The draft existence probe used by the intake steer and tests. */
export declare function draftExists(workspace: string, name: string, artifact: string): Promise<boolean>;
