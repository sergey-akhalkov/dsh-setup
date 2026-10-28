import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalBlockReason, GoalOperation, GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../lib/index.js'

/**
 * Test doubles for the supervisor: a fake live agent, a fake goal service that
 * emits the same goal events, and synthetic session events. The harness never
 * imports the real session or goal services, so it needs no scope peer.
 */

export interface FakeGoal {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  blockedReason?: { code: string; message: string }
  maxGoalRounds: number
  roundsStarted: number
  createdAt: number
  updatedAt: number
  activation: 'armed' | 'disarmed'
}

function goalError(code: string): Error {
  const error = new Error(code)
  ;(error as { code?: string }).code = code
  return error
}

export class FakeGoals {
  goal: FakeGoal | undefined
  readonly calls: string[] = []
  readonly reads: Agent[] = []
  staleNext: 'edit' | 'resume' | undefined
  /** Raise the cap by this much when a stale edit is injected (a concurrent edit). */
  staleEditRaiseCap = 0
  /** Fail this many resume attempts with a stale revision before allowing one. */
  failResumeAttempts = 0
  /** Successful edits before forced edit failures begin. */
  failEditAfter = 0
  /** Forced stale edit failures to inject after failEditAfter successes. */
  failEditAttempts = 0

  readonly #ctx: Context
  readonly #agent: Agent
  #editCalls = 0

  constructor(ctx: Context, agent: Agent) {
    this.#ctx = ctx
    this.#agent = agent
  }

