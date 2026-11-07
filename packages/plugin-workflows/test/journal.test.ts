import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/host/index.ts'
import { Journal } from '../src/host/journal.ts'

type Listener = (...args: unknown[]) => unknown

interface FakeAgent {
  id: string
  session: { id: string; header: { origin?: 'subagent'; parentSession?: string } }
  ctx: { on(name: string, listener: Listener): () => void }
  steer(message: unknown): void
}

interface FakeHost {
  readonly ctx: Record<string, unknown>
  readonly workspace: string
  readonly listeners: Map<string, Listener[]>
  readonly steers: unknown[]
  readonly agent: FakeAgent
  addAgent(id: string, origin?: 'subagent', parentSession?: string): FakeAgent
  emit(name: string, ...args: unknown[]): unknown
  dispose(): void
  calls(): { steers: number; injects: number; preExecute: number }
}

function createHost(workspace: string): FakeHost {
  const listeners = new Map<string, Listener[]>()
  const steers: unknown[] = []
  const agents = new Map<string, FakeAgent>()
  const effects: Array<() => void> = []
  const mainDisposers: Array<() => void> = []
  const remove = (name: string, listener: Listener): void => {
    const list = listeners.get(name)
    if (list === undefined) return
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }
  const add = (name: string, listener: Listener): void => {
    const list = listeners.get(name) ?? []
    list.push(listener)
    listeners.set(name, list)
  }
  const addAgent = (id: string, origin?: 'subagent', parentSession?: string): FakeAgent => {
    const agent: FakeAgent = {
      id,
      session: { id, header: { ...(origin === undefined ? {} : { origin }), ...(parentSession === undefined ? {} : { parentSession }) } },
      ctx: {
        on(name: string, listener: Listener): () => void {
          add(name, listener)
          return () => {
            remove(name, listener)
          }
        },
      },
      steer(message: unknown): void {
        steers.push(message)
      },
    }
    agents.set(id, agent)
    return agent
  }
  const agent = addAgent('session-1')
  const calls = { steers: 0, injects: 0, preExecute: 0 }
  const ctx = {
    get(name: string): unknown {
      if (name === 'agents') {
        return { get: (id: string) => agents.get(id), list: () => [...agents.values()] }
      }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: string) => ({ targetKey: path, displayPath: path }),
          watch: async () => async () => {},
        }
      }
      if (name === 'connection') return { fetch: { register: () => () => {} } }
      return undefined
    },
    on(name: string, listener: Listener): () => void {
      if (name === 'tools/pre-execute') calls.preExecute += 1
      add(name, listener)
      const dispose = (): void => {
        remove(name, listener)
      }
      mainDisposers.push(dispose)
      return dispose
    },
    effect(callback: () => () => void): () => void {
      const cleanup = callback()
      if (typeof cleanup === 'function') effects.push(cleanup as () => void)
      return () => {}
    },
  }
  const emit = (name: string, ...args: unknown[]): unknown => {
    let result: unknown
    for (const listener of [...(listeners.get(name) ?? [])]) result = listener(...args)
    return result
  }
  const dispose = (): void => {
    for (const cleanup of effects.splice(0)) cleanup()
    for (const cleanup of mainDisposers.splice(0)) cleanup()
  }
  return { ctx, workspace, listeners, steers, agent, addAgent, emit, dispose, calls: () => calls }
}

const step = async (host: FakeHost, agent: FakeAgent, turn: number, number: number): Promise<unknown> =>
  host.emit('agent/pre-step', {
    agent,
    turn,
    step: number,
    messages: [],
    signal: new AbortController().signal,
    modelSelection: { provider: 'p', model: 'm' },
  }, async () => ({ kind: 'continue' }))

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the journal did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-journal-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

