import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { apply, REPORT_PATH } from '../src/host/index.ts'
import type { SessionQueryService, TitleObservation } from '../src/host/reader.ts'

class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status
    this.headers = headers
    return this
  }

  end(body?: string): void {
    this.body = body ?? ''
  }

  json(): unknown {
    return JSON.parse(this.body) as unknown
  }
}

function request(url: string, method = 'GET'): IncomingMessage {
  return { method, url, headers: {} } as IncomingMessage
}

const emptyQuery: SessionQueryService = {
  async listSessions() {
    return []
  },
  async readSession() {
    throw new Error('no sessions in this fixture')
  },
  async listEvents() {
    return []
  },
}

const SECRET = 'SECRET-MESSAGE-TEXT-123'
const RAW_REASON = 'RAW-FAILURE-REASON'
const ARGUMENTS = '{"path":"secret-notes.md"}'

/** One session holding a failed edit whose turn never closed. */
function failureQuery(
  titles?: (ids: readonly string[]) => Promise<readonly TitleObservation[]>,
): SessionQueryService {
  const now = Date.now()
  const events = [
    {
      type: 'turn/start',
      seq: 1,
      time: now - 10 * 60_000,
      data: { turn: 1 },
    },
    {
      type: 'tool/call',
      seq: 2,
      time: now - 9 * 60_000,
      data: { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: ARGUMENTS },
    },
    {
      type: 'user/message',
      seq: 3,
      time: now - 8 * 60_000,
      data: {
        role: 'user',
        id: 'm1',
        content: [{ type: 'text', text: SECRET }],
        source: { kind: 'user' },
      },
    },
    {
      type: 'tool/result',
      seq: 4,
      time: now - 7 * 60_000,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm2',
          content: [{ type: 'text', text: SECRET }],
          source: { kind: 'tool', callId: 'c1' },
          toolCallId: 'c1',
          isError: true,
        },
        error: { name: 'ToolError', code: 'E_EDIT', reason: RAW_REASON },
      },
    },
  ]
  return {
    async listSessions() {
      return [
        {
          header: { id: 'session-1' },
          live: true,
          persisted: true,
        },
      ] as unknown as Awaited<ReturnType<SessionQueryService['listSessions']>>
    },
    async readSession() {
      return {
        header: { id: 'session-1' },
        events,
        inheritedEventCount: 0,
      } as unknown as Awaited<ReturnType<SessionQueryService['readSession']>>
    },
    async listEvents() {
      return events as unknown as Awaited<ReturnType<SessionQueryService['listEvents']>>
    },
    ...(titles === undefined ? {} : { readTitleSnapshots: titles }),
  }
}

interface Harness {
  readonly route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
  }
  readonly calls: string[]
  rejection: 401 | 403 | undefined
  readonly ctx: Parameters<typeof apply>[0]
}

interface HarnessOptions {
  readonly query?: SessionQueryService
  readonly reflect?: { get(name: string): unknown }
  readonly rows?: unknown[]
}

function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = []
  const state = { rejection: undefined as 401 | 403 | undefined }
  let route: Harness['route'] | undefined
  const ctx = {
    effect(callback: () => () => void) {
      callback()
      return () => {}
    },
    connection: {
      requestRejection() {
        calls.push('admission')
        return state.rejection
      },
    },
    tools: {
      schemas() {
        return [{ name: 'delegate' }]
      },
    },
    sessionQuery: options.query ?? emptyQuery,
    ...(options.reflect === undefined ? {} : { reflect: options.reflect }),
    webServer: {
      register(value: Harness['route']) {
        route = value
        return () => {}
      },
    },
  } as unknown as Parameters<typeof apply>[0]
  apply(ctx, {
    rows:
      options.rows ??
      ([
        { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
      ] as never),
  })
  if (route === undefined) throw new Error('route not registered')
  return {
    route,
    calls,
    get rejection() {
      return state.rejection
    },
    set rejection(value: 401 | 403 | undefined) {
      state.rejection = value
    },
    ctx,
  }
}