  #view(goal: FakeGoal | undefined = this.goal): GoalView | undefined {
    if (goal === undefined) return undefined
    return { ...goal, id: goal.id as GoalView['id'] } as GoalView
  }

  #ref(goal: FakeGoal): GoalRef {
    return { id: goal.id as GoalView['id'], revision: goal.revision }
  }

  #check(ref: GoalRef): void {
    if (this.goal === undefined) throw goalError('GOAL_NOT_FOUND')
    if (this.goal.id !== ref.id || this.goal.revision !== ref.revision) {
      throw goalError('GOAL_STALE_REVISION')
    }
  }

  #assertAgent(agent: Agent): void {
    if (agent !== this.#agent) throw goalError('GOAL_AGENT_NOT_LIVE')
  }

  #change(operation: GoalOperation): void {
    const goal = this.goal
    if (goal === undefined) return
    this.#ctx.emit('goal/changed', {
      agent: this.#agent,
      change: { operation, ref: this.#ref(goal), goal: this.#view(goal) },
    } as never)
  }

  #activation(): void {
    const goal = this.goal
    if (goal === undefined) return
    this.#ctx.emit('goal/activation-changed', {
      sessionId: this.#agent.id,
      goal: { id: goal.id as GoalView['id'], revision: goal.revision, activation: goal.activation },
    } as never)
  }

  /** Publish an activation edge only when the value actually changes. */
  #setActivation(next: 'armed' | 'disarmed'): void {
    if (this.goal === undefined || this.goal.activation === next) return
    this.goal.activation = next
    this.#activation()
  }

  get(agent: Agent): GoalView | undefined {
    this.#assertAgent(agent)
    this.reads.push(agent)
    return this.#view()
  }

  disarm(agent: Agent): GoalView | undefined {
    this.#assertAgent(agent)
    this.calls.push('disarm')
    this.#setActivation('disarmed')
    return this.#view()
  }

  resume(agent: Agent, ref: GoalRef): GoalView {
    this.#assertAgent(agent)
    this.calls.push('resume')
    if (this.staleNext === 'resume' || this.failResumeAttempts > 0) {
      if (this.staleNext === 'resume') this.staleNext = undefined
      if (this.failResumeAttempts > 0) this.failResumeAttempts -= 1
      if (this.goal !== undefined) this.goal.revision += 1
      throw goalError('GOAL_STALE_REVISION')
    }
    this.#check(ref)
    const goal = this.goal
    if (goal === undefined) throw goalError('GOAL_NOT_FOUND')
    if (goal.phase !== 'active' && goal.phase !== 'paused' && goal.phase !== 'blocked') {
      throw goalError('GOAL_INVALID_TRANSITION')
    }
    if (goal.phase === 'active' && goal.activation === 'armed') {
      throw goalError('GOAL_INVALID_TRANSITION')
    }
    if (goal.roundsStarted >= goal.maxGoalRounds) throw goalError('GOAL_INVALID_TRANSITION')
    goal.phase = 'active'
    goal.blockedReason = undefined
    goal.revision += 1
    goal.updatedAt = Date.now()
    this.#setActivation('armed')
    this.#change('resume')
    return this.#view(goal) as GoalView
  }

  edit(agent: Agent, ref: GoalRef, request: { maxGoalRounds?: number }): GoalView {
    this.#assertAgent(agent)
    this.calls.push('edit')
    this.#editCalls += 1
    if (this.failEditAttempts > 0 && this.#editCalls > this.failEditAfter) {
      this.failEditAttempts -= 1
      if (this.goal !== undefined) this.goal.revision += 1
      throw goalError('GOAL_STALE_REVISION')
    }
    if (this.staleNext === 'edit') {
      this.staleNext = undefined
      if (this.goal !== undefined) {
        this.goal.revision += 1
        if (this.staleEditRaiseCap > 0) {
          this.goal.maxGoalRounds = this.staleEditRaiseCap
          this.staleEditRaiseCap = 0
        }
      }
      throw goalError('GOAL_STALE_REVISION')
    }
    this.#check(ref)
    const goal = this.goal
    if (goal === undefined) throw goalError('GOAL_NOT_FOUND')
    goal.maxGoalRounds = request.maxGoalRounds ?? goal.maxGoalRounds
    goal.revision += 1
    goal.updatedAt = Date.now()
    this.#change('edit')
    return this.#view(goal) as GoalView
  }

  block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView {
    this.#assertAgent(agent)
    this.calls.push('block')
    this.#check(ref)
    const goal = this.goal
    if (goal === undefined) throw goalError('GOAL_NOT_FOUND')
    if (goal.phase !== 'active') throw goalError('GOAL_INVALID_TRANSITION')
    goal.phase = 'blocked'
    goal.blockedReason = { code: reason.code, message: reason.message }
    goal.revision += 1
    goal.updatedAt = Date.now()
    this.#setActivation('disarmed')
    this.#change('block')
    return this.#view(goal) as GoalView
  }

  pause(agent: Agent, ref: GoalRef): GoalView {
    this.#assertAgent(agent)
    this.calls.push('pause')
    this.#check(ref)
    const goal = this.goal
    if (goal === undefined) throw goalError('GOAL_NOT_FOUND')
    if (goal.phase !== 'active') throw goalError('GOAL_INVALID_TRANSITION')
    goal.phase = 'paused'
    goal.revision += 1
    goal.updatedAt = Date.now()
    this.#setActivation('disarmed')
    this.#change('pause')
    return this.#view(goal) as GoalView
  }

  complete(agent: Agent, ref: GoalRef): GoalView {
    this.#assertAgent(agent)
    this.calls.push('complete')
    this.#check(ref)
    const goal = this.goal
    if (goal === undefined) throw goalError('GOAL_NOT_FOUND')
    if (goal.phase === 'complete') throw goalError('GOAL_INVALID_TRANSITION')
    goal.phase = 'complete'
    goal.revision += 1
    goal.updatedAt = Date.now()
    this.#setActivation('disarmed')
    this.#change('complete')
    return this.#view(goal) as GoalView
  }

  clear(agent: Agent, ref: GoalRef): GoalRef {
    this.#assertAgent(agent)
    this.calls.push('clear')
    this.#check(ref)
    const goal = this.goal
    if (goal === undefined) throw goalError('GOAL_NOT_FOUND')
    const cleared: GoalRef = { id: goal.id as GoalView['id'], revision: goal.revision + 1 }
    this.goal = undefined
    this.#ctx.emit('goal/changed', {
      agent: this.#agent,
      change: { operation: 'clear', ref: cleared },
    } as never)
    this.#ctx.emit('goal/activation-changed', { sessionId: this.#agent.id } as never)
    return cleared
  }
}

export function makeGoal(overrides: Partial<FakeGoal> = {}): FakeGoal {
  return {
    id: `goal-${randomUUID()}`,
    revision: 1,
    objective: 'Ship the migration.',
    phase: 'active',
    maxGoalRounds: 256,
    roundsStarted: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activation: 'armed',
    ...overrides,
  }
}

export interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly goals: FakeGoals
  readonly injected: UserMessage[]
  readonly followups: UserMessage[]
  readonly steers: UserMessage[]
  readonly mountedAt: number
  emitSession(event: unknown): void
  emitStatus(status: 'idle' | 'running'): void
  emitError(): void
  flush(): Promise<void>
}

