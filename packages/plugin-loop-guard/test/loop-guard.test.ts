import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { apply, DEFAULT_CONFIG, type ResolvedConfig } from '../lib/index.js'

/**
 * `@deepseek-ai/dsh-scope` is an uninstalled peer of `dsh-session` in this
 * repository (`autoInstallPeers: false`). The guard test needs the real
 * SessionStore for its reentrant-append boundary, so when the peer is absent
 * only its two scope-filter helpers are shimmed; everything else is the
 * published package.
 */
const require = createRequire(import.meta.url)
let scopeInstalled = true
try {
  require.resolve('@deepseek-ai/dsh-scope')
} catch {
  scopeInstalled = false
}
if (!scopeInstalled) {
  const shim = `data:text/javascript,${encodeURIComponent(
    'export const scopeOf = () => undefined\nexport const scopeTarget = (target) => target\n',
  )}`
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-scope') {
        return { url: shim, format: 'module', shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
  })
}
const { SessionId, SessionStore } = await import('@deepseek-ai/dsh-session')

type CancelCause = { kind: string; reason?: string }

interface FakeAgent {
  readonly id: ReturnType<typeof SessionId>
  readonly session: Session
  readonly steers: UserMessage[]
  readonly followups: UserMessage[]
  readonly cancels: Array<{ cause: CancelCause; options?: { keepInbox?: boolean } }>
  readonly removed: string[]
  readonly appendErrors: unknown[]
  readonly pending: UserMessage[]
  readonly controller: AbortController
  readonly agent: Agent
}

interface HarnessOptions {
  readonly realSession?: boolean
  readonly subagent?: boolean
  readonly throwOnLookup?: boolean
  readonly onClose?: () => void
}

interface Harness {
  readonly agent: FakeAgent
  readonly session: Session
  readonly preStep: (turn: number, step?: number) => Promise<void>
  readonly runStream: (
    chunks: readonly StreamChunk[],
    overrides?: Partial<GenerateOptions>,
  ) => Promise<{
    collected: StreamChunk[]
    consumed: number
    closed: boolean
  }>
  readonly finishStep: (turn: number, step: number, withCall: boolean) => void
}

/** Resolve one complete test configuration from overrides. */
function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return Object.freeze({
    ...DEFAULT_CONFIG,
    minRepeats: 2,
    minLineChars: 4,
    ...overrides,
  })
}