describe('report route', () => {
  it('registers one exact path', () => {
    expect(harness().route).toMatchObject({ kind: 'exact', path: REPORT_PATH })
  })

  it('returns the week report JSON for a valid range', async () => {
    const test = harness()
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=week&session=session-1`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(200)
    const body = response.json() as {
      range: string
      bucketLabels: string[]
      totals: {
        turns: number
        steps: number
        toolCalls: number
        errors: number
        records: number
        sessions: number
      }
      activity: number[]
      errorSeries: number[]
      rows: Array<{
        id: string
        group: string
        status?: string
        note: string
        counts: number[]
        details: unknown[]
      }>
      blindSpots: string[]
    }
    expect(body.range).toBe('week')
    expect(body.bucketLabels).toHaveLength(7)
    expect(body.totals).toEqual({
      turns: 0,
      steps: 0,
      toolCalls: 0,
      errors: 0,
      records: 0,
      sessions: 0,
    })
    expect(body.activity).toHaveLength(7)
    expect(body.errorSeries).toHaveLength(7)
    expect(body.rows.some((row) => row.id === 'delegation')).toBe(true)
    expect(body.rows.some((row) => row.id === 'activity.turns')).toBe(true)
    expect(body.rows.find((row) => row.id === 'delegation')?.group).toBe('plugin')
    expect(body.rows.find((row) => row.id === 'activity.turns')?.group).toBe('activity')
    expect(body.blindSpots.length).toBeGreaterThan(0)
    expect(body.rows.find((row) => row.id === 'delegation')?.note).toContain('No traces')
    expect(body.rows.every((row) => row.counts.length === 7)).toBe(true)
  })

  it('rejects an invalid range and does not read sessions', async () => {
    const test = harness()
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=year`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(400)
    expect((response.json() as { error: string }).error).toContain('session, day, week, month')
    expect(test.calls).toEqual(['admission'])
  })

  it('rejects an unauthorized request', async () => {
    const test = harness()
    test.rejection = 401
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=session&session=s`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(401)
    expect(response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('allows only GET', async () => {
    const test = harness()
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=week`, 'POST'),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET')
  })

  it('fails loudly on an unknown configured field and does not mount the route', () => {
    let registered = false
    const ctx = {
      effect(callback: () => () => void) {
        callback()
        return () => {}
      },
      webServer: {
        register() {
          registered = true
          return () => {}
        },
      },
      connection: { requestRejection: () => undefined },
      tools: { schemas: () => [] },
      sessionQuery: emptyQuery,
    } as unknown as Parameters<typeof apply>[0]
    expect(() =>
      apply(ctx, { rows: [{ id: 'x', label: 'X', kind: 'signal', match: { toolName: 'y' } }] }),
    ).toThrow('unknown field "toolName"')
    expect(registered).toBe(false)
  })
})

interface ReportBody {
  failures: Array<Record<string, unknown>>
  failureTotals: { total: number; toolFailures: number; recovered: number }
  toolOutcomes: Array<{ tool: string; calls: number; failed: number }>
  rows: Array<{ id: string; readiness?: string; trigger?: string }>
}

async function failureResponse(
  query: SessionQueryService,
): Promise<{ status: number; body: ReportBody; text: string }> {
  const test = harness({ query })
  const response = new FakeResponse()
  await test.route.handler(
    request(`${REPORT_PATH}?range=week&session=session-1`),
    response as unknown as ServerResponse,
  )
  return { status: response.status, body: response.json() as ReportBody, text: response.body }
}

