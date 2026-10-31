import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { HypothesisResult } from '../src/host/hypotheses.ts'
import { extractRecords } from '../src/host/records.ts'
import type { EpisodeReport, FailureEntry } from '../src/host/report.ts'
import { buildReport, type Report } from '../src/host/report.ts'
import { parseRows } from '../src/host/rows.ts'
import type { Scorecard } from '../src/host/scorecards.ts'
import type { ReadinessSources } from '../src/host/status.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

const NOW = new Date(2026, 9, 31, 12, 30).getTime()
const MINUTE = 60_000
const SECRET = 'SECRET-TOKEN-123'

let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function fixtureReport(range: 'session' | 'week' = 'session'): Report {
  const records = extractRecords('session-1', [
    event('turn/start', { turn: 1 }, NOW - 7 * MINUTE),
    event('step/start', { turn: 1, step: 1 }, NOW - 6 * MINUTE),
    event(
      'user/message',
      {
        role: 'user',
        id: 'm0',
        content: [{ type: 'text', text: SECRET }],
        source: { kind: 'user' },
      },
      NOW - 5 * MINUTE,
    ),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
      NOW - 4 * MINUTE,
    ),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{"path":"notes.md"}' },
      NOW - 3 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm1',
          content: [],
          source: { kind: 'tool', callId: 'c2' },
          toolCallId: 'c2',
          isError: true,
        },
      },
      NOW - 2 * MINUTE,
    ),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - MINUTE),
  ])
  const configured = parseRows({
    rows: [
      { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
      {
        id: 'silent-signal',
        label: 'Silent plugin',
        kind: 'signal',
        trigger: 'a progress note is recorded',
        match: [{ tool: 'task_progress' }],
      },
      {
        id: 'missing-signal',
        label: 'Missing plugin',
        kind: 'signal',
        match: [{ tool: 'retired_tool' }],
      },
      { id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] },
      {
        id: 'tool-failures',
        label: 'Tool failures',
        kind: 'signal',
        match: [{ eventType: 'tool/result' }],
      },
      { id: 'prompt-only', label: 'Prompt-only plugin', kind: 'guidance' },
    ],
  })
  return buildReport({
    range,
    now: NOW,
    records,
    configured,
    registry: new Set(['delegate', 'task_progress', 'write']),
  })
}

/** 22 failures: 20 tool failures, one turn failure, and one cut turn. */
function failureReport(): Report {
  const events: SessionEvent[] = [event('turn/start', { turn: 1 }, NOW - 40 * MINUTE)]
  const tools = ['edit', 'write', 'read', 'delegate']
  for (let index = 0; index < 20; index += 1) {
    const callId = `c${String(index)}`
    const time = NOW - (30 - index) * MINUTE
    events.push(
      event(
        'tool/call',
        { turn: 1, step: 1, callId, name: tools[index % tools.length], arguments: '{}' },
        time,
      ),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            id: `m${String(index)}`,
            content: [],
            source: { kind: 'tool', callId },
            toolCallId: callId,
            isError: true,
          },
          error: { name: 'ToolError', code: `E_${String(index)}`, reason: SECRET },
        },
        time + 1000,
      ),
    )
  }
  events.push(
    event(
      'turn/end',
      { turn: 1, reason: { kind: 'error', error: { message: SECRET, code: 'E_LLM' } } },
      NOW - 2 * MINUTE,
    ),
    event('turn/start', { turn: 2 }, NOW - 90_000),
    event('turn/end', { turn: 2, reason: { kind: 'max-tokens' } }, NOW - MINUTE),
  )
  return buildReport({
    range: 'session',
    now: NOW,
    records: extractRecords('session-1', events),
    configured: parseRows({
      rows: [
        { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
      ],
    }),
    registry: new Set(['delegate', 'edit', 'write', 'read']),
  })
}

/** A window whose only failure is recovered by a completed turn. */
function recoveredOnlyReport(): Report {
  const records = extractRecords('session-1', [
    event('turn/start', { turn: 1 }, NOW - 6 * MINUTE),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
      NOW - 5 * MINUTE,
    ),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{"path":"notes.md"}' },
      NOW - 4 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm1',
          content: [],
          source: { kind: 'tool', callId: 'c2' },
          toolCallId: 'c2',
          isError: true,
        },
      },
      NOW - 3 * MINUTE,
    ),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 2 * MINUTE),
  ])
  return buildReport({
    range: 'session',
    now: NOW,
    records,
    configured: parseRows({
      rows: [
        { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
      ],
    }),
    registry: new Set(['delegate', 'write']),
  })
}

/** A configured tool whose only failure was recovered by a completed turn. */
function recoveredRowReport(): Report {
  const records = extractRecords('session-1', [
    event('turn/start', { turn: 1 }, NOW - 6 * MINUTE),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{}' },
      NOW - 5 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm1',
          content: [],
          source: { kind: 'tool', callId: 'c2' },
          toolCallId: 'c2',
          isError: true,
        },
      },
      NOW - 4 * MINUTE,
    ),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 3 * MINUTE),
  ])
  return buildReport({
    range: 'session',
    now: NOW,
    records,
    configured: parseRows({
      rows: [{ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] }],
    }),
    registry: new Set(['write']),
  })
}

/** Two sessions of activity, so the session denominator must count both. */
function silentAcrossSessionsReport(): Report {
  const records = [
    ...extractRecords('session-1', [
      event('turn/start', { turn: 1 }, NOW - 5 * MINUTE),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 4 * MINUTE),
    ]),
    ...extractRecords('session-2', [
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
        NOW - 3 * MINUTE,
      ),
    ]),
  ]
  return buildReport({
    range: 'session',
    now: NOW,
    records,
    configured: parseRows({
      rows: [
        { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
        {
          id: 'silent-signal',
          label: 'Silent plugin',
          kind: 'signal',
          trigger: 'a progress note is recorded',
          match: [{ tool: 'task_progress' }],
        },
      ],
    }),
    registry: new Set(['delegate', 'task_progress']),
  })
}

/** A configured tool with two unrecovered failures; the newer identity must win. */
function errorCardReport(): Report {
  const records = extractRecords('session-1', [
    event('turn/start', { turn: 1 }, NOW - 5 * MINUTE),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{}' },
      NOW - 4 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm1',
          content: [],
          source: { kind: 'tool', callId: 'c1' },
          toolCallId: 'c1',
          isError: true,
        },
        error: { name: 'OldError', code: 'E_OLD' },
      },
      NOW - 3 * MINUTE,
    ),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{}' },
      NOW - 2 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm2',
          content: [],
          source: { kind: 'tool', callId: 'c2' },
          toolCallId: 'c2',
          isError: true,
        },
        error: { name: 'NewError', code: 'E_NEW' },
      },
      NOW - MINUTE,
    ),
  ])
  return buildReport({
    range: 'session',
    now: NOW,
    records,
    configured: parseRows({
      rows: [{ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] }],
    }),
    registry: new Set(['write']),
  })
}

/** 179 calls with 17 failures, so a bar must draw a partial failing share. */
function mixedToolReport(): Report {
  const events: SessionEvent[] = [event('turn/start', { turn: 1 }, NOW - 60 * MINUTE)]
  for (let index = 0; index < 179; index += 1) {
    const callId = `m${String(index)}`
    events.push(
      event(
        'tool/call',
        { turn: 1, step: 1, callId, name: 'edit', arguments: '{}' },
        NOW - 60 * MINUTE + index,
      ),
    )
  }
  for (let index = 0; index < 17; index += 1) {
    const callId = `m${String(index)}`
    events.push(
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            id: `r${String(index)}`,
            content: [],
            source: { kind: 'tool', callId },
            toolCallId: callId,
            isError: true,
          },
        },
        NOW - 30 * MINUTE + index,
      ),
    )
  }
  return buildReport({
    range: 'session',
    now: NOW,
    records: extractRecords('session-1', events),
    configured: [],
    registry: new Set(['edit']),
  })
}

/** One session-range report over an explicit event and row set. */
function windowReport(options: {
  readonly events?: SessionEvent[]
  readonly rows?: unknown[]
  readonly registry?: string[]
  readonly readiness?: ReadinessSources
}): Report {
  return buildReport({
    range: 'session',
    now: NOW,
    records: extractRecords('session-1', options.events ?? []),
    configured: parseRows({ rows: options.rows ?? [] }),
    registry: new Set(options.registry ?? []),
    readiness: options.readiness,
  })
}

/** One report with a guidance row whose declared section is checked against `sources`. */
function readinessReport(sources: ReadinessSources): Report {
  return buildReport({
    range: 'session',
    now: NOW,
    records: [],
    configured: parseRows({
      rows: [
        {
          id: 'ponytail',
          label: 'Ponytail',
          kind: 'guidance',
          mounted: { section: 'dsh-setup:ponytail', skill: 'ponytail' },
        },
      ],
    }),
    registry: new Set(),
    readiness: sources,
  })
}

/** A hand-made entry so component tests can pin one field at a time. */
function entry(overrides: Partial<FailureEntry> = {}): FailureEntry {
  return {
    seq: 1,
    time: NOW - MINUTE,
    sessionId: 'session-1',
    severity: 'tool failure',
    recovered: false,
    turn: 1,
    step: 1,
    tool: 'edit',
    callId: 'c1',
    ...overrides,
  }
}

/** One unrecovered tool failure in the given session. */
function singleFailureReport(sessionId: string): Report {
  const events = [
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'x1', name: 'edit', arguments: '{}' },
      NOW - 2 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'mx',
          content: [],
          source: { kind: 'tool', callId: 'x1' },
          toolCallId: 'x1',
          isError: true,
        },
        error: { name: 'ToolError', code: 'E_X' },
      },
      NOW - MINUTE,
    ),
  ]
  return buildReport({
    range: 'session',
    now: NOW,
    records: extractRecords(sessionId, events),
    configured: [],
    registry: new Set(['edit']),
  })
}

type Element = { type: unknown; props: Record<string, unknown> }

const Fragment = Symbol('Fragment')
function jsx(type: unknown, props: Record<string, unknown> | null): Element {
  return { type, props: props ?? {} }
}

/** Expand function components so tests inspect the rendered tree, not descriptors. */
function renderTree(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderTree)
  const element = node as Element
  if (typeof element.type === 'function') {
    return renderTree((element.type as (props: Record<string, unknown>) => unknown)(element.props))
  }
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(element.props)) {
    props[key] = key === 'children' ? renderTree(value) : value
  }
  return { type: element.type, props }
}

function elements(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found)
    return found
  }
  const element = node as Element
  if (element.type !== undefined && element.props !== undefined) {
    found.push(element)
    for (const value of Object.values(element.props)) elements(value, found)
  }
  return found
}

/** Visible text only: children, never attribute values. */
function childText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (node === null || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(childText).join('')
  return childText((node as Element).props?.children)
}

interface LoadedModule {
  inject?: string[]
  EN?: Record<string, string>
  apply?: (ctx: unknown) => void
  reportUrl?: (range: string, sessionId?: string) => string
  counted?: (count: number, one: string, many?: string) => string
  chartWidth?: (entryWidth: number | undefined, fallback: number) => number
  useChartWidth?: (fallback?: number) => { ref: unknown; width: number }
  timeScale?: (from: number, to: number, width: number) => (time: number) => number
  categoryBand?: (
    count: number,
    width: number,
    maxBarWidth: number,
  ) => { band: number; bar: number; offset: number }
  SessionTimeline?: (props: Record<string, unknown>) => unknown
  RangeSeries?: (props: Record<string, unknown>) => unknown
  TokenMix?: (props: Record<string, unknown>) => unknown
  failureFacts?: (failure: FailureEntry, t: (key: string) => string) => string[]
  failureCopyText?: (failures: readonly FailureEntry[], t: (key: string) => string) => string
  failureFixPrompt?: (failures: readonly FailureEntry[], t: (key: string) => string) => string
  FAILURE_SECTION_ID?: string
  MAX_FIX_PROMPT_CHARS?: number
  KpiStrip?: (props: Record<string, unknown>) => unknown
  HealthBanner?: (props: Record<string, unknown>) => unknown
  PluginBoard?: (props: Record<string, unknown>) => unknown
  PluginCard?: (props: Record<string, unknown>) => unknown
  StatusPill?: (props: Record<string, unknown>) => unknown
  Sparkline?: (props: Record<string, unknown>) => unknown
  FailureList?: (props: Record<string, unknown>) => unknown
  ToolsPanel?: (props: Record<string, unknown>) => unknown
  BlindSpots?: (props: Record<string, unknown>) => unknown
  RangeSelector?: (props: Record<string, unknown>) => unknown
  ObservabilityPanel?: (props: Record<string, unknown>) => unknown
  ObservabilityView?: (props: Record<string, unknown>) => unknown
  SUB_VIEWS?: readonly string[]
  MIN_EPISODES?: number
  EPISODE_TABLE_LIMIT?: number
  SubViewTabs?: (props: Record<string, unknown>) => unknown
  sufficiency?: (report: Report) => string
  DataSufficiency?: (props: Record<string, unknown>) => unknown
  OutcomeTiles?: (props: Record<string, unknown>) => unknown
  ActivityPanel?: (props: Record<string, unknown>) => unknown
  DataQualityStrip?: (props: Record<string, unknown>) => unknown
  scorecardStatus?: (card: Scorecard) => string
  ScorecardCard?: (props: Record<string, unknown>) => unknown
  ScorecardList?: (props: Record<string, unknown>) => unknown
  visibleEpisodes?: (
    episodes: readonly EpisodeReport[],
    outcome: string,
    plugin: string,
    sort: unknown,
  ) => EpisodeReport[]
  TasksView?: (props: Record<string, unknown>) => unknown
  EpisodeDetail?: (props: Record<string, unknown>) => unknown
  HypothesesView?: (props: Record<string, unknown>) => unknown
  hypothesisCopyText?: (results: readonly HypothesisResult[], t: (key: string) => string) => string
  OverviewView?: (props: Record<string, unknown>) => unknown
  FindingsStrip?: (props: Record<string, unknown>) => unknown
}

interface LoaderRegistration {
  id: string
  factory: (require: (id: string) => unknown) => LoadedModule
}

