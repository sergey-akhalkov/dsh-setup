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
import { apply, type BlockReviewConfig, type Config, type SpeedReviewConfig } from '../lib/index.js'

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
  /** Activation never returns (stalled-startup timeout test). */
  startHang?: boolean
  /** Disposal never settles (cleanup-timeout test). */
  disposeHang?: boolean
  /** Result waits for `release()` (late-result test). */
  defer?: boolean
  /** Result settles with a non-completed stop reason. */
  stopReason?: SubagentResult['stopReason']
  /** Verdict text builder; defaults to a valid no-action verdict. */
  respond?: (run: ReviewRun) => string
}

/** One fake workspace child context paired with its preset-only tool surface. */
export interface FakeReviewerChild {
  agent: Agent
  restrictions: Array<{ allow?: readonly string[] }>
}

/** One valid fenced `no-action` verdict. */
export function validNoAction(): string {
  return `Reviewed.\n\n\`\`\`json\n${JSON.stringify({ verdict: 'no-action' })}\n\`\`\``
}

/** One valid fenced `speedup` verdict. */
export function validSpeedup(speedupId: string): string {
  return `Reviewed.\n\n\`\`\`json\n${JSON.stringify({
    verdict: 'speedup',
    bottleneck: 'the full check ran before two independent test files',
    action: 'start one worker while the main agent keeps integration',
    handoff: 'Change only the two test files and report the focused commands.',
    expectedSaving: '2-4 min per round',
    risk: 'low: the worker edits a test-only directory the main agent reviews',
    speedupId,
  })}\n\`\`\``
}

