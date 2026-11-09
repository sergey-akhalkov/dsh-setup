import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

type Element = { type: unknown; props: Record<string, unknown> }
const Fragment = Symbol('Fragment')
function jsx(type: unknown, props: Record<string, unknown> | null): Element {
  return { type, props: props ?? {} }
}

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

function childText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (node === null || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(childText).join('')
  return childText((node as Element).props?.children)
}

interface LoadedModule {
  inject?: string[]
  ENTRY_LIMITATION?: string
  EN?: Record<string, string>
  apply?: (ctx: unknown) => void
  WorkflowsView?: (props: Record<string, unknown>) => unknown
  WorkflowsLoaded?: (props: Record<string, unknown>) => unknown
  HealthStrip?: (props: Record<string, unknown>) => unknown
  TriggersTable?: (props: Record<string, unknown>) => unknown
  EventList?: (props: Record<string, unknown>) => unknown
  WhyNotTable?: (props: Record<string, unknown>) => unknown
  RunsList?: (props: Record<string, unknown>) => unknown
  RunDetail?: (props: Record<string, unknown>) => unknown
  ErrorLine?: (props: Record<string, unknown>) => unknown
  LoadingLine?: (props: Record<string, unknown>) => unknown
  LoadMore?: (props: Record<string, unknown>) => unknown
  formatTime?: (at: number | undefined, t: unknown) => string
  isStaleGeneration?: (requested: number, current: number) => boolean
  updatePageState?: (
    states: Record<string, unknown>,
    kind: 'events' | 'runs',
    value: unknown,
  ) => Record<string, unknown>
  VIEW_CSS?: string
  eventsUrl?: (session: string, cursor?: string) => string
  healthUrl?: (session: string) => string
}

function loadModule(): LoadedModule {
  const result = buildSync({
    stdin: {
      contents: `export * from './src/client/index.tsx'
export * from './src/client/panel.tsx'
export * from './src/client/view.tsx'
`,
      resolveDir: packageDir,
      sourcefile: 'workflows-client-entry.tsx',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    logLevel: 'silent',
  })
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error('the client source did not bundle')
  let registration: { factory: (require: (id: string) => unknown) => LoadedModule } | undefined
  const window = {
    __ModuleLoader__: {
      load(value: typeof registration): void {
        registration = value
      },
    },
  }
  new Function(
    'window',
    `window.__ModuleLoader__.load({
  id: 'workflows-source',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${output.text}
    return module.exports;
  },
});`,
  )(window)
  if (registration === undefined) throw new Error('the client did not register')
  return registration.factory((id) => {
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
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Tag: (props: Record<string, unknown>) => ({ type: 'span', props }) }
    }
    return {}
  })
}

function translate(key: string): string {
  return key
}

function health(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'waiting',
    listenerCount: 5,
    triggerCount: 9,
    journalWritable: true,
    lastEventAt: 1_762_500_000_000,
    lastCheckAt: 1_762_500_000_000,
    session: 'session-1',
    ...overrides,
  }
}

