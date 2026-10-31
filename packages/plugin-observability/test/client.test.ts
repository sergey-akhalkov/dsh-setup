import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { extractRecords } from '../src/host/records.ts'
import type { FailureEntry } from '../src/host/report.ts'
import { buildReport, type Report } from '../src/host/report.ts'
import { parseRows } from '../src/host/rows.ts'
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
  apply?: (ctx: unknown) => void
  reportUrl?: (range: string, sessionId?: string) => string
  counted?: (count: number, one: string, many?: string) => string
  failureFacts?: (failure: FailureEntry, t: (key: string) => string) => string[]
  failureCopyText?: (failures: readonly FailureEntry[], t: (key: string) => string) => string
  failureFixPrompt?: (failures: readonly FailureEntry[], t: (key: string) => string) => string
  FAILURE_SECTION_ID?: string
  MAX_FIX_PROMPT_CHARS?: number
  KpiStrip?: (props: Record<string, unknown>) => unknown
  HealthBanner?: (props: Record<string, unknown>) => unknown
  ActivityChart?: (props: Record<string, unknown>) => unknown
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

  it('renders the activity chart with axis, legend, and one titled bar per bucket', () => {
    const { module } = loadBundle()
    const report = fixtureReport()
    const rendered = renderTree(module.ActivityChart?.({ report, t: translate }))
    const titles = nodesOf(rendered, 'title')
    expect(titles).toHaveLength(report.bucketLabels.length)
    expect(titles.map(childText).join('\n')).toContain('Turn 1: 7 chart.events')
    expect(titles.map(childText).join('\n')).toContain('1 chart.errors')
    const errorBars = nodesOf(
      rendered,
      'rect',
      (element) => element.props['data-tone'] === 'errors',
    )
    expect(errorBars.length).toBeGreaterThan(0)
    const words = childText(rendered)
    expect(words).toContain('legend.events')
    expect(words).toContain('legend.errors')
    const axis = nodesOf(
      rendered,
      'text',
      (element) => element.props.className === 'dsh-obs-axis',
    ).map(childText)
    expect(axis).toContain('Turn 1')
    expect(axis).toContain('Outside turn')
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
    const { module } = loadBundle()
    const report = fixtureReport()
    const rendered = renderTree(
      module.ObservabilityPanel?.({
        range: 'session',
        report,
        error: null,
        t: translate,
        onRange: () => {},
        now: NOW,
      }),
    )
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
})
