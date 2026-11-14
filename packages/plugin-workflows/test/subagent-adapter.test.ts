import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
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
