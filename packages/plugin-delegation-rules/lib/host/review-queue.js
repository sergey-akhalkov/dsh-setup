const CHILD_LIMIT_PATTERN = /active child limit|subagent limit reached/i;
const REVIEWED_CHANGED_PATTERN = /reviewed inputs changed/i;
const INVALID_OUTPUT_PATTERN = /no fenced JSON verdict|fenced verdict|fenced blocks|returned no text output|verdict digest does not match|verdict must|findings must|requires zero P0\/P1 findings|requires at least one P0\/P1 finding|finding #/i;
const CONFIG_PATTERN = /not registered|not configured|unknown rule|unknown trigger|unknown contract|unknown gate|must be|does not support|unsupported|invalid configuration|configuration must|target options/i;
const PERMISSION_PATTERN = /permission|authori[sz]ation|access-policy|access denied|unauthorized|forbidden|approval/i;
const TIMEOUT_PATTERN = /did not finish within|timed out|timeout/i;
const START_REJECTION_PATTERN = /could not start|failed to start|start rejected|unavailable|capacity|limit reached/i;
/** Provider/result classification shared with the start path. */
export function classifyFailure(error, phase) {
    const message = error instanceof Error ? error.message : String(error);
    const retryAfterMs = retryAfterOf(error, message);
    const matched = (pattern) => pattern.test(message);
    const name = error instanceof Error ? error.name : '';
    // Engine-owned typed failures win over text from rules, targets, or payloads.
    if (name === 'InvalidOutputError')
        return { failureClass: 'invalid-output', transient: false };
    if (name === 'PermissionError')
        return { failureClass: 'permission', transient: false };
    if (name === 'ConfigError')
        return { failureClass: 'config', transient: false };
    if (name === 'TimeoutError') {
        return { failureClass: 'timeout', transient: true, ...retryEvidence(retryAfterMs) };
    }
    if (name === 'ProviderStartError') {
        // Classify the provider cause alone: rule ids and explanatory text must not
        // turn a transient rejection into config/permission or the reverse.
        const providerMessage = error.providerMessage;
        const cause = typeof providerMessage === 'string' ? providerMessage : message;
        const matchesCause = (pattern) => pattern.test(cause);
        if (matchesCause(CHILD_LIMIT_PATTERN)) {
            return { failureClass: 'child-limit', transient: true, ...retryEvidence(retryAfterMs) };
        }
        if (matchesCause(CONFIG_PATTERN))
            return { failureClass: 'config', transient: false };
        if (matchesCause(PERMISSION_PATTERN))
            return { failureClass: 'permission', transient: false };
        return { failureClass: 'provider-not-started', transient: true, ...retryEvidence(retryAfterMs) };
    }
    // Untyped text is untrusted and may embed rule ids or payload keywords, so
    // the permanent checks run before the transient keyword checks.
    if (matched(CHILD_LIMIT_PATTERN)) {
        return { failureClass: 'child-limit', transient: true, ...retryEvidence(retryAfterMs) };
    }
    if (matched(REVIEWED_CHANGED_PATTERN)) {
        return { failureClass: 'reviewed-inputs-changed', transient: false };
    }
    if (matched(INVALID_OUTPUT_PATTERN))
        return { failureClass: 'invalid-output', transient: false };
    if (matched(CONFIG_PATTERN))
        return { failureClass: 'config', transient: false };
    if (matched(PERMISSION_PATTERN))
        return { failureClass: 'permission', transient: false };
    if (matched(TIMEOUT_PATTERN)) {
        return { failureClass: 'timeout', transient: true, ...retryEvidence(retryAfterMs) };
    }
    if (phase === 'start' && matched(START_REJECTION_PATTERN)) {
        return { failureClass: 'provider-not-started', transient: true, ...retryEvidence(retryAfterMs) };
    }
    return { failureClass: 'unknown', transient: false, ...retryEvidence(retryAfterMs) };
}
function retryEvidence(retryAfterMs) {
    return retryAfterMs === undefined ? {} : { retryAfterMs };
}
function retryAfterOf(error, message) {
    if (typeof error === 'object' && error !== null) {
        const value = error.retryAfterMs ??
            error.retryAfter;
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return Math.round(value);
        }
    }
    const match = /retry[- ]after[:= ]+([0-9]+)\s*(ms|s)?/i.exec(message);
    if (match === null)
        return undefined;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0)
        return undefined;
    return match[2]?.toLowerCase() === 's' ? value * 1_000 : value;
}
/**
 * Bounded exponential backoff with full jitter. A provider-supplied retry-after
 * wins when larger; everything is capped by `maxDelayMs`.
 */