function loadBundle(required: string[] = []): { module: LoadedModule; required: string[] } {
  const file = join(packageDir, 'lib', 'client.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  let registration: LoaderRegistration | undefined
  const window = {
    __ModuleLoader__: {
      load(value: LoaderRegistration): void {
        registration = value
      },
    },
  }
  new Function('window', readFileSync(file, 'utf8'))(window)
  if (registration === undefined) throw new Error('the client bundle did not register a module')
  const module = registration.factory((id) => {
    required.push(id)
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
    if (id === 'react') {
      return {
        useEffect: () => {},
        useState: (initial: unknown) => [
          typeof initial === 'function' ? (initial as () => unknown)() : initial,
          () => {},
        ],
      }
    }
    return {}
  })
  return { module, required }
}

function translate(key: string): string {
  return key
}

function findButton(tree: unknown, label: string): Element | undefined {
  return elements(tree).find((element) => element.type === 'button' && childText(element) === label)
}

function nodesOf(tree: unknown, type: string, predicate?: (element: Element) => boolean) {
  return elements(tree).filter(
    (element) => element.type === type && (predicate === undefined || predicate(element)),
  )
}

/** A presentational panel renderer backed by a stateful React double. */
function statefulPanel(): (props: Record<string, unknown>) => unknown {
  const file = join(packageDir, 'lib', 'client.js')
  let registration: LoaderRegistration | undefined
  const window = {
    __ModuleLoader__: {
      load(value: LoaderRegistration): void {
        registration = value
      },
    },
  }
  new Function('window', readFileSync(file, 'utf8'))(window)
  if (registration === undefined) throw new Error('the client bundle did not register a module')
  const states: unknown[] = []
  let cursor = 0
  const react = {
    useState(initial: unknown) {
      const index = cursor
      cursor += 1
      if (!(index in states)) {
        states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const set = (next: unknown): void => {
        states[index] =
          typeof next === 'function' ? (next as (value: unknown) => unknown)(states[index]) : next
      }
      return [states[index], set]
    },
    useEffect: () => {},
  }
  const module = registration.factory((id) => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
    if (id === 'react') return react
    return {}
  }) as LoadedModule
  return (props) => {
    cursor = 0
    return renderTree(module.ObservabilityPanel?.(props))
  }
}

interface Registration {
  readonly options: Record<string, unknown>
  readonly component: (props: Record<string, unknown>) => unknown
}

/** Apply the bundle with an optional service resolver and return its registrations. */
function registrationsWithReflect(reflect?: { get(name: string): unknown }): Registration[] {
  const { module } = loadBundle()
  const registrations: Registration[] = []
  module.apply?.({
    effect(callback: () => () => void) {
      callback()
      return () => {}
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return translate
      },
    },
    slots: {
      inject(_key: string, callback: () => () => void) {
        callback()
        return () => {}
      },
      register(options: Record<string, unknown>, component: Registration['component']) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    ...(reflect === undefined ? {} : { reflect }),
  })
  return registrations
}

describe('Observability Client half', () => {
  it('registers the conversation view with id, order, and a localized label', () => {
    const { module } = loadBundle()
    const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const locales: Array<{ namespace: string; dictionary: Record<string, string> }> = []
    module.apply?.({
      effect(callback: () => () => void) {
        callback()
        return () => {}
      },
      locale: {
        register(namespace: string, _locale: string, dictionary: Record<string, string>) {
          locales.push({ namespace, dictionary })
          return () => {}
        },
        bind() {
          return translate
        },
      },
      slots: {
        inject(_key: string, callback: () => () => void) {
          callback()
          return () => {}
        },
        register(options: Record<string, unknown>, component: unknown) {
          registrations.push({ options, component })
          return () => {}
        },
      },
    })
    expect(module.inject).toEqual(['slots', 'locale'])
    expect(locales[0]?.namespace).toBe('dsh-setup-observability')
    expect(locales[0]?.dictionary['view.label']).toBe('Observability')
    expect(registrations).toHaveLength(1)
    const options = registrations[0]?.options ?? {}
    expect(options.name).toBe('conversation.view')
    expect(options.id).toBe('observability')
    expect(options.order).toBe(20)
    const label = options.label
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('view.label')
    expect(typeof registrations[0]?.component).toBe('function')
  })

  it('builds the report URL with the range and open session', () => {
    const { module } = loadBundle()
    expect(module.reportUrl?.('week', 'session-1')).toBe(
      '/plugins/dsh-setup-observability/report?range=week&session=session-1',
    )
    expect(module.reportUrl?.('day')).toBe('/plugins/dsh-setup-observability/report?range=day')
  })

  it('renders the KPI strip from the whole-window totals and makes the failure count a control', () => {
    const { module } = loadBundle()
    const revealed: number[] = []
    const rendered = renderTree(
      module.KpiStrip?.({
        report: failureReport(),
        t: translate,
        failuresOpen: false,
        onRevealFailures: () => {
          revealed.push(1)
        },
      }),
    )
    const kpis = nodesOf(rendered, 'div', (element) => element.props['data-kpi'] !== undefined)
    const values = new Map(kpis.map((kpi) => [String(kpi.props['data-kpi']), childText(kpi)]))
    expect(values.get('turns')).toContain('2')
    expect(values.get('steps')).toContain('0')
    expect(values.get('toolCalls')).toContain('20')
    const control = elements(rendered).find(
      (element) =>
        element.type === 'button' &&
        element.props['data-kpi'] === 'failures' &&
        element.props['aria-expanded'] === false,
    )
    expect(control).toBeDefined()
    expect(control?.props['aria-controls']).toBe(module.FAILURE_SECTION_ID)
    expect(childText(control)).toContain('22')
    expect(control?.props['data-tone']).toBe('error')
    ;(control?.props.onClick as (() => void) | undefined)?.()
    expect(revealed).toHaveLength(1)
  })

  it('puts the health verdict first and never derives it from silence or a recovered failure', () => {
    const { module } = loadBundle()
    const recovered = renderTree(
      module.HealthBanner?.({ report: recoveredOnlyReport(), t: translate }),
    )
    expect(childText(recovered)).toContain('health.ok')
    expect(childText(recovered)).not.toContain('health.attention')
    expect(childText(recovered)).toContain('1 health.failure')
    expect(elements(recovered).some((element) => element.props['data-tone'] === 'ok')).toBe(true)

    const failed = renderTree(module.HealthBanner?.({ report: failureReport(), t: translate }))
    expect(childText(failed)).toContain('health.attention')
    expect(elements(failed).some((element) => element.props['data-tone'] === 'attention')).toBe(
      true,
    )

    const missing = renderTree(module.HealthBanner?.({ report: fixtureReport(), t: translate }))
    expect(childText(missing)).toContain('health.missing')

    const notMounted = renderTree(
      module.HealthBanner?.({
        report: readinessReport({ sections: new Set(), skillsComplete: false }),
        t: translate,
      }),
    )
    expect(childText(notMounted)).toContain('health.notMounted')
    expect(childText(notMounted)).toContain('1 health.notMountedCount')
  })

  it('earns the verdict from each attention condition independently', () => {
    const { module } = loadBundle()
    const verdict = (report: Report): { text: string; tone: unknown } => {
      const tree = renderTree(module.HealthBanner?.({ report, t: translate }))
      return {
        text: childText(tree),
        tone: elements(tree).find((element) => element.props['data-tone'] !== undefined)?.props[
          'data-tone'
        ],
      }
    }
    const turnFailure = windowReport({
      events: [
        event(
          'turn/end',
          { turn: 1, reason: { kind: 'error', error: { message: 'x', code: 'E' } } },
          NOW,
        ),
      ],
    })
    expect(verdict(turnFailure).text).toContain('health.attention')
    expect(verdict(turnFailure).tone).toBe('attention')

    const turnCut = windowReport({
      events: [event('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, NOW)],
    })
    expect(verdict(turnCut).text).toContain('health.attention')

    const unrecovered = windowReport({
      events: [
        event(
          'tool/call',
          { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{}' },
          NOW - MINUTE,
        ),
        event(
          'tool/result',
          {
            turn: 1,
            step: 1,
            message: {
              role: 'tool',
              id: 'm1',
              content: [],
              source: { kind: 'tool', callId: 'c1' },
              toolCallId: 'c1',
              isError: true,
            },
          },
          NOW - 30_000,
        ),
      ],
    })
    expect(verdict(unrecovered).text).toContain('health.attention')

    const notLoaded = windowReport({
      rows: [{ id: 'gone', label: 'Gone', kind: 'signal', match: [{ tool: 'retired' }] }],
    })
    expect(verdict(notLoaded).text).toContain('health.missing')
    expect(verdict(notLoaded).tone).toBe('attention')

    // Silence plus an unknown readiness check is not a fault.
    const healthy = windowReport({
      events: [
        event('turn/start', { turn: 1 }, NOW - 5 * MINUTE),
        event(
          'tool/call',
          { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{}' },
          NOW - 4 * MINUTE,
        ),
        event(
          'tool/result',
          {
            turn: 1,
            step: 1,
            message: {
              role: 'tool',
              id: 'm1',
              content: [],
              source: { kind: 'tool', callId: 'c1' },
              toolCallId: 'c1',
              isError: true,
            },
          },
          NOW - 3 * MINUTE,
        ),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 2 * MINUTE),
      ],
      rows: [
        {
          id: 'silent',
          label: 'Silent',
          kind: 'signal',
          trigger: 'a progress note is recorded',
          match: [{ tool: 'task_progress' }],
        },
        {
          id: 'guidance',
          label: 'Guidance',
          kind: 'guidance',
          mounted: { section: 'dsh-setup:ponytail' },
        },
      ],
      registry: ['write', 'task_progress'],
      readiness: { skillsComplete: false },
    })
    expect(verdict(healthy).text).toContain('health.ok')
    expect(verdict(healthy).text).not.toContain('health.attention')
    expect(verdict(healthy).tone).toBe('ok')
  })

  it('groups cards by attention, keeps silent rows compact, and words each state', () => {
    const { module } = loadBundle()
    const filtered: Array<string | undefined> = []
    const rendered = renderTree(
      module.PluginBoard?.({
        report: fixtureReport(),
        t: translate,
        now: NOW,
        onShowFailures: (tool?: string) => {
          filtered.push(tool)
        },
      }),
    )
    const cards = nodesOf(rendered, 'article')
    const byStatus = (status: string) =>
      cards.filter((card) => card.props['data-status'] === status)
    expect(byStatus('error')).toHaveLength(2)
    expect(byStatus('active')).toHaveLength(1)
    expect(byStatus('not loaded')).toHaveLength(1)
    const cardText = cards.map(childText).join('\n')
    expect(cardText).toContain('Delegation')
    expect(cardText).toContain('Missing plugin')
    expect(cardText).toContain('delegate')
    const pillText = (card: Element): string =>
      childText(
        nodesOf(
          card,
          'span',
          (element) => String(element.props.className ?? '') === 'dsh-obs-pill',
        )[0],
      )
    expect(pillText(cards.find((card) => childText(card).includes('Delegation')) as Element)).toBe(
      'status.active',
    )
    expect(
      pillText(cards.find((card) => childText(card).includes('Missing plugin')) as Element),
    ).toBe('status.not loaded')
    expect(pillText(cards.find((card) => childText(card).includes('Writes')) as Element)).toBe(
      'status.error',
    )

    // Silence is a compact row with its status word, trigger, and window
    // denominators, and the absence note appears once in the section header.
    const silentRows = nodesOf(
      rendered,
      'li',
      (element) => element.props['data-status'] === 'silent',
    )
    expect(silentRows).toHaveLength(1)
    const silentText = childText(silentRows[0])
    expect(silentText).toContain('Silent plugin')
    expect(silentText).toContain('a progress note is recorded')
    expect(silentText).toContain('0 failure.of 1 kpi.turn')
    expect(silentText).toContain('0 failure.of 2 kpi.toolCall')
    expect(silentText).toContain('0 failure.of 1 kpi.session')
    expect(
      childText(
        nodesOf(
          silentRows[0],
          'span',
          (element) => String(element.props.className ?? '') === 'dsh-obs-pill',
        )[0],
      ),
    ).toBe('status.silent')
    expect(childText(rendered).split('section.absence')).toHaveLength(2)

    // The error card names its last failure and links to the filtered list.
    const errorCard = cards.find((card) => childText(card).includes('Writes'))
    expect(childText(errorCard)).toContain('write')
    const link = elements(errorCard).find(
      (element) => element.type === 'button' && childText(element) === 'card.showFailures',
    )
    ;(link?.props.onClick as (() => void) | undefined)?.()
    expect(filtered).toEqual(['write'])

    expect(childText(rendered)).toContain('Prompt-only plugin')
    expect(childText(rendered)).toContain('status.guidance')

    // Cards belong to the matching section, in attention-first order.
    const sections = nodesOf(rendered, 'section')
    const section = (key: string) =>
      sections.find((candidate) => childText(candidate).includes(key))
    const statuses = (key: string) =>
      nodesOf(section(key), 'article').map((card) => card.props['data-status'])
    // The fixture's tool failures were all recovered, so they need no attention.
    expect(statuses('section.attention')).toEqual(['not loaded'])
    expect(statuses('section.active')).toEqual(['active', 'error', 'error'])
    expect(childText(section('section.silent'))).toContain('Silent plugin')
    expect(childText(section('section.guidance'))).toContain('Prompt-only plugin')
    const order = childText(rendered)
    const attentionAt = order.indexOf('section.attention')
    const activeAt = order.indexOf('section.active')
    const silentAt = order.indexOf('section.silent')
    const guidanceAt = order.indexOf('section.guidance')
    expect(attentionAt).toBeLessThan(activeAt)
    expect(activeAt).toBeLessThan(silentAt)
    expect(silentAt).toBeLessThan(guidanceAt)
  })

  it('shows the readiness word on a guidance row and never a silent status', () => {
    const { module } = loadBundle()
    const sources: ReadinessSources = {
      sections: new Set(['dsh-setup:ponytail']),
      skills: new Set(),
      skillsComplete: true,
    }
    const rendered = renderTree(
      module.PluginBoard?.({ report: readinessReport(sources), t: translate, now: NOW }),
    )
    const text = childText(rendered)
    expect(text).toContain('readiness.notMounted')
    expect(text).not.toContain('health.silent')
    const missing = renderTree(
      module.PluginBoard?.({
        report: readinessReport({
          sections: new Set(['dsh-setup:ponytail']),
          skills: new Set(['ponytail']),
          skillsComplete: true,
        }),
        t: translate,
        now: NOW,
      }),
    )
    expect(childText(missing)).toContain('readiness.mounted')
    const unknown = renderTree(
      module.PluginBoard?.({
        report: readinessReport({ skillsComplete: false }),
        t: translate,
        now: NOW,
      }),
    )
    expect(childText(unknown)).toContain('readiness.unknown')
  })

  it('renders a sparkline with one titled bar per bucket', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.Sparkline?.({ counts: [0, 2, 1], label: 'Delegation' }))
    expect(nodesOf(rendered, 'title').map(childText)).toEqual([
      'Delegation: 0',
      'Delegation: 2',
      'Delegation: 1',
    ])
  })

  it('limits the expanded trace list to five metadata entries', () => {
    const { module } = loadBundle()
    const events = Array.from({ length: 8 }, (_unused, index) =>
      event('step/start', { turn: 1, step: index + 1 }, NOW - (8 - index) * MINUTE),
    )
    const report = buildReport({
      range: 'session',
      now: NOW,
      records: extractRecords('session-1', [
        event('turn/start', { turn: 1 }, NOW - 20 * MINUTE),
        ...events,
      ]),
      configured: parseRows({
        rows: [
          { id: 'steps', label: 'Steps', kind: 'signal', match: [{ eventType: 'step/start' }] },
        ],
      }),
      registry: new Set(),
    })
    const row = report.rows.find((candidate) => candidate.id === 'steps')
    if (row === undefined) throw new Error('row missing')
    const rendered = renderTree(module.PluginCard?.({ row, t: translate, now: NOW }))
    expect(nodesOf(rendered, 'li')).toHaveLength(5)
    expect(childText(rendered)).toContain('card.recent')
  })

  it('draws the failing share proportionally over the call population', () => {
    const { module } = loadBundle()
    const rendered = renderTree(
      module.ToolsPanel?.({ outcomes: failureReport().toolOutcomes, t: translate }),
    )
    const items = nodesOf(rendered, 'li')
    expect(items.length).toBeGreaterThan(0)
    const text = items.map(childText).join('\n')
    expect(text).toContain('edit')
    // edit made 5 calls and every one failed: 5 of 5 · 100%.
    expect(text).toContain('5 failure.of 5 · 100%')
    const failed = nodesOf(rendered, 'span', (element) =>
      String(element.props.className ?? '').includes('dsh-obs-bars-fail'),
    )
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0]?.props.title).toBe('5 tools.share')
  })

  it('draws no failing share for a tool whose calls did not fail', () => {
    const { module } = loadBundle()
    const rendered = renderTree(
      module.ToolsPanel?.({ outcomes: fixtureReport().toolOutcomes, t: translate }),
    )
    const items = nodesOf(rendered, 'li')
    expect(items).toHaveLength(2)
    const text = items.map(childText).join('\n')
    expect(text).toContain('delegate')
    expect(text).toContain('1 failure.of 1 · 100%')
    expect(
      nodesOf(rendered, 'span', (element) =>
        String(element.props.className ?? '').includes('dsh-obs-bars-fail'),
      ),
    ).toHaveLength(1)
  })

  it('renders every observed tool, not only a top slice', () => {
    const { module } = loadBundle()
    const outcomes = Array.from({ length: 10 }, (_unused, index) => ({
      tool: `tool_${String(index)}`,
      calls: 1,
      failed: 0,
    }))
    const rendered = renderTree(module.ToolsPanel?.({ outcomes, t: translate }))
    expect(nodesOf(rendered, 'li')).toHaveLength(10)
    expect(childText(rendered)).toContain('tool_9')
  })

  it('lists every failure collapsed, grouped by severity, with metadata only', () => {
    const { module } = loadBundle()
    const report = failureReport()
    const rendered = renderTree(
      module.FailureList?.({
        failures: report.failures,
        totals: report.failureTotals,
        t: translate,
        open: false,
      }),
    )
    expect(childText(rendered)).toContain('failure.title (22 failure.entries)')
    expect(nodesOf(rendered, 'details')[0]?.props.open).toBe(false)
    const groups = nodesOf(
      rendered,
      'div',
      (element) => element.props['data-severity'] !== undefined,
    )
    expect(groups.map((group) => group.props['data-severity'])).toEqual([
      'turn failure',
      'turn cut',
      'tool failure',
    ])
    const entries = nodesOf(rendered, 'li')
    expect(entries).toHaveLength(22)
    const text = entries.map(childText).join('\n')
    expect(text).toContain('severity.turnFailure')
    expect(text).toContain('severity.turnCut')
    expect(text).toContain('severity.toolFailure')
    expect(text).toContain('turn 1')
    expect(text).toContain('step 1')
    expect(text).toContain('E_19')
    expect(text).toContain('E_LLM')
    // Only metadata: the raw reason and the stored message text never reach the view.
    expect(JSON.stringify(rendered)).not.toContain(SECRET)
    const copy = module.failureCopyText?.(report.failures, translate) ?? ''
    expect(copy.split('\n')).toHaveLength(22)
    expect(copy).toContain('E_19')
    expect(copy).not.toContain(SECRET)
  })

  it('marks recovered entries and states the rendered bound', () => {
    const { module } = loadBundle()
    const recovered = entry({ recovered: true })
    expect(module.failureFacts?.(recovered, translate)).toContain('entry.recovered')
    const failures = [
      entry({ seq: 3, recovered: true }),
      entry({ seq: 2 }),
      entry({ seq: 1, tool: 'read' }),
    ]
    const rendered = renderTree(
      module.FailureList?.({
        failures,
        totals: { total: 5, turnFailures: 0, turnCuts: 0, toolFailures: 5, recovered: 1 },
        t: translate,
        open: true,
      }),
    )
    expect(nodesOf(rendered, 'details')[0]?.props.open).toBe(true)
    expect(childText(rendered)).toContain('failure.bound 3 failure.of 5')
    expect(
      nodesOf(rendered, 'li', (element) => element.props['data-recovered'] === 'true'),
    ).toHaveLength(1)
  })

  it('renders no failure section for an empty window', () => {
    const { module } = loadBundle()
    expect(
      module.FailureList?.({
        failures: [],
        totals: { total: 0, turnFailures: 0, turnCuts: 0, toolFailures: 0, recovered: 0 },
        t: translate,
        open: false,
      }),
    ).toBeNull()
  })

  it('counts with one pluralization helper', () => {
    const { module } = loadBundle()
    expect(module.counted?.(1, 'entry', 'entries')).toBe('1 entry')
    expect(module.counted?.(2, 'entry', 'entries')).toBe('2 entries')
    expect(module.counted?.(2, 'trace')).toBe('2 traces')
  })

  it('opens an entry through the inspector or the session, and never across a missing service', () => {
    const { module } = loadBundle()
    const inspected: string[] = []
    const viewed: Array<[string, string]> = []
    const opened: string[] = []
    const workspace = {
      openSession: (id: string) => opened.push(id),
      startSession: () => {},
    }
    const panel = (report: Report, props: Record<string, unknown> = {}): unknown =>
      renderTree(
        module.ObservabilityPanel?.({
          range: 'session',
          report,
          error: null,
          t: translate,
          onRange: () => {},
          now: NOW,
          sessionId: 'session-1',
          workspace,
          inspectCall: (id: string) => inspected.push(id),
          openView: (view: string, focus: string) => viewed.push([view, focus]),
          ...props,
        }),
      )
    const openButtons = (tree: unknown): Element[] =>
      elements(tree).filter(
        (element) => element.type === 'button' && childText(element) === 'failure.open',
      )

    // Same session: the recorded call is inspected, not re-opened as a session.
    const local = panel(failureReport())
    const localButtons = openButtons(local)
    expect(localButtons).toHaveLength(20)
    ;(localButtons[0]?.props.onClick as (() => void) | undefined)?.()
    expect(inspected).toEqual(['c19'])
    expect(viewed).toEqual([])
    expect(opened).toEqual([])
    ;(localButtons[1]?.props.onClick as (() => void) | undefined)?.()
    expect(inspected).toEqual(['c19', 'c18'])

    // openView is the fallback when inspectCall is absent.
    const fallback = panel(failureReport(), { inspectCall: undefined })
    const fallbackButtons = openButtons(fallback)
    ;(fallbackButtons[0]?.props.onClick as (() => void) | undefined)?.()
    expect(viewed).toEqual([['trajectory', 'c19']])

    // Another session opens through the optional Workspace service.
    const remote = panel(singleFailureReport('session-2'))
    const remoteButtons = openButtons(remote)
    expect(remoteButtons).toHaveLength(1)
    ;(remoteButtons[0]?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual(['session-2'])
    expect(inspected).toEqual(['c19', 'c18'])

    // A turn failure has no call to focus, so it carries metadata only.
    const turnOnly = panel({
      ...failureReport(),
      failures: failureReport().failures.filter((failure) => failure.severity !== 'tool failure'),
      failureTotals: {
        total: 2,
        turnFailures: 1,
        turnCuts: 1,
        toolFailures: 0,
        recovered: 0,
      },
    })
    expect(openButtons(turnOnly)).toHaveLength(0)
  })

  it('opens a prefilled fix draft with append mode and no submit', () => {
    const { module } = loadBundle()
    const started: Array<Record<string, unknown>> = []
    const workspace = {
      openSession: () => {},
      startSession: (_workspaceId?: string, options?: Record<string, unknown>) => {
        started.push(options ?? {})
      },
    }
    const rendered = renderTree(
      module.ObservabilityPanel?.({
        range: 'session',
        report: failureReport(),
        error: null,
        t: translate,
        onRange: () => {},
        now: NOW,
        sessionId: 'session-1',
        workspace,
      }),
    )
    const fix = elements(rendered).find(
      (element) => element.type === 'button' && childText(element) === 'failure.fix',
    )
    expect(fix).toBeDefined()
    ;(fix?.props.onClick as (() => void) | undefined)?.()
    expect(started).toHaveLength(1)
    expect(started[0]?.whenDraftExists).toBe('append')
    const prompt = String(started[0]?.prompt)
    expect(prompt).toContain('fix.head')
    expect(prompt).toContain('fix.instructions')
    expect(prompt).not.toContain(SECRET)
    expect(prompt).not.toContain('RAW-REASON')
    expect(started[0]).not.toHaveProperty('submit')
  })

  it('degrades to the copyable list when a new session cannot be opened', () => {
    const { module } = loadBundle()
    const rendered = renderTree(
      module.ObservabilityPanel?.({
        range: 'session',
        report: failureReport(),
        error: null,
        t: translate,
        onRange: () => {},
        now: NOW,
        sessionId: 'session-1',
      }),
    )
    const buttons = elements(rendered).filter((element) => element.type === 'button')
    expect(buttons.some((element) => childText(element) === 'failure.fix')).toBe(false)
    expect(buttons.some((element) => childText(element) === 'failure.open')).toBe(false)
    expect(buttons.some((element) => childText(element) === 'failure.copy')).toBe(true)
    expect(childText(rendered)).toContain('failure.entries')
  })

  it('bounds the fix prompt, keeping identifiers, the omitted tail, and the instructions', () => {
    const { module } = loadBundle()
    const limit = module.MAX_FIX_PROMPT_CHARS ?? 0
    const many = Array.from({ length: 205 }, (_unused, index) =>
      entry({ seq: index + 7, tool: `tool_${String(index)}` }),
    )
    const prompt = module.failureFixPrompt?.(many, translate) ?? ''
    expect(prompt.length).toBeLessThanOrEqual(limit)
    expect(prompt).toContain('fix.omitted')
    expect(prompt).toContain('fix.instructions')
    expect(prompt).toContain('fix.event 7')
    expect(prompt).toContain('session session-1')
    // An oversized entry loses its descriptive tail, never the locator or instructions.
    const huge = module.failureFixPrompt?.(
      [
        entry({ seq: 42, errorName: 'A'.repeat(2000), errorCode: 'B'.repeat(2000) }),
        entry({ seq: 43 }),
        entry({ seq: 44 }),
      ],
      translate,
    )
    const text = String(huge)
    expect(text.length).toBeLessThanOrEqual(limit)
    expect(text).toContain('fix.head')
    expect(text).toContain('fix.instructions')
    expect(text).toContain('fix.event 42')
    expect(text).toContain('session session-1')
  })

  it('names a failure by its title, falling back to a short session id', () => {
    const { module } = loadBundle()
    const totals = { total: 1, turnFailures: 0, turnCuts: 0, toolFailures: 1, recovered: 0 }
    const titled = renderTree(
      module.FailureList?.({
        failures: [entry({ sessionTitle: 'Fix the parser' })],
        totals,
        t: translate,
        open: true,
      }),
    )
    expect(childText(titled)).toContain('Fix the parser')
    const untitled = renderTree(
      module.FailureList?.({
        failures: [entry({ sessionId: 'abcdef12-3456-7890', sessionTitle: undefined })],
        totals,
        t: translate,
        open: true,
      }),
    )
    const text = childText(untitled)
    expect(text).toContain('abcdef12')
    expect(text).not.toContain('abcdef12-3456-7890')
  })

  it('keeps the KPI control in sync with the native summary toggle and moves focus', () => {
    const { module } = loadBundle()
    const render = statefulPanel()
    const report = failureReport()
    const base = {
      range: 'session',
      report,
      error: null,
      t: translate,
      onRange: () => {},
      now: NOW,
      sessionId: 'session-1',
    }
    const kpiOf = (tree: unknown) =>
      elements(tree).find(
        (element) => element.type === 'button' && element.props['data-kpi'] === 'failures',
      )
    const detailsOf = (tree: unknown) => nodesOf(tree, 'details')[0]
    const toggle = (tree: unknown, open: boolean): void => {
      const handler = detailsOf(tree)?.props.onToggle as
        | ((event: { currentTarget: { open: boolean } }) => void)
        | undefined
      handler?.({ currentTarget: { open } })
    }

    let tree = render(base)
    expect(detailsOf(tree)?.props.open).toBe(false)
    expect(kpiOf(tree)?.props['aria-expanded']).toBe(false)

    toggle(tree, true)
    tree = render(base)
    expect(detailsOf(tree)?.props.open).toBe(true)
    expect(kpiOf(tree)?.props['aria-expanded']).toBe(true)

    toggle(tree, false)
    tree = render(base)
    expect(detailsOf(tree)?.props.open).toBe(false)
    expect(kpiOf(tree)?.props['aria-expanded']).toBe(false)

    const focused: string[] = []
    const focusCalls: string[] = []
    const globals = globalThis as { document?: unknown }
    const original = globals.document
    globals.document = {
      getElementById(id: string) {
        focused.push(id)
        return {
          focus: () => {
            focusCalls.push(id)
          },
        }
      },
    }
    try {
      const onClick = kpiOf(tree)?.props.onClick as (() => void) | undefined
      expect(onClick).toBeDefined()
      onClick?.()
      tree = render(base)
      expect(detailsOf(tree)?.props.open).toBe(true)
      expect(focused).toEqual(['dsh-obs-failures'])
      expect(focusCalls).toEqual(['dsh-obs-failures'])
      // The focus target is the section itself, focusable only with tabIndex -1.
      const section = nodesOf(
        tree,
        'section',
        (element) => element.props.id === module.FAILURE_SECTION_ID,
      )[0]
      expect(section?.props.tabIndex).toBe(-1)
    } finally {
      globals.document = original
    }
  })

  it('resolves the optional Workspace and forwards it with the view props', () => {
    const workspace = { openSession: () => {}, startSession: () => {} }
    const inspectCall = () => {}
    const openView = () => {}
    const resolved = registrationsWithReflect({
      get: (name) => (name === 'uiWorkspace' ? workspace : undefined),
    })[0]
    if (resolved === undefined) throw new Error('the view was not registered')
    const element = resolved.component({ sessionId: 's1', inspectCall, openView }) as {
      props: Record<string, unknown>
    }
    expect(element.props.workspace).toBe(workspace)
    expect(element.props.inspectCall).toBe(inspectCall)
    expect(element.props.openView).toBe(openView)

    const absent = registrationsWithReflect()[0]
    if (absent === undefined) throw new Error('the view was not registered')
    const withoutService = absent.component({}) as { props: Record<string, unknown> }
    expect(withoutService.props.workspace).toBeUndefined()

    const throwing = registrationsWithReflect({
      get: () => {
        throw new Error('service unavailable')
      },
    })[0]
    if (throwing === undefined) throw new Error('the view was not registered')
    const degraded = throwing.component({}) as { props: Record<string, unknown> }
    expect(degraded.props.workspace).toBeUndefined()
  })

  it('hides remote actions without Workspace while keeping local navigation and copy', () => {
    const { module } = loadBundle()
    const render = (report: Report, props: Record<string, unknown> = {}): unknown =>
      renderTree(
        module.ObservabilityPanel?.({
          range: 'session',
          report,
          error: null,
          t: translate,
          onRange: () => {},
          now: NOW,
          sessionId: 'session-1',
          ...props,
        }),
      )
    const buttons = (tree: unknown): string[] =>
      elements(tree)
        .filter((element) => element.type === 'button')
        .map(childText)

    // A remote entry with no Workspace service has no Open and no Fix.
    const localOnly = render(singleFailureReport('session-2'), { inspectCall: () => {} })
    expect(buttons(localOnly)).not.toContain('failure.open')
    expect(buttons(localOnly)).not.toContain('failure.fix')
    expect(buttons(localOnly)).toContain('failure.copy')
    // The same entry is actionable once the optional service resolves.
    const withWorkspace = render(singleFailureReport('session-2'), {
      inspectCall: () => {},
      workspace: { openSession: () => {}, startSession: () => {} },
    })
    expect(buttons(withWorkspace)).toContain('failure.open')
    expect(buttons(withWorkspace)).toContain('failure.fix')
  })

  it('keeps a recovered-only failing tool out of needs attention', () => {
    const { module } = loadBundle()
    const report = recoveredRowReport()
    const row = report.rows.find((candidate) => candidate.id === 'writes')
    expect(row?.status).toBe('error')
    expect(row?.unrecoveredErrors).toBe(0)
    const banner = renderTree(module.HealthBanner?.({ report, t: translate }))
    expect(childText(banner)).toContain('health.ok')
    const board = renderTree(module.PluginBoard?.({ report, t: translate, now: NOW }))
    const sections = nodesOf(board, 'section')
    const section = (key: string) =>
      sections.find((candidate) => childText(candidate).includes(key))
    expect(section('section.attention')).toBeUndefined()
    expect(childText(section('section.active'))).toContain('Writes')
    expect(childText(board)).toContain('1 card.errors')
  })

  it('draws a mixed failing share proportionally with its count and percentage', () => {
    const { module } = loadBundle()
    const rendered = renderTree(
      module.ToolsPanel?.({ outcomes: mixedToolReport().toolOutcomes, t: translate }),
    )
    const fail = nodesOf(rendered, 'span', (element) =>
      String(element.props.className ?? '').includes('dsh-obs-bars-fail'),
    )[0]
    expect(fail?.props.style).toEqual({ width: '9%' })
    expect(childText(rendered)).toContain('17 failure.of 179 · 9%')
  })

  it('counts distinct sessions in the silent-row denominators', () => {
    const { module } = loadBundle()
    const report = silentAcrossSessionsReport()
    expect(report.totals.sessions).toBe(2)
    const board = renderTree(module.PluginBoard?.({ report, t: translate, now: NOW }))
    const silent = nodesOf(board, 'li', (element) => element.props['data-status'] === 'silent')
    expect(silent).toHaveLength(1)
    expect(childText(silent[0])).toContain('0 failure.of 2 kpi.session')
  })

  it('names the latest failure tool, error name, and code on an error card', () => {
    const { module } = loadBundle()
    const report = errorCardReport()
    const board = renderTree(module.PluginBoard?.({ report, t: translate, now: NOW }))
    const card = nodesOf(board, 'article').find((element) => childText(element).includes('Writes'))
    expect(childText(card)).toContain('write · NewError · E_NEW')
    expect(childText(card)).not.toContain('E_OLD')
    expect(
      childText(
        nodesOf(
          card as Element,
          'span',
          (element) => String(element.props.className ?? '') === 'dsh-obs-pill',
        )[0],
      ),
    ).toBe('status.error')
  })

  it('keeps blind spots in a collapsed block', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.BlindSpots?.({ report: fixtureReport(), t: translate }))
    const details = nodesOf(rendered, 'details')[0]
    expect(details?.props.open).toBeUndefined()
    expect(childText(rendered)).toContain('blind.title')
  })

  it('shows loading, empty, and route-error states', () => {
    const { module } = loadBundle()
    const panel = (props: Record<string, unknown>): string =>
      childText(
        renderTree(
          module.ObservabilityPanel?.({
            range: 'session',
            t: translate,
            onRange: () => {},
            now: NOW,
            ...props,
          }),
        ),
      )
    expect(panel({ report: null, error: null })).toContain('state.loading')
    expect(
      panel({
        report: {
          range: 'session',
          from: 0,
          to: 0,
          bucketLabels: [],
          totals: { turns: 0, steps: 0, toolCalls: 0, errors: 0, records: 0, sessions: 0 },
          activity: [],
          errorSeries: [],
          rows: [],
          blindSpots: [],
        },
        error: null,
      }),
    ).toContain('state.empty')
    const failed = renderTree(
      module.ObservabilityPanel?.({
        range: 'session',
        report: null,
        error: 'boom',
        t: translate,
        onRange: () => {},
        now: NOW,
      }),
    )
    expect(childText(failed)).toContain('state.error boom')
    expect(nodesOf(failed, 'p').some((element) => element.props.role === 'alert')).toBe(true)
  })

  it('offers four ranges and selects the active one', () => {
    const { module } = loadBundle()
    let selected = ''
    const tree = renderTree(
      module.RangeSelector?.({
        range: 'week',
        t: translate,
        onRange: (value: string) => {
          selected = value
        },
      }),
    )
    const buttons = nodesOf(tree, 'button')
    expect(buttons.map((button) => button.props.children)).toEqual([
      'range.session',
      'range.day',
      'range.week',
      'range.month',
    ])
    expect(buttons[2]?.props['aria-pressed']).toBe(true)
    expect(buttons[0]?.props['aria-pressed']).toBe(false)
    const click = buttons[1]?.props.onClick as () => void
    click()
    expect(selected).toBe('day')
  })

  it('never renders message text or tool arguments and shows metadata on demand', () => {
    loadBundle()
    const render = statefulPanel()
    const report = fixtureReport()
    const props = {
      range: 'session',
      report,
      error: null,
      t: translate,
      onRange: () => {},
      now: NOW,
    }
    let rendered = render(props)
    ;(findButton(rendered, 'tab.plugins')?.props.onClick as (() => void) | undefined)?.()
    rendered = render(props)
    const visible = childText(rendered)
    expect(visible).not.toContain(SECRET)
    expect(JSON.stringify(rendered)).not.toContain(SECRET)
    expect(JSON.stringify(report)).not.toContain(SECRET)
    expect(JSON.stringify(report)).not.toContain('notes.md')
    const failures = report.rows.find((row) => row.id === 'tool-failures')
    const entry = failures?.details[0]
    if (entry === undefined) throw new Error('failure detail missing')
    expect(visible).toContain(new Date(entry.time).toLocaleString())
    expect(visible).toContain('tool-failures')
    expect(visible).toContain('turn 1')
    expect(visible).toContain('error')
  })

  it('refetches the report when the range changes', async () => {
    loadBundle()
    const urls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string) => {
      urls.push(input)
      return { ok: true, status: 200, json: async () => fixtureReport() }
    }) as unknown as typeof fetch
    const states: unknown[] = []
    let cursor = 0
    let effectCursor = 0
    let effects: Array<{ run: () => void; deps: readonly unknown[] | undefined; ran: boolean }> = []
    const react = {
      useState(initial: unknown) {
        const index = cursor
        cursor += 1
        if (!(index in states)) {
          states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
        }
        const set = (next: unknown): void => {
          states[index] =
            typeof next === 'function' ? (next as (value: unknown) => unknown)(states[index]) : next
        }
        return [states[index], set]
      },
      useEffect(run: () => void, deps?: readonly unknown[]) {
        const index = effectCursor
        effectCursor += 1
        const previous = effects[index]
        const changed =
          previous === undefined ||
          deps === undefined ||
          previous.deps === undefined ||
          deps.length !== previous.deps.length ||
          deps.some((value, at) => value !== previous.deps?.[at])
        if (changed) effects[index] = { run, deps, ran: false }
      },
    }
    const file = join(packageDir, 'lib', 'client.js')
    let registration: LoaderRegistration | undefined
    const window = {
      __ModuleLoader__: {
        load(value: LoaderRegistration): void {
          registration = value
        },
      },
    }
    new Function('window', readFileSync(file, 'utf8'))(window)
    if (registration === undefined) throw new Error('bundle missing')
    const hooked = registration.factory((id) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
      if (id === 'react') return react
      return {}
    })
    const flush = (): void => {
      for (const effect of effects) {
        if (!effect.ran) {
          effect.ran = true
          effect.run()
        }
      }
    }
    const render = (): unknown => {
      cursor = 0
      effectCursor = 0
      return renderTree(hooked.ObservabilityView?.({ t: translate, sessionId: 'session-1' }))
    }
    try {
      effects = []
      let tree = render()
      flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
      tree = render()
      const weekButton = findButton(tree, 'range.week')
      expect(weekButton).toBeDefined()
      ;(weekButton?.props.onClick as (() => void) | undefined)?.()
      tree = render()
      flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(urls).toEqual([
        '/plugins/dsh-setup-observability/report?range=session&session=session-1',
        '/plugins/dsh-setup-observability/report?range=week&session=session-1',
      ])
      expect(tree).not.toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  describe('chart foundation and sub-views', () => {
    const T0 = NOW - 12 * MINUTE
    const T1 = NOW - MINUTE
    const at = (minutes: number): number => T0 + minutes * MINUTE

    it('maps time and category geometry for 320 px and 1400 px containers', () => {
      const { module } = loadBundle()
      const narrow = module.timeScale?.(0, 100, 320)
      expect(narrow?.(0)).toBe(0)
      expect(narrow?.(50)).toBe(160)
      expect(narrow?.(100)).toBe(320)
      expect(narrow?.(120)).toBe(320)
      expect(narrow?.(-10)).toBe(0)
      const wide = module.timeScale?.(0, 100, 1400)
      expect(wide?.(25)).toBe(350)
      expect(wide?.(100)).toBe(1400)
      const flat = module.timeScale?.(T0, T0, 320)
      expect(flat?.(T0 - MINUTE)).toBe(0)
      expect(flat?.(T0)).toBe(0)
      expect(flat?.(T0 + MINUTE)).toBe(0)
      const wideBand = module.categoryBand?.(2, 1400, 24)
      expect(wideBand?.band).toBe(700)
      expect(wideBand?.bar).toBe(24)
      expect(wideBand?.offset).toBe((700 - 24) / 2)
      const narrowBand = module.categoryBand?.(24, 320, 24)
      expect(narrowBand?.band).toBeCloseTo(320 / 24)
      expect(narrowBand?.bar).toBeLessThanOrEqual(24)
      expect(narrowBand?.bar).toBeGreaterThan(0)
      expect(narrowBand?.offset).toBeGreaterThanOrEqual(0)
      expect(module.categoryBand?.(1, 1400, 24)?.bar).toBe(24)
      expect(module.categoryBand?.(0, 320, 24)).toEqual({ band: 0, bar: 0, offset: 0 })
    })

    it('keeps a deterministic fallback width without a ResizeObserver', () => {
      const { module } = loadBundle()
      expect(module.chartWidth?.(undefined, 640)).toBe(640)
      expect(module.chartWidth?.(0, 640)).toBe(640)
      expect(module.chartWidth?.(Number.NaN, 640)).toBe(640)
      expect(module.chartWidth?.(320, 640)).toBe(320)
      expect(module.chartWidth?.(1400, 640)).toBe(1400)
      const measured = module.useChartWidth?.()
      expect(measured?.width).toBe(640)
      expect(typeof measured?.ref).toBe('function')
      expect(module.useChartWidth?.(320)?.width).toBe(320)
      const fallback = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns: [], t: translate }),
      )
      const svg = nodesOf(fallback, 'svg')[0]
      expect(svg?.props.viewBox).toBe('0 0 640 96')
      expect(svg?.props.preserveAspectRatio).toBeUndefined()
      const narrow = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns: [], width: 320, t: translate }),
      )
      expect(nodesOf(narrow, 'svg')[0]?.props.viewBox).toBe('0 0 320 96')
      const wide = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns: [], width: 1400, t: translate }),
      )
      expect(nodesOf(wide, 'svg')[0]?.props.viewBox).toBe('0 0 1400 96')
    })

    it('measures a rendered chart with ResizeObserver and keeps the fallback without one', () => {
      // A hook-running React double: effects are collected and can be flushed.
      const file = join(packageDir, 'lib', 'client.js')
      let registration: LoaderRegistration | undefined
      const window = {
        __ModuleLoader__: {
          load(value: LoaderRegistration): void {
            registration = value
          },
        },
      }
      new Function('window', readFileSync(file, 'utf8'))(window)
      if (registration === undefined) throw new Error('the client bundle did not register a module')
      const states: unknown[] = []
      let cursor = 0
      const effects: Array<() => void | (() => void)> = []
      const react = {
        useState(initial: unknown) {
          const index = cursor
          cursor += 1
          if (!(index in states)) {
            states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
          }
          const set = (next: unknown): void => {
            states[index] =
              typeof next === 'function'
                ? (next as (value: unknown) => unknown)(states[index])
                : next
          }
          return [states[index], set]
        },
        useEffect(effect: () => void | (() => void)) {
          effects.push(effect)
        },
      }
      const module = registration.factory((id: string) => {
        if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
        if (id === 'react') return react
        return {}
      }) as LoadedModule
      const render = (): ReturnType<typeof renderTree> => {
        cursor = 0
        return renderTree(
          module.RangeSeries?.({
            labels: ['a', 'b'],
            counts: [1, 2],
            errors: [0, 0],
            t: translate,
          }),
        )
      }
      const observer = class FakeResizeObserver {
        static latest: FakeResizeObserver | undefined
        readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void
        node: unknown
        constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
          this.callback = callback
          FakeResizeObserver.latest = this
        }
        observe(node: unknown): void {
          this.node = node
        }
        disconnect(): void {}
        notify(width: number): void {
          this.callback([{ contentRect: { width } }])
        }
      }
      const globalWithObserver = globalThis as { ResizeObserver?: unknown }
      const original = globalWithObserver.ResizeObserver
      const attach = (tree: unknown): void => {
        const svg = nodesOf(tree, 'svg')[0]
        const ref = svg?.props.ref
        expect(ref).toEqual(expect.any(Function))
        if (typeof ref === 'function') ref({})
      }
      try {
        globalWithObserver.ResizeObserver = observer
        let tree = render()
        attach(tree)
        tree = render()
        for (const effect of effects) effect()
        expect(observer.latest).toBeDefined()
        observer.latest?.notify(320)
        tree = render()
        expect(nodesOf(tree, 'svg')[0]?.props.viewBox).toBe('0 0 320 140')
        observer.latest?.notify(1400)
        tree = render()
        expect(nodesOf(tree, 'svg')[0]?.props.viewBox).toBe('0 0 1400 140')

        // Without ResizeObserver, mounting and the effect stay on the fallback.
        delete globalWithObserver.ResizeObserver
        effects.length = 0
        states.length = 0
        cursor = 0
        tree = render()
        attach(tree)
        tree = render()
        for (const effect of effects) expect(() => effect()).not.toThrow()
        tree = render()
        expect(nodesOf(tree, 'svg')[0]?.props.viewBox).toBe('0 0 640 140')
      } finally {
        if (original === undefined) delete globalWithObserver.ResizeObserver
        else globalWithObserver.ResizeObserver = original
      }
    })

    it('counts an unfinished step and a pending call from the recorded counters', () => {
      const { module } = loadBundle()
      const tree = renderTree(
        module.SessionTimeline?.({
          from: T0,
          to: T1,
          turns: [
            {
              turn: 1,
              start: at(0),
              end: at(10),
              steps: [],
              tools: [],
              human: [],
              errors: [],
              stepsCount: 1,
              callsCount: 1,
            },
          ],
          t: translate,
        }),
      )
      const text = childText(tree)
      expect(text).toContain('1 timeline.step')
      expect(text).toContain('1 timeline.call')
      expect(text).not.toContain('timeline.empty')
    })

    it('draws a one-turn session with four labelled lanes and a turn row', () => {
      const { module } = loadBundle()
      const turns = [
        {
          turn: 1,
          start: at(0),
          end: at(10),
          steps: [{ from: at(1), to: at(2) }],
          tools: [
            { from: at(2), to: at(3) },
            { from: at(3), to: at(4) },
          ],
          human: [at(5)],
          errors: [at(7)],
        },
      ]
      const rendered = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns, t: translate }),
      )
      const svg = nodesOf(rendered, 'svg')[0]
      expect(svg?.props.role).toBe('img')
      expect(svg?.props['aria-label']).toBe('timeline.title')
      expect(svg?.props.preserveAspectRatio).toBeUndefined()
      const lanes = nodesOf(
        rendered,
        'text',
        (element) => String(element.props.className ?? '') === 'dsh-obs-tl-label',
      ).map(childText)
      expect(lanes).toEqual([
        'timeline.laneSteps',
        'timeline.laneTools',
        'timeline.laneHuman',
        'timeline.laneErrors',
      ])
      const bars = nodesOf(
        rendered,
        'rect',
        (element) => String(element.props.className ?? '') === 'dsh-obs-tl-bar',
      )
      expect(bars.map((bar) => bar.props['data-tone'])).toEqual(['steps', 'tools', 'tools'])
      expect(bars.every((bar) => Number(bar.props.width) >= 1)).toBe(true)
      const ticks = nodesOf(
        rendered,
        'line',
        (element) => String(element.props.className ?? '') === 'dsh-obs-tl-tick',
      )
      expect(ticks.map((tick) => tick.props['data-tone'])).toEqual(['human', 'errors'])
      const titles = nodesOf(rendered, 'title').map(childText)
      expect(titles).toHaveLength(5)
      expect(titles.join(' ')).toContain('timeline.step')
      expect(titles.join(' ')).toContain('timeline.call')
      expect(titles.join(' ')).toContain('timeline.humanMessage')
      expect(titles.join(' ')).toContain('timeline.error')
      expect(titles.join(' ')).not.toContain(SECRET)
      const rows = nodesOf(rendered, 'li')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.props['data-turn']).toBe(1)
      const rowText = childText(rows[0])
      expect(rowText).toContain('timeline.turn 1')
      expect(rowText).toContain('10timeline.minute')
      expect(rowText).toContain('1 timeline.step')
      expect(rowText).toContain('2 timeline.calls')
      expect(rowText).toContain('1 timeline.error')
      expect(childText(rendered)).not.toContain('timeline.empty')
      const axis = nodesOf(
        rendered,
        'text',
        (element) => String(element.props.className ?? '') === 'dsh-obs-axis',
      )
      expect(axis).toHaveLength(3)
    })

    it('draws every turn of a multi-turn session in order', () => {
      const { module } = loadBundle()
      const turns = [
        {
          turn: 1,
          start: at(0),
          end: at(4),
          steps: [
            { from: at(1), to: at(2) },
            { from: at(2), to: at(3) },
          ],
          tools: [{ from: at(3), to: at(4) }],
          human: [at(0)],
          errors: [],
        },
        {
          turn: 2,
          start: at(5),
          end: at(9),
          steps: [{ from: at(6), to: at(7) }],
          tools: [{ from: at(8), to: at(9) }],
          human: [],
          errors: [at(7), at(8)],
        },
      ]
      const rendered = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns, t: translate }),
      )
      const rows = nodesOf(rendered, 'li')
      expect(rows.map((row) => row.props['data-turn'])).toEqual([1, 2])
      const bars = nodesOf(
        rendered,
        'rect',
        (element) => String(element.props.className ?? '') === 'dsh-obs-tl-bar',
      )
      expect(bars).toHaveLength(5)
      const errors = nodesOf(rows[1], 'span', (element) => element.props['data-tone'] === 'error')
      expect(errors).toHaveLength(1)
      expect(nodesOf(rendered, 'title')).toHaveLength(8)
    })

    it('gives human markers and error ticks time-only tooltips', () => {
      const { module } = loadBundle()
      const turns = [
        {
          turn: 1,
          start: at(0),
          end: at(9),
          steps: [],
          tools: [],
          human: [at(2), at(4)],
          errors: [at(6)],
          text: SECRET,
        },
      ]
      const rendered = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns, t: translate }),
      )
      const ticks = nodesOf(
        rendered,
        'line',
        (element) => String(element.props.className ?? '') === 'dsh-obs-tl-tick',
      )
      expect(ticks.map((tick) => tick.props['data-tone'])).toEqual(['human', 'human', 'errors'])
      const titles = nodesOf(rendered, 'title').map(childText)
      expect(titles).toHaveLength(3)
      expect(titles[0]).toContain('timeline.humanMessage')
      expect(titles[2]).toContain('timeline.error')
      expect(titles.join(' ')).not.toContain(SECRET)
    })

    it('states no activity when a session turn has no spans', () => {
      const { module } = loadBundle()
      const turns = [
        { turn: 1, start: at(0), end: at(4), steps: [], tools: [], human: [], errors: [] },
      ]
      const rendered = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns, t: translate }),
      )
      expect(childText(rendered)).toContain('timeline.empty')
      expect(
        nodesOf(
          rendered,
          'rect',
          (element) => String(element.props.className ?? '') === 'dsh-obs-tl-bar',
        ),
      ).toHaveLength(0)
      expect(nodesOf(rendered, 'line')).toHaveLength(0)
      const row = nodesOf(rendered, 'li')[0]
      expect(childText(row)).toContain('0 timeline.steps')
      expect(childText(row)).toContain('0 timeline.calls')
      expect(childText(row)).toContain('0 timeline.errors')
    })

    it('never renders message text or tool arguments from a turn', () => {
      const { module } = loadBundle()
      const turns = [
        {
          turn: 1,
          start: at(0),
          end: at(5),
          steps: [{ from: at(1), to: at(2), text: SECRET }],
          tools: [{ from: at(2), to: at(3), arguments: SECRET }],
          human: [at(3)],
          errors: [],
          message: SECRET,
        },
      ]
      const rendered = renderTree(
        module.SessionTimeline?.({ from: T0, to: T1, turns, t: translate }),
      )
      expect(childText(rendered)).not.toContain(SECRET)
      expect(JSON.stringify(rendered)).not.toContain(SECRET)
    })

    it('draws 24 hourly, 7 daily, and 30 daily buckets with three to five labels', () => {
      const { module } = loadBundle()
      for (const buckets of [24, 7, 30]) {
        const labels = Array.from({ length: buckets }, (_unused, index) => `b${String(index)}`)
        const counts = labels.map((_label, index) => (index === 1 ? 5 : 0))
        const errors = labels.map(() => 0)
        const rendered = renderTree(module.RangeSeries?.({ labels, counts, errors, t: translate }))
        const bars = nodesOf(
          rendered,
          'rect',
          (element) => String(element.props.className ?? '') === 'dsh-obs-bar',
        )
        expect(bars).toHaveLength(1)
        expect(Number(bars[0]?.props.width)).toBeGreaterThan(0)
        expect(Number(bars[0]?.props.width)).toBeLessThanOrEqual(24)
        const axis = nodesOf(
          rendered,
          'text',
          (element) => String(element.props.className ?? '') === 'dsh-obs-axis',
        )
        expect(axis.length).toBeGreaterThanOrEqual(3)
        expect(axis.length).toBeLessThanOrEqual(5)
        expect(nodesOf(rendered, 'title')).toHaveLength(buckets)
      }
    })

    it('stacks the error share on top of a single non-zero bucket', () => {
      const { module } = loadBundle()
      const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      const counts = [0, 0, 0, 4, 0, 0, 0]
      const errors = [0, 0, 0, 1, 0, 0, 0]
      const rendered = renderTree(module.RangeSeries?.({ labels, counts, errors, t: translate }))
      const bars = nodesOf(
        rendered,
        'rect',
        (element) => String(element.props.className ?? '') === 'dsh-obs-bar',
      )
      expect(bars).toHaveLength(2)
      const events = bars.find((bar) => bar.props['data-tone'] === 'events')
      const failures = bars.find((bar) => bar.props['data-tone'] === 'errors')
      expect(events).toBeDefined()
      expect(failures).toBeDefined()
      expect(Number(failures?.props.y)).toBeLessThan(Number(events?.props.y))
      expect(Number(failures?.props.width)).toBeLessThanOrEqual(24)
      expect(
        nodesOf(rendered, 'title')
          .map(childText)
          .some((text) => text.includes('4 chart.events') && text.includes('1 chart.errors')),
      ).toBe(true)
    })

    it('states that a zero range has no activity', () => {
      const { module } = loadBundle()
      const labels = ['Mon', 'Tue', 'Wed']
      const rendered = renderTree(
        module.RangeSeries?.({ labels, counts: [0, 0, 0], errors: [0, 0, 0], t: translate }),
      )
      expect(childText(rendered)).toContain('series.empty')
      expect(nodesOf(rendered, 'rect')).toHaveLength(0)
      expect(nodesOf(rendered, 'svg')[0]?.props['aria-label']).toBe('series.title')
    })

    it('labels the series and token charts for assistive technology', () => {
      const { module } = loadBundle()
      const series = renderTree(
        module.RangeSeries?.({ labels: ['Mon'], counts: [1], errors: [0], t: translate }),
      )
      const svg = nodesOf(series, 'svg')[0]
      expect(svg?.props.role).toBe('img')
      expect(svg?.props['aria-label']).toBe('series.title')
      expect(svg?.props.preserveAspectRatio).toBeUndefined()
      expect(svg?.props.viewBox).toBe('0 0 640 140')
      expect(childText(series)).toContain('legend.events')
      expect(childText(series)).toContain('legend.errors')
      const mix = renderTree(module.TokenMix?.({ cacheRead: 2, input: 1, output: 1, t: translate }))
      const bar = nodesOf(mix, 'svg')[0]
      expect(bar?.props.role).toBe('img')
      expect(bar?.props['aria-label']).toContain('tokens.title')
      expect(bar?.props['aria-label']).toContain('50%')
      expect(bar?.props.preserveAspectRatio).toBeUndefined()
    })

    it('stacks cache read, input, and output tokens with a caption of each share', () => {
      const { module } = loadBundle()
      const rendered = renderTree(
        module.TokenMix?.({ cacheRead: 700, input: 200, output: 100, t: translate }),
      )
      const segments = nodesOf(rendered, 'rect')
      expect(segments.map((segment) => segment.props['data-tone'])).toEqual([
        'cacheRead',
        'input',
        'output',
      ])
      expect(segments.map((segment) => segment.props.width)).toEqual(['70%', '20%', '10%'])
      expect(segments.map((segment) => segment.props.x)).toEqual(['0%', '70%', '90%'])
      const text = childText(rendered)
      expect(text).toContain('tokens.cacheRead 70%')
      expect(text).toContain('tokens.input 20%')
      expect(text).toContain('tokens.output 10%')
      expect(text).not.toContain('tokens.empty')
    })

    it('renders a zero token mix with zero shares and no segments', () => {
      const { module } = loadBundle()
      const rendered = renderTree(
        module.TokenMix?.({ cacheRead: 0, input: 0, output: 0, t: translate }),
      )
      expect(nodesOf(rendered, 'rect')).toHaveLength(0)
      const text = childText(rendered)
      expect(text).toContain('tokens.empty')
      expect(text.match(/0%/g) ?? []).toHaveLength(3)
    })
  })
})

