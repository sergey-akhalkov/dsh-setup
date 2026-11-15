import { ConfigError, ProviderStartError } from './review.js';
export function hostSubagentRunner(runtime, agent) {
    const pendingTeardowns = [];
    let startState = 'idle';
    let startError;
    const startWaiters = [];
    const settleStart = (error) => {
        startState = error === undefined ? 'started' : 'failed';
        startError = error;
        for (const waiter of startWaiters.splice(0)) {
            if (startState === 'started')
                waiter.resolve();
            else
                waiter.reject(error);
        }
    };
    /** Run one dispose attempt and remember whether it confirmed the teardown. */
    const teardown = (item) => {
        item.error = undefined;
        item.done = false;
        let pending;
        try {
            pending = item.dispose();
        }
        catch (error) {
            item.error = error;
            return Promise.resolve();
        }
        const attempt = pending.then(() => {
            item.done = true;
        }, (error) => {
            item.error = error;
        });
        item.attempt = attempt;
        return attempt;
    };
    return {
        // Resolves only after the most recent target actually started; a failed
        // activation rejects with its cause so the queue can classify and retry it.
        awaitStart: () => startState === 'started'
            ? Promise.resolve()
            : startState === 'failed'
                ? Promise.reject(startError)
                : new Promise((resolve, reject) => {
                    startWaiters.push({ resolve, reject });
                }),
        // A dispose failure is preserved, never swallowed: the scheduler keeps the
        // queue slot, conversation key, and snapshot in quarantine until a later
        // call confirms the child is gone.
        waitForTeardown: async () => {
            let failure;
            for (const item of [...pendingTeardowns]) {
                if (item.attempt !== undefined)
                    await item.attempt;
                if (item.done !== true)
                    await teardown(item);
                if (item.done === true) {
                    const index = pendingTeardowns.indexOf(item);
                    if (index >= 0)
                        pendingTeardowns.splice(index, 1);
                }
                else if (failure === undefined) {
                    failure = item.error ?? new Error('the reviewer child could not be torn down');
                }
            }
            if (failure !== undefined)
                throw failure;
        },
        run: async (request, signal) => {
            startState = 'idle';
            startError = undefined;
            const controller = signal ?? new AbortController().signal;
            // A missing provider is a run-time review failure with the target id and
            // the recovery action, not the provider's bare "no provider" message. A
            // runtime that cannot list providers skips the pre-check and lets the
            // start surface its own error.
            if (typeof runtime.getProvider === 'function') {
                const provider = runtime.getProvider(request.provider);
                if (provider === undefined) {
                    const subject = request.reviewer === undefined
                        ? `provider "${request.provider}"`
                        : `review target "${request.reviewer}" (provider "${request.provider}")`;
                    const error = new ConfigError(`${subject} is not registered; install or enable that provider, or set reviewers.${request.reviewer ?? '<target>'}.provider in the workflows row, then re-run`);
                    settleStart(error);
                    throw error;
                }
            }
            const options = {
                ...(request.agentOptions ?? {}),
                ...(request.model === undefined ? {} : { model: request.model }),
                ...(request.reasoningEffort === undefined
                    ? {}
                    : { reasoningEffort: request.reasoningEffort }),
            };
            let activation;
            // An activation that never resolves still owns the review slot and
            // snapshot: track it as a pending teardown until it settles.
            let resolveActivation = () => undefined;
            let rejectActivation = () => undefined;
            const activationGate = new Promise((resolve, reject) => {
                resolveActivation = resolve;
                rejectActivation = reject;
            });
            const unresolved = {
                dispose: async () => {
                    const value = await activationGate.catch(() => undefined);
                    await value?.dispose();
                },
            };
            pendingTeardowns.push(unresolved);
            void activationGate.catch(() => undefined);
            try {
                activation = await runtime.startActivation({
                    provider: request.provider,
                    label: (request.label ?? `workflows ${request.provider}`).slice(0, 120),
                    parent: agent,
                    prompt: [{ type: 'text', text: request.prompt }],
                    ...(request.schema === undefined ? {} : { outputSchema: request.schema }),
                    ...(Object.keys(options).length === 0 ? {} : { agentOptions: options }),
                    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
                    signal: controller,
                    delivery: request.delivery ?? 'caller',
                });
                resolveActivation(activation);
                unresolved.dispose = () => activation.dispose();
            }
            catch (error) {
                rejectActivation(error);
                // Keep the untruncated provider cause for classification and the
                // public message bounded and actionable; the classifier honors a
                // retry-after hint carried on either.
                const providerMessage = error instanceof Error ? error.message : String(error);
                const subject = request.reviewer === undefined
                    ? `provider "${request.provider}"`
                    : `review target "${request.reviewer}" (provider "${request.provider}")`;
                const hint = typeof error === 'object' && error !== null
                    ? (error.retryAfterMs ??
                        error.retryAfter)
                    : undefined;
                const retryAfterMs = typeof hint === 'number' && Number.isFinite(hint) && hint > 0
                    ? Math.round(hint)
                    : undefined;
                const failure = new ProviderStartError(`${subject} could not start: ${providerMessage.slice(0, 300)}; check reviewers.${request.reviewer ?? '<target>'} against provider "${request.provider}", then re-run the review`, providerMessage, retryAfterMs);
                settleStart(failure);
                throw failure;
            }
            settleStart();
            // A published activation outlives the start signal: cancellation must
            // dispose the child explicitly, whether the abort arrived before or
            // after publication. Teardown is fire-and-forget here; failures stay
            // pending for `waitForTeardown` to retry.
            // The activation's pending item is the one teardown path: before it
            // resolves it holds the slot; after, it disposes the child once.
            const item = unresolved;
            const stop = () => {
                if (!pendingTeardowns.includes(item))
                    pendingTeardowns.push(item);
                void teardown(item);
            };
            if (controller.aborted)
                stop();
            else
                controller.addEventListener('abort', stop, { once: true });
            try {
                const result = await activation.result;
                const text = result.output
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('\n')
                    .trim();
                return {
                    childId: String(activation.childId),
                    completed: result.stopReason === 'completed',
                    ...(text === '' ? {} : { text }),
                    ...(result.structured === undefined ? {} : { result: result.structured }),
                    ...(result.diagnostic === undefined ? {} : { error: result.diagnostic }),
                };
            }
            finally {
                controller.removeEventListener('abort', stop);
            }
        },
    };
}
