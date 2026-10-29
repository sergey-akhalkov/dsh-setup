import { type TransferClientOptions } from './export-client.js';
import { type ResolvedExportConfig } from './export-config.js';
/** What one cycle did; every failure is reported, never thrown out of the cycle. */
export interface ExportCycleResult {
    outcome: 'disabled' | 'forbidden' | 'locked' | 'unchanged' | 'committed' | 'local' | 'failed';
    banks: number;
    changed: boolean;
    committed: boolean;
    pushed: boolean;
    /** Why a non-committed outcome happened, for the one-line report. */
    reason?: string;
}
export interface ExportCycleOptions {
    config: ResolvedExportConfig;
    /** Resolved Hindsight endpoint. */
    apiUrl: string;
    /** Report sink; the default is console.error, matching the other Host plugins. */
    log?: (message: string) => void;
    now?: () => Date;
    client?: Partial<TransferClientOptions>;
    git?: {
        timeoutMs?: number;
        env?: NodeJS.ProcessEnv;
    };
}
/**
 * One full export cycle: list banks, export each through the transfer API,
 * write the snapshot, commit it when the content changed, and push when a
 * remote is configured. Only the configured directory is touched, and every
 * failure is reported and retried by the next cycle.
 */
export declare function runExportCycle(options: ExportCycleOptions): Promise<ExportCycleResult>;