/** One assistant message that recorded usage; the text is a fixture secret. */
function usageEvent(time: number, input: number, output: number, cacheRead = 0): SessionEvent {
  return event(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      usage: {
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
        totalTokens: input + output + cacheRead,
      },
      content: [{ type: 'text', text: SECRET }],
      text: SECRET,
    },
    time,
  )
}

/** A parent, a child, usage, a checkpoint, a goal, and secret-like text everywhere. */
function richRecords(): {
  records: ReturnType<typeof extractRecords>
  sessions: Array<{
    id: string
    parentSession?: string
    origin?: string
    delegationDepth?: number
  }>
} {
  const from = NOW - 30 * MINUTE
  const parent = extractRecords('session-1', [
    event(
      'user/message',
      {
        role: 'user',
        id: 'm0',
        content: [{ type: 'text', text: SECRET }],
        source: { kind: 'user' },
      },
      from,
    ),
    event(
      'goal/change',
      {
        operation: 'create',
        goal: { id: 'g1', phase: 'active' },
        roundsStarted: 1,
        objective: SECRET,
      },
      from + MINUTE,
    ),
    event('turn/start', { turn: 1 }, from + 2 * MINUTE),
    event('step/start', { turn: 1, step: 1 }, from + 3 * MINUTE),
    usageEvent(from + 4 * MINUTE, 100, 20, 300),
    event(
      'tool/call',
      {
        turn: 1,
        step: 1,
        callId: 'd1',
        name: 'delegate',
        arguments: JSON.stringify({ prompt: SECRET }),
      },
      from + 5 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm1',
          content: [],
          source: { kind: 'tool', callId: 'd1' },
          toolCallId: 'd1',
        },
      },
      from + 6 * MINUTE,
    ),
    event(
      'tool/call',
      {
        turn: 1,
        step: 1,
        callId: 'c1',
        name: 'work_checkpoint',
        arguments: JSON.stringify({
          outcome: 'done',
          verified: [SECRET],
          remaining: [],
          next: SECRET,
        }),
      },
      from + 7 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm2',
          content: [],
          source: { kind: 'tool', callId: 'c1' },
          toolCallId: 'c1',
        },
      },
      from + 8 * MINUTE,
    ),
    event(
      'tool/call',
      {
        turn: 1,
        step: 1,
        callId: 'c2',
        name: 'edit',
        arguments: JSON.stringify({ path: `${SECRET}.md` }),
      },
      from + 9 * MINUTE,
    ),
    event(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'm3',
          content: [],
          source: { kind: 'tool', callId: 'c2' },
          toolCallId: 'c2',
        },
      },
      from + 10 * MINUTE,
    ),
    event(
      'goal/change',
      {
        operation: 'complete',
        goal: { id: 'g1', phase: 'completed' },
        roundsStarted: 2,
        objective: SECRET,
      },
      from + 11 * MINUTE,
    ),
    event('step/end', { turn: 1, step: 1 }, from + 12 * MINUTE),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, from + 13 * MINUTE),
  ])
  const child = extractRecords('child-1', [
    event(
      'user/message',
      {
        role: 'user',
        id: 'c0',
        content: [{ type: 'text', text: SECRET }],
        source: { kind: 'user' },
      },
      from + 4 * MINUTE,
    ),
    usageEvent(from + 5 * MINUTE, 10, 5, 20),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, from + 9 * MINUTE),
  ])
  return {
    records: [...parent, ...child],
    sessions: [
      { id: 'session-1' },
      { id: 'child-1', parentSession: 'session-1', origin: 'delegate', delegationDepth: 1 },
    ],
  }
}

