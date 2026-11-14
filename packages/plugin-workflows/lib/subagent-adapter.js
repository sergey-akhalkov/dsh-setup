/**
 * Adapt the DSH subagent runtime to the engine's runner. A caller-delivered
 * review is cataloged for visibility; a `parent` delivery notifies the model.
 * Cancellation after publication stops the child with `dispose()`, because the
 * start signal no longer governs a published activation.
 */
export function hostSubagentRunner(runtime, agent) {
    return {
        run: async (request, signal) => {
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
                    throw new Error(`${subject} is not registered; install or enable that provider, or set reviewers.${request.reviewer ?? '<target>'}.provider in the workflows row, then re-run`);
                }
            }
            const options = {
                ...(request.agentOptions ?? {}),
                ...(request.model === undefined ? {} : { model: request.model }),
                ...(request.reasoningEffort === undefined
                    ? {}
                    : { reasoningEffort: request.reasoningEffort }),
            };
            const activation = await runtime.startActivation({
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
            // A published activation outlives the start signal: cancellation must
            // dispose the child explicitly, whether the abort arrived before or
            // after publication. Teardown is fire-and-forget and never masks the
            // result or leaks an unhandled rejection.
            const stop = () => {
                void activation.dispose().catch(() => undefined);
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
