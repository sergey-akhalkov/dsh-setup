import { type ExportCycleOptions, type ExportCycleResult } from './export-cycle.js';
export interface SchedulerOptions extends ExportCycleOptions {
    /** An idle session starts at most one cycle per window (default one minute). */
    idleDebounceMs?: number;
    /** Wall-clock bound for a dispose that waits for an in-flight cycle. */
    disposeTimeoutMs?: number;
}
export interface ExportScheduler {
    /** Run one cycle unless another is in flight; an idle trigger is debounced. */
    run(reason: 'interval' | 'idle' | 'dispose'): Promise<ExportCycleResult | undefined>;
    /** Stop future cycles and start one bounded best-effort cycle; never waits. */
    dispose(): Promise<void>;
}
/**
 * Serialize export cycles inside one Host process. The repository lock covers
 * other processes; this keeps one process from stacking cycles on itself, and
 * every trigger is fire-and-forget so a turn never waits for memory export.
 */
export declare function createExportScheduler(options: SchedulerOptions): ExportScheduler;