/** A report whose input carried secret-like text the report must not keep. */
function richReport(range: 'session' | 'week' = 'session'): Report {
  const { records, sessions } = richRecords()
  return buildReport({
    range,
    now: NOW,
    records,
    configured: parseRows({
      rows: [
        {
          id: 'goal-continuity',
          label: 'Goal continuity',
          kind: 'signal',
          goal: 'Keep one goal across human messages',
          eligible: [{ tool: 'edit' }],
          match: [{ tool: 'work_checkpoint' }],
        },
        {
          id: 'never',
          label: 'Never fired',
          kind: 'signal',
          trigger: 'a progress note is recorded',
          match: [{ tool: 'task_progress' }],
        },
      ],
    }),
    registry: new Set(['work_checkpoint', 'edit', 'delegate', 'task_progress']),
    sessions,
    config: {
      idleGapMinutes: 30,
      minEpisodes: 10,
      hypotheses: [
        {
          metric: 'checkpoint-coverage',
          direction: 'increase',
          threshold: 0.1,
          window: 'session',
          minSamples: 1,
          guardrail: 'failure-rate',
        },
      ],
    },
    baseline: {
      kind: 'previous completed session',
      records: [],
      from: NOW - 120 * MINUTE,
      to: NOW - 60 * MINUTE,
      sessions: [],
    },
  })
}