/** Build the first user message of a fake inbox. */
function userMessage(text: string): UserMessage {
  const message: UserMessage = {
    id: randomUUID() as UserMessage['id'],
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
  return Object.freeze(message)
}

/** One completed tool-call block followed by a repeated reasoning line. */
function callThenLoop(repeat = 2): StreamChunk[] {
  const callId = 'call-1' as never
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 0,
      id: callId,
      name: 'write',
      argumentsDelta: '{"path":"a.txt"',
    },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name: 'write', arguments: '{"path":"a.txt"}' },
    },
    { type: 'block-start', index: 1, blockType: 'reasoning' },
    ...Array.from({ length: repeat }, () => ({
      type: 'reasoning-delta' as const,
      index: 1,
      text: 'The same repeated planning line.\n',
    })),
    { type: 'block-start', index: 2, blockType: 'text' },
    { type: 'text-delta', index: 2, text: 'not reached' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One reasoning stream that repeats the line enough to trigger a cut. */
function repeatedReasoning(repeat = 2): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    ...Array.from({ length: repeat }, () => ({
      type: 'reasoning-delta' as const,
      index: 0,
      text: 'The same repeated planning line.\n',
    })),
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Normal prose; the detector must leave it alone. */
function normalReasoning(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'Planning the next step.\n' },
    { type: 'reasoning-delta', index: 0, text: 'Reading the tool result.\n' },
    { type: 'reasoning-delta', index: 0, text: 'Writing the final answer.\n' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One repeated line in one reasoning block. */
function oneLineReasoning(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'The same repeated planning line.\n' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Message text, used to assert bounded notices. */
function noticeText(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** Build one plugin instance over a real Cordis context and a fake agent. */
function createHarness(
  overrides: Partial<ResolvedConfig> = {},
  options: HarnessOptions = {},
): Harness {
  const resolved = config(overrides)
  const ctx = new Context()
  const session: Session = options.realSession
    ? new SessionStore(ctx).create(SessionId(`loop-guard-${randomUUID()}`))
    : ({
        id: SessionId('fake-session'),
        header: options.subagent === true ? { origin: 'subagent' } : {},
      } as unknown as Session)
  const controller = { current: new AbortController() }
  const steers: UserMessage[] = []
  const followups: UserMessage[] = []
  const cancels: Array<{ cause: CancelCause; options?: { keepInbox?: boolean } }> = []
  const removed: string[] = []
  const appendErrors: unknown[] = []
  const pending: UserMessage[] = []
  const inbox = {
    remove(id: string): boolean {
      const index = pending.findIndex((message) => message.id === id)
      if (index >= 0) pending.splice(index, 1)
      removed.push(id)
      if (options.realSession === true) {
        try {
          session.append('agent/inbox/spliced', {
            target: 'next-step',
            start: 0,
            removedCount: index >= 0 ? 1 : 0,
            inserted: [],
          })
        } catch (error) {
          appendErrors.push(error)
        }
      }
      return index >= 0
    },
  }
  const fake: FakeAgent = {
    id: session.id,
    session,
    steers,
    followups,
    cancels,
    removed,
    appendErrors,
    pending,
    get controller(): AbortController {
      return controller.current
    },
    agent: {
      id: session.id,
      session,
      steer(message: UserMessage): void {
        steers.push(message)
      },
      followup(message: UserMessage): void {
        followups.push(message)
        if (options.realSession === true) {
          try {
            session.append('agent/inbox/spliced', {
              target: 'next-turn',
              start: 0,
              removedCount: 0,
              inserted: [message],
            })
          } catch (error) {
            appendErrors.push(error)
          }
        }
      },
      cancel(cause: CancelCause, cancelOptions?: { keepInbox?: boolean }): void {
        cancels.push({ cause, options: cancelOptions })
        controller.current.abort(cause)
      },
      inbox,
    } as unknown as Agent,
  }
  const agents = new Map<string, Agent>([[session.id, fake.agent]])
  ctx.provide('agents', {
    get(id: string): Agent | undefined {
      if (options.throwOnLookup === true) throw new Error('registry unavailable')
      return agents.get(id)
    },
  } as unknown as AgentRegistry)
  apply(ctx, resolved)

  let currentTurn: number | null = null
  async function preStep(turn: number, step = 1): Promise<void> {
    // The real loop replaces the turn controller for each new turn; the
    // previous turn's controller stays aborted with its winning cause.
    if (currentTurn !== turn) {
      currentTurn = turn
      if (controller.current.signal.aborted) controller.current = new AbortController()
    }
    await ctx.waterfall(
      'agent/pre-step',
      { agent: fake.agent, messages: [], turn, step, signal: controller.current.signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
  }

  async function runStream(
    chunks: readonly StreamChunk[],
    overrides: Partial<GenerateOptions> = {},
  ): Promise<{
    collected: StreamChunk[]
    consumed: number
    closed: boolean
  }> {
    let consumed = 0
    let closed = false
    async function* source(): AsyncGenerator<StreamChunk> {
      try {
        for (const chunk of chunks) {
          consumed += 1
          yield chunk
        }
      } finally {
        closed = true
        options.onClose?.()
      }
    }
    const streamOptions: GenerateOptions = {
      provider: 'test',
      model: 'test',
      messages: [],
      sessionId: session.id,
      signal: controller.current.signal,
      ...overrides,
    }
    const stream = ctx.waterfall('llm/stream', streamOptions, () => source())
    const collected: StreamChunk[] = []
    for await (const chunk of stream) collected.push(chunk)
    return { collected, consumed, closed }
  }

  function finishStep(turn: number, step: number, withCall: boolean): void {
    if (withCall) {
      const callId = 'call-1'
      session.append('tool/call', {
        turn,
        step,
        callId: callId as never,
        name: 'write',
        arguments: '{"path":"a.txt"}',
      })
      session.append(
        'tool/result',
        {
          turn,
          step,
          message: {
            id: randomUUID() as never,
            role: 'tool' as const,
            content: [{ type: 'text' as const, text: 'written' }],
            source: { kind: 'tool' as const, callId: callId as never },
            toolCallId: callId as never,
          },
        },
        { surfaceOp: 'append' as const },
      )
    }
    session.append('step/end', { turn, step })
  }

  return { agent: fake, session, preStep, runStream, finishStep }
}

/** Let the deferred reset microtask run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('loop guard stream', () => {
  it('cuts on repetition, stops consuming, and steers one notice', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const chunks = [
      { type: 'block-start' as const, index: 0, blockType: 'reasoning' as const },
      { type: 'reasoning-delta' as const, index: 0, text: 'The same repeated planning line.\n' },
      { type: 'reasoning-delta' as const, index: 0, text: 'The same repeated planning line.\n' },
      { type: 'reasoning-delta' as const, index: 0, text: 'The same repeated planning line.\n' },
      { type: 'finish' as const, reason: { kind: 'stop' as const } },
    ]
    const result = await harness.runStream(chunks)
    expect(result.collected).toEqual(chunks.slice(0, 2))
    expect(result.consumed).toBe(3)
    expect(result.closed).toBe(true)
    expect(harness.agent.steers).toHaveLength(1)
    const text = noticeText(harness.agent.steers[0] as UserMessage)
    expect(text).toContain('The same repeated planning line.')
    expect(text).toContain('Recovery 1 of 3')
    expect(harness.agent.steers[0]?.source).toMatchObject({ kind: 'loop-guard', form: 'notice' })
  })

  it('passes a normal stream through unchanged', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const chunks = normalReasoning()
    const result = await harness.runStream(chunks)
    expect(result.collected).toEqual(chunks)
    expect(result.consumed).toBe(chunks.length)
    expect(result.closed).toBe(true)
    expect(harness.agent.steers).toHaveLength(0)
  })

  it('drops no completed tool-call block when a later repetition is cut', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const chunks = callThenLoop()
    const result = await harness.runStream(chunks)
    expect(result.collected).toEqual(chunks.slice(0, 5))
    const completed = result.collected.find(
      (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
    )
    expect(completed).toBeDefined()
    if (completed?.type === 'block-end' && completed.block.type === 'tool-call') {
      expect(completed.block.arguments).toBe('{"path":"a.txt"}')
    }
    expect(result.collected.some((chunk) => chunk.type === 'text-delta')).toBe(false)
    expect(harness.agent.steers).toHaveLength(1)
  })

  it('does not cut while a tool-call block is open and steers instead', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: 'call-1' as never,
        name: 'write',
        argumentsDelta: '{"path":"a.txt"',
      },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: 'The same repeated planning line.\n' },
      { type: 'reasoning-delta', index: 1, text: 'The same repeated planning line.\n' },
      {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: 'call-1' as never,
          name: 'write',
          arguments: '{"path":"a.txt"}',
        },
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await harness.runStream(chunks)
    expect(result.collected).toEqual(chunks)
    expect(result.consumed).toBe(chunks.length)
    expect(harness.agent.steers).toHaveLength(1)
  })

  it('yields a completed tool-call block-end before cutting the active reasoning block', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const line = 'The same repeated planning line.'
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: 'call-1' as never,
        name: 'write',
        argumentsDelta: '{"path":"a.txt"}',
      },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: `${line}\n` },
      { type: 'reasoning-delta', index: 1, text: line },
      {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: 'call-1' as never,
          name: 'write',
          arguments: '{"path":"a.txt"}',
        },
      },
      {
        type: 'block-end',
        index: 1,
        block: { type: 'reasoning', text: line },
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await harness.runStream(chunks)
    const completedCall = result.collected.find(
      (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
    )
    expect(completedCall).toMatchObject({
      block: { type: 'tool-call', arguments: '{"path":"a.txt"}' },
    })
    expect(harness.agent.steers).toHaveLength(1)
  })

  it('detects a line repeated across reasoning blocks and resets the window at a new turn', async () => {
    const harness = createHarness({ minRepeats: 5, crossBlockRepeats: 2, crossBlockWindow: 5 })
    await harness.preStep(1, 1)
    await harness.runStream(oneLineReasoning())
    expect(harness.agent.steers).toHaveLength(0)

    await harness.preStep(1, 2)
    await harness.runStream(oneLineReasoning())
    expect(harness.agent.steers).toHaveLength(1)
    expect(noticeText(harness.agent.steers[0] as UserMessage)).toContain(
      '2 of the last 5 reasoning blocks',
    )

    await harness.preStep(2, 1)
    await harness.runStream(oneLineReasoning())
    expect(harness.agent.steers).toHaveLength(1)
  })

  it('ignores session-less and auxiliary model calls', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const chunks = repeatedReasoning()
    expect((await harness.runStream(chunks, { sessionId: undefined })).collected).toEqual(chunks)
    expect((await harness.runStream(chunks, { purpose: 'compaction' })).collected).toEqual(chunks)
    expect(harness.agent.steers).toHaveLength(0)
  })

  it('fails open when the agent lookup throws', async () => {
    const harness = createHarness({}, { throwOnLookup: true })
    await harness.preStep(1, 1)
    const chunks = repeatedReasoning()
    const result = await harness.runStream(chunks)
    expect(result.collected).toEqual(chunks)
    expect(harness.agent.steers).toHaveLength(0)
  })

  it('fails open when the detector throws on a malformed chunk', async () => {
    const harness = createHarness()
    await harness.preStep(1, 1)
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 42 as unknown as string },
      { type: 'reasoning-delta', index: 0, text: 'The same repeated planning line.\n' },
      { type: 'reasoning-delta', index: 0, text: 'The same repeated planning line.\n' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const result = await harness.runStream(chunks)
    expect(result.collected).toEqual(chunks)
    expect(harness.agent.steers).toHaveLength(0)
  })

  it('ignores subagent streams unless subagent scope is enabled', async () => {
    const disabled = createHarness({}, { subagent: true })
    await disabled.preStep(1, 1)
    const ignored = repeatedReasoning()
    expect((await disabled.runStream(ignored)).collected).toEqual(ignored)
    expect(disabled.agent.steers).toHaveLength(0)

    const enabled = createHarness({ subagents: true }, { subagent: true })
    await enabled.preStep(1, 1)
    await enabled.runStream(repeatedReasoning())
    expect(enabled.agent.steers).toHaveLength(1)
  })

  it('resets interventions at a new turn', async () => {
    const harness = createHarness({ maxInterventionsPerTurn: 2 })
    await harness.preStep(1, 1)
    await harness.runStream(repeatedReasoning())
    expect(harness.agent.steers).toHaveLength(1)

    await harness.preStep(2, 1)
    await harness.runStream(repeatedReasoning())
    expect(harness.agent.steers).toHaveLength(2)
    expect(harness.agent.cancels).toHaveLength(0)
    expect(noticeText(harness.agent.steers[1] as UserMessage)).toContain('Recovery 1 of 2')
  })

  it('delivers no notice or follow-up after an external cancel', async () => {
    for (const cause of [{ kind: 'user' }, { kind: 'parent' }, { kind: 'disposed' }] as const) {
      const harness = createHarness({ maxInterventionsPerTurn: 1 }, { realSession: true })
      await harness.preStep(1, 1)
      await harness.runStream(repeatedReasoning())
      expect(harness.agent.steers).toHaveLength(1)
      harness.agent.controller.abort(cause)
      harness.finishStep(1, 1, true)
      await flushMicrotasks()
      expect(harness.agent.followups).toHaveLength(0)
      expect(harness.agent.removed).toHaveLength(0)
    }
  })

  it('drops the reset follow-up when the user cancels during stream cleanup after the reset was scheduled', async () => {
    let armed = false
    let harness: Harness
    harness = createHarness(
      { maxInterventionsPerTurn: 1, maxResetsPerSession: 1 },
      {
        realSession: true,
        onClose: () => {
          if (armed) harness.agent.controller.abort({ kind: 'user' })
        },
      },
    )
    await harness.preStep(1, 1)
    await harness.runStream(repeatedReasoning())
    expect(harness.agent.steers).toHaveLength(1)

    // The second detection schedules the reset; the user cancels while the
    // source iterator is being closed, after the reset is pending.
    armed = true
    await harness.preStep(1, 2)
    await harness.runStream(repeatedReasoning())
    harness.finishStep(1, 2, true)
    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(0)
    expect(harness.agent.steers).toHaveLength(1)
  })

  it('does not follow up after another hook cancellation', async () => {
    const harness = createHarness({ maxInterventionsPerTurn: 1 }, { realSession: true })
    await harness.preStep(1, 1)
    await harness.runStream(repeatedReasoning())
    harness.agent.controller.abort({ kind: 'hook', reason: 'other-plugin' })
    harness.finishStep(1, 1, true)
    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(0)
  })
})

describe('loop guard step-end reset', () => {
  it('cancels at step end, removes its notice, keeps user steering, and starts one follow-up', async () => {
    const harness = createHarness(
      { maxInterventionsPerTurn: 2, maxResetsPerSession: 1 },
      { realSession: true },
    )

    // Step 1: first notice.
    await harness.preStep(1, 1)
    const first = await harness.runStream(callThenLoop())
    expect(first.collected.some((chunk) => chunk.type === 'text-delta')).toBe(false)
    harness.finishStep(1, 1, true)
    await flushMicrotasks()
    expect(harness.agent.cancels).toHaveLength(0)

    // Step 2: second notice; queued user steering survives the coming reset.
    await harness.preStep(1, 2)
    await harness.runStream(callThenLoop())
    const secondNotice = harness.agent.steers[1] as UserMessage
    harness.agent.pending.push(secondNotice)
    const user = userMessage('keep this queued instruction')
    harness.agent.pending.push(user)
    harness.finishStep(1, 2, true)
    await flushMicrotasks()
    expect(harness.agent.cancels).toHaveLength(0)

    // Step 3: the intervention limit schedules the reset at this step end.
    await harness.preStep(1, 3)
    await harness.runStream(callThenLoop())
    expect(harness.agent.steers).toHaveLength(2)
    harness.finishStep(1, 3, true)
    expect(harness.agent.cancels).toHaveLength(1)
    expect(harness.agent.cancels[0]?.cause).toMatchObject({ kind: 'hook' })
    expect(harness.agent.cancels[0]?.options).toEqual({ keepInbox: true })
    expect(harness.agent.followups).toHaveLength(0)

    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(1)
    expect(harness.agent.removed).toEqual([secondNotice.id])
    expect(harness.agent.pending).toEqual([user])
    expect(harness.agent.appendErrors).toEqual([])
    expect(harness.agent.steers).toHaveLength(2)

    const events = harness.session.snapshotEvents()
    const stepEnd = events.findLastIndex((event) => event.type === 'step/end')
    const spliced = events
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.type === 'agent/inbox/spliced')
    expect(spliced.length).toBeGreaterThan(0)
    for (const entry of spliced) expect(entry.index).toBeGreaterThan(stepEnd)
    expect(events.filter((event) => event.type === 'tool/call')).toHaveLength(3)
    expect(events.filter((event) => event.type === 'tool/result')).toHaveLength(3)
    expect(events.some((event) => event.type === 'step/end')).toBe(true)
  })

  it('stops with the final reason after the reset limit and cannot loop forever', async () => {
    const harness = createHarness(
      { maxInterventionsPerTurn: 1, maxResetsPerSession: 1 },
      { realSession: true },
    )

    // Turn 1: one notice, then the reset at the next detection.
    await harness.preStep(1, 1)
    await harness.runStream(callThenLoop())
    harness.finishStep(1, 1, true)
    await harness.preStep(1, 2)
    await harness.runStream(callThenLoop())
    harness.finishStep(1, 2, true)
    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(1)
    expect(harness.agent.cancels).toHaveLength(1)
    expect(harness.agent.cancels[0]?.cause.reason).toContain('reset the turn')

    // Turn 2: the reset budget is spent, so the next detection stops the turn.
    await harness.preStep(2, 1)
    await harness.runStream(callThenLoop())
    harness.finishStep(2, 1, true)
    await harness.preStep(2, 2)
    await harness.runStream(callThenLoop())
    harness.finishStep(2, 2, true)
    expect(harness.agent.cancels).toHaveLength(2)
    const finalReason = harness.agent.cancels[1]?.cause.reason ?? ''
    expect(finalReason).toContain('kept repeating')
    expect(finalReason).toContain('1 recovery notices')
    expect(finalReason).toContain('The same repeated planning line.')
    expect(harness.agent.cancels[1]?.options).toEqual({ keepInbox: true })
    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(1)

    // A third turn can only stop again; no endless reset cycle is possible.
    await harness.preStep(3, 1)
    await harness.runStream(callThenLoop())
    harness.finishStep(3, 1, true)
    await harness.preStep(3, 2)
    await harness.runStream(callThenLoop())
    harness.finishStep(3, 2, true)
    expect(harness.agent.cancels).toHaveLength(3)
    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(1)
  })

  it('clears the reset budget after a clean turn', async () => {
    const harness = createHarness(
      { maxInterventionsPerTurn: 1, maxResetsPerSession: 1 },
      { realSession: true },
    )

    // Turn 1 reaches one reset.
    await harness.preStep(1, 1)
    await harness.runStream(repeatedReasoning())
    harness.finishStep(1, 1, true)
    await harness.preStep(1, 2)
    await harness.runStream(repeatedReasoning())
    harness.finishStep(1, 2, true)
    await flushMicrotasks()
    expect(harness.agent.followups).toHaveLength(1)

    // Turn 2 is clean: the pre-step of turn 3 clears the reset budget.
    await harness.preStep(2, 1)
    await harness.runStream(normalReasoning())
    harness.finishStep(2, 1, false)
    await harness.preStep(3, 1)

    // Turn 3 may reset again instead of stopping.
    await harness.runStream(repeatedReasoning())
    harness.finishStep(3, 1, false)
    await harness.preStep(3, 2)
    await harness.runStream(repeatedReasoning())
    harness.finishStep(3, 2, false)
    await flushMicrotasks()
    expect(harness.agent.cancels).toHaveLength(2)
    expect(harness.agent.cancels[1]?.cause.reason).toContain('reset the turn')
    expect(harness.agent.followups).toHaveLength(2)
  })
})

describe('loop guard privacy', () => {
  it('caps the persisted preview in notices and the stop reason', async () => {
    const longLine = 'abcdefghijKLMNOPQRSTUVWXYZ0123456789'
    const harness = createHarness(
      { previewChars: 10, maxInterventionsPerTurn: 1, maxResetsPerSession: 0 },
      { realSession: true },
    )
    const repeated = [
      { type: 'block-start' as const, index: 0, blockType: 'reasoning' as const },
      { type: 'reasoning-delta' as const, index: 0, text: `${longLine}\n` },
      { type: 'reasoning-delta' as const, index: 0, text: `${longLine}\n` },
      { type: 'finish' as const, reason: { kind: 'stop' as const } },
    ]
    await harness.preStep(1, 1)
    await harness.runStream(repeated)
    const notice = noticeText(harness.agent.steers[0] as UserMessage)
    expect(notice).toContain('abcdefghi…')
    expect(notice).not.toContain(longLine)
    const noticeSource = harness.agent.steers[0]?.source as
      | { form?: string; summary?: string }
      | undefined
    expect(noticeSource?.form).toBe('notice')
    expect(noticeSource?.summary?.length).toBeLessThan(121)

    // The next detection is the final stop (maxResetsPerSession is 0).
    await harness.preStep(1, 2)
    await harness.runStream(repeated)
    harness.finishStep(1, 2, false)
    const reason = harness.agent.cancels[0]?.cause.reason ?? ''
    expect(reason).toContain('abcdefghi…')
    expect(reason).not.toContain(longLine)
    expect(reason).toContain('0 turn resets')
  })

  it('ships no file-writing or logging path for reasoning', () => {
    const built = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(built).not.toContain('node:fs')
    expect(built).not.toContain('console.')
  })
})

describe('loop guard configuration', () => {
  it('fails plugin load and names the invalid field', () => {
    const ctx = new Context()
    expect(() => apply(ctx, { minRepeats: 1 })).toThrow(/minRepeats/u)
    expect(() => apply(ctx, { previewChars: 0 })).toThrow(/previewChars/u)
    expect(() => apply(ctx, { text: false, reasoning: false })).toThrow(/reasoning/u)
  })

  it('starts with valid overrides and applies the custom threshold', async () => {
    const harness = createHarness({ minRepeats: 5 })
    await harness.preStep(1, 1)
    const four = repeatedReasoning(4)
    expect((await harness.runStream(four)).collected).toEqual(four)
    expect(harness.agent.steers).toHaveLength(0)
    await harness.preStep(1, 2)
    await harness.runStream(repeatedReasoning(5))
    expect(harness.agent.steers).toHaveLength(1)
    expect(noticeText(harness.agent.steers[0] as UserMessage)).toContain('repeated 5 times')
  })
})
