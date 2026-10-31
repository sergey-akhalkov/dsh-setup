import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply, type Config } from '../lib/index.js'

/** The tool the plugin registers for the checkpoint decision. */
export const CHECKPOINT_TOOL = 'work_checkpoint'

export interface CheckpointHarnessOptions {
  readonly config?: Config
  /** Header overrides, e.g. `origin: 'subagent'` for a subagent turn. */
  readonly header?: Record<string, unknown>
  /** The session id the record path hashes and the persisted record names. */
  readonly sessionId?: string
  /** Worker-start tools the fake registry reports as visible. */
  readonly availableTools?: readonly string[]
  /** Make the session snapshot throw to exercise the fail-open path. */
  readonly snapshotError?: boolean
  /** A fake active goal the supervisor may read; goal mutations are recorded. */
  readonly goal?: Record<string, unknown>
}

/**
 * Test doubles for the work checkpoint: a real Cordis context, a fake root
 * agent whose session log the plugin observes, a fake tool registry, and a fake
 * working directory. The checkpoint tool runs through its real definition.
 */
export class CheckpointHarness {
  readonly ctx = new Context()
  readonly agent: Agent
  readonly session: Session
  readonly events: SessionEvent[] = []
  readonly steers: UserMessage[] = []
  readonly injected: UserMessage[] = []
  readonly tools = new Map<string, ToolDefinition>()
  readonly availableTools: Set<string>
  readonly goalCalls: string[] = []
  sessionId: string
  readonly workspace: string
  private readonly snapshotError: boolean
  private readonly goal: Record<string, unknown> | undefined

  private constructor(workspace: string, options: CheckpointHarnessOptions) {
    this.workspace = workspace
    this.snapshotError = options.snapshotError ?? false
    this.availableTools = new Set(options.availableTools ?? [])
    this.goal = options.goal === undefined ? undefined : { ...options.goal }
    this.sessionId =
      options.sessionId ??
      `session-${createHash('sha256').update(workspace).digest('hex').slice(0, 12)}`
    const header = {
      version: 1,
      id: this.sessionId,
      createdAt: Date.now(),
      isSeeded: false,
      cwd: workspace,
      ...options.header,
    }
    this.session = {
      id: this.sessionId,
      header,
      snapshotEvents: () => {
        if (this.snapshotError) throw new Error('session log unavailable')
        return this.events
      },
    } as unknown as Session
    this.agent = {
      id: this.sessionId as never,
      session: this.session,
      status: 'running',
      inject: (message: UserMessage) => {
        this.injected.push(message)
      },
      steer: (message: UserMessage) => {
        this.steers.push(message)
      },
    } as unknown as Agent
    const agents = new Map<string, Agent>([[this.sessionId, this.agent]])
    this.ctx.provide('agents', {
      list: () => [this.agent],
      get: (id: string) => agents.get(id),
    } as never)
    this.ctx.provide('goals', {
      get: () => this.goal,
      disarm: () => {
        this.goalCalls.push('disarm')
        return this.goal
      },
      resume: () => {
        this.goalCalls.push('resume')
        return this.goal
      },
      edit: () => {
        this.goalCalls.push('edit')
        return this.goal
      },
      block: () => {
        this.goalCalls.push('block')
        return this.goal
      },
      pause: () => {
        this.goalCalls.push('pause')
        return this.goal
      },
      complete: () => {
        this.goalCalls.push('complete')
        return this.goal
      },
      clear: () => {
        this.goalCalls.push('clear')
        return this.goal
      },
    } as never)
    this.ctx.provide('workingDirectory', { get: () => this.workspace } as never)
    this.ctx.provide('tools', {
      register: (definition: ToolDefinition) => {
        this.tools.set(definition.name, definition)
        return () => this.tools.delete(definition.name)
      },
      get: (name: string) => {
        if (this.tools.has(name)) return this.tools.get(name)
        return this.availableTools.has(name) ? { name } : undefined
      },
      schemas: () => [...this.tools.values()],
    } as never)
    apply(this.ctx, options.config)
    this.ctx.emit('agent/created', { agent: this.agent, source: 'startup' })
  }

  static async create(options: CheckpointHarnessOptions = {}): Promise<{
    harness: CheckpointHarness
    cleanup: () => Promise<void>
  }> {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-goal-checkpoint-'))
    const harness = new CheckpointHarness(workspace, options)
    return {
      harness,
      cleanup: async () => {
        await rm(workspace, { recursive: true, force: true })
      },
    }
  }