function episodeFixture(overrides: Partial<EpisodeReport> = {}): EpisodeReport {
  const start = NOW - 60 * MINUTE
  return {
    id: 'session-1#1',
    sessionId: 'session-1',
    start,
    end: start + 10 * MINUTE,
    durationMs: 10 * MINUTE,
    steps: 4,
    toolCalls: 5,
    turns: 1,
    commands: 0,
    humanMessages: 1,
    machineMessages: 0,
    outcome: 'completed',
    verified: true,
    failures: 0,
    substantive: true,
    activeMs: 8 * MINUTE,
    activeMsFull: 8 * MINUTE,
    usage: { input: 600, output: 200, cacheRead: 1000, cacheWrite: 0, total: 1800 },
    fullUsage: { input: 600, output: 200, cacheRead: 1000, cacheWrite: 0, total: 1800 },
    costBasis: 'through cutoff',
    goals: { created: 1, paused: 0, resumed: 0, completed: 1, rounds: 1, phase: 'completed' },
    checkpoints: { total: 1, closes: 1, verified: 1 },
    delegateCalls: 1,
    parallelWidth: 1,
    parentWaitMs: 2 * MINUTE,
    children: [],
    firedRows: [],
    timeline: {
      from: start,
      to: start + 10 * MINUTE,
      steps: [],
      tools: [],
      human: [],
      errors: [],
      stepsCount: 0,
      callsCount: 0,
    },
    ...overrides,
  }
}

