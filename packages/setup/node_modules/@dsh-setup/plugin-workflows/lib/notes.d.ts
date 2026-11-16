import { type GitRunner } from './git.js';
/**
 * The engine-owned work-progress note, written by the `note` action to
 * `.dsh/workflows/notes/<change>.json`. The note is the only evidence that
 * lets a code-changing turn close with its task still unchecked: it is bound to
 * the worktree digest it was written against, so a later write makes it stale.
 * A serial note also names its lane, so the engine lane gate reads the active
 * note path and treats that one lane as the serial decision.
 */
/** Where each owner keeps its progress note. */
export declare const NOTES_DIR = ".dsh/workflows/notes";
export declare const LEGACY_NOTES_DIR = ".dsh/delegation/task-progress";
export type NoteOwner = 'workflows' | 'legacy';
export type ProgressStatus = 'in-progress' | 'blocked';
export declare const PROGRESS_STATUSES: readonly ProgressStatus[];
export interface ProgressNote {
    readonly taskId: string;
    readonly status: ProgressStatus;
    readonly reason: string;
    readonly worktreeDigest: string;
    readonly time: string;
    /** The lane the note decided serial; absent on a legacy note or outside a lane. */
    readonly lane?: string;
}
export interface NoteInput {
    readonly change: string;
    readonly task: string;
    readonly status: ProgressStatus;
    readonly reason?: string;
}
/** The workspace-relative note path of one owner. */
export declare function notePathFor(owner: NoteOwner, change: string): string;
/** Parse one note; a malformed document is undefined, never a partial note. */
export declare function parseProgressNote(value: unknown): ProgressNote | undefined;
/** The active owner's note for a change, or undefined when absent or malformed. */
export declare function readProgressNote(workspace: string, change: string, owner: NoteOwner): Promise<ProgressNote | undefined>;
export interface WrittenNote {
    readonly text: string;
    readonly note: ProgressNote;
    /** The lane title the note decided serial, when it named a lane. */
    readonly lane?: string;
}
/**
 * Write one owner's progress note. The worktree digest is captured now, so the
 * note authorizes only the worktree it was written against. An unreadable
 * tasks.md or an uncomputable digest refuses the note instead of writing
 * evidence the gates could never accept.
 */
export declare function writeProgressNote(workspace: string, input: NoteInput, options?: {
    readonly owner?: NoteOwner;
    readonly runGit?: GitRunner;
    readonly now?: number;
}): Promise<WrittenNote>;
