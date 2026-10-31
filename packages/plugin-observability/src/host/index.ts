import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { isRange, RANGES, type Range, rangeWindow } from './aggregate.js'
import { SessionCache } from './cache.js'
import { type PluginConfig, parseConfig } from './config.js'
import type { MetricValues } from './hypotheses.js'
import { FULL_WINDOW } from './metrics.js'
import {
  readBaseline,
  readSessions,
  readSessionTitles,
  type SessionQueryService,
} from './reader.js'
import { attachSessionTitles, buildReport, metricValuesFor, type Report } from './report.js'
import { configuredArgumentFields } from './rows.js'
import type { ReadinessSources } from './status.js'

/** Observability: signal counts derived from the session event logs. */
export const name = '@dsh-setup/plugin-observability'

/** Services the report route reads through. */
export const inject = ['sessionQuery', 'tools', 'webServer', 'connection']

/** Read-only report route used by the view. */
export const REPORT_PATH = '/plugins/dsh-setup-observability/report'

/** Row configuration: declarative signal and guidance rows only. */
export interface Config {
  readonly rows?: unknown
  readonly idleGapMinutes?: unknown
  readonly minEpisodes?: unknown
  readonly hypotheses?: unknown
}

interface ConnectionService {
  requestRejection(request: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

interface ToolRegistry {
  schemas(): readonly { name: string }[]
}

/** The prompt registry as far as readiness reads it. */
interface SystemPromptService {
  assemble(): Promise<{ sections: readonly { name: string }[] }>
}

/** The skill registry as far as readiness reads it. */
interface SkillsService {
  snapshot(): Promise<{ skills: readonly { name: string }[]; complete: boolean }>
}

interface HostContext extends Context {
  connection: ConnectionService
  tools: ToolRuntime
}

/** Read an optional service without declaring it a load requirement. */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    const reflect = (ctx as { reflect?: { get(name: string): unknown } }).reflect
    return (reflect?.get(name) as T | undefined) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Observe the live registries once per report. A missing service, a throwing
 * assembly, or an incomplete catalog is unknown, never absence.
 */
async function readReadiness(ctx: Context): Promise<ReadinessSources> {
  const sources: { sections?: Set<string>; skills?: Set<string>; skillsComplete: boolean } = {
    skillsComplete: false,
  }
  const systemPrompt = optionalService<SystemPromptService>(ctx, 'systemPrompt')
  if (systemPrompt !== undefined) {
    try {
      const assembly = await systemPrompt.assemble()
      sources.sections = new Set(assembly.sections.map((section) => section.name))
    } catch {
      // Readiness unknown; a false alarm is worse than an unknown.
    }
  }
  const skills = optionalService<SkillsService>(ctx, 'skills')
  if (skills !== undefined) {
    try {
      const snapshot = await skills.snapshot()
      sources.skills = new Set(snapshot.skills.map((entry) => entry.name))
      sources.skillsComplete = snapshot.complete === true
    } catch {
      // Readiness unknown.
    }
  }
  return sources
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? REPORT_PATH, 'http://localhost')
}

/** Compute one report for a validated range, with its baseline comparison. */
export async function computeReport(
  ctx: {
    readonly sessionQuery: SessionQueryService
    readonly tools: ToolRegistry
    readonly reflect?: { get(name: string): unknown }
  },
  range: Range,
  sessionId: SessionId | undefined,
  now: number,
  cache: SessionCache,
  config: PluginConfig,
): Promise<Report> {
  const argumentFields = configuredArgumentFields(config.rows)
  const { records, sessions } = await readSessions({
    query: ctx.sessionQuery,
    range,
    now,
    sessionId,
    cache,
    argumentFields,
  })
  const currentWindow = rangeWindow(range, now, 0)
  const baseline = await readBaseline({
    query: ctx.sessionQuery,
    range,
    now,
    sessionId,
    cache,
    argumentFields,
    windowFrom: currentWindow.from,
    windowTo: currentWindow.to,
  })
  const registry = new Set(ctx.tools.schemas().map((schema) => schema.name))
  const readiness = await readReadiness(ctx as unknown as Context)
  // A hypothesis is evaluated over the window it declares, even when another
  // range is requested; distinct windows are read once each and cached.
  const hypothesisValues = new Map<Range, { current: MetricValues; baseline?: MetricValues }>()
  for (const hypothesis of config.hypotheses) {
    if (hypothesisValues.has(hypothesis.window)) continue
    const windowRange = hypothesis.window
    const window = rangeWindow(windowRange, now, 0)
    const observed = windowRange === 'session' ? FULL_WINDOW : { from: window.from, to: window.to }
    const corpus =
      windowRange === range
        ? { records, sessions }
        : await readSessions({
            query: ctx.sessionQuery,
            range: windowRange,
            now,
            sessionId,
            cache,
            argumentFields,
          })
    const forBaseline =
      windowRange === range
        ? baseline
        : await readBaseline({
            query: ctx.sessionQuery,
            range: windowRange,
            now,
            sessionId,
            cache,
            argumentFields,
            windowFrom: window.from,
            windowTo: window.to,
          })
    const currentValues = metricValuesFor({
      records: corpus.records,
      sessions: corpus.sessions,
      idleGapMinutes: config.idleGapMinutes,
      window: observed,
    })
    const baselineValues =
      forBaseline === undefined
        ? undefined
        : metricValuesFor({
            records: forBaseline.records,
            sessions: forBaseline.sessions,
            idleGapMinutes: config.idleGapMinutes,
            window: { from: forBaseline.from, to: forBaseline.to },
          })
    hypothesisValues.set(windowRange, {
      current: currentValues,
      ...(baselineValues === undefined ? {} : { baseline: baselineValues }),
    })
  }
  const report = buildReport({
    range,
    now,
    records,
    configured: config.rows,
    registry,
    readiness,
    sessions,
    config: {
      idleGapMinutes: config.idleGapMinutes,
      minEpisodes: config.minEpisodes,
      hypotheses: config.hypotheses,
    },
    hypothesisValues,
    ...(baseline === undefined
      ? {}
      : {
          baseline: {
            kind: baseline.kind,
            records: baseline.records,
            sessions: baseline.sessions,
            from: baseline.from,
            to: baseline.to,
          },
        }),
  })
  const named = new Set<string>([
    ...report.failures.map((failure) => failure.sessionId),
    ...report.episodes.map((episode) => episode.sessionId),
    ...report.episodes.flatMap((episode) => episode.children.map((child) => child.sessionId)),
  ])
  const titles = await readSessionTitles(ctx.sessionQuery, [...named] as unknown as SessionId[])
  return attachSessionTitles(report, titles)
}

/** Register the read-only report route. */
export function apply(ctx: HostContext, rawConfig?: Config): void {
  const config = parseConfig(rawConfig)
  const cache = new SessionCache()
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: REPORT_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        const rejection = ctx.connection.requestRejection({ headers: req.headers })
        if (rejection !== undefined) {
          writeJson(res, rejection, { error: rejection === 401 ? 'Unauthorized' : 'Forbidden' })
          return
        }
        const url = requestUrl(req)
        const range = url.searchParams.get('range')
        if (!isRange(range)) {
          writeJson(res, 400, {
            error: `range must be one of: ${RANGES.join(', ')}`,
          })
          return
        }
        const session = url.searchParams.get('session')
        const now = Date.now()
        try {
          const report = await computeReport(
            ctx,
            range,
            session === null || session === '' ? undefined : (session as unknown as SessionId),
            now,
            cache,
            config,
          )
          writeJson(res, 200, report)
        } catch (error) {
          console.error('observability: report computation failed', error)
          writeJson(res, 500, { error: 'The report could not be computed.' })
        }
      },
    } satisfies WebRoute),
  )
}
