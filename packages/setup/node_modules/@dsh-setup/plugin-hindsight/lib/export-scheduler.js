import { runExportCycle } from './export-cycle.js';
const DEFAULT_IDLE_DEBOUNCE_MS = 60_000;
const DEFAULT_DISPOSE_TIMEOUT_MS = 120_000;
/**
 * Serialize export cycles inside one Host process. The repository lock covers
 * other processes; this keeps one process from stacking cycles on itself, and
 * every trigger is fire-and-forget so a turn never waits for memory export.
 */
export function createExportScheduler(options) {
    const idleDebounceMs = options.idleDebounceMs ?? DEFAULT_IDLE_DEBOUNCE_MS;
    const disposeTimeoutMs = options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS;
    let inFlight;
    let lastStartedAt = 0;
    let disposed = false;
    const start = () => {
        lastStartedAt = Date.now();
        const cycle = runExportCycle({
            config: options.config,
            apiUrl: options.apiUrl,
            log: options.log,
            now: options.now,
            client: options.client,
            git: options.git,
        }).finally(() => {
            inFlight = undefined;
        });
        inFlight = cycle;
        return cycle;
    };
    return {
        run(reason) {
            if (disposed && reason !== 'dispose')
                return Promise.resolve(undefined);
            if (inFlight !== undefined)
                return Promise.resolve(undefined);
            if (reason === 'idle' && Date.now() - lastStartedAt < idleDebounceMs) {
                return Promise.resolve(undefined);
            }
            return start();
        },
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            if (inFlight !== undefined) {
                // A cycle is already running: give it the bounded window, never block longer.
                await Promise.race([
                    inFlight.then(() => undefined),
                    new Promise((resolve) => setTimeout(resolve, disposeTimeoutMs).unref()),
                ]);
                return;
            }
            // Best effort: start a final cycle and let the process continue.
            void start();
        },
    };
}
