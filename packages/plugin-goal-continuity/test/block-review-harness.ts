import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
} from '@deepseek-ai/dsh-subagent'
import { expect, vi } from 'vitest'
import { apply, type BlockReviewConfig, type Config } from '../lib/index.js'

/** Reviewer tools the preset is expected to mount and the gate to allow. */
export const REVIEWER_TOOLS = ['read', 'grep', 'glob'] as const
/** Globally mounted mutation tools that must never remain visible to the reviewer. */
export const MUTATION_TOOLS = ['mcp_call', 'delegate', 'edit', 'write', 'pwsh', 'update_goal']

export interface FakeGoal {
  id: string
  revision: number
  objective: string
  phase: GoalView['phase']
  maxGoalRounds: number
  roundsStarted: number
}

/** A start request recorded by the fake provider. */
export interface ReviewRun {
  provider: string
  label: string
  prompt: string
  parentId: string
  cwd?: string
  agentPreset?: string
  agentOptions?: { model?: string; reasoningEffort?: string }
}

interface FakeSubagentProvider {
  provider: SubagentProvider
  capabilities: SubagentCapabilities
  inheritsParentContext: boolean
}

export interface FakeSubagentsOptions {
  /** Provider capabilities; `agentPreset` must stay true for a valid reviewer. */
  capabilities?: Partial<SubagentCapabilities>
  inheritsParentContext?: boolean
  /** Start throws instead of publishing a child. */
  startError?: Error
  /** Child-scope restriction throws. */
  restrictError?: Error
  /** Result never settles (timeout test). */
  hang?: boolean
  /** Result settles with a non-completed stop reason. */
  stopReason?: SubagentResult['stopReason']
  /** Verdict text builder; defaults to a valid not-blocker. */
  respond?: (run: ReviewRun) => string
}

/** One fake workspace child context paired with its preset-only tool surface. */
export interface FakeReviewerChild {
  agent: Agent
  restrictions: Array<{ allow?: readonly string[] }>
}

/**
 * Test doubles for the block-review gate: a fake goal service, a fake subagent
 * provider that publishes a reviewer child through the real `agent/created`
 * dispatch, and a fake child-scope tools registry that only knows the preset
 * read tools and the globally mounted mutation tools.
 */
export class BlockReviewHarness {
  readonly ctx = new Context()
  readonly agent: Agent
  readonly session: Session
  readonly injected: UserMessage[] = []
  readonly runs: ReviewRun[] = []
  readonly children: FakeReviewerChild[] = []
  readonly restrictions: Array<{ allow?: readonly string[] }> = []
  readonly globals = new Set<string>([...REVIEWER_TOOLS, ...MUTATION_TOOLS])
  readonly disposals: Array<ReturnType<typeof vi.fn>> = []
  readonly startCalls: number[] = []
  goal: FakeGoal | undefined
  events: SessionEvent[] = []
  private readonly workspaceDirectory: string
  private readonly options: FakeSubagentsOptions
  private readonly capabilities: SubagentCapabilities
  private readonly provider: FakeSubagentProvider

  private constructor(
    workspace: string,
    config: Config,
    options: FakeSubagentsOptions,
    goal?: Partial<FakeGoal>,
  ) {
    this.workspaceDirectory = workspace
    this.options = options
    this.capabilities = {
      agentOptions: true,
      agentPreset: true,
      outputSchema: true,
      depthLimit: true,
      ...options.capabilities,
    }
    this.provider = {
      provider: {
        name: 'spawn',
        capabilities: this.capabilities,
        inheritsParentContext: options.inheritsParentContext ?? false,
      },
      capabilities: this.capabilities,
      inheritsParentContext: options.inheritsParentContext ?? false,
    }
    this.agent = this.createRootAgent(goal)
    this.session = this.agent.session
    const children = this.children
    const runs = this.runs
    const startCalls = this.startCalls
    const disposals = this.disposals
    const subagents = {
      list: () => ['spawn', 'fork'],
      getProvider: (name: string) => (name === 'spawn' ? this.provider.provider : undefined),
      startActivation: async (spec: SubagentActivationSpec): Promise<SubagentActivation> => {
        startCalls.push(1)
        if (options.startError !== undefined) throw options.startError
        const run: ReviewRun = {
          provider: spec.provider,
          label: spec.label,
          prompt: spec.request.prompt
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('\n'),
          parentId: spec.request.parent.id,
          ...(spec.request.cwd === undefined ? {} : { cwd: spec.request.cwd }),
          ...(spec.request.agentPreset === undefined
            ? {}
            : { agentPreset: spec.request.agentPreset }),
          ...(spec.request.agentOptions === undefined
            ? {}
            : { agentOptions: spec.request.agentOptions as ReviewRun['agentOptions'] }),
        }
        runs.push(run)
        const child = this.createReviewerChild(spec)
        children.push(child)
        // The real manager announces `agent/created` before accepting the first
        // prompt; the restriction failure must reject the start.
        this.ctx.emit('agent/created', { agent: child.agent, source: 'startup' })
        const result = this.resultFor(run)
        const dispose = vi.fn(async () => undefined)
        disposals.push(dispose)
        return { childId: child.agent.id, result, dispose }
      },
    }
    this.ctx.provide('agents', {
      list: () => [],
      get: (id: string) => (id === this.agent.id ? this.agent : undefined),
      roots: () => [this.agent],
      currentInitiator: () => this.agent,
    } as never)
    this.ctx.provide('goals', { get: () => this.goalView() } as never)
    this.ctx.provide('subagents', subagents as never)
    this.ctx.provide('workingDirectory', { get: () => this.workspaceDirectory } as never)
    apply(this.ctx, config)
  }