export function retryDelayMs(attempt, limits, retryAfterMs, random = Math.random) {
    const exponent = Math.min(Math.max(attempt - 1, 0), 30);
    const ceiling = Math.min(limits.maxDelayMs, limits.baseDelayMs * 2 ** exponent);
    const jittered = ceiling * (0.5 + random() * 0.5);
    const honored = Math.max(jittered, retryAfterMs ?? 0);
    return Math.round(Math.min(limits.maxDelayMs, honored));
}
/** One per-profile admission queue. */
export class ReviewQueue {
    limits;
    hooks;
    entries = new Map();
    identities = new Map();
    keys = new Map();
    waiting = [];
    active = new Set();
    persistChains = new Map();
    sequence = 0;
    constructor(limits, hooks) {
        this.limits = limits;
        this.hooks = hooks;
    }
    /** Stop every pending timer; the engine calls this when the plugin unloads. */
    dispose() {
        for (const entry of this.entries.values()) {
            if (entry.waitTimer !== undefined)
                clearTimeout(entry.waitTimer);
            if (entry.retryTimer !== undefined)
                clearTimeout(entry.retryTimer);
        }
        this.entries.clear();
        this.identities.clear();
        this.keys.clear();
        this.waiting = [];
        this.active.clear();
    }
    owns(runId) {
        return this.entries.has(runId) && !(this.entries.get(runId)?.finished ?? true);
    }
    summary() {
        return {
            enabled: this.limits.enabled,
            concurrency: this.limits.concurrency,
            active: this.active.size,
            queued: this.waiting.length,
        };
    }
    /** Admission for one already prepared run. */
    async submit(run) {
        const existing = this.identities.get(run.file.identity);
        if (existing !== undefined && !existing.finished) {
            return { kind: 'duplicate', run: existing.run };
        }
        // The waiting cap applies only when this run must actually wait. A new key
        // head with a free slot starts immediately and consumes no waiting room.
        const mustWait = this.keys.has(run.file.key) ||
            (this.limits.enabled && this.active.size >= this.limits.concurrency);
        if (this.limits.enabled && mustWait && this.waiting.length >= this.limits.maxQueued) {
            return { kind: 'full', depth: this.waiting.length, maxQueued: this.limits.maxQueued };
        }
        const entry = {
            run,
            phase: 'queued',
            seq: ++this.sequence,
            queuedAtMs: this.hooks.now().getTime(),
            attempts: 0,
            waitDeadlineMs: 0,
            head: false,
            finished: false,
            settling: false,
            admitted: false,
            retryToken: 0,
        };
        this.entries.set(run.file.id, entry);
        this.identities.set(run.file.identity, entry);
        const key = this.keys.get(run.file.key);
        if (key === undefined) {
            this.keys.set(run.file.key, { head: entry, followers: [] });
            entry.head = true;
        }
        else {
            key.followers.push(entry);
        }
        run.file.state = 'queued';
        run.file.queuedAt = this.hooks.now().toISOString();
        delete run.file.queuePosition;
        this.waiting.push(entry);
        this.waiting.sort((left, right) => left.seq - right.seq);
        if (this.limits.enabled)
            this.armWaitTimer(entry);
        this.syncPositions();
        this.pump();
        if (entry.phase === 'starting' && entry.startOutcome !== undefined) {
            await entry.startOutcome;
            if (entry.startError !== undefined)
                throw entry.startError;
        }
        if (entry.finished || entry.phase === 'settled')
            return { kind: 'settled' };
        if (entry.phase === 'retry-wait')
            return { kind: 'accepted', phase: 'retry-wait' };
        if (entry.phase === 'queued')
            return { kind: 'accepted', phase: 'queued' };
        return { kind: 'accepted', phase: 'running' };
    }
    /**
     * Replace a queued run's identity after a re-preparation. The old mapping is
     * removed and the new one inserted in one step. When the new identity is
     * already admitted, this run is the duplicate: it settles `discarded` naming
     * the incumbent, promotes its follower, and fires its observer exactly once.
     */
    async replaceIdentity(run, identity) {
        const entry = this.entries.get(run.file.id);
        if (entry === undefined || entry.finished)
            return { replaced: false };
        const occupied = this.identities.get(identity);
        if (occupied !== undefined && occupied !== entry && !occupied.finished) {
            this.forgetIdentity(entry);
            await this.finish(entry, 'discarded', `duplicate of run ${occupied.run.file.id}`);
            return { collision: occupied.run, replaced: false };
        }
        this.forgetIdentity(entry);
        run.file.identity = identity;
        this.identities.set(identity, entry);
        return { replaced: true };
    }
    /** Wait out an incumbent's in-flight start so a duplicate handle is settled. */
    async whenAdmitted(runId) {
        const entry = this.entries.get(runId);
        if (entry === undefined || entry.finished)
            return;
        if (entry.phase === 'starting' && entry.startOutcome !== undefined) {
            await entry.startOutcome;
        }
    }
    /** Mark the run's terminal state, release its slot, and settle exactly once. */
    async complete(run, state) {
        const entry = this.entries.get(run.file.id);
        if (entry === undefined)
            return;
        await this.finish(entry, state);
    }
    /** A queued run cancelled before any target started settles discarded. */
    async cancel(runId) {
        const entry = this.entries.get(runId);
        if (entry === undefined || entry.finished || entry.phase !== 'queued')
            return false;
        await this.finish(entry, 'discarded', 'cancelled before the target started');
        return true;
    }
    /**
     * Re-enter a transiently failed run after its backoff. The caller has already
     * persisted `retry-wait`; this releases the slot and arms the retry timer.
     */
    async scheduleRetry(run, failure, error) {
        const entry = this.entries.get(run.file.id);
        if (entry === undefined || entry.finished)
            return;
        entry.failureClass = failure.failureClass;
        entry.retryAfterMs = failure.retryAfterMs;
        entry.lastError = error;
        entry.phase = 'retry-wait';
        this.active.delete(entry);
        run.file.state = 'retry-wait';
        run.file.failureClass = failure.failureClass;
        run.file.lastRetryAt = this.hooks.now().toISOString();
        delete run.file.queuePosition;
        this.persistEntry(run);
        // A never-started run keeps its acceptance deadline across the backoff.
        if (this.limits.enabled && !entry.admitted) {
            if (entry.waitTimer !== undefined) {
                clearTimeout(entry.waitTimer);
                delete entry.waitTimer;
            }
            const remaining = entry.waitDeadlineMs - this.hooks.now().getTime();
            if (remaining <= 0) {
                await this.settleWaitTimeout(entry);
                return;
            }
            entry.waitTimer = setTimeout(() => {
                void this.waitTimedOut(entry);
            }, remaining);
        }
        const token = ++entry.retryToken;
        const delay = retryDelayMs(entry.attempts, this.limits, failure.retryAfterMs);
        entry.retryTimer = setTimeout(() => {
            this.retryDue(entry, token);
        }, delay);
        this.pump();
    }
    /** Re-enter the waiting list, or settle visibly when capacity or time is gone. */
    retryDue(entry, token) {
        if (entry.finished || entry.retryToken !== token)
            return;
        delete entry.retryTimer;
        if (!entry.admitted && this.hooks.now().getTime() >= entry.waitDeadlineMs) {
            void this.settleWaitTimeout(entry);
            return;
        }
        if (this.limits.enabled && this.waiting.length >= this.limits.maxQueued) {
            const cause = entry.lastError ?? new Error('the retry could not re-enter the full review queue');
            void this.failEntry(entry, cause, 'queue-timeout');
            return;
        }
        entry.phase = 'queued';
        delete entry.run.file.failureClass;
        this.waiting.push(entry);
        this.waiting.sort((left, right) => left.seq - right.seq);
        this.syncPositions();
        this.pump();
    }
    /** Attempts this run has already used, for the retry budget decision. */
    attemptsOf(runId) {
        return this.entries.get(runId)?.attempts ?? 0;
    }
    /** Promote the next follower of a key after its head settles. */
    detachKey(entry) {
        const state = this.keys.get(entry.run.file.key);
        if (state === undefined)
            return;
        if (state.head === entry) {
            const next = state.followers.shift();
            state.head = next;
            if (next === undefined) {
                this.keys.delete(entry.run.file.key);
                return;
            }
            next.head = true;
        }
        else {
            state.followers = state.followers.filter((follower) => follower !== entry);
            if (state.head === undefined && state.followers.length === 0) {
                this.keys.delete(entry.run.file.key);
            }
        }
    }
    forgetIdentity(entry) {
        if (this.identities.get(entry.run.file.identity) === entry) {
            this.identities.delete(entry.run.file.identity);
        }
    }
    armWaitTimer(entry) {
        entry.waitDeadlineMs = this.hooks.now().getTime() + this.limits.waitTimeoutMs;
        entry.waitTimer = setTimeout(() => {
            void this.waitTimedOut(entry);
        }, this.limits.waitTimeoutMs);
    }
    async waitTimedOut(entry) {
        if (entry.finished || entry.settling)
            return;
        // Only an unadmitted run has a wait clock; a live, in-flight, or already
        // settled run is unaffected by a late timer dispatch.
        if (entry.phase !== 'queued' && entry.phase !== 'retry-wait')
            return;
        await this.settleWaitTimeout(entry);
    }
    /** Settle an unadmitted run whose acceptance-based wait deadline expired. */
    async settleWaitTimeout(entry) {
        if (entry.finished || entry.settling || entry.phase === 'settled')
            return;
        entry.settling = true;
        const position = this.positionOf(entry);
        const waitMs = this.hooks.now().getTime() - entry.queuedAtMs;
        this.removeWaiting(entry);
        entry.retryToken += 1;
        // Clear both timers before awaiting the hook: a late dispatch must observe
        // the in-progress settlement, never start a second one.
        if (entry.waitTimer !== undefined) {
            clearTimeout(entry.waitTimer);
            delete entry.waitTimer;
        }
        if (entry.retryTimer !== undefined) {
            clearTimeout(entry.retryTimer);
            delete entry.retryTimer;
        }
        entry.phase = 'settled';
        try {
            await this.hooks.timeout(entry.run, {
                ...(position === 0 ? {} : { position }),
                waitMs,
            });
        }
        finally {
            await this.finish(entry, 'failed');
        }
    }
    positionOf(entry) {
        const index = this.waiting.indexOf(entry);
        return index < 0 ? 0 : index + 1;
    }
    removeWaiting(entry) {
        this.waiting = this.waiting.filter((candidate) => candidate !== entry);
    }
    /** Apply every position before any persistence so a stale sweep cannot win. */
    syncPositions() {
        const queued = this.waiting.filter((entry) => entry.phase === 'queued');
        for (const [index, entry] of queued.entries()) {
            entry.run.file.queuePosition = index + 1;
        }
        for (const entry of queued)
            this.persistEntry(entry.run);
    }
    persistEntry(run) {
        void this.enqueuePersist(run);
    }
    async persistNow(run) {
        await this.enqueuePersist(run);
    }
    /**
     * Serialize one run's writes so a terminal state can never be overwritten by
     * an earlier queued-state write that resolves late. Unrelated runs stay
     * independent.
     */
    enqueuePersist(run) {
        const previous = this.persistChains.get(run.file.id) ?? Promise.resolve();
        const next = previous.then(async () => {
            try {
                await this.hooks.persist(run);
            }
            catch {
                // Queue facts are local scratch; a failed write must not block admission.
            }
        });
        this.persistChains.set(run.file.id, next);
        void next.finally(() => {
            if (this.persistChains.get(run.file.id) === next)
                this.persistChains.delete(run.file.id);
        });
        return next;
    }
    startEligible(entry) {
        return !entry.finished && entry.phase === 'queued' && entry.head;
    }
    /**
     * Claim every available slot synchronously and launch each start on its own.
     * A slow target start must never delay an unrelated admission or handle.
     */
    pump() {
        const limit = this.limits.enabled ? this.limits.concurrency : Number.POSITIVE_INFINITY;
        while (this.active.size < limit) {
            if (this.limits.enabled) {
                // A late timer dispatch can free a slot after the acceptance deadline:
                // settle the expired run instead of starting it.
                const expired = this.waiting.find((candidate) => candidate.phase === 'queued' && this.hooks.now().getTime() >= candidate.waitDeadlineMs);
                if (expired !== undefined) {
                    void this.settleWaitTimeout(expired);
                    continue;
                }
            }
            const entry = this.waiting.find((candidate) => this.startEligible(candidate));
            if (entry === undefined)
                return;
            this.claim(entry);
        }
    }
    claim(entry) {
        this.removeWaiting(entry);
        entry.phase = 'starting';
        entry.attempts += 1;
        entry.run.file.state = 'starting';
        entry.run.file.attempts = entry.attempts;
        entry.run.file.waitMs = this.hooks.now().getTime() - entry.queuedAtMs;
        delete entry.run.file.queuePosition;
        if (entry.retryTimer !== undefined) {
            clearTimeout(entry.retryTimer);
            delete entry.retryTimer;
        }
        this.active.add(entry);
        this.syncPositions();
        this.persistEntry(entry.run);
        entry.startOutcome = this.runStart(entry);
        void entry.startOutcome.catch(() => undefined);
    }
    async runStart(entry) {
        try {
            await this.hooks.start(entry.run);
        }
        catch (error) {
            this.active.delete(entry);
            if (entry.finished)
                return;
            const failure = classifyFailure(error, 'start');
            entry.failureClass = failure.failureClass;
            if (this.limits.enabled && failure.transient && entry.attempts < this.limits.maxAttempts) {
                // A slow start can consume the wait timer and then fail after the
                // acceptance deadline; a never-started run must not begin retrying.
                if (this.hooks.now().getTime() >= entry.waitDeadlineMs) {
                    await this.settleWaitTimeout(entry);
                    return;
                }
                await this.scheduleRetry(entry.run, failure, error);
                return;
            }
            entry.startError = error;
            await this.failEntry(entry, error, failure.failureClass);
            return;
        }
        if (entry.finished)
            return;
        entry.phase = 'running';
        entry.admitted = true;
        entry.run.file.state = 'running';
        if (entry.waitTimer !== undefined) {
            // The target is live: admission is proven and the wait clock stops.
            clearTimeout(entry.waitTimer);
            delete entry.waitTimer;
        }
        this.persistEntry(entry.run);
    }
    async failEntry(entry, error, failureClass) {
        entry.phase = 'settled';
        try {
            await this.hooks.fail(entry.run, error, failureClass);
        }
        finally {
            await this.finish(entry, 'failed');
        }
    }
    async finish(entry, state, detail) {
        if (entry.finished)
            return;
        entry.finished = true;
        entry.phase = 'settled';
        if (entry.waitTimer !== undefined) {
            clearTimeout(entry.waitTimer);
            delete entry.waitTimer;
        }
        if (entry.retryTimer !== undefined) {
            clearTimeout(entry.retryTimer);
            delete entry.retryTimer;
        }
        this.removeWaiting(entry);
        this.active.delete(entry);
        this.forgetIdentity(entry);
        this.detachKey(entry);
        entry.run.file.state = state;
        delete entry.run.file.queuePosition;
        if (detail !== undefined)
            entry.run.file.detail = detail;
        await this.persistNow(entry.run);
        this.syncPositions();
        try {
            this.hooks.settled(entry.run, state);
        }
        catch {
            // The observer is a seam; it must not change queue cleanup.
        }
        this.pump();
    }
}
