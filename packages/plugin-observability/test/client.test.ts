import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { extractRecords } from '../src/host/records.ts'
import { buildReport, type Report } from '../src/host/report.ts'
import { parseRows } from '../src/host/rows.ts'

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

function healthyReport(): Report {
  const records = extractRecords('session-1', [
    event('turn/start', { turn: 1 }, NOW - 2 * MINUTE),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
      NOW - MINUTE,
    ),
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
    registry: new Set(['delegate']),
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
  KpiStrip?: (props: Record<string, unknown>) => unknown
  HealthBanner?: (props: Record<string, unknown>) => unknown
  ActivityChart?: (props: Record<string, unknown>) => unknown
  PluginBoard?: (props: Record<string, unknown>) => unknown
  PluginCard?: (props: Record<string, unknown>) => unknown
  StatusPill?: (props: Record<string, unknown>) => unknown
  Sparkline?: (props: Record<string, unknown>) => unknown
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

  it('renders the KPI strip from the whole-window totals', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.KpiStrip?.({ report: fixtureReport(), t: translate }))
    const kpis = nodesOf(rendered, 'div', (element) => element.props['data-kpi'] !== undefined)
    const values = new Map(kpis.map((kpi) => [String(kpi.props['data-kpi']), childText(kpi)]))
    expect(values.get('turns')).toContain('1')
    expect(values.get('steps')).toContain('1')
    expect(values.get('toolCalls')).toContain('2')
    expect(values.get('errors')).toContain('1')
    expect(kpis.find((kpi) => kpi.props['data-kpi'] === 'errors')?.props['data-tone']).toBe('error')
  })

  it('puts the health verdict first and names the failing plugin count', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.HealthBanner?.({ report: fixtureReport(), t: translate }))
    expect(childText(rendered)).toContain('health.attention')
    expect(childText(rendered)).toContain('1 health.errors')
    expect(elements(rendered).some((element) => element.props['data-tone'] === 'attention')).toBe(
      true,
    )
    const healthy = renderTree(module.HealthBanner?.({ report: healthyReport(), t: translate }))
    expect(childText(healthy)).toContain('health.ok')
    expect(childText(healthy)).not.toContain('health.attention')
    expect(elements(healthy).some((element) => element.props['data-tone'] === 'ok')).toBe(true)
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

  it('groups plugin cards by attention and keeps guidance compact', () => {
    const { module } = loadBundle()
    const rendered = renderTree(
      module.PluginBoard?.({ report: fixtureReport(), t: translate, now: NOW }),
    )
    const cards = nodesOf(rendered, 'article')
    const byStatus = (status: string) =>
      cards.filter((card) => card.props['data-status'] === status)
    expect(byStatus('error')).toHaveLength(2)
    expect(byStatus('active')).toHaveLength(1)
    expect(byStatus('silent')).toHaveLength(1)
    expect(byStatus('not loaded')).toHaveLength(1)
    const cardText = cards.map(childText).join('\n')
    expect(cardText).toContain('Delegation')
    expect(cardText).toContain('active')
    expect(cardText).toContain('Missing plugin')
    expect(cardText).toContain('not loaded')
    expect(cardText).toContain('Silent plugin')
    expect(cardText).toContain('silent')
    expect(cardText).toContain('delegate')
    expect(childText(rendered)).toContain('Prompt-only plugin')
    expect(childText(rendered)).toContain('status.guidance')
    // Silence is explained, never implied.
    expect(cardText).toContain('No traces in this period')

    // Cards belong to the matching section, in attention-first order.
    const sections = nodesOf(rendered, 'section')
    const section = (key: string) =>
      sections.find((candidate) => childText(candidate).includes(key))
    const statuses = (key: string) =>
      nodesOf(section(key), 'article').map((card) => card.props['data-status'])
    expect(
      statuses('section.attention')
        .slice(0, -1)
        .every((status) => status === 'error'),
    ).toBe(true)
    expect(statuses('section.attention').at(-1)).toBe('not loaded')
    expect(statuses('section.active')).toEqual(['active'])
    expect(statuses('section.silent')).toEqual(['silent'])
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

  it('renders tool distribution bars by call count', () => {
    const { module } = loadBundle()
    const rendered = renderTree(module.ToolsPanel?.({ rows: fixtureReport().rows, t: translate }))
    const items = nodesOf(rendered, 'li')
    expect(items).toHaveLength(2)
    expect(items.map(childText).join('\n')).toContain('delegate')
    expect(items.map(childText).join('\n')).toContain('write')
    expect(nodesOf(rendered, 'span').some((element) => element.props.style !== undefined)).toBe(
      true,
    )
  })

  it('renders every observed tool, not only a top slice', () => {
    const { module } = loadBundle()
    const calls = Array.from({ length: 10 }, (_unused, index) =>
      event(
        'tool/call',
        {
          turn: 1,
          step: 1,
          callId: `c${String(index)}`,
          name: `tool_${String(index)}`,
          arguments: '{}',
        },
        NOW - MINUTE,
      ),
    )
    const report = buildReport({
      range: 'session',
      now: NOW,
      records: extractRecords('session-1', [
        event('turn/start', { turn: 1 }, NOW - 2 * MINUTE),
        ...calls,
      ]),
      configured: [],
      registry: new Set(),
    })
    const rendered = renderTree(module.ToolsPanel?.({ rows: report.rows, t: translate }))
    expect(nodesOf(rendered, 'li')).toHaveLength(10)
    expect(childText(rendered)).toContain('tool_9')
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
          totals: { turns: 0, steps: 0, toolCalls: 0, errors: 0, records: 0 },
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
