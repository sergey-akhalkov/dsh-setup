/**
 * Workspace file source for `openspec/changes/**`. The filesystem service owns
 * the watch itself (directory watches see direct entries only), so this module
 * watches the tree's directories and re-scans the files it cares about after a
 * per-path debounce; a watcher error triggers a rescan so a dropped event stays
 * visible. Every read is canonically checked against the workspace root, so a
 * link cannot pull another workspace's files into this one.
 */
/** Debounce window applied to coalesced watcher notifications. */
export declare const FS_CHANGE_DEBOUNCE_MS = 250;
/** The workspace-relative root this source observes. */
export declare const CHANGES_ROOT = "openspec/changes";
/** One relative file change; `hash` is absent for a deletion. */
export interface FsChangeEvent {
    readonly path: string;
    readonly change: 'created' | 'modified' | 'deleted';
    readonly hash?: string;
}
/** The filesystem service's observation seam. */
export interface FsWatchService {
    resolve(path: string, options?: {
        cwd?: string;
    }): Promise<unknown>;
    watch(target: unknown, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>;
}
export interface FsChangeOptions {
    readonly workspace: string;
    readonly fs: FsWatchService;
    onChange(event: FsChangeEvent): void;
    onError(error: Error): void;
    /** Called after a watcher error made the source re-scan the tree. */
    onRescan?(reason: string): void;
    readonly debounceMs?: number;
}
export interface FsChangeWatcher {
    start(): Promise<void>;
    dispose(): Promise<void>;
}
interface SnapshotEntry {
    readonly sig: string;
    readonly hash: string;
}
/** Whether a canonical target stays inside a canonical root. */
export declare function isInside(root: string, target: string): boolean;
/** Read one file's identity; oversized files use size and mtime instead of bytes. */
export declare function fileEntry(file: string): Promise<SnapshotEntry | undefined>;
/**
 * Start one workspace's change-tree watcher. The initial scan is a silent
 * baseline; watches attach, then one rescan catches an edit made while they were
 * initializing. Later scans emit ordered create/modify/delete events after a
 * per-directory debounce window.
 */
export declare function startFsChangeWatcher(options: FsChangeOptions): Promise<FsChangeWatcher>;
export {};
