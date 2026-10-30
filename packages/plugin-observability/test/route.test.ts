import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { apply, REPORT_PATH } from '../src/host/index.ts'
import type { SessionQueryService } from '../src/host/reader.ts'

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

function harness(): Harness {
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
    sessionQuery: emptyQuery,
    webServer: {
      register(value: Harness['route']) {
        route = value
        return () => {}
      },
    },
  } as unknown as Parameters<typeof apply>[0]
  apply(ctx, {
    rows: [
      { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
    ],
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
      totals: { turns: number; steps: number; toolCalls: number; errors: number; records: number }
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
    expect(body.totals).toEqual({ turns: 0, steps: 0, toolCalls: 0, errors: 0, records: 0 })
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
