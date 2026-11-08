import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/host/index.ts'

/**
 * Host-level regression for the engine wiring: a `tools/pre-execute` call for
 * `openspec new change` must be refused with a started intake run and the
 * evaluation must land in the change-1 journal with its reason and run id.
 */

const TEMP_DIRECTORIES: string[] = []
const KEY = 'a'.repeat(64)

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-wiring-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  delete process.env.DSH_WORKFLOWS_HOST_KEY
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

type Listener = (...args: unknown[]) => unknown

function fakeHost(workspace: string): {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  emit(name: string, ...args: unknown[]): Promise<unknown>
} {
  const listeners = new Map<string, Listener[]>()
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' as const } },
    ctx: { on: () => () => {} },
    steer: () => {},
    inject: () => {},
  }
  const tools = {
    get: (name: string) =>
      ['delegate', 'task_progress', 'delegation_status', 'work_checkpoint'].includes(name)
        ? { name }
        : undefined,
    register: () => () => {},
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: unknown) => ({ targetKey: String(path) }),
          watch: async () => async () => {},
        }
      }
      if (name === 'connection') return { fetch: { register: () => () => {} } }
      if (name === 'tools') return tools
      return undefined
    },
    on(name: string, listener: Listener): () => void {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    effect(callback: () => () => void): () => void {
      callback()
      return () => {}
    },
  }
  return {
    ctx,
    agent,
    async emit(name, ...args): Promise<unknown> {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = await listener(...args)
      return result
    },
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('engine host wiring', () => {
  it('records a pre-execute evaluation with run-created and the run id', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-1',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string; reason?: string } | undefined
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () =>
      (await readFile(journalFile, 'utf8').catch(() => '')).includes('definition:change-intake'),
    )
    const raw = await readFile(journalFile, 'utf8')
    const record = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.kind === 'tools/pre-execute') as
      | { readonly triggers?: Array<Record<string, unknown>> }
      | undefined
    expect(
      record?.triggers?.find((entry) => entry.id === 'definition:change-intake'),
    ).toMatchObject({
      matched: true,
      reason: 'run-created',
    })
    const created = record?.triggers?.find((entry) => entry.id === 'definition:change-intake')
    expect(typeof created?.runId).toBe('string')
    // The first call is refused with the started run and the first step; the
    // evaluated intake trigger is not a second run.
    expect(nextCalled).toBe(false)
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toContain('requirements')
  })
})

describe('definition event normalization', () => {
  it('carries the review verdict and content hash into the review event', async () => {
    const workspace = await tempWorkspace()
    const path = 'openspec/changes/auth/reviews/0123456789abcdef.json'
    await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
      await mkdir(join(workspace, 'openspec', 'changes', 'auth', 'reviews'), { recursive: true })
      await writeFile(
        join(workspace, path),
        `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId: '0123456789abcdef', verdict: 'PASS', digest: 'a'.repeat(64), findings: [], time: '2026-11-08T00:00:00.000Z' })}\n`,
        'utf8',
      )
    })
    const { definitionEventsOf } = await import('../src/host/index.ts')
    const events = definitionEventsOf(
      {
        at: 1,
        session: 'session-1',
        turn: 2,
        kind: 'fs.change',
        subject: path,
        summary: 'x',
        bytes: 1,
        truncated: false,
      },
      { kind: 'fs.change', subject: path, change: 'modified', hash: 'abc' },
      workspace,
    )
    const review = events.find((event) => event.kind === 'review.record')
    expect(review).toMatchObject({ verdict: 'PASS', hash: 'abc', workspace })
  })
})

describe('retro applicability through the journal path', () => {
  it('records not-applicable for a short turn and creates an observational run for an applicable turn', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const readJournal = async (): Promise<Array<Record<string, unknown>>> =>
      (await readFile(journalFile, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    const retroRows = async (): Promise<Array<Record<string, unknown>>> =>
      (await readJournal()).flatMap((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).filter(
              (row) => row.id === 'definition:retro',
            )
          : [],
      )

    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 1,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'not-applicable'))
    expect((await retroRows()).some((row) => row.reason === 'run-created')).toBe(false)

    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 2,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    for (const name of ['read', 'read', 'read', 'read', 'write']) {
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: `call-${name}`,
          name,
          arguments: {},
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'run-created'))
    expect((await retroRows()).some((row) => row.reason === 'run-created')).toBe(true)
  })
})
