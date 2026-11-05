import { rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, type BundleConfig } from '../lib/index.js'
import { FakeGit, FakeSubagents, makeWorkspace, writeChange } from './helpers.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

interface LaneAgent {
  id: string
  session: { id: string; header: Record<string, never> }
  steer: (message: unknown) => void
}

interface HarnessOptions {
  cwd: string
  /** Worker-start tool names the registry reports as visible. */
  visibleWorkers?: string[]
  /** Set false to model a tools service without a lookup function. */
  toolLookup?: boolean
}

/**
 * Lane-local harness: the shared Harness has no tool-lookup registry, and the
 * lane gate reads one to decide whether a worker can be started at all.
 */
class LaneHarness {
  readonly agent: LaneAgent
  readonly steers: string[] = []
  private readonly cwd: string
  private readonly events = new Map<string, Array<(...args: unknown[]) => unknown>>()

  constructor(options: HarnessOptions) {
    this.cwd = options.cwd
    const steers = this.steers
    this.agent = {
      id: 'agent-1',
      session: { id: 'agent-1', header: {} },
      steer: (message: unknown) => {
        const content = (message as { content?: Array<{ text?: string }> }).content ?? []
        steers.push(content.map((block) => block.text ?? '').join('\n'))
      },
    }
    const events = this.events
    const ctx = {
      subagents: new FakeSubagents(),
      workingDirectory: { get: () => options.cwd },
      tools: {
        register: () => () => undefined,
        ...(options.toolLookup === false
          ? {}
          : {
              get: (name: string) =>
                options.visibleWorkers?.includes(name) === true ? { name } : undefined,
            }),
      },
      skills: { registerProvider: () => () => undefined },
      on: (name: string, handler: (...args: unknown[]) => unknown) => {
        const list = events.get(name) ?? []
        list.push(handler)
        events.set(name, list)
        return () => undefined
      },
    }
    const config: BundleConfig = {
      rules: [{ id: 'lane-fanout', when: 'lane-assignment', contract: 'note', gate: 'strict' }],
    }
    apply(ctx as unknown as Context, config, {
      runGit: new FakeGit().run,
      now: () => new Date('2026-11-05T00:00:00.000Z'),
    })
  }

  private async fire(name: string, args: unknown[]): Promise<void> {
    for (const handler of this.events.get(name) ?? []) await handler(...args)
  }

  async preStep(turn = 1): Promise<void> {
    await this.fire('agent/pre-step', [
      { agent: this.agent, turn, step: 1, messages: [], signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [] }),
    ])
  }

  async turnStopping(turn = 1): Promise<void> {
    await this.fire('agent/turn-stopping', [
      { agent: this.agent, turn, signal: new AbortController().signal },
    ])
  }

  async writeResult(filePath: string, before: string, after: string): Promise<void> {
    await this.fire('tools/result', [
      {
        agent: this.agent,
        arguments: { file_path: filePath },
        callId: 'call-1',
        name: 'write',
        rootCallId: 'root-1',
        signal: new AbortController().signal,
        token: Symbol('token'),
      },
      {
        isError: false,
        value: { path: resolve(this.cwd, filePath), before, after },
        content: [],
      },
    ])
  }
}

type Section = [heading: string, tasks: Array<[number: string, text: string, checked: boolean]>]

function plan(sections: Section[]): string {
  const lines = ['# Tasks', '']
  for (const [heading, tasks] of sections) {
    lines.push(`## ${heading}`, '')
    for (const [number, text, checked] of tasks) {
      lines.push(`- [${checked ? 'x' : ' '}] ${number} ${text}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

const FIXTURE = [
  { number: '1.1', text: 'First code' },
  { number: '1.2', text: 'Second code' },
  { number: '2.1', text: 'Write docs' },
  { number: '3.1', text: 'Run the gate' },
]

function twoLanes(code1: boolean, code2: boolean, docs: boolean): string {
  return plan([
    [
      '1. Code (owns `src/**`)',
      [
        ['1.1', 'First code', code1],
        ['1.2', 'Second code', code2],
      ],
    ],
    ['2. Docs (owns `docs/a.md`)', [['2.1', 'Write docs', docs]]],
    ['3. Serial tail (owns `packages/setup/**`)', [['3.1', 'Run the gate', false]]],
  ])
}

interface TickedTurn {
  harness: LaneHarness
  dir: string
}

async function tickedTurn(visibleWorkers: string[], toolLookup = true): Promise<TickedTurn> {
  const root = await workspace()
  const dir = await writeChange(root, 'change-a', FIXTURE)
  const before = twoLanes(false, false, false)
  const after = twoLanes(true, false, false)
  await writeFile(join(dir, 'tasks.md'), before, 'utf8')
  const harness = new LaneHarness({ cwd: root, visibleWorkers, toolLookup })
  await harness.preStep(1)
  await harness.writeResult(join(dir, 'tasks.md'), before, after)
  await writeFile(join(dir, 'tasks.md'), after, 'utf8')
  return { harness, dir }
}

describe('lane-assignment worker-tool visibility', () => {
  it('fails open when no worker-start tool is visible', async () => {
    const { harness } = await tickedTurn([])
    await harness.turnStopping(1)
    expect(harness.steers).toHaveLength(0)
  })

  it('reports the unassigned lane when a worker-start tool is visible', async () => {
    const { harness } = await tickedTurn(['subagent'])
    await harness.turnStopping(1)
    const message = harness.steers.join('\n')
    expect(message).toContain('rule "lane-fanout"')
    expect(message).toContain('lane-tag: change-a#2')
  })

  it('keeps the gate enabled when the tools registry cannot be read', async () => {
    const { harness } = await tickedTurn([], false)
    await harness.turnStopping(1)
    expect(harness.steers.join('\n')).toContain('lane-tag: change-a#2')
  })

  it('fails open when the task plan becomes unreadable', async () => {
    const { harness, dir } = await tickedTurn(['subagent'])
    await rm(join(dir, 'tasks.md'))
    await harness.turnStopping(1)
    expect(harness.steers.join('\n')).not.toContain('lane-fanout')
  })
})
