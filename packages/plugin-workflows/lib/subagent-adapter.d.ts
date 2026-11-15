import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import { type ReviewSubagentRunner } from './review.js';
export declare function hostSubagentRunner(runtime: SubagentRuntime, agent: Agent): ReviewSubagentRunner;
