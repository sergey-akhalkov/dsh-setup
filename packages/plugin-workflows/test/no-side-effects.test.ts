import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mutation = vi.hoisted(() => ({ paths: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const record = (path: unknown): void => {
    mutation.paths.push(String(path))
  }
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      record(args[0])
      return actual.writeFile(...args)
    },
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      record(args[0])
      return actual.appendFile(...args)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      record(args[0])
      record(args[1])
      return actual.rename(...args)
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      record(args[0])
      return actual.unlink(...args)
    },
    truncate: async (...args: Parameters<typeof actual.truncate>) => {
      record(args[0])
      return actual.truncate(...args)
    },
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      record(args[0])
      return actual.mkdir(...args)
    },
  }
})

import { apply } from '../src/host/index.ts'

type Listener = (...args: unknown[]) => unknown

interface FakeHost {
  readonly ctx: Record<string, unknown>
  readonly workspace: string
  readonly agent: {
    id: string
    session: { id: string; header: { origin?: 'root' | 'subagent' } }
    ctx: { on(name: string, listener: Listener): () => void }
    steer(message: unknown): void
    inject(message: unknown): void
  }
  readonly steers: unknown[]
  readonly injects: unknown[]
  readonly registered: string[]
  emit(name: string, ...args: unknown[]): unknown
  dispose(): void
}

function createHost(workspace: string): FakeHost {
  const listeners = new Map<string, Listener[]>()
  const steers: unknown[] = []
  const injects: unknown[] = []
  const registered: string[] = []
  const effects: Array<() => void> = []
  const add = (name: string, listener: Listener): void => {
    registered.push(name)
    const list = listeners.get(name) ?? []
    list.push(listener)
    listeners.set(name, list)
  }
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' as const } },
    ctx: {
      on(name: string, listener: Listener): () => void {
        add(name, listener)
        return () => {}
      },
    },
    steer(message: unknown): void {
      steers.push(message)
    },
    inject(message: unknown): void {
      injects.push(message)
    },
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: string) => ({ targetKey: path }),
          watch: async () => async () => {},
        }
      }
      if (name === 'connection') {
        return {
          fetch: {
            register: (route: { path: string }) => {
              registered.push(`route:${route.path}`)
              return () => {}
            },
          },
        }
      }
      return undefined
    },
    on(name: string, listener: Listener): () => void {
      add(name, listener)
      return () => {}
    },
    effect: (callback: () => () => void) => {
      const cleanup = callback()
      if (typeof cleanup === 'function') effects.push(cleanup as () => void)
      return () => {}
    },
  }
  const emit = (name: string, ...args: unknown[]): unknown => {
    let result: unknown
    for (const listener of listeners.get(name) ?? []) result = listener(...args)
    return result
  }
  return {
    ctx,
    workspace,
    agent,
    steers,
    injects,
    registered,
    emit,
    dispose: () => {
      for (const cleanup of effects.splice(0)) {
        try {
          cleanup()
        } catch {
          // A cleanup failure must not mask the assertion.
        }
      }
    },
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the recorder did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-side-effects-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

async function walk(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) paths.push(...(await walk(join(directory, entry.name), relative)))
    else paths.push(relative)
  }
  return paths
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

describe('read-only safety', () => {
  it('dispatches a full turn without steering, injecting, or writing outside .dsh/workflows', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
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
    host.emit('agent/created', { agent: host.agent, source: 'fresh' })
    host.emit(
      'tools/result',
      { agent: host.agent, callId: 'call-1', name: 'read', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    host.emit('subagent/start', { runId: 'run-1', provider: 'spawn', id: 'child-1', local: true })
    host.emit('subagent/end', {
      runId: 'run-1',
      provider: 'spawn',
      id: 'child-1',
      local: true,
      stopReason: 'completed',
    })
    host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: new AbortController().signal,
    })

    await waitFor(async () => (await walk(workspace)).some((path) => path.endsWith('.jsonl')))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.steers).toEqual([])
    expect(host.injects).toEqual([])
    expect(host.registered).not.toContain('tools/pre-execute')
    expect(host.registered).not.toContain('tools/post-execute')
    expect(host.registered).not.toContain('tools/execute')
    const paths = await walk(workspace)
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((path) => path.startsWith('.dsh/workflows/'))).toBe(true)
    const allowed = resolve(workspace, '.dsh', 'workflows')
    const inside = (target: string): boolean => {
      const rel = relative(allowed, resolve(target))
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }
    expect(mutation.paths.length).toBeGreaterThan(0)
    expect(mutation.paths.every(inside)).toBe(true)
    expect(inside(join(workspace, '.dsh', 'workflows-escaped-probe'))).toBe(false)
    expect(inside(join(workspace, '.dsh', 'workflows', '..', '.escaped-probe'))).toBe(false)
    host.dispose()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('contains every event listener failure and keeps the agent loop unaffected', async () => {
    const workspace = await tempWorkspace()
    const host = createHost(workspace)
    apply(host.ctx as never)
    await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
    await expect(
      (async () => {
        for (const name of ['agent/turn-stopping', 'tools/result']) {
          expect(() => {
            host.emit(
              name,
              {
                agent: host.agent,
                turn: 1,
                signal: new AbortController().signal,
                callId: 'c',
                name: 'read',
                arguments: {},
              },
              { isError: true, error: { message: 'x' }, content: [] },
            )
          }).not.toThrow()
        }
      })(),
    ).resolves.toBeUndefined()
    host.dispose()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
})