/** The text of the latest model-facing notice. */
export function noticeText(message: UserMessage | undefined): string {
  if (message === undefined) return ''
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** One goal-round message as it enters the first step of its turn. */
export function goalUserMessage(goal: FakeGoal, round: number): UserMessage {
  return {
    id: `goal-step-message-${round}`,
    role: 'user',
    content: [{ type: 'text', text: '<goal_round />' }],
    source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
  } as unknown as UserMessage
}

/**
 * Test doubles for the goal-round speed review: a real Cordis context, a fake
 * goal service, a fake subagent provider that publishes a reviewer child
 * through the real `agent/created` dispatch, timed session events, and a fake
 * root tool registry for the follow-through availability checks.
 */
export class SpeedReviewHarness {
  readonly ctx = new Context()
  readonly agent: Agent
  readonly session: Session
  readonly injected: UserMessage[] = []
  readonly steers: UserMessage[] = []
  readonly runs: ReviewRun[] = []
  readonly children: FakeReviewerChild[] = []
  readonly restrictions: Array<{ allow?: readonly string[] }> = []
  readonly globals = new Set<string>([...REVIEWER_TOOLS, ...MUTATION_TOOLS])
  readonly availableTools = new Set<string>()
  readonly disposals: Array<ReturnType<typeof vi.fn>> = []
  readonly startCalls: number[] = []
  /** Session working directory the plugin reads; defaults to the workspace. */
  cwd: string
  goal: FakeGoal | undefined
  events: SessionEvent[] = []
  private readonly workspaceDirectory: string
  private readonly options: FakeSubagentsOptions
  private readonly capabilities: SubagentCapabilities
  private readonly provider: SubagentProvider
  private readonly releases: Array<(text: string) => void> = []

  private constructor(
    workspace: string,
    config: Config,
    options: FakeSubagentsOptions,
    goal?: Partial<FakeGoal>,
  ) {
    this.workspaceDirectory = workspace
    this.cwd = workspace
    this.options = options
    this.capabilities = {
      agentOptions: true,
      agentPreset: true,
      outputSchema: true,
      depthLimit: true,
      ...options.capabilities,
    }
    this.provider = {
      name: 'spawn',
      capabilities: this.capabilities,
      inheritsParentContext: options.inheritsParentContext ?? false,
    }
    this.agent = this.createRootAgent(goal)
    this.session = this.agent.session
    const subagents = {
      list: () => ['spawn', 'fork'],
      getProvider: (name: string) => (name === 'spawn' ? this.provider : undefined),
      startActivation: async (spec: SubagentActivationSpec): Promise<SubagentActivation> => {
        this.startCalls.push(1)
        if (options.startHang === true) {
          return new Promise<SubagentActivation>(() => undefined)
        }
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
        this.runs.push(run)
        const child = this.createReviewerChild(spec)
        this.children.push(child)
        this.ctx.emit('agent/created', { agent: child.agent, source: 'startup' })
        const result = this.resultFor(run)
        const dispose =
          options.disposeHang === true
            ? vi.fn(() => new Promise<void>(() => undefined))
            : vi.fn(async () => undefined)
        this.disposals.push(dispose)
        return { childId: child.agent.id, result, dispose }
      },
    }
    this.ctx.provide('agents', {
      list: () => [this.agent],
      get: (id: string) =>
        id === this.agent.id
          ? this.agent
          : this.children.find((child) => child.agent.id === id)?.agent,
      roots: () => [this.agent],
      currentInitiator: () => this.agent,
    } as never)
    this.ctx.provide('goals', { get: () => this.goalView() } as never)
    this.ctx.provide('subagents', subagents as never)
    this.ctx.provide('workingDirectory', { get: () => this.cwd } as never)
    this.ctx.provide('tools', {
      get: (name: string) => (this.availableTools.has(name) ? { name } : undefined),
    } as never)
    apply(this.ctx, config)
  }

  static async create(
    options: FakeSubagentsOptions = {},
    config: Config = speedReviewConfig(),
    goal: Partial<FakeGoal> = {},
  ): Promise<{ harness: SpeedReviewHarness; cleanup: () => Promise<void> }> {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-goal-speed-'))
    const harness = new SpeedReviewHarness(workspace, config, options, goal)
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
      steer: (message: UserMessage) => {
        this.steers.push(message)
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
    if (this.options.defer === true) {
      return new Promise<SubagentResult>((resolve) => {
        this.releases.push((text) =>
          resolve({
            output: [{ type: 'text', text }],
            stopReason: this.options.stopReason ?? 'completed',
          }),
        )
      })
    }
    const text = this.options.respond?.(run) ?? validNoAction()
    return Promise.resolve({
      output: [{ type: 'text', text }],
      stopReason: this.options.stopReason ?? 'completed',
    })
  }

  /** Resolve the oldest deferred review with the given verdict text. */
  release(text: string = validNoAction()): void {
    const release = this.releases.shift()
    if (release === undefined) throw new Error('no deferred review is waiting')
    release(text)
  }

  /** Resolve the newest deferred review, leaving older ones pending. */
  releaseLast(text: string = validNoAction()): void {
    const release = this.releases.pop()
    if (release === undefined) throw new Error('no deferred review is waiting')
    release(text)
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

  append(event: Record<string, unknown>, time = Date.now()): void {
    const full = { seq: this.events.length, time, ...event } as SessionEvent
    this.events.push(full)
    this.ctx.emit('session/event', this.session, full)
  }

  turnStart(turn = 1, time = Date.now()): void {
    this.append({ type: 'turn/start', data: { turn } }, time)
  }

  goalMessage(goal: FakeGoal, round = goal.roundsStarted, time = Date.now()): void {
    this.append(
      {
        type: 'user/message',
        data: {
          id: `goal-message-${this.events.length}`,
          role: 'user',
          content: [{ type: 'text', text: '<goal_round />' }],
          source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
        },
      },
      time,
    )
  }

  directMessage(text = 'keep going', time = Date.now()): void {
    this.append(
      {
        type: 'user/message',
        data: {
          id: `user-message-${this.events.length}`,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        },
      },
      time,
    )
  }

  toolCall(name: string, args: unknown, time = Date.now(), turn = 1): string {
    const callId = `call-${this.events.length}`
    this.append(
      {
        type: 'tool/call',
        data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) },
      },
      time,
    )
    return callId
  }

  toolResult(callId: string, text = 'ok', time = Date.now(), isError = false, turn = 1): void {
    this.append(
      {
        type: 'tool/result',
        data: {
          turn,
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
      },
      time,
    )
  }

  turnEnd(
    reason: Record<string, unknown> = { kind: 'completed' },
    time = Date.now(),
    turn = 1,
  ): void {
    this.append({ type: 'turn/end', data: { turn, reason } }, time)
  }

  /** Run the registered pre-step waterfall and return its decision. */
  async preStep(turn = 1, messages: UserMessage[] = []): Promise<unknown> {
    const decision = { kind: 'enter', messages: [] as UserMessage[] }
    const next = vi.fn(async () => decision)
    const waterfall = this.ctx.waterfall as unknown as (
      name: string,
      payload: unknown,
      next: unknown,
    ) => Promise<unknown>
    return waterfall.call(
      this.ctx,
      'agent/pre-step',
      {
        agent: this.agent,
        messages,
        turn,
        step: 1,
        signal: new AbortController().signal,
      },
      next,
    )
  }

  /** Run the registered turn-stopping listeners. */
  async turnStopping(turn = 1, agent: Agent = this.agent): Promise<void> {
    const serial = this.ctx.serial as unknown as (
      name: string,
      payload: unknown,
    ) => Promise<unknown>
    await serial.call(this.ctx, 'agent/turn-stopping', {
      agent,
      turn,
      signal: new AbortController().signal,
    })
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const path = join(this.workspaceDirectory, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }

  recordPath(goalId = 'goal-1', round = 1): string {
    return join(this.cwd, '.dsh', 'goal-continuity', 'retro', goalId, `${round}.json`)
  }

  async readRecord(goalId = 'goal-1', round = 1): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(this.recordPath(goalId, round), 'utf8')) as Record<
      string,
      unknown
    >
  }

  async tryReadRecord(goalId = 'goal-1', round = 1): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.readRecord(goalId, round)
    } catch {
      return undefined
    }
  }

  async writeRecord(record: Record<string, unknown>, goalId = 'goal-1', round = 1): Promise<void> {
    const path = this.recordPath(goalId, round)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  }

  /** Wait until a review record appears and return it. */
  async waitForRecord(goalId = 'goal-1', round = 1): Promise<Record<string, unknown>> {
    return vi.waitFor(async () => {
      const record = await this.tryReadRecord(goalId, round)
      expect(record).toBeDefined()
      return record as Record<string, unknown>
    })
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

/** Config with both reviewer targets ready for the fake provider. */
export function speedReviewConfig(
  speedReview: SpeedReviewConfig = {},
  blockReview: BlockReviewConfig = {},
): Config {
  return {
    blockReview: { provider: 'spawn', reviewerPreset: 'goal-reviewer', ...blockReview },
    speedReview: { provider: 'spawn', ...speedReview },
  }
}