export interface HarnessOptions {
  readonly config?: Config
  /** Treat the session as restored: its creation time precedes the mount. */
  readonly restart?: boolean
  /** Created before mount and returned by agents.list() during apply. */
  readonly existing?: boolean
  readonly initialGoal?: Partial<FakeGoal>
  readonly header?: Record<string, unknown>
  readonly throwOnInject?: boolean
  /** Omit the session creation time to exercise the first-observation fallback. */
  readonly missingCreatedAt?: boolean
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const ctx = new Context()
  const sessionId = `session-${randomUUID()}`
  const session = {
    id: sessionId,
    header: {
      version: 1,
      id: sessionId,
      createdAt: Date.now(),
      isSeeded: false,
      ...options.header,
    },
  } as unknown as Session
  const injected: UserMessage[] = []
  const followups: UserMessage[] = []
  const steers: UserMessage[] = []
  const agent = {
    id: sessionId,
    session,
    status: 'idle',
    inject(message: UserMessage): void {
      if (options.throwOnInject === true) throw new Error('agent disposed')
      injected.push(message)
    },
    followup(message: UserMessage): void {
      followups.push(message)
    },
    steer(message: UserMessage): void {
      steers.push(message)
    },
  } as unknown as Agent
  const goals = new FakeGoals(ctx, agent)
  if (options.initialGoal !== undefined) goals.goal = makeGoal(options.initialGoal)
  const existing = options.existing ?? false
  const agents = new Map<string, Agent>([[sessionId, agent]])
  ctx.provide('agents', {
    list: () => (existing ? [agent] : []),
    get: (id: string) => agents.get(id),
  } as never)
  ctx.provide('goals', goals as never)
  const mountedAt = Date.now()
  apply(ctx, options.config)
  if (!existing) {
    const header = session.header as { createdAt?: number }
    if (options.missingCreatedAt === true) header.createdAt = undefined
    else header.createdAt = options.restart === true ? mountedAt - 1000 : mountedAt + 1000
    ctx.emit('agent/created', { agent, source: options.restart === true ? 'resume' : 'startup' })
  }
  return {
    ctx,
    agent,
    session,
    goals,
    injected,
    followups,
    steers,
    mountedAt,
    emitSession(event: unknown): void {
      ctx.emit('session/event', session, event as SessionEvent)
    },
    emitStatus(status: 'idle' | 'running'): void {
      ctx.emit('agent/status', { agent, status } as never)
    },
    emitError(): void {
      ctx.emit('agent/error', { agent, turn: 1, step: 1, error: new Error('boom') } as never)
    },
    flush,
  }
}

export function setGoal(harness: Harness, overrides: Partial<FakeGoal> = {}): FakeGoal {
  const goal = makeGoal(overrides)
  harness.goals.goal = goal
  return goal
}

export function turnStart(harness: Harness, turn = 1): void {
  harness.emitSession({ type: 'turn/start', seq: 1, time: Date.now(), data: { turn } })
}

export function goalMessage(harness: Harness, goal: FakeGoal, round = 1): void {
  harness.emitSession({
    type: 'user/message',
    seq: 1,
    time: Date.now(),
    data: {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: '<goal_round />' }],
      source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
    },
  })
}

export function directMessage(harness: Harness): void {
  harness.emitSession({
    type: 'user/message',
    seq: 1,
    time: Date.now(),
    data: {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: 'keep going' }],
      source: { kind: 'user' },
    },
  })
}

export function turnEnd(harness: Harness, reason: Record<string, unknown>, turn = 1): void {
  harness.emitSession({
    type: 'turn/end',
    seq: 1,
    time: Date.now(),
    data: { turn, reason },
  })
}

/** Simulate the driver's turn/end reaction for a non-goal aborted turn. */
export function driverDisarm(harness: Harness): void {
  harness.goals.disarm(harness.agent)
}

/** Simulate the driver's idle settlement for a cancelled goal round. */
export function driverPauseCancelledRound(harness: Harness): void {
  const goal = harness.goals.goal
  if (goal !== undefined && goal.phase === 'active' && goal.activation === 'armed') {
    harness.goals.pause(harness.agent, { id: goal.id as GoalView['id'], revision: goal.revision })
  }
}

export function noticeText(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

export function countCalls(harness: Harness, name: string): number {
  return harness.goals.calls.filter((call) => call === name).length
}
