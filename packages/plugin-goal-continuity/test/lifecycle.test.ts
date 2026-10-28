import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../lib/index.js'

/**
 * Per-agent state is an implementation detail, so it is observed through the
 * only effect the lifecycle has: whether a session event reaches a goal read.
 * If initialization or disposal is removed, these counts change.
 */

function makeSession(id: string, header: Record<string, unknown> = {}): Session {
  return {
    id,
    header: { createdAt: Date.now(), isSeeded: false, version: 1, ...header },
  } as unknown as Session
}

function makeAgent(id: string, header: Record<string, unknown> = {}): Agent {
  const session = makeSession(id, header)
  return { id, session } as unknown as Agent
}

function turnEnd(reason: Record<string, unknown>): SessionEvent {
  return {
    type: 'turn/end',
    seq: 1,
    time: Date.now(),
    data: { turn: 1, reason },
  } as unknown as SessionEvent
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

interface Harness {
  readonly ctx: Context
  readonly get: ReturnType<typeof vi.fn>
  readonly sessions: Map<string, Agent>
}

function createHarness(agents: Agent[], existing: Agent[] = agents): Harness {
  const ctx = new Context()
  const sessions = new Map(agents.map((agent) => [agent.id as string, agent]))
  const get = vi.fn(() => undefined)
  ctx.provide('agents', {
    list: () => existing,
    get: (id: string) => sessions.get(id),
  } as never)
  ctx.provide('goals', { get } as never)
  apply(ctx)
  return { ctx, get, sessions }
}

describe('per-agent state lifecycle', () => {
  it('initializes state for an agent that exists at mount', async () => {
    const agent = makeAgent('existing')
    const harness = createHarness([agent])
    harness.ctx.emit('session/event', agent.session, turnEnd({ kind: 'completed' }))
    await flush()
    expect(harness.get).toHaveBeenCalledTimes(1)
    expect(harness.get.mock.calls[0]?.[0]).toBe(agent)
  })

  it('initializes state for an agent created after mount', async () => {
    const agent = makeAgent('new')
    const harness = createHarness([agent], [])
    harness.ctx.emit('agent/created', { agent, source: 'startup' })
    harness.ctx.emit('session/event', agent.session, turnEnd({ kind: 'completed' }))
    await flush()
    expect(harness.get).toHaveBeenCalledTimes(1)
  })

  it('removes state when the agent is disposed', async () => {
    const agent = makeAgent('disposed')
    const harness = createHarness([agent])
    await flush()
    harness.get.mockClear()
    harness.ctx.emit('agent/disposed', { agent })
    harness.ctx.emit('session/event', agent.session, turnEnd({ kind: 'completed' }))
    await flush()
    expect(harness.get).not.toHaveBeenCalled()
  })

  it('keeps state isolated per agent', async () => {
    const first = makeAgent('first')
    const second = makeAgent('second')
    const harness = createHarness([first, second])
    await flush()
    harness.get.mockClear()
    harness.ctx.emit('agent/disposed', { agent: first })
    harness.ctx.emit('session/event', second.session, turnEnd({ kind: 'completed' }))
    await flush()
    expect(harness.get).toHaveBeenCalledTimes(1)
    expect(harness.get.mock.calls[0]?.[0]).toBe(second)
    harness.ctx.emit('session/event', first.session, turnEnd({ kind: 'completed' }))
    await flush()
    expect(harness.get).toHaveBeenCalledTimes(1)
  })

  it('does not track a forked or subagent session', async () => {
    const subagent = makeAgent('subagent', { origin: 'subagent' })
    const forked = makeAgent('forked', { parentSession: 'parent', isSeeded: true })
    const harness = createHarness([subagent, forked])
    harness.ctx.emit('session/event', subagent.session, turnEnd({ kind: 'completed' }))
    harness.ctx.emit('session/event', forked.session, turnEnd({ kind: 'completed' }))
    await flush()
    expect(harness.get).not.toHaveBeenCalled()
  })

  it('touches no service and registers no listener when disabled', () => {
    let touched = false
    const ctx = {
      get agents(): never {
        touched = true
        throw new Error('agents must not be read when disabled')
      },
      on: () => {
        touched = true
        return () => undefined
      },
    } as unknown as Context
    expect(() => apply(ctx, { enabled: false })).not.toThrow()
    expect(touched).toBe(false)
  })
})