describe('failure report', () => {
  it('carries failure entries and no message text, arguments, or raw reason', async () => {
    const { status, body, text } = await failureResponse(failureQuery())
    expect(status).toBe(200)
    expect(body.failures).toHaveLength(1)
    expect(body.failures[0]).toMatchObject({
      sessionId: 'session-1',
      severity: 'tool failure',
      tool: 'edit',
      callId: 'c1',
      errorName: 'ToolError',
      errorCode: 'E_EDIT',
      recovered: false,
    })
    expect(body.failureTotals).toEqual({
      total: 1,
      turnFailures: 0,
      turnCuts: 0,
      toolFailures: 1,
      recovered: 0,
    })
    expect(body.toolOutcomes).toEqual([{ tool: 'edit', calls: 1, failed: 1 }])
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(RAW_REASON)
    expect(text).not.toContain('secret-notes.md')
  })

  it('names the failure sessions through the batch title lookup', async () => {
    const { body } = await failureResponse(
      failureQuery(async (ids) =>
        ids.map((sessionId) => ({
          sessionId: sessionId as never,
          status: 'fulfilled' as const,
          value: { session: { id: sessionId }, title: { title: 'Fix the parser' } },
        })),
      ),
    )
    expect(body.failures[0]?.sessionTitle).toBe('Fix the parser')
  })

  it('reports without a title when the lookup is absent, empty, or rejects', async () => {
    const absent = await failureResponse(failureQuery())
    expect(absent.body.failures[0]?.sessionTitle).toBeUndefined()

    const empty = await failureResponse(failureQuery(async () => []))
    expect(empty.body.failures[0]?.sessionTitle).toBeUndefined()

    const rejectedEntry = await failureResponse(
      failureQuery(async (ids) =>
        ids.map((sessionId) => ({
          sessionId: sessionId as never,
          status: 'rejected' as const,
          reason: new Error('title source unavailable'),
        })),
      ),
    )
    expect(rejectedEntry.status).toBe(200)
    expect(rejectedEntry.body.failures[0]?.sessionTitle).toBeUndefined()

    const throwing = await failureResponse(
      failureQuery(async () => {
        throw new Error('title source unavailable')
      }),
    )
    expect(throwing.status).toBe(200)
    expect(throwing.body.failures[0]?.sessionTitle).toBeUndefined()
  })
})

describe('guidance readiness route', () => {
  const guidanceRows = [
    {
      id: 'ponytail',
      label: 'Ponytail',
      kind: 'guidance',
      mounted: { section: 'dsh-setup:ponytail', skill: 'ponytail' },
    },
  ]

  async function readiness(reflect?: { get(name: string): unknown }): Promise<string | undefined> {
    const test = harness({ reflect, rows: guidanceRows })
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=week`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(200)
    const body = response.json() as ReportBody
    return body.rows.find((row) => row.id === 'ponytail')?.readiness
  }

  it('reports mounted when the assembly and the completed catalog carry both names', async () => {
    expect(
      await readiness({
        get(name) {
          if (name === 'systemPrompt') {
            return { assemble: async () => ({ sections: [{ name: 'dsh-setup:ponytail' }] }) }
          }
          return { snapshot: async () => ({ skills: [{ name: 'ponytail' }], complete: true }) }
        },
      }),
    ).toBe('mounted')
  })

  it('reports readiness unknown for a missing service, a throwing assembly, and partial discovery', async () => {
    expect(await readiness()).toBe('readiness unknown')
    expect(
      await readiness({
        get(name) {
          if (name === 'systemPrompt') {
            return {
              assemble: async () => {
                throw new Error('assembly failed')
              },
            }
          }
          return { snapshot: async () => ({ skills: [], complete: false }) }
        },
      }),
    ).toBe('readiness unknown')
    expect(
      await readiness({
        get(name) {
          if (name === 'systemPrompt') {
            return { assemble: async () => ({ sections: [{ name: 'dsh-setup:ponytail' }] }) }
          }
          return { snapshot: async () => ({ skills: [], complete: false }) }
        },
      }),
    ).toBe('readiness unknown')
  })

  it('reports not mounted for a confirmed absent declaration only', async () => {
    expect(
      await readiness({
        get(name) {
          if (name === 'systemPrompt') {
            return { assemble: async () => ({ sections: [{ name: 'dsh-setup:other' }] }) }
          }
          return { snapshot: async () => ({ skills: [], complete: true }) }
        },
      }),
    ).toBe('not mounted')
  })
})