  /** The hashed session directory the record must live under. */
  sessionDirectory(): string {
    const name = createHash('sha256').update(this.sessionId).digest('hex').slice(0, 16)
    return join(this.workspace, '.dsh', 'work-checkpoints', name)
  }

  /** Replace the session identity after creation, when the workspace is known. */
  resetSessionId(sessionId: string): void {
    this.sessionId = sessionId
    ;(this.session as { id: string }).id = sessionId
    ;(this.session.header as { id: string }).id = sessionId
    ;(this.agent as { id: string }).id = sessionId
  }

  recordPath(turn = 1): string {
    return join(this.sessionDirectory(), `${turn}.json`)
  }

  async readRecord(turn = 1): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(this.recordPath(turn), 'utf8')) as Record<string, unknown>
  }

  async tryReadRecord(turn = 1): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.readRecord(turn)
    } catch {
      return undefined
    }
  }

  async recordNames(): Promise<string[]> {
    try {
      return await readdir(this.sessionDirectory())
    } catch {
      return []
    }
  }

  /** Make the session directory path unusable, so the record write fails. */
  async blockSessionDirectory(): Promise<void> {
    const directory = this.sessionDirectory()
    await mkdir(join(this.workspace, '.dsh', 'work-checkpoints'), { recursive: true })
    await writeFile(directory, 'not a directory', 'utf8')
  }

  append(event: Record<string, unknown>, time = Date.now()): void {
    const full = { seq: this.events.length, time, ...event } as SessionEvent
    this.events.push(full)
    this.ctx.emit('session/event', this.session, full)
  }

  turnStart(turn = 1): void {
    this.append({ type: 'turn/start', data: { turn } })
  }

  goalMessage(round = 1): void {
    this.append({
      type: 'user/message',
      data: {
        id: `goal-message-${this.events.length}`,
        role: 'user',
        content: [{ type: 'text', text: '<goal_round />' }],
        source: { kind: 'goal', goalId: 'goal-1', revision: 1, round },
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

  toolResult(callId: string, text = 'ok', isError = false): void {
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

  /** Emit the live structured outcome the checkpoint gate observes for one call. */
  toolOutcome(name: string, callId: string, value: unknown, isError = false): void {
    this.ctx.emit(
      'tools/result',
      {
        agent: this.agent,
        arguments: {},
        callId,
        name,
        rootCallId: 'root-1',
        signal: new AbortController().signal,
        token: Symbol('token'),
      } as never,
      { isError, value, content: [] } as never,
    )
  }

  turnEnd(reason: Record<string, unknown> = { kind: 'completed' }, turn = 1): void {
    this.append({ type: 'turn/end', data: { turn, reason } })
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

  /** Run one `agent/pre-step` boundary through the registered waterfall. */
  async preStep(turn = 1, agent: Agent = this.agent): Promise<void> {
    const waterfall = this.ctx.waterfall as unknown as (
      name: string,
      payload: unknown,
      next: unknown,
    ) => Promise<unknown>
    await waterfall.call(
      this.ctx,
      'agent/pre-step',
      {
        agent,
        messages: [],
        turn,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter', messages: [] }),
    )
  }

  /** Run one tool definition the plugin registered. */
  async execute(name: string, args: unknown): Promise<unknown> {
    const definition = this.tools.get(name)
    if (definition === undefined) throw new Error(`tool "${name}" is not registered`)
    return definition.execute(args, { agent: this.agent } as never)
  }

  /** Emit one successful work_checkpoint call and run the real tool. */
  async checkpoint(args: unknown): Promise<{ text: string }> {
    const callId = this.toolCall(CHECKPOINT_TOOL, args)
    const value = (await this.execute(CHECKPOINT_TOOL, args)) as { text: string }
    this.toolResult(callId, value.text)
    return value
  }

  /** Emit one failed work_checkpoint call, as a rejected tool argument does. */
  async failedCheckpoint(args: unknown): Promise<string> {
    const callId = this.toolCall(CHECKPOINT_TOOL, args)
    try {
      await this.execute(CHECKPOINT_TOOL, args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.toolResult(callId, message, true)
      return message
    }
    throw new Error('the checkpoint call unexpectedly succeeded')
  }
}
