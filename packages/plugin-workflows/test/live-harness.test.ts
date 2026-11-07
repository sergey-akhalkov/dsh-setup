import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/host/index.ts'
import { hashSession } from '../src/host/projection.ts'

/**
 * Automated live-session proxy for task 7.3. It drives the real plugin entry
 * with a live-session-shaped host, a real journal, a producer checkpoint, a
 * delegate result, and a review record, then reads the same Fetch routes the
 * Workflows view calls. Opening the actual Web view needs an installed profile
 * and is recorded as the remaining manual step in the change.
 */

type Listener = (...args: unknown[]) => unknown

interface Route {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  fetch(request: Request): Promise<Response>
}

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-live-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the live proxy did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

describe('live-session proxy', () => {
  it('shows a checkpoint, a delegate run, and a review in the session timeline', async () => {
    const workspace = await tempWorkspace()
    const listeners = new Map<string, Listener[]>()
    const routes: Route[] = []
    const add = (name: string, listener: Listener): void => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
    }
    const agent = {
      id: 'session-live',
      session: { id: 'session-live', header: { origin: 'root' } },
      ctx: {
        on(name: string, listener: Listener): () => void {
          add(name, listener)
          return () => {}
        },
      },
      steer: () => {},
      inject: () => {},
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
              register: (route: Route) => {
                routes.push(route)
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
        callback()
        return () => {}
      },
    }
    const emit = (name: string, ...args: unknown[]): unknown => {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = listener(...args)
      return result
    }

    apply(ctx as never)
    await emit(
      'agent/pre-step',
      {
        agent,
        turn: 1,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )

    // A producer checkpoint for this session (the hashed directory is the
    // producer's own layout; the directory name is never read as a session id).
    const checkpointDirectory = join(
      workspace,
      '.dsh',
      'work-checkpoints',
      hashSession('session-live'),
    )
    await mkdir(checkpointDirectory, { recursive: true })
    await writeFile(
      join(checkpointDirectory, '1.json'),
      JSON.stringify({
        version: 2,
        checkpoint: 'checkpoint-1-abc',
        revision: 1,
        turn: 1,
        outcome: 'continue',
        verified: ['the proxy test passes'],
        lanes: [],
        laneAges: [],
        derivedRemaining: [],
        parallelComputed: false,
        next: 'finish',
        time: '2026-11-07T10:00:00.000Z',
      }),
      'utf8',
    )

    // A delegate result observed in the live session; the projection uses the
    // run handle for attribution.
    emit(
      'tools/result',
      { agent, callId: 'call-delegate', name: 'delegate', arguments: {} },
      {
        isError: false,
        content: [
          {
            type: 'text',
            text: 'rule "task-review" review started\nrun: run-mw6live-1234abcd\nstate: running',
          },
        ],
      },
    )
    const runDirectory = join(workspace, '.dsh', 'delegation', 'runs')
    await mkdir(runDirectory, { recursive: true })
    await writeFile(
      join(runDirectory, 'run-mw6live-1234abcd.json'),
      JSON.stringify({
        id: 'run-mw6live-1234abcd',
        rule: 'task-review',
        change: 'add-workflow-observability',
        key: 'k',
        identity: 'i',
        state: 'completed',
        record: '.dsh/delegation/task-review/add-workflow-observability/tasks/x.json',
        startedAt: '2026-11-07T10:05:00.000Z',
      }),
      'utf8',
    )

    const route = (path: string): Route => {
      const found = routes.find((candidate) => candidate.path === path)
      if (found === undefined) throw new Error(`no route ${path}`)
      return found
    }
    const read = async (path: string): Promise<Record<string, unknown>> => {
      const response = await route(path).fetch(
        new Request(`http://localhost${path}?session=session-live`),
      )
      expect(response.status).toBe(200)
      return (await response.json()) as Record<string, unknown>
    }

    await waitFor(async () => {
      const runs = (await read('/api/workflows/runs')) as { runs?: unknown[] }
      return (runs.runs?.length ?? 0) >= 2
    })
    const runs = (await read('/api/workflows/runs')) as {
      runs: Array<{ source: string; attribution: string }>
    }
    expect(runs.runs.map((entry) => entry.source)).toEqual(['checkpoint', 'delegation'])
    for (const entry of runs.runs) expect(entry.attribution).toBe('local')

    const triggers = (await read('/api/workflows/triggers')) as {
      triggers: Array<{ id: string; last?: { reason: string } }>
    }
    expect(
      triggers.triggers.find((trigger) => trigger.id === 'delegate-result')?.last?.reason,
    ).toBe('would-fire')

    const events = (await read('/api/workflows/events')) as {
      events: Array<{ kind: string; triggers?: Array<{ id: string; reason: string }> }>
    }
    const delegate = events.events.find((event) => event.kind === 'tools/result')
    expect(
      delegate?.triggers?.find((evaluation) => evaluation.id === 'delegate-result')?.reason,
    ).toBe('would-fire')

    const health = (await read('/api/workflows/health')) as { state: string; listenerCount: number }
    expect(health.listenerCount).toBeGreaterThanOrEqual(5)
    expect(['waiting', 'healthy']).toContain(health.state)
  })
})
