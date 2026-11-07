import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { redactText } from './redact.js';
/**
 * Workspace listener health, written beside the journal. The view needs three
 * states that otherwise look like silence: no event yet, a trigger that did not
 * match, and a listener that is down; a read-only journal is a fourth.
 */
/** The periodic journal-writability self-check interval. */
export const SELF_CHECK_MS = 60_000;
/** A heartbeat older than this while a session is running means the listener is down. */
export const HEALTH_STALE_MS = 10 * 60_000;
/** The main event observers plus the per-workspace change source. */
export const REQUIRED_LISTENERS = 5;
/** The health file path for one workspace. */
export function healthPath(root) {
    return join(root, 'health.json');
}
async function defaultProbe(root) {
    try {
        // Probe the journal's actual write destination, not only its parent.
        const events = join(root, 'events');
        await mkdir(events, { recursive: true });
        const probe = join(events, '.health-probe');
        await writeFile(probe, '', 'utf8');
        await unlink(probe);
        return true;
    }
    catch {
        return false;
    }
}
async function writeAtomic(file, text) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, file);
}
function boundedError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return redactText(message).slice(0, 300);
}
/**
 * One workspace's health writer. Writes are serialized; a failed write never
 * throws into an event listener, and the self-check never rejects.
 */
export class WorkflowHealth {
    state;
    path;
    now;
    intervalMs;
    schedule;
    probe;
    write;
    timer;
    chain = Promise.resolve();
    constructor(options) {
        this.path = healthPath(options.root);
        this.now = options.now ?? (() => Date.now());
        this.intervalMs = options.intervalMs ?? SELF_CHECK_MS;
        this.schedule =
            options.schedule ??
                ((callback, intervalMs) => {
                    const handle = setInterval(callback, intervalMs);
                    return { dispose: () => clearInterval(handle) };
                });
        this.probe = options.probe ?? (() => defaultProbe(options.root));
        this.write = options.write ?? writeAtomic;
        this.state = {
            listenerCount: 0,
            journalWritable: true,
            triggerCount: options.triggerCount,
        };
    }
    /** Write the initial state and arm the 60-second self-check. */
    async start() {
        await this.selfCheck();
        this.timer = this.schedule(() => {
            void this.selfCheck();
        }, this.intervalMs);
    }
    /** Record one observed event and publish the new last-event time. */
    markEvent(at) {
        const last = this.state.lastEventAt;
        this.state = { ...this.state, lastEventAt: last === undefined ? at : Math.max(last, at) };
        void this.persist();
    }
    /** Publish the number of successfully registered listeners. */
    setListenerCount(count) {
        this.state = { ...this.state, listenerCount: count };
        void this.persist();
    }
    /** Record a contained listener failure. */
    recordError(error) {
        this.state = {
            ...this.state,
            lastErrorAt: this.now(),
            lastError: boundedError(error),
        };
        void this.persist();
    }
    /** Flip journal writability without throwing. */
    setJournalWritable(writable) {
        this.state = { ...this.state, journalWritable: writable };
        void this.persist();
    }
    /** Probe the journal directory and publish the result. Never rejects. */
    async selfCheck() {
        let writable = false;
        try {
            writable = await this.probe();
        }
        catch {
            writable = false;
        }
        this.state = { ...this.state, journalWritable: writable, lastCheckAt: this.now() };
        await this.persist();
    }
    /** The state the view renders; a missing listener or stale heartbeat is down. */
    stateFor(hasMatchedEvent, sessionRunning) {
        if (this.state.listenerCount < REQUIRED_LISTENERS)
            return 'listener-down';
        if (!this.state.journalWritable)
            return 'journal-readonly';
        if (sessionRunning &&
            this.state.lastCheckAt !== undefined &&
            this.now() - this.state.lastCheckAt > HEALTH_STALE_MS) {
            return 'listener-down';
        }
        return hasMatchedEvent ? 'healthy' : 'waiting';
    }
    /** A copy of the published fields. */
    snapshot() {
        return { ...this.state };
    }
    /** Await every queued write; tests use this before reading the file. */
    async flush() {
        await this.chain;
    }
    /** Stop the self-check. A pending write still settles. */
    dispose() {
        this.timer?.dispose();
        this.timer = undefined;
    }
    persist() {
        const text = `${JSON.stringify(this.state)}\n`;
        this.chain = this.chain.then(() => this.write(this.path, text)).catch(() => undefined);
        return this.chain;
    }
}
