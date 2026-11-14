import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { SubagentRunner } from './executors.js';
/**
 * Adapt the DSH subagent runtime to the engine's runner. A caller-delivered
 * review is cataloged for visibility; a `parent` delivery notifies the model.
 * Cancellation after publication stops the child with `dispose()`, because the
 * start signal no longer governs a published activation.
 */
export declare function hostSubagentRunner(runtime: SubagentRuntime, agent: Agent): SubagentRunner;