/** A session report whose episode list the Tasks tests control. */
function tasksReport(episodes: readonly EpisodeReport[], timeline?: Report['timeline']): Report {
  const base = fixtureReport()
  const reportTimeline = timeline === undefined ? base.timeline : timeline
  return {
    ...base,
    episodes,
    episodeCount: episodes.length,
    ...(reportTimeline === undefined ? {} : { timeline: reportTimeline }),
  }
}

function cohortMetrics(overrides: Partial<Scorecard['treated']> = {}): Scorecard['treated'] {
  return {
    n: 6,
    verifiedShare: 0.5,
    tokens: { p50: 1000, p90: 2000, n: 6 },
    activeMinutes: { p50: 10, p90: 20, n: 6 },
    stepsPerHumanMessage: { p50: 3, p90: 5, n: 6 },
    ...overrides,
  }
}

function scorecardFixture(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    rowId: 'goal-continuity',
    label: 'Goal continuity',
    goal: 'Keep one goal across human messages',
    eligibilityDeclared: true,
    eligible: 12,
    fired: 6,
    firedOutside: 0,
    activation: 0.5,
    errorRate: 0,
    treated: cohortMetrics({ n: 6, verifiedShare: 0.8 }),
    control: cohortMetrics({ n: 6, verifiedShare: 0.5 }),
    deltas: {
      verifiedShare: 0.3,
      tokensP50: 120,
      activeMinutesP50: -2,
      stepsPerHumanMessageP50: 1,
    },
    matched: true,
    weekRelaxed: false,
    insufficient: false,
    association: 'association, not proof',
    ...overrides,
  }
}

function hypothesisFixture(overrides: Partial<HypothesisResult> = {}): HypothesisResult {
  return {
    index: 0,
    metric: 'checkpoint-coverage',
    direction: 'increase',
    threshold: 0.1,
    window: 'week',
    minSamples: 20,
    samples: 40,
    baseline: 0.5,
    current: 0.8,
    status: 'supported',
    label: 'supported in the observed window',
    observed: 'association, not proof',
    ...overrides,
  }
}

function panelProps(report: Report, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    range: 'session',
    report,
    error: null,
    t: translate,
    onRange: () => {},
    now: NOW,
    sessionId: 'session-1',
    ...extra,
  }
}

function pillText(element: Element | undefined): string {
  return childText(
    nodesOf(
      element,
      'span',
      (candidate) => String(candidate.props.className ?? '') === 'dsh-obs-pill',
    )[0],
  )
}

