import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { rangeWindow } from '../src/host/aggregate.ts'
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
  withBaseline = false,
): SessionQueryService {
  const now = Date.now()
  const baselineAt = now - 24 * 3_600_000
  const baselineEvents = [
    {
      type: 'user/message',
      seq: 1,
      time: baselineAt,
      data: {
        role: 'user',
        content: [{ type: 'text', text: SECRET }],
        source: { kind: 'user' },
      },
    },
    {
      type: 'turn/end',
      seq: 2,
      time: baselineAt + 60_000,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
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
      const listed = [
        {
          header: { id: 'session-1', cwd: '/workspace' },
          live: true,
          persisted: true,
        },
      ]
      if (withBaseline) {
        listed.push({
          header: { id: 'previous', cwd: '/workspace' },
          live: false,
          persisted: true,
        } as never)
      }
      return listed as unknown as Awaited<ReturnType<SessionQueryService['listSessions']>>
    },
    async readSession(id: string) {
      return {
        header: { id },
        events: id === 'previous' ? baselineEvents : events,
        inheritedEventCount: 0,
      } as unknown as Awaited<ReturnType<SessionQueryService['readSession']>>
    },
    async listEvents(id: string) {
      return (id === 'previous' ? baselineEvents : events) as unknown as Awaited<
        ReturnType<SessionQueryService['listEvents']>
      >
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
  readonly hypotheses?: unknown[]
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
    ...(options.hypotheses === undefined ? {} : { hypotheses: options.hypotheses }),
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
      episodes: unknown[]
      episodeCount: number
      cohortCount: number
      scorecards: unknown[]
      hypotheses: unknown[]
      findings: unknown[]
      quality: { episodes: number }
      cost: { cutoffLabel: string; tokensPerEpisode: { n: number } }
      dataQuality: { usageCoverage: number; comparisonSample: number }
      timeline?: unknown
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
    // The episode, scorecard, hypothesis, finding, and data-quality sections ride
    // on the same route payload.
    expect(body.episodes).toEqual([])
    expect(body.episodeCount).toBe(0)
    expect(body.cohortCount).toBe(0)
    expect(body.scorecards).toHaveLength(1)
    expect(body.hypotheses).toEqual([])
    expect(body.findings).toEqual([])
    expect(body.quality.episodes).toBe(0)
    expect(body.cost.cutoffLabel).toBe('through cutoff')
    expect(body.cost.tokensPerEpisode.n).toBe(0)
    expect(body.dataQuality.usageCoverage).toBe(0)
    expect(body.dataQuality.comparisonSample).toBe(0)
    expect(body.timeline).toBeUndefined()
  })

  it('serves a repeated report from the short-lived cache', async () => {
    const base = failureQuery(undefined, true)
    let reads = 0
    const query: SessionQueryService = {
      ...base,
      async listSessions() {
        reads += 1
        return base.listSessions()
      },
    }
    const test = harness({ query })
    const first = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=day&session=session-1`),
      first as unknown as ServerResponse,
    )
    expect(first.status).toBe(200)
    const afterFirst = reads
    expect(afterFirst).toBeGreaterThan(0)
    const second = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=day&session=session-1`),
      second as unknown as ServerResponse,
    )
    expect(second.status).toBe(200)
    // The second request within the TTL does not read the corpus again.
    expect(reads).toBe(afterFirst)
    expect(second.json()).toEqual(first.json())
  })

  it('writes nothing under the Harness home while reading a baseline', async () => {
    const { mkdtempSync, readdirSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = mkdtempSync(join(tmpdir(), 'dsh-obs-home-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      // A populated baseline: the previous window holds a completed episode.
      const test = harness({ query: failureQuery(undefined, true) })
      const response = new FakeResponse()
      await test.route.handler(
        request(`${REPORT_PATH}?range=day&session=session-1`),
        response as unknown as ServerResponse,
      )
      expect(response.status).toBe(200)
      const body = response.json() as { baseline?: { kind: string } }
      expect(body.baseline?.kind).toBe('previous equal window')
      expect(readdirSync(home)).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('serializes a populated report with the cap, uncapped counts, child work, and no text', async () => {
    const now = Date.now()
    interface Fixture {
      id: string
      events: Array<{ type: string; seq: number; time: number; data: Record<string, unknown> }>
      parentSession?: string
    }
    const secret = 'SECRET-ROUTE-TOKEN'
    const human = (at: number): Fixture['events'] => [
      {
        type: 'user/message',
        seq: 1,
        time: at,
        data: { role: 'user', content: [{ type: 'text', text: secret }], source: { kind: 'user' } },
      },
    ]
    const fixtures: Fixture[] = []
    for (let index = 0; index < 205; index += 1) {
      const at = now - (index + 1) * 60_000
      fixtures.push({
        id: `bulk-${String(index)}`,
        events: [
          ...human(at),
          {
            type: 'tool/call',
            seq: 2,
            time: at + 1_000,
            data: {
              turn: 1,
              step: 1,
              callId: `bulk-${String(index)}-c`,
              name: 'edit',
              arguments: `{"path":"${secret}"}`,
            },
          },
          {
            type: 'turn/end',
            seq: 3,
            time: at + 2_000,
            data: { turn: 1, reason: { kind: 'completed' } },
          },
        ],
      })
    }
    fixtures.push({
      id: 'parent',
      events: [
        ...human(now - 10 * 60_000),
        {
          type: 'goal/change',
          seq: 2,
          time: now - 9 * 60_000,
          data: {
            kind: 'goal/change',
            operation: 'create',
            goal: { id: 'g1', revision: 1, objective: secret, phase: 'active' },
            roundsStarted: 1,
          },
        },
        {
          type: 'tool/call',
          seq: 3,
          time: now - 8 * 60_000,
          data: {
            turn: 1,
            step: 1,
            callId: 'cp1',
            name: 'work_checkpoint',
            arguments: JSON.stringify({
              outcome: 'done',
              verified: [secret],
              remaining: [secret],
              next: secret,
            }),
          },
        },
        {
          type: 'turn/end',
          seq: 4,
          time: now - 7 * 60_000,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      ],
    })
    // A child joined to the parent, an orphan child, and an episode that started
    // before the day window with work inside it.
    const dayFrom = rangeWindow('day', now, 0).from
    fixtures.push({
      id: 'child',
      parentSession: 'parent',
      events: [
        {
          type: 'assistant/message',
          seq: 1,
          time: now - 8 * 60_000,
          data: {
            turn: 1,
            step: 1,
            usage: {
              inputTokens: 100,
              outputTokens: 10,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 110,
            },
          },
        },
        {
          type: 'turn/end',
          seq: 2,
          time: now - 7 * 60_000,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      ],
    })
    fixtures.push({
      id: 'orphan',
      parentSession: 'missing',
      events: [
        {
          type: 'assistant/message',
          seq: 1,
          time: now - 9 * 60_000,
          data: {
            turn: 1,
            step: 1,
            usage: {
              inputTokens: 70,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 70,
            },
          },
        },
      ],
    })
    fixtures.push({
      id: 'spanning',
      events: [
        ...human(dayFrom - 10 * 60_000),
        {
          type: 'assistant/message',
          seq: 2,
          time: dayFrom + 5 * 60_000,
          data: {
            turn: 1,
            step: 1,
            usage: {
              inputTokens: 50,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 50,
            },
          },
        },
        {
          type: 'turn/end',
          seq: 3,
          time: dayFrom + 6 * 60_000,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      ],
    })
    const headers = new Map(
      fixtures.map((fixture) => [
        fixture.id,
        {
          version: 4,
          id: fixture.id,
          createdAt: fixture.events[0]?.time ?? now,
          cwd: '/w',
          isSeeded: fixture.parentSession !== undefined,
          ...(fixture.parentSession === undefined ? {} : { parentSession: fixture.parentSession }),
        },
      ]),
    )
    const query: SessionQueryService = {
      async listSessions() {
        return fixtures.map((fixture) => ({
          header: headers.get(fixture.id),
          live: false,
          persisted: true,
        })) as unknown as Awaited<ReturnType<SessionQueryService['listSessions']>>
      },
      async readSession(sessionId) {
        const fixture = fixtures.find((entry) => entry.id === String(sessionId))
        return {
          session: headers.get(String(sessionId)),
          inheritedEventCount: 0,
          events: fixture?.events ?? [],
        } as unknown as Awaited<ReturnType<SessionQueryService['readSession']>>
      },
      async listEvents(sessionId) {
        const fixture = fixtures.find((entry) => entry.id === String(sessionId))
        return (fixture?.events ?? []) as unknown as Awaited<
          ReturnType<SessionQueryService['listEvents']>
        >
      },
    }
    const test = harness({
      query,
      rows: [
        {
          id: 'edits',
          label: 'Edits',
          kind: 'signal',
          goal: 'small edits',
          match: [{ tool: 'edit' }],
        },
      ],
    })
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=day&session=parent`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(200)
    const body = response.json() as {
      episodes: Array<{ sessionId: string; start: number; children: unknown[] }>
      episodeCount: number
      cohortCount: number
      windowCost: { total: number }
      cost: { contextPerStep: number; messages: number }
      scorecards: Array<{ eligible: number; fired: number }>
    }
    expect(body.episodes).toHaveLength(200)
    // 205 bulk episodes, the parent session, and the episode that started before
    // the window; the orphan child is not a top-level episode.
    expect(body.episodeCount).toBe(207)
    // The spanning episode starts before the window, so it joins no cohort here.
    expect(body.cohortCount).toBe(206)
    // The joined child's 110 tokens and the spanning episode's in-window 50 are
    // attributed once; the orphan child's 70 tokens are not added anywhere.
    expect(body.windowCost.total).toBe(160)
    // The cost denominator is the same attributed work: two assistant messages.
    expect(body.cost.messages).toBe(2)
    expect(body.cost.contextPerStep).toBe(75)
    expect(body.episodes.some((episode) => episode.children.length === 1)).toBe(true)
    expect(body.scorecards[0]?.fired).toBe(205)
    expect(JSON.stringify(body)).not.toContain(secret)
  })

  it('evaluates a hypothesis over its declared window, not the requested range', async () => {
    const now = Date.now()
    const old = now - 3 * 24 * 3_600_000
    const events = [
      {
        type: 'user/message',
        seq: 1,
        time: old,
        data: { role: 'user', content: [], source: { kind: 'user' } },
      },
      {
        type: 'turn/end',
        seq: 2,
        time: old + 1_000,
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ]
    const header = { version: 4, id: 'session-1', createdAt: old, cwd: '/w', isSeeded: false }
    const query: SessionQueryService = {
      async listSessions() {
        return [{ header, live: false, persisted: true }] as unknown as Awaited<
          ReturnType<SessionQueryService['listSessions']>
        >
      },
      async readSession() {
        return { session: header, inheritedEventCount: 0, events } as unknown as Awaited<
          ReturnType<SessionQueryService['readSession']>
        >
      },
      async listEvents() {
        return events as unknown as Awaited<ReturnType<SessionQueryService['listEvents']>>
      },
    }
    const test = harness({
      query,
      hypotheses: [
        {
          description: 'fewer steps per human message over a week',
          metric: 'steps-per-human-message',
          direction: 'decrease',
          threshold: 1,
          window: 'week',
          minSamples: 1,
        },
      ],
    })
    const response = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=day&session=session-1&hypotheses=1`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(200)
    const body = response.json() as {
      cohortCount: number
      hypotheses: Array<{ window: string; samples: number; status: string }>
    }
    // The day window holds no episode, but the weekly hypothesis sees three days ago.
    expect(body.cohortCount).toBe(0)
    expect(body.hypotheses[0]?.window).toBe('week')
    expect(body.hypotheses[0]?.samples).toBe(1)
    expect(body.hypotheses[0]?.status).toBe('inconclusive')
  })

  it('skips the declared hypothesis windows unless the hypothesis view asks', async () => {
    const test = harness({
      hypotheses: [
        {
          description: 'fewer steps over a week',
          metric: 'steps-per-human-message',
          direction: 'decrease',
          threshold: 1,
          window: 'week',
          minSamples: 1,
        },
      ],
    })
    const view = new FakeResponse()
    await test.route.handler(
      request(`${REPORT_PATH}?range=day&session=session-1`),
      view as unknown as ServerResponse,
    )
    expect(view.status).toBe(200)
    const body = view.json() as { hypotheses: Array<{ status: string }> }
    // Without the parameter the extra week corpus is not read; the result waits.
    expect(body.hypotheses[0]?.status).toBe('collecting')
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
