import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { classifyFailure } from '../src/host/review-queue.ts'
import { hostSubagentRunner } from '../src/host/subagent-adapter.ts'

interface Captured {
  spec: Record<string, unknown>
  disposed: number
}

function fakeRuntime(
  captured: Captured,
  result: Promise<{
    stopReason: string
    output: Array<{ type: string; text: string }>
    diagnostic?: string
  }>,
): SubagentRuntime {
  return {
    getProvider: () => ({ name: 'codex-subagent', capabilities: { agentOptions: true } }),
    startActivation: async (spec: Record<string, unknown>) => {
      captured.spec = spec
      return {
        childId: 'child-1',
        name: 'child',
        result,
        dispose: async () => {
          captured.disposed += 1
        },
      }
    },
  } as unknown as SubagentRuntime
}

const agent = { session: { id: 'session-1' } } as unknown as Agent

describe('host subagent adapter', () => {
  it('forwards the label, provider options, cwd, and delivery', async () => {
    const captured: Captured = { spec: {}, disposed: 0 }
    const runner = hostSubagentRunner(
      fakeRuntime(
        captured,
        Promise.resolve({
          stopReason: 'completed',
          output: [{ type: 'text', text: 'the verdict' }],
        }),
      ),
      agent,
    )
    const result = await runner.run({
      provider: 'codex-subagent',
      prompt: 'prompt',
      reviewer: 'codex',
      label: 'delegation:task-review',
      delivery: 'parent',
      cwd: '/snapshot',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
      agentOptions: { maxTokens: 10 },
    })
    expect(result).toMatchObject({ childId: 'child-1', completed: true, text: 'the verdict' })
    expect(captured.spec.label).toBe('delegation:task-review')
    expect(captured.spec.delivery).toBe('parent')
    expect(captured.spec.cwd).toBe('/snapshot')
    expect(captured.spec.agentOptions).toEqual({
      maxTokens: 10,
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    expect(captured.disposed).toBe(0)
  })

  it('disposes a published activation when the caller times out', async () => {
    const captured: Captured = { spec: {}, disposed: 0 }
    let resolveResult: (value: {
      stopReason: string
      output: Array<{ type: string; text: string }>
    }) => void = () => undefined
    const pending = new Promise<{
      stopReason: string
      output: Array<{ type: string; text: string }>
    }>((resolve) => {
      resolveResult = resolve
    })
    const runner = hostSubagentRunner(fakeRuntime(captured, pending), agent)
    const controller = new AbortController()
    const running = runner.run({ provider: 'codex-subagent', prompt: 'prompt' }, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(captured.disposed).toBe(1)
    resolveResult({ stopReason: 'cancelled', output: [] })
    const result = await running
    expect(result.completed).toBe(false)
  })

  it('waits for the disposed child before releasing teardown', async () => {
    const captured: Captured = { spec: {}, disposed: 0 }
    const runner = hostSubagentRunner(
      fakeRuntime(
        captured,
        new Promise(() => {
          // A cancelled child never completes; disposal is the only cleanup.
        }),
      ),
      agent,
    )
    const controller = new AbortController()
    void runner.run({ provider: 'codex-subagent', prompt: 'prompt' }, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await runner.waitForTeardown?.()
    expect(captured.disposed).toBe(1)
  })
  it('disposes an activation published after the abort already fired', async () => {
    const captured: Captured = { spec: {}, disposed: 0 }
    const runner = hostSubagentRunner(
      fakeRuntime(captured, Promise.resolve({ stopReason: 'completed', output: [] })),
      agent,
    )
    const controller = new AbortController()
    controller.abort()
    await runner.run({ provider: 'codex-subagent', prompt: 'prompt' }, controller.signal)
    expect(captured.disposed).toBe(1)
  })
})

describe('missing provider diagnostic', () => {
  it('names the reviewer, provider, and the config to change', async () => {
    const runtime = { getProvider: () => undefined } as unknown as SubagentRuntime
    const runner = hostSubagentRunner(runtime, agent)
    await expect(
      runner.run({ provider: 'absent', prompt: 'prompt', reviewer: 'codex' }),
    ).rejects.toThrow(/review target "codex" \(provider "absent"\).*reviewers\.codex\.provider/u)
  })
})

describe('adapter start and teardown signals', () => {
  it('reports a start failure through awaitStart and classifies it', async () => {
    const runtime = {
      getProvider: () => ({ name: 'codex-subagent', capabilities: { agentOptions: true } }),
      startActivation: async () => {
        throw new Error('permission denied: reviewer is not authorized')
      },
    } as unknown as SubagentRuntime
    const runner = hostSubagentRunner(runtime, agent)
    const running = runner.run({ provider: 'codex-subagent', prompt: 'prompt', reviewer: 'codex' })
    const startError = await runner.awaitStart?.().catch((error: unknown) => error)
    expect(startError).toBeInstanceOf(Error)
    expect(classifyFailure(startError, 'start')).toMatchObject({
      failureClass: 'permission',
      transient: false,
    })
    await expect(running).rejects.toThrow(/could not start: permission denied/)
  })

  it('resolves awaitStart only after the activation is published', async () => {
    const captured: Captured = { spec: {}, disposed: 0 }
    let publish: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      publish = resolve
    })
    const runtime = {
      getProvider: () => ({ name: 'codex-subagent', capabilities: { agentOptions: true } }),
      startActivation: async (spec: Record<string, unknown>) => {
        captured.spec = spec
        await gate
        return {
          childId: 'child-1',
          name: 'child',
          result: Promise.resolve({ stopReason: 'completed', output: [] }),
          dispose: async () => undefined,
        }
      },
    } as unknown as SubagentRuntime
    const runner = hostSubagentRunner(runtime, agent)
    const running = runner.run({ provider: 'codex-subagent', prompt: 'prompt' })
    let started = false
    void runner.awaitStart?.().then(() => {
      started = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started).toBe(false)
    publish?.()
    await runner.awaitStart?.()
    expect(started).toBe(true)
    await running
  })

  it('preserves a dispose failure and retries it until teardown confirms', async () => {
    const captured: Captured = { spec: {}, disposed: 0 }
    let failures = 2
    const runtime = {
      getProvider: () => ({ name: 'codex-subagent', capabilities: { agentOptions: true } }),
      startActivation: async () => ({
        childId: 'child-1',
        name: 'child',
        result: new Promise(() => undefined),
        dispose: async () => {
          captured.disposed += 1
          if (failures > 0) {
            failures -= 1
            throw new Error('teardown unconfirmed')
          }
        },
      }),
    } as unknown as SubagentRuntime
    const runner = hostSubagentRunner(runtime, agent)
    const controller = new AbortController()
    void runner.run({ provider: 'codex-subagent', prompt: 'prompt' }, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(runner.waitForTeardown?.()).rejects.toThrow(/teardown unconfirmed/)
    await expect(runner.waitForTeardown?.()).resolves.toBeUndefined()
    expect(captured.disposed).toBe(3)
    await expect(runner.waitForTeardown?.()).resolves.toBeUndefined()
    expect(captured.disposed).toBe(3)
  })
})