  static async create(
    options: FakeSubagentsOptions = {},
    config: Config = {},
    goal: Partial<FakeGoal> = {},
  ): Promise<{ harness: BlockReviewHarness; cleanup: () => Promise<void> }> {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-goal-review-'))
    const harness = new BlockReviewHarness(workspace, config, options, goal)
    return {
      harness,
      cleanup: async () => {
        await rm(workspace, { recursive: true, force: true })
      },
    }
  }

  get workspace(): string {
    return this.workspaceDirectory
  }

  private createRootAgent(goal: Partial<FakeGoal> | undefined): Agent {
    const base: FakeGoal = {
      id: 'goal-1',
      revision: 1,
      objective: 'Ship the migration.',
      phase: 'active',
      maxGoalRounds: 256,
      roundsStarted: 0,
      ...goal,
    }
    this.goal = base
    const session = {
      id: 'root-agent',
      header: {
        version: 1,
        id: 'root-agent',
        createdAt: Date.now(),
        isSeeded: false,
        cwd: this.workspaceDirectory,
        permissionPreset: 'danger-full-access',
      },
      snapshotEvents: () => this.events,
    } as unknown as Session
    return {
      id: 'root-agent' as never,
      session,
      status: 'running',
      inject: (message: UserMessage) => {
        this.injected.push(message)
      },
    } as unknown as Agent
  }

  private createReviewerChild(spec: SubagentActivationSpec): FakeReviewerChild {
    const childContext = new Context()
    const restrictions: Array<{ allow?: readonly string[] }> = []
    const tools = {
      restrict: (filter: { allow?: readonly string[] }) => {
        if (this.options.restrictError !== undefined) throw this.options.restrictError
        for (const name of filter.allow ?? []) {
          if (!this.globals.has(name)) throw new Error(`unknown tool "${name}"`)
        }
        restrictions.push(filter)
        this.restrictions.push(filter)
        return () => undefined
      },
    }
    childContext.provide('tools', tools as never)
    const header = {
      version: 1,
      id: `reviewer-${this.children.length + 1}`,
      createdAt: Date.now(),
      isSeeded: false,
      cwd: this.workspaceDirectory,
      origin: 'subagent',
      delegationDepth: 1,
      parentSession: spec.request.parent.id,
      agentPreset: spec.request.agentPreset,
    }
    const agent = {
      id: header.id,
      session: { id: header.id, header },
      ctx: childContext,
    } as unknown as Agent
    return { agent, restrictions }
  }

  private resultFor(run: ReviewRun): Promise<SubagentResult> {
    if (this.options.hang === true) {
      return new Promise<SubagentResult>(() => undefined)
    }
    const text = this.options.respond?.(run) ?? validNotBlocker('make the sibling edit')
    return Promise.resolve({
      output: [{ type: 'text', text }],
      stopReason: this.options.stopReason ?? 'completed',
    })
  }

  goalView(): GoalView | undefined {
    const goal = this.goal
    if (goal === undefined) return undefined
    return {
      id: goal.id as GoalView['id'],
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      maxGoalRounds: goal.maxGoalRounds,
      roundsStarted: goal.roundsStarted,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activation: 'armed',
    } as GoalView
  }

  setGoal(overrides: Partial<FakeGoal> = {}): FakeGoal {
    this.goal = {
      id: 'goal-1',
      revision: 1,
      objective: 'Ship the migration.',
      phase: 'active',
      maxGoalRounds: 256,
      roundsStarted: 0,
      ...overrides,
    }
    return this.goal
  }

  append(event: Record<string, unknown>): void {
    this.events.push({ seq: this.events.length, time: Date.now(), ...event } as SessionEvent)
  }

  turnStart(turn = 1): void {
    this.append({ type: 'turn/start', data: { turn } })
  }

