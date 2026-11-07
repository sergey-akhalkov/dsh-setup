/**
 * Workspace listener health, written beside the journal. The view needs three
 * states that otherwise look like silence: no event yet, a trigger that did not
 * match, and a listener that is down; a read-only journal is a fourth.
 */
/** The periodic journal-writability self-check interval. */
export declare const SELF_CHECK_MS = 60000;
/** A heartbeat older than this while a session is running means the listener is down. */
export declare const HEALTH_STALE_MS: number;
/** The main event observers plus the per-workspace change source. */
export declare const REQUIRED_LISTENERS = 5;
/** The bounded health file shape. */
export interface HealthFile {
    readonly listenerCount: number;
    readonly lastEventAt?: number;
    readonly lastCheckAt?: number;
    readonly journalWritable: boolean;
    readonly triggerCount: number;
    readonly lastErrorAt?: number;
    readonly lastError?: string;
}
export type HealthState = 'listener-down' | 'journal-readonly' | 'waiting' | 'healthy';
/** Everything one workspace's health writer needs. */
export interface HealthOptions {
    /** The workspace's `.dsh/workflows` directory. */
    readonly root: string;
    readonly triggerCount: number;
    readonly now?: () => number;
    readonly intervalMs?: number;
    readonly schedule?: (callback: () => void, intervalMs: number) => {
        dispose(): void;
    };
    /** Test seam: prove the journal directory is writable. */
    readonly probe?: () => Promise<boolean>;
    /** Test seam: publish the health text. */
    readonly write?: (file: string, text: string) => Promise<void>;
}
/** The health file path for one workspace. */
export declare function healthPath(root: string): string;
/**
 * One workspace's health writer. Writes are serialized; a failed write never
 * throws into an event listener, and the self-check never rejects.
 */
export declare class WorkflowHealth {
    private state;
    private readonly path;
    private readonly now;
    private readonly intervalMs;
    private readonly schedule;
    private readonly probe;
    private readonly write;
    private timer;
    private chain;
    constructor(options: HealthOptions);
    /** Write the initial state and arm the 60-second self-check. */
    start(): Promise<void>;
    /** Record one observed event and publish the new last-event time. */
    markEvent(at: number): void;
    /** Publish the number of successfully registered listeners. */
    setListenerCount(count: number): void;
    /** Record a contained listener failure. */
    recordError(error: unknown): void;
    /** Flip journal writability without throwing. */
    setJournalWritable(writable: boolean): void;
    /** Probe the journal directory and publish the result. Never rejects. */
    selfCheck(): Promise<void>;
    /** The state the view renders; a missing listener or stale heartbeat is down. */
    stateFor(hasMatchedEvent: boolean, sessionRunning: boolean): HealthState;
    /** A copy of the published fields. */
    snapshot(): HealthFile;
    /** Await every queued write; tests use this before reading the file. */
    flush(): Promise<void>;
    /** Stop the self-check. A pending write still settles. */
    dispose(): void;
    private persist;
}