describe('workflow event recorder', () => {
  it('records each observed event in order with its bounded fields', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    host.addAgent('child-9', 'subagent', 'session-1')
    apply(host.ctx as never)
    host.emit('agent/created', { agent: host.agent, source: 'fresh' })
    const journal = new Journal()

    await step(host, host.agent, 2, 3)
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-1', name: 'read', arguments: { path: 'notes.md' } },
      { isError: false, content: [{ type: 'text', text: 'contents' }] },
    )
    host.emit('agent/turn-stopping', { agent: host.agent, turn: 2, signal: new AbortController().signal })
    // The real DSH emitter calls a single-argument listener; the parent comes
    // from the child session's recorded direct parent, not a callback argument.
    host.emit('subagent/start', {
      runId: 'run-1',
      provider: 'spawn',
      id: 'child-9',
      local: true,
    })
    host.emit('subagent/end', {
      runId: 'run-1',
      provider: 'spawn',
      id: 'child-9',
      local: true,
      stopReason: 'completed',
    })

    await waitFor(async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 5)
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records.map((record) => record.kind)).toEqual([
      'agent/pre-step',
      'tools/result',
      'agent/turn-stopping',
      'subagent/start',
      'subagent/end',
    ])
    for (const record of records) {
      expect(record.v).toBe(1)
      expect(record.session).toBe('session-1')
      expect(typeof record.at).toBe('number')
      expect(typeof record.summary).toBe('string')
      expect(typeof record.bytes).toBe('number')
      expect(record.truncated).toBe(false)
    }
    expect(records[0]?.turn).toBe(2)
    expect(records[0]?.subject).toBe('root')
    expect(records[0]?.summary).toBe('step 3')
    expect(records[1]?.subject).toBe('read')
    expect(records[1]?.callId).toBe('call-1')
    expect(records[1]?.ok).toBe(true)
    expect(records[1]?.turn).toBe(2)
    expect(records[3]?.subject).toBe('child-9')
    expect(records[3]?.turn).toBe(2)
    expect(records[4]?.subject).toBe('child-9')
    expect(records[4]?.turn).toBe(2)
    expect(host.calls()).toEqual({ steers: 0, injects: 0, preExecute: 0 })
    expect(host.steers).toEqual([])
  })

  it('records a gate-refused stop attempt while the same turn continues', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    const gateRefusals: number[] = []

    await step(host, host.agent, 1, 1)
    // A fake gate refuses closure by steering the turn; the refusal is the
    // fact that leaves the same turn open, not a second pre-step alone.
    host.listeners.get('agent/turn-stopping')?.push((payload) => {
      const candidate = payload as { turn: number; agent: { steer(message: unknown): void } }
      gateRefusals.push(candidate.turn)
      candidate.agent.steer({ text: 'gate refused the close' })
    })
    host.emit('agent/turn-stopping', { agent: host.agent, turn: 1, signal: new AbortController().signal })
    expect(gateRefusals).toEqual([1])
    expect(host.steers).toHaveLength(1)
    // The refused turn is still open, so the loop runs another step.
    await step(host, host.agent, 1, 2)

    await waitFor(async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 3)
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records.map((record) => record.kind)).toEqual([
      'agent/pre-step',
      'agent/turn-stopping',
      'agent/pre-step',
    ])
    expect(records[0]?.turn).toBe(1)
    expect(records[2]?.turn).toBe(1)
    expect(records[1]?.summary).toContain('stop attempt')
    expect(records.some((record) => record.kind.includes('turn/end'))).toBe(false)
    // The recorder never steered; only the fake gate did.
    expect(host.steers).toHaveLength(1)
  })

  it('attributes a nested delegation to the immediate parent without duplicating it', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    const child = host.addAgent('child-b', 'subagent', 'session-1')
    const grandchild = host.addAgent('child-c', 'subagent', 'child-b')
    apply(host.ctx as never)
    host.emit('agent/created', { agent: host.agent, source: 'fresh' })
    host.emit('agent/created', { agent: child, source: 'fresh' })
    const journal = new Journal()

    await step(host, child, 1, 1)
    host.emit('subagent/start', { runId: 'run-b', provider: 'spawn', id: 'child-b', local: true })
    host.emit('subagent/start', { runId: 'run-c', provider: 'spawn', id: 'child-c', local: true })
    host.emit('subagent/end', { runId: 'run-c', provider: 'spawn', id: 'child-c', local: true, stopReason: 'completed' })

    await waitFor(async () => (await journal.read(workspace, 'child-b', 0, 50)).records.length === 3)
    const parent = await journal.read(workspace, 'session-1', 0, 50)
    const nested = await journal.read(workspace, 'child-b', 0, 50)
    // Only the immediate parent records the grandchild, once.
    expect(parent.records.map((record) => record.subject)).toEqual(['child-b'])
    expect(nested.records.map((record) => record.kind)).toEqual([
      'agent/pre-step',
      'subagent/start',
      'subagent/end',
    ])
    expect(nested.records[1]?.subject).toBe('child-c')
    expect(nested.records[1]?.turn).toBe(1)
    expect(nested.records[2]?.subject).toBe('child-c')
    expect(nested.records[2]?.turn).toBe(1)
    expect(grandchild.session.header.parentSession).toBe('child-b')
  })

  it('binds a parent that was already live when the recorder mounted', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    host.addAgent('child-9', 'subagent', 'session-1')
    apply(host.ctx as never)
    const journal = new Journal()
    host.emit('subagent/start', { runId: 'run-existing', provider: 'spawn', id: 'child-9', local: true })
    await waitFor(async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1)
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records[0]?.kind).toBe('subagent/start')
    expect(records[0]?.subject).toBe('child-9')
  })

  it('stops observing once the recorder is disposed', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    host.addAgent('child-9', 'subagent', 'session-1')
    apply(host.ctx as never)
    const journal = new Journal()
    host.emit('subagent/start', { runId: 'run-unload', provider: 'spawn', id: 'child-9', local: true })
    await waitFor(async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1)
    host.dispose()
    host.emit('subagent/end', {
      runId: 'run-unload',
      provider: 'spawn',
      id: 'child-9',
      local: true,
      stopReason: 'completed',
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records.map((record) => record.kind)).toEqual(['subagent/start'])
  })

  it('contains a listener that throws and keeps later events observable', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    const failure = vi.spyOn(Journal.prototype, 'record').mockImplementation(() => {
      throw new Error('boom')
    })
    let continued = 0
    const result = host.emit('agent/pre-step', {
      agent: host.agent,
      turn: 1,
      step: 1,
      messages: [],
      signal: new AbortController().signal,
      modelSelection: { provider: 'p', model: 'm' },
    }, async () => {
      continued += 1
      return { kind: 'continue' }
    })
    await Promise.resolve(result)
    expect(continued).toBe(1)
    failure.mockRestore()
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-3', name: 'read', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await waitFor(async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1)
    expect((await journal.read(workspace, 'session-1', 0, 50)).records[0]?.kind).toBe('tools/result')
  })

  it('contains a listener whose journal write fails', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
    await writeFile(join(workspace, '.dsh', 'workflows', 'events'), 'not a directory', 'utf8')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = createHost(workspace)
    apply(host.ctx as never)
    expect(() => {
      host.emit(
        'tools/result',
        { agent: host.agent, callId: 'call-2', name: 'read', arguments: {} },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }).not.toThrow()
    await waitFor(() => errors.mock.calls.length > 0)
    expect(String(errors.mock.calls[0]?.[0])).toContain('workflows: the session journal could not be written')
    expect(String(errors.mock.calls[0]?.[0]).length).toBeLessThan(300)
  })
})
