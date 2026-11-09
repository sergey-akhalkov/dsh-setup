import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/host/index.ts'
import { eventsDirectory, Journal } from '../src/host/journal.ts'

type Listener = (...args: unknown[]) => unknown

function linkPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN'
}

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
  readonly fsWatchers: Array<(error?: Error) => void>
  readonly fsClosed: number[]
  resolveFsWatch(): void
  readonly agent: FakeAgent
  addAgent(id: string, origin?: 'subagent', parentSession?: string, failScoped?: boolean): FakeAgent
  emit(name: string, ...args: unknown[]): unknown
  fireFs(error?: Error): void
  dispose(): void
  calls(): { steers: number; injects: number; preExecute: number }
}

function createHost(
  workspace: string,
  options: {
    readonly failOn?: string
    readonly failScopedOn?: string
    readonly failFsWatch?: boolean
    readonly deferFsWatch?: boolean
  } = {},
): FakeHost {
  const listeners = new Map<string, Listener[]>()
  const steers: unknown[] = []
  const agents = new Map<string, FakeAgent>()
  const fsWatchers: Array<(error?: Error) => void> = []
  const fsClosed: number[] = []
  const pendingWatches: Array<(close: () => Promise<void>) => void> = []
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
  const addAgent = (
    id: string,
    origin?: 'subagent',
    parentSession?: string,
    failScoped?: boolean,
  ): FakeAgent => {
    const agent: FakeAgent = {
      id,
      session: {
        id,
        header: {
          ...(origin === undefined ? {} : { origin }),
          ...(parentSession === undefined ? {} : { parentSession }),
        },
      },
      ctx: {
        on(name: string, listener: Listener): () => void {
          if (failScoped === true || name === options.failScopedOn) {
            throw new Error('scoped registration failed')
          }
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
          watch: async (_target: unknown, changed: (error?: Error) => void) => {
            if (options.failFsWatch === true) throw new Error('watch failed')
            fsWatchers.push(changed)
            const close = async (): Promise<void> => {
              fsClosed.push(1)
            }
            if (options.deferFsWatch === true) {
              return new Promise<() => Promise<void>>((resolve) => {
                pendingWatches.push((deferredClose) => resolve(deferredClose))
              })
            }
            return close
          },
        }
      }
      if (name === 'connection') return { fetch: { register: () => () => {} } }
      return undefined
    },
    on(name: string, listener: Listener): () => void {
      if (name === 'tools/pre-execute') calls.preExecute += 1
      if (name === options.failOn) throw new Error('registration failed')
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
  const fireFs = (error?: Error): void => {
    for (const changed of fsWatchers) changed(error)
  }
  const resolveFsWatch = (): void => {
    const resolve = pendingWatches.shift()
    resolve?.(async () => {
      fsClosed.push(1)
    })
  }
  return {
    ctx,
    workspace,
    listeners,
    steers,
    fsWatchers,
    fsClosed,
    resolveFsWatch,
    agent,
    addAgent,
    emit,
    fireFs,
    dispose,
    calls: () => calls,
  }
}

const step = async (
  host: FakeHost,
  agent: FakeAgent,
  turn: number,
  number: number,
): Promise<unknown> =>
  host.emit(
    'agent/pre-step',
    {
      agent,
      turn,
      step: number,
      messages: [],
      signal: new AbortController().signal,
      modelSelection: { provider: 'p', model: 'm' },
    },
    async () => ({ kind: 'continue' }),
  )

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
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
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
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
    host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 2,
      signal: new AbortController().signal,
    })
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

    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 5,
    )
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
    expect(records[1]?.triggers).toHaveLength(9)
    expect(
      records[1]?.triggers?.some(
        (evaluation) =>
          evaluation.id === 'delegate-result' && evaluation.reason === 'filter-mismatch',
      ),
    ).toBe(true)
    expect(records[3]?.subject).toBe('child-9')
    expect(records[3]?.turn).toBe(2)
    expect(records[4]?.subject).toBe('child-9')
    expect(records[4]?.turn).toBe(2)
    expect(host.calls()).toEqual({ steers: 0, injects: 0, preExecute: 1 })
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
    host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(gateRefusals).toEqual([1])
    expect(host.steers).toHaveLength(1)
    // The refused turn is still open, so the loop runs another step.
    await step(host, host.agent, 1, 2)

    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 3,
    )
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
    host.emit('subagent/end', {
      runId: 'run-c',
      provider: 'spawn',
      id: 'child-c',
      local: true,
      stopReason: 'completed',
    })

    await waitFor(async () => {
      const child = await journal.read(workspace, 'child-b', 0, 50)
      const parent = await journal.read(workspace, 'session-1', 0, 50)
      return (
        child.records.length === 3 && parent.records.some((record) => record.subject === 'child-b')
      )
    })
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
    host.emit('subagent/start', {
      runId: 'run-existing',
      provider: 'spawn',
      id: 'child-9',
      local: true,
    })
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
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
    host.emit('subagent/start', {
      runId: 'run-unload',
      provider: 'spawn',
      id: 'child-9',
      local: true,
    })
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
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
    const result = host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 1,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => {
        continued += 1
        return { kind: 'continue' }
      },
    )
    await Promise.resolve(result)
    expect(continued).toBe(1)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () => String((await readHealth())?.lastError ?? '').includes('boom'))
    expect(typeof (await readHealth())?.lastErrorAt).toBe('number')
    failure.mockRestore()
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-3', name: 'read', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
    expect((await journal.read(workspace, 'session-1', 0, 50)).records[0]?.kind).toBe(
      'tools/result',
    )
  })

  it('never stores tool output content, only a fixed identity summary', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-secret', name: 'read', arguments: {} },
      {
        isError: false,
        content: [{ type: 'text', text: 'authorization: Bearer SECRET-TOKEN-123' }],
      },
    )
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records[0]?.summary).toBe('read ok; output omitted')
    expect(records[0]?.bytes).toBeGreaterThan(0)
    expect(JSON.stringify(records)).not.toContain('SECRET-TOKEN-123')
  })

  it('keeps a delegate run handle so the run projection can attribute it', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-run', name: 'delegate', arguments: {} },
      {
        isError: false,
        content: [
          {
            type: 'text',
            text: 'rule "task-review" review started\nrun: run-mw6abcde-1234abcd\nstate: running\npassword: HUNTER-secret',
          },
        ],
      },
    )
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records[0]?.summary).toBe('delegate review started; run: run-mw6abcde-1234abcd')
    expect(JSON.stringify(records)).not.toContain('HUNTER-secret')
  })

  it('does not treat an arbitrary run line as a delegate handle', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-forged', name: 'delegate', arguments: {} },
      {
        isError: false,
        content: [
          {
            type: 'text',
            text: 'rule "task-review" review started\nrun: HUNTER-secret',
          },
        ],
      },
    )
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records[0]?.summary).toBe('delegate ok; output omitted')
    expect(JSON.stringify(records)).not.toContain('HUNTER-secret')
  })

  it('marks an oversized tool result as truncated', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-big', name: 'read', arguments: {} },
      {
        isError: false,
        content: [{ type: 'text', text: 'x'.repeat(5000) }],
      },
    )
    await waitFor(
      async () => (await journal.read(workspace, 'session-1', 0, 50)).records.length === 1,
    )
    const { records } = await journal.read(workspace, 'session-1', 0, 50)
    expect(records[0]?.truncated).toBe(true)
    expect(records[0]?.bytes).toBe(5000)
    expect(records[0]?.summary).toBe('read ok; output omitted')
  })

  it('removes expired and over-limit session files on write', async () => {
    const workspace = await tempWorkspace()
    const now = 1_700_000_000_000
    const day = 24 * 60 * 60 * 1000
    let files = [
      { name: 'old.jsonl', size: 100, mtimeMs: now - 31 * day },
      { name: 'middle.jsonl', size: 100, mtimeMs: now - 1000 },
      { name: 'newest.jsonl', size: 100, mtimeMs: now - 10 },
    ]
    const removed: string[] = []
    const journal = new Journal({
      now: () => now,
      retentionMs: 30 * day,
      maxWorkspaceBytes: 150,
      statFile: async () => ({ size: 0, mtimeMs: now }),
      writeLine: async () => {},
      listFiles: async () => files,
      removeFile: async (file) => {
        removed.push(file)
        files = files.filter((entry) => !file.endsWith(entry.name))
      },
    })
    const { record } = journal.record({
      at: now,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary: 'ok',
      bytes: 2,
      truncated: false,
    })
    expect((await journal.append(workspace, record)).ok).toBe(true)
    expect(removed.some((file) => file.endsWith('old.jsonl'))).toBe(true)
    expect(removed.some((file) => file.endsWith('middle.jsonl'))).toBe(true)
    expect(removed.some((file) => file.endsWith('newest.jsonl'))).toBe(false)
  })

  it('rotates a full session file and keeps its newest records readable', async () => {
    const workspace = await tempWorkspace()
    const journal = new Journal({ maxSessionBytes: 260 })
    for (let index = 0; index < 3; index += 1) {
      const { record } = journal.record({
        at: index,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        summary: `entry-${String(index)} ${'x'.repeat(120)}`,
        bytes: 130,
        truncated: false,
      })
      expect((await journal.append(workspace, record)).ok).toBe(true)
    }
    const files = await readdir(eventsDirectory(workspace))
    expect(files.some((name) => name.endsWith('.jsonl.1'))).toBe(true)
    const { records } = await journal.read(workspace, 'session-1', 0, 10)
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(records.at(-1)?.summary).toContain('entry-2')
  })

  it('leaves previous records intact when a write fails', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    const journal = new Journal({
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 2) throw new Error('disk full')
        await appendFile(file, line, 'utf8')
      },
    })
    const first = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary: 'first',
      bytes: 5,
      truncated: false,
    })
    expect((await journal.append(workspace, first.record)).ok).toBe(true)
    const second = journal.record({
      at: 2,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary: 'second',
      bytes: 6,
      truncated: false,
    })
    const failed = await journal.append(workspace, second.record)
    expect(failed.ok).toBe(false)
    const { records } = await journal.read(workspace, 'session-1', 0, 10)
    expect(records).toHaveLength(1)
    expect(records[0]?.summary).toBe('first')
  })

  it('preserves readable records when an append after rotation fails', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    const journal = new Journal({
      maxSessionBytes: 260,
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 3) throw new Error('disk full')
        await appendFile(file, line, 'utf8')
      },
    })
    const entry = (index: number): ReturnType<Journal['record']> =>
      journal.record({
        at: index,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        summary: `entry-${String(index)} ${'x'.repeat(120)}`,
        bytes: 130,
        truncated: false,
      })
    expect((await journal.append(workspace, entry(1).record)).ok).toBe(true)
    expect((await journal.append(workspace, entry(2).record)).ok).toBe(true)
    expect((await journal.read(workspace, 'session-1', 0, 10)).records).toHaveLength(2)
    expect((await journal.append(workspace, entry(3).record)).ok).toBe(false)
    expect((await journal.read(workspace, 'session-1', 0, 10)).records).toHaveLength(2)
  })

  it('repairs a torn line so the next successful record is readable', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    const journal = new Journal({
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 2) {
          await appendFile(file, '{"torn":', 'utf8')
          throw new Error('partial write')
        }
        await appendFile(file, line, 'utf8')
      },
    })
    const entry = (index: number, summary: string): ReturnType<Journal['record']> =>
      journal.record({
        at: index,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        summary,
        bytes: summary.length,
        truncated: false,
      })
    expect((await journal.append(workspace, entry(1, 'first').record)).ok).toBe(true)
    expect((await journal.append(workspace, entry(2, 'second').record)).ok).toBe(false)
    expect((await journal.append(workspace, entry(3, 'third').record)).ok).toBe(true)
    const { records } = await journal.read(workspace, 'session-1', 0, 10)
    expect(records.map((record) => record.summary)).toEqual(['first', 'third'])
  })

  it('keeps the workspace under its cap for concurrent appends', async () => {
    const workspace = await tempWorkspace()
    const journal = new Journal({ maxWorkspaceBytes: 400 })
    await Promise.all(
      ['a', 'b', 'c', 'd'].map(async (session) => {
        const { record } = journal.record({
          at: 1,
          session,
          kind: 'tools/result',
          subject: 'read',
          summary: 'x'.repeat(150),
          bytes: 150,
          truncated: false,
        })
        expect((await journal.append(workspace, record)).ok).toBe(true)
      }),
    )
    const files = await readdir(eventsDirectory(workspace))
    let total = 0
    for (const name of files) {
      total += (await stat(join(eventsDirectory(workspace), name))).size
    }
    expect(total).toBeLessThanOrEqual(400)
  })

  it('publishes workspace health on boot and on every event', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-health', name: 'read', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () => {
      const current = await readHealth()
      return typeof current?.lastEventAt === 'number' && typeof current?.lastCheckAt === 'number'
    })
    const health = (await readHealth()) ?? {}
    expect(health.listenerCount).toBeGreaterThanOrEqual(4)
    expect(typeof health.triggerCount).toBe('number')
    expect(health.journalWritable).toBe(true)
    expect(typeof health.lastCheckAt).toBe('number')
  })

  it('leaves committed records readable when the repair truncation fails', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    const journal = new Journal({
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 2) {
          await appendFile(file, '{"torn":', 'utf8')
          throw new Error('partial write')
        }
        await appendFile(file, line, 'utf8')
      },
      truncateFile: async () => {
        throw new Error('truncate failed')
      },
    })
    const entry = (index: number): ReturnType<Journal['record']> =>
      journal.record({
        at: index,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        summary: `entry-${String(index)}`,
        bytes: 5,
        truncated: false,
      })
    expect((await journal.append(workspace, entry(1).record)).ok).toBe(true)
    expect((await journal.append(workspace, entry(2).record)).ok).toBe(false)
    expect((await journal.append(workspace, entry(3).record)).ok).toBe(false)
    const { records } = await journal.read(workspace, 'session-1', 0, 10)
    expect(records.map((record) => record.summary)).toEqual(['entry-1'])
  })

  it('repairs one session file even when another session appends in between', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    const journal = new Journal({
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 2) {
          await appendFile(file, '{"torn":', 'utf8')
          throw new Error('partial write')
        }
        await appendFile(file, line, 'utf8')
      },
    })
    const entry = (session: string, index: number): ReturnType<Journal['record']> =>
      journal.record({
        at: index,
        session,
        kind: 'tools/result',
        subject: 'read',
        summary: `${session}-${String(index)}`,
        bytes: 5,
        truncated: false,
      })
    expect((await journal.append(workspace, entry('a', 1).record)).ok).toBe(true)
    expect((await journal.append(workspace, entry('a', 2).record)).ok).toBe(false)
    expect((await journal.append(workspace, entry('b', 1).record)).ok).toBe(true)
    expect((await journal.append(workspace, entry('a', 3).record)).ok).toBe(true)
    const { records } = await journal.read(workspace, 'a', 0, 10)
    expect(records.map((record) => record.summary)).toEqual(['a-1', 'a-3'])
  })

  it('repairs a torn file when a new Journal instance takes over', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    const first = new Journal({
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 2) {
          await appendFile(file, '{"torn":', 'utf8')
          throw new Error('partial write')
        }
        await appendFile(file, line, 'utf8')
      },
    })
    const entry = (index: number): ReturnType<Journal['record']> =>
      first.record({
        at: index,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        summary: `entry-${String(index)}`,
        bytes: 5,
        truncated: false,
      })
    expect((await first.append(workspace, entry(1).record)).ok).toBe(true)
    expect((await first.append(workspace, entry(2).record)).ok).toBe(false)
    const second = new Journal()
    expect((await second.append(workspace, entry(3).record)).ok).toBe(true)
    const { records } = await second.read(workspace, 'session-1', 0, 10)
    expect(records.map((record) => record.summary)).toEqual(['entry-1', 'entry-3'])
  })

  it('records a workspace change under the session active there', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const journal = new Journal()
    await step(host, host.agent, 1, 1)
    await waitFor(() => host.fsWatchers.length > 0)
    await mkdir(join(workspace, 'openspec', 'changes', 'add-x'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-x', 'tasks.md'),
      '- [ ] 1.1\n',
      'utf8',
    )
    host.fireFs()
    await waitFor(async () =>
      (await journal.read(workspace, 'session-1', 0, 50)).records.some(
        (record) => record.kind === 'fs.change',
      ),
    )
    const record = (await journal.read(workspace, 'session-1', 0, 50)).records.find(
      (entry) => entry.kind === 'fs.change',
    )
    expect(record?.session).toBe('session-1')
    expect(record?.subject).toContain('openspec/changes/add-x/tasks.md')
    expect(record?.summary).toContain('created')
    expect(record?.turn).toBe(1)
    expect(
      record?.triggers?.some(
        (evaluation) =>
          evaluation.id === 'openspec-tasks-checked' &&
          evaluation.matched &&
          evaluation.reason === 'would-fire',
      ),
    ).toBe(true)
  })

  it('fails the append when the repair read fails and preserves both records on retry', async () => {
    const workspace = await tempWorkspace()
    let calls = 0
    let failRead = false
    const journal = new Journal({
      writeLine: async (file, line) => {
        calls += 1
        if (calls === 2) {
          await appendFile(file, '{"torn":', 'utf8')
          throw new Error('partial write')
        }
        await appendFile(file, line, 'utf8')
      },
      readText: async (file) => {
        if (failRead) {
          const error = new Error('EIO') as NodeJS.ErrnoException
          error.code = 'EIO'
          throw error
        }
        return readFile(file, 'utf8')
      },
    })
    const entry = (index: number): ReturnType<Journal['record']> =>
      journal.record({
        at: index,
        session: 'session-1',
        kind: 'tools/result',
        subject: 'read',
        summary: `entry-${String(index)}`,
        bytes: 5,
        truncated: false,
      })
    expect((await journal.append(workspace, entry(1).record)).ok).toBe(true)
    expect((await journal.append(workspace, entry(2).record)).ok).toBe(false)
    failRead = true
    expect((await journal.append(workspace, entry(3).record)).ok).toBe(false)
    failRead = false
    expect((await journal.append(workspace, entry(3).record)).ok).toBe(true)
    const { records } = await journal.read(workspace, 'session-1', 0, 10)
    expect(records.map((record) => record.summary)).toEqual(['entry-1', 'entry-3'])
  })

  it('publishes health for a live session without waiting for an event', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () => {
      const current = await readHealth()
      return current?.listenerCount === 5 && typeof current.lastCheckAt === 'number'
    })
    const health = (await readHealth()) ?? {}
    expect(health.listenerCount).toBe(5)
    expect(health.triggerCount).toBe(9)
    expect(health.journalWritable).toBe(true)
    expect(health.lastEventAt).toBeUndefined()
    expect(typeof health.lastCheckAt).toBe('number')
    host.dispose()
  })

  it('reports a failed listener registration as listener-down', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace, { failOn: 'agent/turn-stopping' })
    apply(host.ctx as never)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () =>
      String((await readHealth())?.lastError ?? '').includes('registration failed'),
    )
    const health = (await readHealth()) ?? {}
    expect(health.listenerCount).toBeLessThan(5)
    expect(String(health.lastError)).toContain('registration failed')
    host.dispose()
  })

  it('records a scoped listener registration failure in health', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace, { failScopedOn: 'subagent/start' })
    apply(host.ctx as never)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () =>
      String((await readHealth())?.lastError ?? '').includes('scoped registration failed'),
    )
    expect(Number((await readHealth())?.listenerCount)).toBeLessThan(5)
    host.dispose()
  })

  it('reports a failed change-watcher registration as listener-down', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace, { failFsWatch: true })
    apply(host.ctx as never)
    await step(host, host.agent, 1, 1)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () => {
      const current = await readHealth()
      return (
        Number(current?.listenerCount) < 5 &&
        String(current?.lastError ?? '').includes('watch failed')
      )
    })
    expect(String((await readHealth())?.lastError)).toContain('watch failed')
    expect(Number((await readHealth())?.listenerCount)).toBeLessThan(5)
    host.dispose()
  })

  it('keeps a post-boot scoped registration failure visible after the watcher starts', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    const late = host.addAgent('late', undefined, undefined, true)
    host.emit('agent/created', { agent: late, source: 'fresh' })
    await step(host, host.agent, 1, 1)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () =>
      String((await readHealth())?.lastError ?? '').includes('scoped registration failed'),
    )
    expect(Number((await readHealth())?.listenerCount)).toBeLessThan(5)
    host.dispose()
  })

  it('attributes a file change made right after session boot without an agent event', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    await waitFor(() => host.fsWatchers.length > 0)
    await mkdir(join(workspace, 'openspec', 'changes', 'add-boot'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-boot', 'tasks.md'),
      '- [ ] 1.1\n',
      'utf8',
    )
    host.fireFs()
    const journal = new Journal()
    await waitFor(async () =>
      (await journal.read(workspace, 'session-1', 0, 50)).records.some(
        (record) => record.kind === 'fs.change',
      ),
    )
    const record = (await journal.read(workspace, 'session-1', 0, 50)).records.find(
      (entry) => entry.kind === 'fs.change',
    )
    expect(record?.session).toBe('session-1')
    expect(record?.subject).toContain('add-boot/tasks.md')
    host.dispose()
  })

  it('disposes a watcher that finishes initializing after plugin unload', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace, { deferFsWatch: true })
    apply(host.ctx as never)
    await waitFor(() => host.fsWatchers.length > 0)
    host.dispose()
    host.resolveFsWatch()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.fsClosed.length).toBeGreaterThan(0)
  })

  it('keeps every trigger evaluation when oversized metadata must be truncated', async () => {
    const workspace = await tempWorkspace()
    const journal = new Journal()
    const long = `${'变更'.repeat(120)}2.5.json`
    const triggers = Array.from({ length: 9 }, (_, index) => ({
      id: `trigger-${String(index)}`,
      matched: index < 2,
      reason: index < 2 ? 'would-fire' : 'event-mismatch',
      path: long,
      filter: `path: ${long}`,
    }))
    const { record, truncated } = journal.record({
      at: 1,
      session: 'session-1',
      kind: 'fs.change',
      subject: `openspec/changes/${long}`,
      summary: long,
      bytes: long.length,
      truncated: false,
      triggers,
    })
    expect(truncated).toBe(true)
    expect(record.triggers).toHaveLength(9)
    expect(record.triggers?.filter((evaluation) => evaluation.matched)).toHaveLength(2)
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThanOrEqual(4096)
    expect((await journal.append(workspace, record)).ok).toBe(true)
    const { records } = await journal.read(workspace, 'session-1', 0, 10)
    expect(records[0]?.triggers).toHaveLength(9)
    expect(records[0]?.triggers?.map((evaluation) => evaluation.id)).toEqual(
      triggers.map((trigger) => trigger.id),
    )
  })

  it('does not read a session journal through a link that escapes the workspace', async () => {
    const workspace = await tempWorkspace()
    const external = await tempWorkspace()
    const { record } = new Journal().record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'read',
      summary: 'read ok',
      bytes: 3,
      truncated: false,
    })
    await writeFile(join(external, 'session-1.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
    await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
    try {
      await symlink(external, join(workspace, '.dsh', 'workflows', 'events'), 'junction')
    } catch (error) {
      if (linkPermissionError(error)) return
      throw error
    }
    const { records } = await new Journal().read(workspace, 'session-1', 0, 10)
    expect(records).toEqual([])
  })

  it('does not read a single linked .jsonl file or its rotation', async () => {
    const workspace = await tempWorkspace()
    const external = await tempWorkspace()
    const { record } = new Journal().record({
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'delegate',
      summary: 'delegate review started; run: run-mw6abcde-1234abcd',
      bytes: 3,
      truncated: false,
    })
    await writeFile(join(external, 'session-1.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
    await writeFile(join(external, 'session-1.jsonl.1'), `${JSON.stringify(record)}\n`, 'utf8')
    const events = join(workspace, '.dsh', 'workflows', 'events')
    await mkdir(events, { recursive: true })
    try {
      await symlink(join(external, 'session-1.jsonl'), join(events, 'session-1.jsonl'), 'file')
      await symlink(join(external, 'session-1.jsonl.1'), join(events, 'session-1.jsonl.1'), 'file')
    } catch (error) {
      if (linkPermissionError(error)) return
      throw error
    }
    expect(await new Journal().read(workspace, 'session-1', 0, 10)).toEqual({ records: [] })
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
    await waitFor(() =>
      errors.mock.calls.some((call) =>
        String(call[0]).includes('workflows: the session journal could not be written'),
      ),
    )
    expect(errors.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'workflows: the session journal could not be written',
    )
    const journalError = errors.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes('the session journal could not be written'))
    expect((journalError ?? '').length).toBeLessThan(300)
    const healthFile = join(workspace, '.dsh', 'workflows', 'health.json')
    const readHealth = async (): Promise<Record<string, unknown> | undefined> => {
      try {
        return JSON.parse(await readFile(healthFile, 'utf8')) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    await waitFor(async () => {
      const current = await readHealth()
      return (
        current?.journalWritable === false &&
        typeof current?.lastEventAt === 'number' &&
        typeof current?.lastCheckAt === 'number'
      )
    })
    expect((await readHealth())?.journalWritable).toBe(false)
  })
})