describe('sub-views, outcome tiles, tasks, and hypotheses', () => {
  it('opens on Overview and switches among four sub-views without leaving the range selector', () => {
    loadBundle()
    const render = statefulPanel()
    const base = panelProps(fixtureReport())
    const tabs = (tree: unknown): Element[] =>
      nodesOf(tree, 'button', (element) => element.props.role === 'tab')
    const selected = (tree: unknown): string[] =>
      tabs(tree)
        .filter((tab) => tab.props['aria-selected'] === true)
        .map(childText)
    let tree = render(base)
    expect(tabs(tree).map(childText)).toEqual([
      'tab.overview',
      'tab.plugins',
      'tab.tasks',
      'tab.hypotheses',
    ])
    expect(tabs(tree).map((tab) => tab.props['aria-selected'])).toEqual([true, false, false, false])
    expect(tabs(tree)[0]?.props.tabIndex).toBe(0)
    expect(tabs(tree)[1]?.props.tabIndex).toBe(-1)
    const tabpanel = nodesOf(tree, 'div', (element) => element.props.role === 'tabpanel')[0]
    expect(tabpanel?.props.id).toBe('dsh-obs-panel-overview')
    expect(tabpanel?.props['aria-labelledby']).toBe('dsh-obs-tab-overview')
    expect(childText(tree)).toContain('verdict.insufficient')
    expect(
      nodesOf(tree, 'fieldset', (element) => element.props['aria-label'] === 'range.label'),
    ).toHaveLength(1)

    ;(findButton(tree, 'tab.plugins')?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.plugins'])
    expect(nodesOf(tree, 'div', (element) => element.props.role === 'tabpanel')[0]?.props.id).toBe(
      'dsh-obs-panel-plugins',
    )
    expect(childText(tree)).toContain('section.attention')

    ;(findButton(tree, 'tab.tasks')?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.tasks'])
    expect(childText(tree)).toContain('tasks.title')

    ;(findButton(tree, 'tab.hypotheses')?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.hypotheses'])
    expect(childText(tree)).toContain('hypothesis.title')

    ;(findButton(tree, 'tab.overview')?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.overview'])
  })

  it('opens the matching plugin row from a scorecard link', () => {
    loadBundle()
    const render = statefulPanel()
    const base = panelProps(richReport())
    let tree = render(base)
    const link = elements(tree).find(
      (element) => element.type === 'button' && childText(element) === 'scorecard.rowDetail',
    )
    expect(link).toBeDefined()
    ;(link?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    expect(
      nodesOf(
        tree,
        'button',
        (element) => element.props.role === 'tab' && element.props['aria-selected'] === true,
      ).map(childText),
    ).toEqual(['tab.plugins'])
    const focused = nodesOf(tree, 'article', (element) => element.props['data-focus'] === 'true')
    expect(focused).toHaveLength(1)
    expect(childText(focused[0])).toContain('Goal continuity')
  })

  it('moves between the sub-views with the keyboard', () => {
    loadBundle()
    const render = statefulPanel()
    const base = panelProps(fixtureReport())
    let tree = render(base)
    const selected = (current: unknown): string[] =>
      nodesOf(
        current,
        'button',
        (element) => element.props.role === 'tab' && element.props['aria-selected'] === true,
      ).map(childText)
    const press = (key: string): void => {
      const tab = nodesOf(
        tree,
        'button',
        (element) => element.props.role === 'tab' && element.props['aria-selected'] === true,
      )[0]
      const handler = tab?.props.onKeyDown as
        | ((event: { key: string; preventDefault: () => void }) => void)
        | undefined
      handler?.({ key, preventDefault: () => {} })
    }
    press('ArrowRight')
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.plugins'])
    press('End')
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.hypotheses'])
    press('Home')
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.overview'])
    press('ArrowLeft')
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.hypotheses'])
    press('ArrowRight')
    tree = render(base)
    expect(selected(tree)).toEqual(['tab.overview'])
  })

  it('moves keyboard focus to the selected tab', () => {
    const { module } = loadBundle()
    const focused: string[] = []
    const globalDoc = globalThis as { document?: unknown }
    const original = globalDoc.document
    globalDoc.document = {
      getElementById: (id: string) => ({ focus: () => focused.push(id) }),
    }
    try {
      const views: string[] = []
      const tree = renderTree(
        module.SubViewTabs?.({
          view: 'overview',
          t: translate,
          onView: (view: string) => views.push(view),
        }),
      )
      const selected = nodesOf(
        tree,
        'button',
        (element) => element.props.role === 'tab' && element.props['aria-selected'] === true,
      )[0]
      const press = (key: string): void => {
        const handler = selected?.props.onKeyDown as
          | ((event: { key: string; preventDefault: () => void }) => void)
          | undefined
        handler?.({ key, preventDefault: () => {} })
      }
      press('ArrowRight')
      expect(views).toContain('plugins')
      expect(focused).toContain('dsh-obs-tab-plugins')
      press('End')
      expect(focused).toContain('dsh-obs-tab-hypotheses')
      press('Home')
      expect(focused).toContain('dsh-obs-tab-overview')
    } finally {
      if (original === undefined) delete globalDoc.document
      else globalDoc.document = original
    }
  })

  it('never calls thin data sufficient and states the sample and coverage', () => {
    const { module } = loadBundle()
    const thin = renderTree(module.DataSufficiency?.({ report: fixtureReport(), t: translate }))
    const section = nodesOf(
      thin,
      'section',
      (element) => element.props['data-sufficiency'] !== undefined,
    )[0]
    expect(section?.props['data-sufficiency']).toBe('insufficient')
    const text = childText(thin)
    expect(text).toContain('verdict.insufficient')
    expect(text).toContain('verdict.episodes')
    expect(text).toContain('verdict.of')
    expect(text).not.toContain('verdict.sufficient')
    expect(text).not.toContain('health.ok')
    expect(module.sufficiency?.(fixtureReport())).toBe('insufficient')
    expect(module.sufficiency?.(richReport())).toBe('insufficient')
    const rich = richReport()
    const covered = {
      ...rich,
      quality: { ...rich.quality, episodes: 12 },
      dataQuality: {
        ...rich.dataQuality,
        steps: 1,
        stepsWithUsage: 1,
        messages: 1,
        messagesWithUsage: 1,
        unlinkedChildren: 0,
        unmappedClosers: 0,
      },
    }
    expect(module.sufficiency?.(covered)).toBe('sufficient')
  })

  it('renders four outcome tiles with n, p50/p90, and the cost cutoff', () => {
    const { module } = loadBundle()
    const report = richReport()
    const rendered = renderTree(module.OutcomeTiles?.({ report, t: translate }))
    const tiles = nodesOf(
      rendered,
      'article',
      (element) => element.props['data-tile'] !== undefined,
    )
    expect(tiles.map((tile) => tile.props['data-tile'])).toEqual([
      'quality',
      'cost',
      'speed',
      'autonomy',
    ])
    const text = tiles.map(childText).join('\n')
    expect(text).toContain('tile.quality')
    expect(text).toContain('tile.cost')
    expect(text).toContain('tile.speed')
    expect(text).toContain('tile.autonomy')
    expect(text).toContain('tile.n')
    expect(text).toContain('tile.p50')
    expect(text).toContain('tile.p90')
    expect(text).toContain('100%')
    const cost = tiles.find((tile) => tile.props['data-tile'] === 'cost')
    expect(childText(cost)).toContain('tile.cutoff')
    expect(childText(cost)).toContain('cutoff.full')
    expect(childText(cost)).toContain('455')

    const week = fixtureReport('week')
    const weekTiles = renderTree(module.OutcomeTiles?.({ report: week, t: translate }))
    const weekCost = nodesOf(
      weekTiles,
      'article',
      (element) => element.props['data-tile'] === 'cost',
    )[0]
    expect(childText(weekCost)).toContain('cutoff.through')
  })

  it('renders the Overview with token mix, activity, scorecards, silent rows, and data quality', () => {
    const { module } = loadBundle()
    const report = richReport()
    const rendered = renderTree(
      module.OverviewView?.({
        report,
        t: translate,
        failuresOpen: false,
        onToggleFailures: () => {},
        onRevealFailures: () => {},
        onClearFilter: () => {},
      }),
    )
    const text = childText(rendered)
    expect(text).toContain('tokens.title')
    expect(text).toContain('timeline.title')
    expect(text).toContain('scorecards.title')
    expect(text).toContain('scorecard.activation')
    expect(text).toContain('dq.title')
    expect(text).toContain('section.silent')
    expect(text).toContain('Never fired')
    expect(text).toContain('a progress note is recorded')
    expect(text).toContain('status.silent')
    expect(
      nodesOf(rendered, 'svg', (element) => element.props['aria-label'] === 'timeline.title'),
    ).toHaveLength(1)
    expect(
      nodesOf(rendered, 'ul', (element) => element.props.className === 'dsh-obs-dq').length,
    ).toBeGreaterThan(0)
  })

  it('states partial usage and never reports it as complete', () => {
    const { module } = loadBundle()
    const report = windowReport({
      events: [
        event(
          'user/message',
          { role: 'user', id: 'm0', content: [], source: { kind: 'user' } },
          NOW - 10 * MINUTE,
        ),
        event('step/start', { turn: 1, step: 1 }, NOW - 9 * MINUTE),
        usageEvent(NOW - 8 * MINUTE, 10, 2),
        event('assistant/message', { content: [] }, NOW - 7 * MINUTE),
        event('step/end', { turn: 1, step: 1 }, NOW - 6 * MINUTE),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 5 * MINUTE),
      ],
    })
    expect(report.dataQuality.messages).toBe(2)
    expect(report.dataQuality.messagesWithUsage).toBe(1)
    expect(report.dataQuality.usageCoverage).toBe(0.5)
    const strip = renderTree(module.DataQualityStrip?.({ report, t: translate }))
    const text = childText(strip)
    expect(text).toContain('dq.partial')
    expect(text).toContain('1/2')
    expect(text).toContain('dq.unlinked')
    expect(module.sufficiency?.(report)).toBe('insufficient')
  })

  it('keeps failure access on the Overview', () => {
    const { module } = loadBundle()
    const report = failureReport()
    const rendered = renderTree(
      module.OverviewView?.({
        report,
        t: translate,
        failuresOpen: false,
        onToggleFailures: () => {},
        onRevealFailures: () => {},
        onClearFilter: () => {},
      }),
    )
    const control = elements(rendered).find(
      (element) => element.type === 'button' && element.props['data-kpi'] === 'failures',
    )
    expect(control).toBeDefined()
    expect(childText(control)).toContain('22')
    expect(
      nodesOf(rendered, 'section', (element) => element.props.id === 'dsh-obs-failures'),
    ).toHaveLength(1)
    expect(childText(rendered)).toContain('failure.title')
    expect(childText(rendered)).toContain('verdict.insufficient')
  })

  it('draws the session timeline for the session range and a time series for a wider range', () => {
    const { module } = loadBundle()
    const session = fixtureReport()
    const sessionView = renderTree(module.ActivityPanel?.({ report: session, t: translate }))
    const timeline = nodesOf(
      sessionView,
      'svg',
      (element) => element.props['aria-label'] === 'timeline.title',
    )
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.props.role).toBe('img')
    expect(timeline[0]?.props.preserveAspectRatio).toBeUndefined()
    const lanes = nodesOf(
      sessionView,
      'text',
      (element) => String(element.props.className ?? '') === 'dsh-obs-tl-label',
    ).map(childText)
    expect(lanes).toEqual([
      'timeline.laneSteps',
      'timeline.laneTools',
      'timeline.laneHuman',
      'timeline.laneErrors',
    ])
    expect(
      nodesOf(
        sessionView,
        'text',
        (element) => String(element.props.className ?? '') === 'dsh-obs-axis',
      ).length,
    ).toBeGreaterThan(0)

    const week = fixtureReport('week')
    const weekView = renderTree(module.ActivityPanel?.({ report: week, t: translate }))
    const series = nodesOf(
      weekView,
      'svg',
      (element) => element.props['aria-label'] === 'series.title',
    )[0]
    expect(series).toBeDefined()
    expect(nodesOf(series, 'title')).toHaveLength(week.bucketLabels.length)
    expect(childText(weekView)).toContain('legend.events')
    expect(childText(weekView)).toContain('legend.errors')
  })

  it('renders a declared-eligibility scorecard with goal, activation, comparison, and row link', () => {
    const { module } = loadBundle()
    const opened: string[] = []
    const rendered = renderTree(
      module.ScorecardCard?.({
        card: scorecardFixture(),
        t: translate,
        onOpenRow: (rowId: string) => opened.push(rowId),
      }),
    )
    const text = childText(rendered)
    expect(text).toContain('Goal continuity')
    expect(text).toContain('Keep one goal across human messages')
    expect(text).toContain('scorecard.activation 50%')
    expect(text).toContain('6 scorecard.of 12 scorecard.eligible')
    expect(text).toContain('scorecard.primary')
    expect(text).toContain('80% scorecard.of 50%')
    expect(text).toContain('+30 scorecard.points')
    expect(text).toContain('scorecard.n 6 scorecard.treated · 6 scorecard.control')
    expect(text).toContain('association, not proof')
    expect(text).not.toContain('scorecard.noEligibility')
    expect(text).not.toContain('scorecard.insufficientNote')
    expect(pillText(nodesOf(rendered, 'article')[0])).toBe('scorecard.active')
    const spark = nodesOf(
      rendered,
      'svg',
      (element) => String(element.props.className ?? '') === 'dsh-obs-spark',
    )[0]
    expect(nodesOf(spark, 'title')).toHaveLength(2)
    expect(nodesOf(spark, 'title').map(childText).join(' ')).toContain('bar.treated')
    const link = elements(rendered).find(
      (element) => element.type === 'button' && childText(element) === 'scorecard.rowDetail',
    )
    ;(link?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual(['goal-continuity'])
  })

  it('formats a negative delta once and words an unavailable comparison', () => {
    const { module } = loadBundle()
    const negative = renderTree(
      module.ScorecardCard?.({
        card: scorecardFixture({
          treated: cohortMetrics({ n: 6, verifiedShare: 0.5 }),
          control: cohortMetrics({ n: 6, verifiedShare: 0.8 }),
        }),
        t: translate,
      }),
    )
    expect(childText(negative)).toContain('scorecard.delta −30 scorecard.points')
    const absent = renderTree(
      module.ScorecardCard?.({
        card: scorecardFixture({
          treated: cohortMetrics({ n: 0, verifiedShare: undefined }),
          control: cohortMetrics({ n: 0, verifiedShare: undefined }),
        }),
        t: translate,
      }),
    )
    expect(childText(absent)).toContain('scorecard.unavailable')
    expect(childText(absent)).toContain('scorecard.primaryNone')
    // The matching rule and the relaxed-week fallback are disclosed.
    const relaxed = renderTree(
      module.ScorecardCard?.({
        card: scorecardFixture({ weekRelaxed: true }),
        t: translate,
      }),
    )
    expect(childText(relaxed)).toContain('scorecard.matching')
    expect(childText(relaxed)).toContain('scorecard.relaxed')
  })

  it('words undeclared eligibility, silence, insufficiency, error, and firing outside eligibility', () => {
    const { module } = loadBundle()
    const card = (overrides: Partial<Scorecard>): unknown =>
      renderTree(module.ScorecardCard?.({ card: scorecardFixture(overrides), t: translate }))
    const undeclared = card({ eligibilityDeclared: false })
    expect(childText(undeclared)).toContain('scorecard.noEligibility')
    const silent = card({ fired: 0, activation: 0, errorRate: undefined })
    expect(childText(silent)).toContain('scorecard.silent')
    expect(childText(silent)).toContain('scorecard.activation 0%')
    const insufficient = card({ insufficient: true })
    expect(childText(insufficient)).toContain('scorecard.insufficient')
    expect(childText(insufficient)).toContain('scorecard.insufficientNote')
    const failed = card({ errorRate: 0.5 })
    expect(childText(failed)).toContain('scorecard.error')
    expect(childText(failed)).toContain('scorecard.errorRate 50%')
    const outside = card({ fired: 12, firedOutside: 2, activation: 1 })
    expect(childText(outside)).toContain('2 scorecard.firedOutside')
    expect(childText(outside)).toContain('scorecard.activation 100%')
    expect(module.scorecardStatus?.(scorecardFixture({ eligible: 0 }))).toBe('not applicable')
    expect(module.scorecardStatus?.(scorecardFixture({ insufficient: true }))).toBe('insufficient')
    expect(module.scorecardStatus?.(scorecardFixture({ fired: 0, activation: 0 }))).toBe('silent')
    expect(module.scorecardStatus?.(scorecardFixture({ errorRate: 0.5 }))).toBe('error')
  })

  it('renders a mixed task table, sorts it, filters by outcome, and opens a detail', () => {
    const { module } = loadBundle()
    const episodes = [
      episodeFixture({
        id: 'session-1#1',
        sessionTitle: 'Fix the parser',
        start: NOW - 60 * MINUTE,
        end: NOW - 50 * MINUTE,
        firedRows: ['goal-continuity'],
      }),
      episodeFixture({
        id: 'session-1#2',
        sessionTitle: 'Retry the build',
        start: NOW - 40 * MINUTE,
        end: NOW - 30 * MINUTE,
        steps: 6,
        humanMessages: 2,
        usage: { input: 800, output: 200, cacheRead: 1400, cacheWrite: 0, total: 2400 },
        fullUsage: { input: 800, output: 200, cacheRead: 1400, cacheWrite: 0, total: 2400 },
        outcome: 'failed',
        verified: false,
        failures: 2,
        firedRows: ['never'],
      }),
      episodeFixture({
        id: 'session-1#3',
        sessionId: 'abcdef12-3456-7890',
        start: NOW - 20 * MINUTE,
        end: NOW - 10 * MINUTE,
        usage: { input: 200, output: 100, cacheRead: 300, cacheWrite: 0, total: 600 },
        fullUsage: { input: 200, output: 100, cacheRead: 300, cacheWrite: 0, total: 600 },
        outcome: 'cut',
        verified: false,
        failures: 0,
      }),
    ]
    const report = tasksReport(episodes)
    const sorted: string[] = []
    const outcomes: string[] = []
    const plugins: string[] = []
    const selected: Array<string | undefined> = []
    const render = (sort: unknown, outcome: string, plugin = 'all', selectedId?: string): unknown =>
      renderTree(
        module.TasksView?.({
          report,
          t: translate,
          sort,
          outcome,
          plugin,
          ...(selectedId === undefined ? {} : { selectedId }),
          onSort: (key: string) => sorted.push(key),
          onOutcome: (value: string) => outcomes.push(value),
          onPlugin: (value: string) => plugins.push(value),
          onSelect: (id: string | undefined) => selected.push(id),
        }),
      )
    let tree = render({ key: 'start', direction: -1 }, 'all')
    const rowIds = (current: unknown): unknown[] =>
      nodesOf(current, 'tr', (element) => element.props['data-episode'] !== undefined).map(
        (row) => row.props['data-episode'],
      )
    expect(rowIds(tree)).toEqual(['session-1#3', 'session-1#2', 'session-1#1'])
    const text = childText(tree)
    for (const key of [
      'tasks.columnDate',
      'tasks.columnStepsPerHuman',
      'tasks.columnSteps',
      'tasks.columnTokens',
      'tasks.columnActive',
      'tasks.columnOutcome',
      'tasks.columnVerified',
      'tasks.columnSubagents',
      'tasks.columnGoal',
      'tasks.columnFailures',
    ]) {
      expect(text).toContain(key)
    }
    expect(text).toContain('Fix the parser')
    expect(text).toContain('abcdef12')
    expect(text).not.toContain('abcdef12-3456-7890')
    expect(text).toContain('outcome.failed')
    expect(text).toContain('tasks.verifiedNo')
    expect(
      nodesOf(tree, 'th', (element) => element.props['aria-sort'] === 'descending'),
    ).toHaveLength(1)

    const tokensHeader = findButton(tree, 'tasks.columnTokens')
    ;(tokensHeader?.props.onClick as (() => void) | undefined)?.()
    expect(sorted).toEqual(['tokens'])
    tree = render({ key: 'tokens', direction: 1 }, 'all')
    expect(rowIds(tree)).toEqual(['session-1#3', 'session-1#1', 'session-1#2'])

    const selects = nodesOf(tree, 'select')
    const outcomeSelect = selects[0]
    ;(
      outcomeSelect?.props.onChange as
        | ((event: { currentTarget: { value: string } }) => void)
        | undefined
    )?.({ currentTarget: { value: 'failed' } })
    expect(outcomes).toEqual(['failed'])
    tree = render({ key: 'start', direction: -1 }, 'failed')
    expect(rowIds(tree)).toEqual(['session-1#2'])

    // The plugin filter reads the episode's fired row ids.
    const pluginSelect = nodesOf(tree, 'select')[1]
    ;(
      pluginSelect?.props.onChange as
        | ((event: { currentTarget: { value: string } }) => void)
        | undefined
    )?.({ currentTarget: { value: 'goal-continuity' } })
    expect(plugins).toEqual(['goal-continuity'])
    tree = render({ key: 'start', direction: -1 }, 'all', 'goal-continuity')
    expect(rowIds(tree)).toEqual(['session-1#1'])

    const firstRowButton = nodesOf(nodesOf(tree, 'tbody')[0], 'button')[0]
    ;(firstRowButton?.props.onClick as (() => void) | undefined)?.()
    expect(selected).toEqual(['session-1#1'])
    tree = render({ key: 'start', direction: -1 }, 'all', 'goal-continuity', 'session-1#1')
    expect(childText(tree)).toContain('tasks.detail')
    expect(childText(tree)).toContain('tasks.tokenPerStep')
  })

  it('states an empty task window', () => {
    const { module } = loadBundle()
    const rendered = renderTree(
      module.TasksView?.({
        report: tasksReport([]),
        t: translate,
        sort: { key: 'start', direction: -1 },
        outcome: 'all',
        plugin: 'all',
        onSort: () => {},
        onOutcome: () => {},
        onPlugin: () => {},
        onSelect: () => {},
      }),
    )
    expect(childText(rendered)).toContain('tasks.empty')
    expect(nodesOf(rendered, 'tbody')).toHaveLength(0)
  })

  it('caps the task table at 200 episodes', () => {
    const { module } = loadBundle()
    const episodes = Array.from({ length: 205 }, (_unused, index) =>
      episodeFixture({
        id: `session-1#${String(index + 1)}`,
        start: NOW - (300 - index) * MINUTE,
        end: NOW - (290 - index) * MINUTE,
      }),
    )
    const rendered = renderTree(
      module.TasksView?.({
        report: tasksReport(episodes),
        t: translate,
        sort: { key: 'start', direction: -1 },
        outcome: 'all',
        plugin: 'all',
        onSort: () => {},
        onOutcome: () => {},
        onPlugin: () => {},
        onSelect: () => {},
      }),
    )
    const rows = nodesOf(rendered, 'tr', (element) => element.props['data-episode'] !== undefined)
    expect(rows).toHaveLength(200)
    expect(childText(rendered)).toContain('tasks.capped')
    expect(childText(rendered)).toContain('200 failure.of 205')
    expect(module.EPISODE_TABLE_LIMIT).toBe(200)
  })

  it('labels a spanning episode cost through the cutoff and over the full episode', () => {
    const { module } = loadBundle()
    const spanning = episodeFixture({
      id: 'session-1#9',
      steps: 2,
      usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 },
      fullUsage: { input: 400, output: 100, cacheRead: 0, cacheWrite: 0, total: 500 },
      activeMs: 5 * MINUTE,
      activeMsFull: 20 * MINUTE,
    })
    const report = tasksReport([spanning])
    const table = renderTree(
      module.TasksView?.({
        report,
        t: translate,
        sort: { key: 'start', direction: -1 },
        outcome: 'all',
        plugin: 'all',
        onSort: () => {},
        onOutcome: () => {},
        onPlugin: () => {},
        onSelect: () => {},
      }),
    )
    expect(childText(table)).toContain('120')
    // The token header states the cost basis, from the registered dictionary.
    expect(module.EN?.['tasks.columnTokens']).toBe('Tokens (through cutoff)')
    const unfinished = renderTree(
      module.EpisodeDetail?.({
        episode: episodeFixture({
          timeline: {
            from: NOW - 10 * MINUTE,
            to: NOW,
            steps: [],
            tools: [],
            human: [],
            errors: [],
            stepsCount: 1,
            callsCount: 1,
          },
        }),
        t: translate,
        onClose: () => {},
      }),
    )
    expect(childText(unfinished)).toContain('1 timeline.step')
    expect(childText(unfinished)).toContain('1 timeline.call')
    const detail = renderTree(
      module.EpisodeDetail?.({ episode: spanning, t: translate, onClose: () => {} }),
    )
    const text = childText(detail)
    expect(text).toContain('tasks.throughCutoff')
    expect(text).toContain('(cutoff.through)')
    expect(text).toContain('120')
    expect(text).toContain('tasks.fullEpisode')
    expect(text).toContain('(cutoff.full)')
    expect(text).toContain('500')
    expect(text).toContain('tasks.tokenPerStep')
    expect(text).toContain('60')
    expect(text).toContain('tasks.checkpoints')
    expect(text).toContain('tasks.noChildren')
    expect(text).toContain('tasks.episodeSpan')
    expect(
      nodesOf(
        detail,
        'svg',
        (element) => String(element.props.className ?? '') === 'dsh-obs-timeline-chart',
      ),
    ).toHaveLength(1)
  })

  it('renders an episode detail with subagents, goals, checkpoints, and no fixture text', () => {
    const { module } = loadBundle()
    const episode = {
      ...episodeFixture({
        id: 'session-1#4',
        start: NOW - 10 * MINUTE,
        end: NOW - 2 * MINUTE,
        children: [
          {
            sessionId: 'child-1',
            sessionTitle: 'Child session',
            origin: 'delegate',
            delegationDepth: 1,
            outcome: 'completed',
            verified: true,
            usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, total: 35 },
            toolCalls: 1,
          },
        ],
      }),
      objective: SECRET,
      arguments: `${SECRET}.md`,
      checkpointVerifiedList: [SECRET],
      message: SECRET,
    } as unknown as EpisodeReport
    const report = tasksReport([episode])
    const rendered = renderTree(
      module.TasksView?.({
        report,
        t: translate,
        sort: { key: 'start', direction: -1 },
        outcome: 'all',
        plugin: 'all',
        selectedId: 'session-1#4',
        onSort: () => {},
        onOutcome: () => {},
        onPlugin: () => {},
        onSelect: () => {},
      }),
    )
    const text = childText(rendered)
    expect(text).toContain('Child session')
    expect(text).toContain('tasks.subagents')
    expect(text).toContain('tasks.goalsRow')
    expect(text).toContain('tasks.checkpoints')
    expect(text).toContain('tasks.created')
    expect(text).toContain('timeline.title')
    expect(text).not.toContain(SECRET)
    expect(JSON.stringify(rendered)).not.toContain(SECRET)
  })

  it('renders supported hypotheses with baseline, current, threshold, samples, and a copy summary', () => {
    const { module } = loadBundle()
    const results = [hypothesisFixture()]
    const report = { ...fixtureReport(), hypotheses: results }
    const rendered = renderTree(module.HypothesesView?.({ report, t: translate }))
    const text = childText(rendered)
    expect(text).toContain('hypothesis.metric.checkpointCoverage')
    expect(text).toContain('hypothesis.status.supported')
    expect(text).toContain('hypothesis.baseline')
    expect(text).toContain('hypothesis.current')
    expect(text).toContain('hypothesis.threshold')
    expect(text).toContain('hypothesis.samples')
    expect(text).toContain('40/20')
    expect(text).toContain('hypothesis.window')
    expect(text).toContain('range.week')
    expect(text).toContain('hypothesis.association')
    // The card names the actual numbers, not only the labels.
    expect(text).toContain('50')
    expect(text).toContain('80')
    expect(text).toContain('10')
    const card = nodesOf(
      rendered,
      'article',
      (element) => element.props['data-status'] !== undefined,
    )[0]
    expect(card?.props['data-status']).toBe('supported')
    expect(pillText(card)).toBe('hypothesis.status.supported')
    expect(childText(rendered)).toContain('hypothesis.copy')
    const copy = module.hypothesisCopyText?.(results, translate) ?? ''
    expect(copy).toContain('hypothesis.metric.checkpointCoverage')
    expect(copy).toContain('hypothesis.status.supported')
    expect(copy).toContain('hypothesis.samples 40/20')
    expect(copy).toContain('50')
    expect(copy).toContain('80')
    expect(copy).toContain('10')
    expect(copy).not.toContain(SECRET)
  })

  it('words collecting, inconclusive, and refuted hypotheses', () => {
    const { module } = loadBundle()
    const results = [
      hypothesisFixture({ index: 0, status: 'refuted', current: 0.1, threshold: 0.1 }),
      hypothesisFixture({ index: 1, status: 'inconclusive' }),
      hypothesisFixture({ index: 2, status: 'collecting', samples: 3, minSamples: 20 }),
    ]
    const rendered = renderTree(
      module.HypothesesView?.({
        report: { ...fixtureReport(), hypotheses: results },
        t: translate,
      }),
    )
    const text = childText(rendered)
    expect(text).toContain('hypothesis.status.refuted')
    expect(text).toContain('hypothesis.status.inconclusive')
    expect(text).toContain('hypothesis.status.collecting')
    expect(text).toContain('hypothesis.collecting')
    expect(text).toContain('3 verdict.of 20')
    expect(text).not.toContain('hypothesis.status.supported')
    const cards = nodesOf(
      rendered,
      'article',
      (element) => element.props['data-status'] !== undefined,
    )
    expect(cards.map((card) => card.props['data-status'])).toEqual([
      'refuted',
      'inconclusive',
      'collecting',
    ])
  })

  it('blocks support when a guardrail regresses', () => {
    const { module } = loadBundle()
    const guarded = hypothesisFixture({
      status: 'inconclusive',
      guardrail: { metric: 'failure-rate', baseline: 0.1, current: 0.2, regressed: true },
    })
    const rendered = renderTree(
      module.HypothesesView?.({
        report: { ...fixtureReport(), hypotheses: [guarded] },
        t: translate,
      }),
    )
    const text = childText(rendered)
    expect(text).toContain('hypothesis.guardrail')
    expect(text).toContain('hypothesis.metric.failureRate')
    expect(text).toContain('hypothesis.regressedBlock')
    expect(text).toContain('hypothesis.regressed')
    expect(text).not.toContain('hypothesis.status.supported')
    expect(
      nodesOf(rendered, 'p', (element) =>
        String(element.props.className ?? '').includes('dsh-obs-err'),
      ).length,
    ).toBeGreaterThan(0)
  })

  it('states an empty hypotheses tab', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.HypothesesView?.({ report: fixtureReport(), t: translate }))
    expect(childText(rendered)).toContain('hypothesis.empty')
  })

  it('renders no fixture text on any sub-view and keeps status words visible', () => {
    loadBundle()
    const render = statefulPanel()
    const base = panelProps(richReport())
    const scanned = richReport()
    expect(JSON.stringify(scanned)).not.toContain(SECRET)
    let tree = render(base)
    expect(childText(tree)).toContain('status.silent')
    expect(childText(tree)).toContain('scorecard.insufficient')
    for (const label of ['tab.plugins', 'tab.tasks', 'tab.hypotheses', 'tab.overview']) {
      ;(findButton(tree, label)?.props.onClick as (() => void) | undefined)?.()
      tree = render(base)
      expect(childText(tree)).not.toContain(SECRET)
      expect(JSON.stringify(tree)).not.toContain(SECRET)
    }
    ;(findButton(tree, 'tab.tasks')?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    const rowButton = nodesOf(nodesOf(tree, 'tbody')[0], 'button')[0]
    ;(rowButton?.props.onClick as (() => void) | undefined)?.()
    tree = render(base)
    expect(childText(tree)).toContain('tasks.detail')
    expect(childText(tree)).not.toContain(SECRET)
    expect(JSON.stringify(tree)).not.toContain(SECRET)
  })

  it('keeps two columns above 900px, one below, and uses theme tokens only', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.ObservabilityPanel?.(panelProps(fixtureReport())))
    const css = childText(nodesOf(rendered, 'style')[0])
    expect(css).toContain('@media (min-width: 901px)')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)')
    for (const token of [
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-border-l2',
      '--dsw-alias-state-success-primary',
      '--dsw-alias-state-error-primary',
      '--dsw-focus-ring-color',
    ]) {
      expect(css).toContain(`var(${token}`)
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})

describe('attention findings', () => {
  const FINDING = {
    id: 'serial-long-run',
    severity: 'attention' as const,
    title: 'A long run carried the work on one stream',
    evidence:
      '1 long episode ran with a parallel width of at most one; the longest (session-1#1) recorded 41 steps, 21 active minutes, and a width of 0.',
    episodeIds: ['session-1#1'],
    nextAction:
      'Name two to four independent streams and their files, or record why the work must stay serial.',
  }

  it('renders the title, evidence, and next action of a finding', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.FindingsStrip?.({ findings: [FINDING], t: translate }))
    const text = childText(rendered)
    expect(text).toContain(FINDING.title)
    expect(text).toContain('41 steps')
    expect(text).toContain(FINDING.nextAction)
    expect(text).not.toContain('SECRET-TOKEN-123')
    expect(nodesOf(rendered, 'section')).toHaveLength(1)
  })

  it('renders nothing when there is no finding', () => {
    const { module } = loadBundle()
    expect(renderTree(module.FindingsStrip?.({ findings: [], t: translate }))).toBeNull()
  })

  it('shows the attention strip above the Overview tiles', () => {
    const { module } = loadBundle()
    const report = { ...richReport(), findings: [FINDING] }
    const rendered = renderTree(module.OverviewView?.(panelProps(report)))
    const text = childText(rendered)
    expect(text).toContain(FINDING.title)
    // Rendered text order: the finding precedes the quality tile.
    expect(text.indexOf(FINDING.title)).toBeGreaterThanOrEqual(0)
    expect(text.indexOf(FINDING.title)).toBeLessThan(text.indexOf('tile.quality'))
  })
})