  goalRound(goal: FakeGoal, round = goal.roundsStarted): void {
    this.append({
      type: 'user/message',
      data: {
        id: `goal-message-${this.events.length}`,
        role: 'user',
        content: [{ type: 'text', text: '<goal_round />' }],
        source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
      },
    })
  }

  directMessage(text: string): void {
    this.append({
      type: 'user/message',
      data: {
        id: `user-message-${this.events.length}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      },
    })
  }

  runtimeContext(text: string, sections: Array<{ name: string; text: string }> = []): void {
    this.append({
      type: 'user/message',
      data: {
        id: `runtime-context-${this.events.length}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'runtime-context', form: 'snapshot', sections },
      },
    })
  }

  toolCall(name: string, args: unknown): string {
    const callId = `call-${this.events.length}`
    this.append({
      type: 'tool/call',
      data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
    })
    return callId
  }

  toolResult(callId: string, text: string, isError = false): void {
    this.append({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: `result-${this.events.length}`,
          role: 'tool',
          source: { kind: 'tool', callId },
          toolCallId: callId,
          isError,
          content: [{ type: 'text', text }],
        },
      },
    })
  }

  /** Run one `update_goal` call through the registered pre-execute waterfall. */
  async block(
    args: Record<string, unknown> = {},
    agent: Agent = this.agent,
    signal = new AbortController().signal,
  ): Promise<{ decision: unknown; next: ReturnType<typeof vi.fn> }> {
    const next = vi.fn(async () => ({ kind: 'allow' }))
    const waterfall = this.ctx.waterfall as unknown as (
      name: string,
      exec: unknown,
      next: unknown,
    ) => Promise<unknown>
    const decision = await waterfall(
      'tools/pre-execute',
      {
        agent,
        name: 'update_goal',
        arguments: {
          goal_id: this.goal?.id,
          revision: this.goal?.revision,
          action: 'blocked',
          blocked_reason: 'the sibling automation repository needs a missing method',
          ...args,
        },
        signal,
        callId: 'call-1',
        rootCallId: 'call-1',
        token: Symbol('token'),
      },
      next,
    )
    return { decision, next }
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const path = join(this.workspaceDirectory, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }

  async readRecord(goalId: string, digest: string): Promise<Record<string, unknown>> {
    const path = join(
      this.workspaceDirectory,
      '.dsh',
      'goal-continuity',
      'block-review',
      goalId,
      `${digest}.json`,
    )
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  }

  recordPath(goalId: string, digest: string): string {
    return join(
      this.workspaceDirectory,
      '.dsh',
      'goal-continuity',
      'block-review',
      goalId,
      `${digest}.json`,
    )
  }

  /** The prompt text the reviewer received in the last run. */
  lastPrompt(): string {
    return this.runs.at(-1)?.prompt ?? ''
  }

  /** The effective tool surface implied by the child-scope allowlist. */
  reviewerSurface(): string[] {
    const filter = this.restrictions.at(-1)
    if (filter?.allow === undefined) return [...this.globals]
    return [...filter.allow]
  }
}

/** One valid `not-blocker` verdict, fenced. */
export function validNotBlocker(nextStep: string): string {
  return `Reviewed.\n\n\`\`\`json\n${JSON.stringify({
    verdict: 'not-blocker',
    userAction: null,
    nextStep,
    evidence: ['the workspace is writable'],
    confidence: 'high',
  })}\n\`\`\``
}

/** One valid `blocker` verdict, fenced. */
export function validBlocker(userAction: string): string {
  return `Reviewed.\n\n\`\`\`json\n${JSON.stringify({
    verdict: 'blocker',
    userAction,
    nextStep: null,
    evidence: ['restart is not a file operation'],
    confidence: 'high',
  })}\n\`\`\``
}

/** A model-facing rejection code from one pre-execute decision. */
export function decisionCode(decision: unknown): string | undefined {
  if (typeof decision !== 'object' || decision === null) return undefined
  const value = decision as { info?: { code?: string }; kind?: string }
  return value.info?.code
}

/** The text of the latest injected notice. */
export function noticeText(harness: BlockReviewHarness): string {
  const message = harness.injected.at(-1)
  if (message === undefined) return ''
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

export function expectAllowed(decision: unknown, next: ReturnType<typeof vi.fn>): void {
  expect(decision).toEqual({ kind: 'allow' })
  expect(next).toHaveBeenCalledTimes(1)
}

/** Config with the reviewer target ready for a fake provider. */
export function reviewConfig(blockReview: BlockReviewConfig = {}): Config {
  return { blockReview: { provider: 'spawn', reviewerPreset: 'goal-reviewer', ...blockReview } }
}