describe('Workflows Client half', () => {
  it('registers the conversation view with id, order, and a localized label', () => {
    const module = loadModule()
    const locales: Array<{ namespace: string; dictionary: Record<string, string> }> = []
    const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
    module.apply?.({
      get: (name: string) => (name === 'resources' ? {} : undefined),
      effect(callback: () => () => void) {
        callback()
        return () => {}
      },
      locale: {
        register(namespace: string, _locale: string, dictionary: Record<string, string>) {
          locales.push({ namespace, dictionary })
          return () => {}
        },
        bind: () => translate,
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
    expect(module.inject).toEqual(['slots', 'locale', 'resources'])
    expect(locales[0]?.namespace).toBe('dsh-setup-workflows')
    expect(locales[0]?.dictionary['view.label']).toBe('Workflows')
    expect(registrations).toHaveLength(1)
    const options = registrations[0]?.options ?? {}
    expect(options.name).toBe('conversation.view')
    expect(options.id).toBe('workflows')
    expect(options.order).toBe(30)
    expect((options.label as () => string)()).toBe('view.label')
    const registered = registrations[0]?.component as (props: Record<string, unknown>) => Element
    expect(typeof registered).toBe('function')
    const tree = registered({ sessionId: 'session-42' })
    expect(typeof tree.type).toBe('function')
    expect((tree.type as { name?: string }).name).toBe('WorkflowsView')
    expect(tree.props.sessionId).toBe('session-42')
    expect((tree.props.t as (key: string) => string)('view.label')).toBe('view.label')
    expect(module.ENTRY_LIMITATION).toContain('tab is the entry')
  })

  it('stays inert with one bounded diagnostic when the conversation services are absent', () => {
    const module = loadModule()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => module.apply?.({})).not.toThrow()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0]?.[0]).length).toBeLessThan(200)
    errors.mockRestore()
  })

  it('renders each health state as its own labelled strip', () => {
    const module = loadModule()
    for (const state of ['listener-down', 'journal-readonly', 'waiting', 'healthy']) {
      const rendered = renderTree(module.HealthStrip?.({ health: health({ state }), t: translate }))
      expect(childText(rendered)).toContain(`health.${state}`)
      expect(elements(rendered).some((element) => element.props['data-state'] === state)).toBe(true)
    }
    const failed = renderTree(
      module.HealthStrip?.({
        health: health({ state: 'listener-down', lastError: 'registration threw' }),
        t: translate,
      }),
    )
    expect(childText(failed)).toContain('registration threw')
  })

  it('renders the trigger catalog with filters and last evaluations', () => {
    const module = loadModule()
    const triggers = [
      {
        id: 'openspec-tasks-checked',
        event: 'fs.change',
        filter: { path: 'openspec/changes/**/tasks.md', change: 'created-or-modified' },
        mode: 'shadow',
        dedupe: 'path+content-hash',
        last: { at: 1, matched: true, reason: 'would-fire' },
      },
    ]
    const rendered = renderTree(module.TriggersTable?.({ triggers, t: translate }))
    const text = childText(rendered)
    expect(text).toContain('openspec-tasks-checked')
    expect(text).toContain('path: openspec/changes/**/tasks.md')
    expect(text).toContain('reason.would-fire')
    const empty = renderTree(module.TriggersTable?.({ triggers: [], t: translate }))
    expect(childText(empty)).toContain('triggers.empty')
  })

  it('renders event rows with a truncation marker and a loading/empty state', () => {
    const module = loadModule()
    const event = {
      v: 1,
      at: 1,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'delegate',
      summary: 'delegate review started; run: run-1',
      bytes: 40,
      truncated: true,
    }
    const rendered = renderTree(module.EventList?.({ events: [event], t: translate }))
    const text = childText(rendered)
    expect(text).toContain('delegate')
    expect(text).toContain('events.truncated')
    expect(childText(renderTree(module.EventList?.({ events: [], t: translate })))).toContain(
      'events.empty',
    )
    expect(childText(renderTree(module.LoadingLine?.({ t: translate })))).toContain('state.loading')
  })

  it('renders the Why-not rows with matched state, reason, path, and filter', () => {
    const module = loadModule()
    const events = [
      {
        v: 1,
        at: 1,
        session: 'session-1',
        kind: 'fs.change',
        subject: 'src/index.ts',
        summary: 'modified src/index.ts',
        bytes: 20,
        truncated: false,
        triggers: [
          {
            id: 'openspec-tasks-checked',
            matched: false,
            reason: 'filter-mismatch',
            path: 'src/index.ts',
            filter: 'path: openspec/changes/**/tasks.md',
          },
        ],
      },
    ]
    const rendered = renderTree(module.WhyNotTable?.({ events, t: translate }))
    const text = childText(rendered)
    expect(text).toContain('reason.filter-mismatch')
    expect(text).toContain('src/index.ts')
    expect(text).toContain('openspec/changes/**/tasks.md')
    expect(childText(renderTree(module.WhyNotTable?.({ events: [], t: translate })))).toContain(
      'whyNot.empty',
    )
  })

  it('renders attributed runs, selects one, and shows its steps and evidence', () => {
    const module = loadModule()
    const selected: string[] = []
    const runs = [
      {
        id: 'delegation:run-1',
        source: 'delegation',
        session: 'session-1',
        attribution: 'local',
        title: 'task-review change-x',
        startedAt: 1,
        status: 'done',
        steps: [
          { id: 'rule', title: 'task-review', state: 'completed' },
          {
            id: 'record',
            title: 'Review verdict',
            state: 'PASS',
            at: 2,
            evidence: '.dsh/record.json',
          },
        ],
      },
    ]
    const list = renderTree(
      module.RunsList?.({
        runs,
        t: translate,
        onSelect: (run: { id: string }) => selected.push(run.id),
      }),
    )
    const button = elements(list).find((element) => element.type === 'button')
    expect(button?.props['data-run']).toBe('delegation:run-1')
    ;(button?.props.onClick as (() => void) | undefined)?.()
    expect(selected).toEqual(['delegation:run-1'])
    const detail = renderTree(module.RunDetail?.({ run: runs[0], t: translate }))
    const text = childText(detail)
    expect(text).toContain('Review verdict')
    expect(text).toContain('PASS')
    expect(text).toContain('.dsh/record.json')
    expect(
      childText(renderTree(module.RunsList?.({ runs: [], t: translate, onSelect: () => {} }))),
    ).toContain('runs.empty')
  })

  it('shows a malformed-record run as an error row and a retry control', () => {
    const module = loadModule()
    const malformed = {
      id: 'checkpoint:1',
      source: 'checkpoint',
      session: 'session-1',
      attribution: 'local',
      title: 'Unreadable checkpoint record',
      startedAt: 0,
      status: 'unknown',
      steps: [],
      error: '.dsh/work-checkpoints/abc/1.json: bad JSON',
    }
    const detail = renderTree(module.RunDetail?.({ run: malformed, t: translate }))
    expect(childText(detail)).toContain('.dsh/work-checkpoints/abc/1.json: bad JSON')
    let retried = 0
    const error = renderTree(
      module.ErrorLine?.({ message: 'boom', t: translate, onRetry: () => (retried += 1) }),
    )
    expect(childText(error)).toContain('state.error')
    const retry = elements(error).find((element) => element.type === 'button')
    ;(retry?.props.onClick as (() => void) | undefined)?.()
    expect(retried).toBe(1)
  })

  it('renders checkpoint and review run details with state, time, and evidence', () => {
    const module = loadModule()
    const checkpoint = renderTree(
      module.RunDetail?.({
        run: {
          id: 'checkpoint:2',
          source: 'checkpoint',
          session: 'session-1',
          attribution: 'local',
          title: 'Checkpoint turn 2',
          startedAt: 1_762_500_000_000,
          status: 'running',
          steps: [
            { id: 'outcome', title: 'Outcome', state: 'continue' },
            {
              id: 'bottleneck',
              title: 'Bottleneck',
              state: 'lead_action',
              at: 1_762_500_060_000,
              evidence: 'packages/plugin-workflows',
            },
            {
              id: 'lane',
              title: 'Lane',
              state: 'running',
              evidence: 'openspec/changes/add-workflow-observability',
            },
            { id: 'next', title: 'Next', state: 'next', evidence: 'finish the change' },
          ],
        },
        t: translate,
        session: 'session-1',
      }),
    )
    expect(childText(checkpoint)).toContain('Checkpoint turn 2')
    expect(childText(checkpoint)).toContain('continue')
    expect(childText(checkpoint)).toContain('lead_action')
    expect(childText(checkpoint)).toContain('packages/plugin-workflows')
    const expectedTime = module.formatTime?.(1_762_500_060_000, translate) ?? ''
    expect(expectedTime).not.toBe('')
    expect(childText(checkpoint)).toContain(expectedTime)
    expect(childText(checkpoint)).toContain('—')
    expect(childText(checkpoint)).toContain('openspec/changes/add-workflow-observability')
    expect(childText(checkpoint)).toContain('finish the change')

    expect(elements(checkpoint).filter((element) => element.type === 'a')).toHaveLength(0)
    const review = renderTree(
      module.RunDetail?.({
        run: {
          id: 'review:add-workflow-observability/0123456789abcdef',
          source: 'review',
          session: 'session-1',
          attribution: 'portable',
          title: 'Review add-workflow-observability 0123456789abcdef',
          startedAt: 1_762_500_000_000,
          status: 'done',
          record: 'openspec/changes/add-workflow-observability/reviews/0123456789abcdef.json',
          steps: [
            {
              id: 'record',
              title: 'Review verdict',
              state: 'PASS',
              at: Date.parse('2026-11-07T10:12:00.000Z'),
              evidence: '.dsh/record.json',
            },
            {
              id: 'target',
              title: 'Review target',
              state: 'target',
              evidence: 'codex-subagent / astra',
            },
          ],
        },
        t: translate,
        session: 'session-1',
      }),
    )
    const anchors = elements(review).filter((element) => element.type === 'a')
    expect(anchors.length).toBeGreaterThan(0)
    expect(String(anchors[0]?.props.href)).toContain(
      '/api/workflows/evidence?session=session-1&path=',
    )
    expect(childText(review)).toContain('PASS')
    expect(childText(review)).toContain(
      module.formatTime?.(Date.parse('2026-11-07T10:12:00.000Z'), translate) ?? '',
    )
    expect(childText(review)).toContain('.dsh/record.json')
    expect(childText(review)).toContain('codex-subagent / astra')
    expect(childText(review)).toContain('runs.status.done')
  })

  it('discards responses from a previous session generation', () => {
    const module = loadModule()
    expect(module.isStaleGeneration?.(2, 1)).toBe(true)
    expect(module.isStaleGeneration?.(1, 1)).toBe(false)
  })

  it('keeps events and runs pagination states independent', () => {
    const module = loadModule()
    const initial = {
      events: { key: 'events:5', phase: 'error', message: 'events failed' },
      runs: { key: 'runs:5', phase: 'loading' },
    }
    const afterRuns = module.updatePageState?.(initial, 'runs', undefined)
    expect(afterRuns?.events).toEqual(initial.events)
    const afterEvents = module.updatePageState?.(initial, 'events', undefined)
    expect(afterEvents?.runs).toEqual(initial.runs)
  })

  it('renders pagination with loading, retry, and end states', () => {
    const module = loadModule()
    const more = renderTree(module.LoadMore?.({ next: '5', t: translate, onLoad: () => {} }))
    expect(childText(more)).toContain('paging.more')
    const loading = module.LoadMore?.({
      next: '5',
      t: translate,
      loading: true,
      onLoad: () => {},
    })
    expect(elements(loading).some((element) => element.props.disabled === true)).toBe(true)
    const failed = renderTree(
      module.LoadMore?.({ next: '5', t: translate, error: 'page failed', onLoad: () => {} }),
    )
    expect(childText(failed)).toContain('page failed')
    expect(childText(failed)).toContain('state.retry')
    expect(module.LoadMore?.({ next: undefined, t: translate, onLoad: () => {} })).toBeNull()
  })

  it('builds document-relative API URLs and never redefines a shipped token', () => {
    const module = loadModule()
    expect(module.eventsUrl?.('session-1')).toContain('/api/workflows/events?session=session-1')
    expect(module.eventsUrl?.('session-1', '50')).toContain('cursor=50')
    expect(module.healthUrl?.('session-1')).toBe('/api/workflows/health?session=session-1')
    const css = module.VIEW_CSS ?? ''
    expect(css).not.toMatch(/--dsw-[a-z0-9-]+\s*:/u)
    expect(css).toContain('var(--dsw-')
  })
})
describe('Workflows loaded view', () => {
  it('renders definitions, receipts, runs, a violation, a malformed row, and the trigger run id', () => {
    const module = loadModule()
    const t = (key: string): string =>
      ({ 'definitions.heading': 'Definitions', 'receipts.heading': 'Receipts' })[key] ?? key
    const step = (id: string, state: string, title = id) => ({
      id,
      title,
      state,
      at: 1_762_500_000_000,
    })
    const loaded = {
      health: {
        state: 'healthy',
        listenerCount: 5,
        triggerCount: 9,
        journalWritable: true,
        lastEventAt: 1_762_500_000_000,
        lastCheckAt: 1_762_500_000_000,
        session: 'session-1',
      },
      triggers: [
        {
          id: 'change-intake',
          event: 'tool.pre-execute',
          filter: { tool: 'shell' },
          mode: 'active',
          dedupe: 'name',
        },
      ],
      events: {
        items: [
          {
            at: 1_762_500_000_000,
            kind: 'tool.pre-execute',
            subject: 'auth',
            triggers: [
              { id: 'change-intake', matched: true, reason: 'run-created', runId: 'run-created-1' },
            ],
          },
        ],
      },
      runs: {
        items: [
          {
            id: 'workflow:run-running',
            source: 'workflow',
            session: 'session-1',
            attribution: 'local',
            title: 'change-intake intake',
            startedAt: 1_762_500_000_000,
            status: 'running',
            steps: [step('requirements', 'open')],
          },
          {
            id: 'workflow:run-blocked',
            source: 'workflow',
            session: 'session-1',
            attribution: 'local',
            title: 'change-intake intake',
            startedAt: 1_762_500_000_001,
            status: 'running',
            steps: [step('spec-review', 'blocked'), step('violation:0', 'VIOLATION', 'VIOLATION')],
          },
          {
            id: 'workflow:malformed',
            source: 'workflow',
            attribution: 'unattributed',
            title: 'workflow intake',
            startedAt: 0,
            status: 'unknown',
            steps: [],
            error: 'the run record is not an object',
          },
        ],
        next: undefined,
      },
      definitions: [
        {
          id: 'change-intake',
          name: 'OpenSpec change intake',
          version: 1,
          trigger: 'tool.pre-execute',
          mode: 'active',
          gateOwnership: 'own',
          steps: [
            { id: 'requirements', title: 'Requirements', executor: 'main', ownership: 'own' },
            { id: 'spec-review', title: 'Spec review', executor: 'tool', ownership: 'defer' },
          ],
        },
      ],
      receipts: [
        {
          change: 'auth',
          kind: 'adoption',
          digest: 'a'.repeat(64),
          issuedAt: 1_762_500_000_000,
        },
      ],
    }
    const blocked = JSON.stringify(
      renderTree(
        module.WorkflowsLoaded?.({
          loaded,
          t,
          sessionId: 'session-1',
          selected: 'workflow:run-blocked',
        }) as never,
      ),
    )
    expect(blocked).toContain('Definitions')
    expect(blocked).toContain('Receipts')
    expect(blocked).toContain('workflow:run-running')
    expect(blocked).toContain('workflow:run-blocked')
    expect(blocked).toContain('VIOLATION')
    expect(blocked).toContain('run-created-1')
    expect(blocked).toContain('auth')
    const malformed = JSON.stringify(
      renderTree(
        module.WorkflowsLoaded?.({
          loaded,
          t,
          sessionId: 'session-1',
          selected: 'workflow:malformed',
        }) as never,
      ),
    )
    expect(malformed).toContain('workflow:malformed')
    expect(malformed).toContain('the run record is not an object')
  })
})