describe('overview details', () => {
  it('uses the configured episode minimum for the sufficiency verdict', () => {
    const { module } = loadBundle()
    const base = richReport()
    const complete = {
      ...base,
      minEpisodes: 5,
      quality: { ...base.quality, episodes: 12 },
      dataQuality: {
        ...base.dataQuality,
        steps: 2,
        stepsWithUsage: 2,
        messages: 2,
        messagesWithUsage: 2,
        unlinkedChildren: 0,
        unmappedClosers: 0,
      },
    }
    expect(module.sufficiency?.(complete)).toBe('sufficient')
    expect(module.sufficiency?.({ ...complete, minEpisodes: 20 })).toBe('insufficient')
    // A silent plugin whose declared eligibility matched no episode is not sufficient.
    const silentRow = {
      id: 'quiet',
      label: 'Quiet plugin',
      kind: 'signal' as const,
      group: 'plugin' as const,
      status: 'silent' as const,
      note: 'No traces in this period.',
      eligibilityDeclared: true,
      traces: 0,
      errors: 0,
      unrecoveredErrors: 0,
      counts: [],
      tools: [],
      details: [],
    }
    const emptyEligibility = {
      ...complete,
      rows: [...complete.rows, silentRow],
      scorecards: [scorecardFixture({ rowId: 'quiet', label: 'Quiet plugin', eligible: 0 })],
    }
    expect(module.sufficiency?.(emptyEligibility)).toBe('insufficient')
    const banner = renderTree(
      module.DataSufficiency?.({ report: { ...complete, minEpisodes: 20 }, t: translate }),
    )
    expect(childText(banner)).toContain('20')
  })

  it('shows a percentile on the quality tile', () => {
    const { module } = loadBundle()
    const base = richReport()
    const report = {
      ...base,
      quality: { ...base.quality, stepsToCompletion: { p50: 3, p90: 9, n: 4 } },
    }
    const text = childText(renderTree(module.OutcomeTiles?.({ report, t: translate })))
    expect(text).toContain('3 unit.steps')
    expect(text).toContain('9 unit.steps')
    expect(text).toContain('tile.n 4 tile.completed')
    // An empty completed distribution reads unavailable, not zero.
    const empty = {
      ...report,
      quality: { ...base.quality, stepsToCompletion: { p50: 0, p90: 0, n: 0 } },
    }
    const emptyText = childText(renderTree(module.OutcomeTiles?.({ report: empty, t: translate })))
    expect(emptyText).toContain('tile.n 0 tile.completed')
    expect((emptyText.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('shows the through-cutoff cost and label on the cost tile', () => {
    const { module } = loadBundle()
    const base = richReport()
    const report = {
      ...base,
      cutoffLabel: 'through cutoff' as const,
      cost: {
        ...base.cost,
        cutoffLabel: 'through cutoff' as const,
        tokensPerEpisode: { p50: 111, p90: 222, n: 2 },
        fullTokensPerEpisode: { p50: 999, p90: 888, n: 2 },
      },
    }
    const text = childText(renderTree(module.OutcomeTiles?.({ report, t: translate })))
    expect(text).toContain('111')
    expect(text).toContain('222')
    expect(text).not.toContain('999')
    expect(text).toContain('cutoff.through')
  })

  it('keeps a silent plugin in the compact group, not as a scorecard', () => {
    const { module } = loadBundle()
    const base = richReport()
    const quiet = {
      id: 'quiet',
      label: 'Quiet plugin',
      kind: 'signal' as const,
      group: 'plugin' as const,
      status: 'silent' as const,
      note: 'No traces in this period.',
      eligibilityDeclared: false,
      traces: 0,
      errors: 0,
      unrecoveredErrors: 0,
      counts: [],
      tools: [],
      details: [],
    }
    const report = {
      ...base,
      rows: [...base.rows, quiet],
      scorecards: [
        scorecardFixture({ rowId: 'quiet', label: 'Quiet plugin', activation: 0, fired: 0 }),
      ],
    }
    const tree = renderTree(module.OverviewView?.(panelProps(report)))
    // One compact row only; the scorecard is not expanded beside it.
    expect((childText(tree).match(/Quiet plugin/g) ?? []).length).toBe(1)
    // The compact row keeps its eligibility context.
    expect(childText(tree)).toContain('0 scorecard.of 12 scorecard.eligible')
    const undeclared = {
      ...report,
      rows: [...base.rows, { ...quiet, id: 'unknown-eligibility', label: 'Undeclared plugin' }],
      scorecards: [
        scorecardFixture({
          rowId: 'quiet',
          label: 'Quiet plugin',
          activation: 0,
          fired: 0,
        }),
        scorecardFixture({
          rowId: 'unknown-eligibility',
          label: 'Undeclared plugin',
          eligibilityDeclared: false,
          activation: 0,
          fired: 0,
        }),
      ],
    }
    const undeclaredText = childText(renderTree(module.OverviewView?.(panelProps(undeclared))))
    expect(undeclaredText).toContain('scorecard.noEligibility')
  })
})
