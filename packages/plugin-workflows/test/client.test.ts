import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  DESIGN_ID?: string
  DESIGN_KIND?: string
  DESIGN_SERVICES?: readonly string[]
  apply?: (ctx: unknown) => void
  registerDesignPage?: (ctx: unknown) => void
  DesignPage?: (props: Record<string, unknown>) => unknown
  DesignPageBody?: (props: Record<string, unknown>) => unknown
  closeWithGuard?: (state: { dirty: boolean }, ask: () => boolean) => void
  designTabKey?: (sessionId: string, tabId: string) => string
  setDesignDirty?: (key: string, dirty: boolean) => void
  isDesignDirty?: (key: string) => boolean
  closeDesignOnTabClose?: (t: (key: string) => string, key: string) => void
  WorkflowsView?: (props: Record<string, unknown>) => unknown
  WorkflowsLoaded?: (props: Record<string, unknown>) => unknown
  StatusLine?: (props: Record<string, unknown>) => unknown
  RunList?: (props: Record<string, unknown>) => unknown
  JournalList?: (props: Record<string, unknown>) => unknown
  RunDetailPage?: (props: Record<string, unknown>) => unknown
  MissingRunPage?: (props: Record<string, unknown>) => unknown
  TriggersTable?: (props: Record<string, unknown>) => unknown
  ErrorLine?: (props: Record<string, unknown>) => unknown
  LoadingLine?: (props: Record<string, unknown>) => unknown
  LoadMore?: (props: Record<string, unknown>) => unknown
  formatTime?: (at: number | undefined, t: unknown) => string
  reasonLabel?: (reason: string, t: unknown) => string
  statusDetails?: (health: Record<string, unknown>, t: unknown) => string
  durationText?: (startedAt: number, endedAt: number | undefined) => string | undefined
  relativeLabel?: (bucket: { unit: string; n: number }, t: unknown) => string
  isStaleGeneration?: (requested: number, current: number) => boolean
  updatePageState?: (
    states: Record<string, unknown>,
    kind: 'events' | 'runs',
    value: unknown,
  ) => Record<string, unknown>
  dedupeRuns?: (runs: readonly Record<string, unknown>[]) => readonly Record<string, unknown>[]
  restoreListPosition?: (host: unknown, runId: string, scrollTop: number) => void
  readRuns?: (
    session: string,
    pages: number,
  ) => Promise<{ items: Array<Record<string, unknown>>; next?: string }>
  VIEW_CSS?: string
  eventsUrl?: (session: string, cursor?: string) => string
  runsUrl?: (
    session: string,
    cursor?: string,
    limit?: number,
    options?: Record<string, unknown>,
  ) => string
  healthUrl?: (session: string) => string
}

interface ConfirmControl {
  answer: boolean
  prompts: number
}

function loadModule(confirmControl: ConfirmControl = { answer: false, prompts: 0 }): LoadedModule {
  const result = buildSync({
    stdin: {
      contents: `export * from './src/client/index.tsx'
export * from './src/client/panel.tsx'
export * from './src/client/view.tsx'
export * from './src/client/run-history.tsx'
export * from './src/client/run-detail.tsx'
export * from './src/client/design-page.tsx'
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
    confirm: () => {
      confirmControl.prompts += 1
      return confirmControl.answer
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
        Component: class {},
        createContext: (value: unknown) => ({
          Provider: (props: unknown) => props,
          Consumer: () => null,
          _currentValue: value,
        }),
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
          type,
          props: { ...(props as Record<string, unknown>), children },
        }),
        forwardRef: (render: unknown) => render,
        memo: (component: unknown) => component,
        useCallback: (callback: unknown) => callback,
        useContext: (context: { _currentValue?: unknown }) => context?._currentValue,
        useEffect: () => {},
        useId: () => 'id',
        useLayoutEffect: () => {},
        useMemo: (factory: () => unknown) => factory(),
        useRef: (value: unknown) => ({ current: value }),
        useState: (initial: unknown) => [
          typeof initial === 'function' ? (initial as () => unknown)() : initial,
          () => {},
        ],
        useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
      }
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        Tag: (props: Record<string, unknown>) => ({ type: 'span', props }),
        StateDot: (props: Record<string, unknown>) => ({ type: 'span', props }),
        Button: (props: Record<string, unknown>) => ({ type: 'button', props }),
        Tooltip: (props: Record<string, unknown>) => ({ type: 'span', props }),
        PathLabel: (props: Record<string, unknown>) => ({
          type: 'span',
          props: { children: props.path },
        }),
        SegmentedControl: (props: Record<string, unknown>) => ({ type: 'div', props }),
        Menu: (props: Record<string, unknown>) => ({ type: 'menu', props }),
        DisclosureRow: (props: Record<string, unknown>) => ({ type: 'disclosure', props }),
        Pill: (props: Record<string, unknown>) => ({ type: 'span', props }),
        AnimatedRows: (props: Record<string, unknown>) => ({ type: 'div', props }),
        relativeTime: (at: number, now: number) => {
          const minutes = Math.floor(Math.max(0, now - at) / 60_000)
          return minutes > 0 ? { unit: 'minutes', n: minutes } : { unit: 'now', n: 0 }
        },
      }
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

const NOW = 1_762_500_300_000

function runView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'workflow:run-1',
    source: 'workflow',
    session: 'session-1',
    attribution: 'local',
    title: 'OpenSpec change intake · auth',
    startedAt: 1_762_500_000_000,
    status: 'done',
    trigger: 'tool.pre-execute',
    endedAt: 1_762_500_060_000,
    steps: [
      {
        id: 'requirements',
        title: 'Requirements',
        state: 'done',
        at: 1_762_500_030_000,
        evidenceRef: { kind: 'record', ref: '.dsh/delegation/record.json' },
      },
      {
        id: 'spec-review',
        title: 'Spec review',
        state: 'blocked',
        at: 1_762_500_060_000,
        failureClass: 'no-call',
        reason: 'the tool was not observed',
      },
    ],
    violations: [{ stepId: 'spec-review', at: 1_762_500_060_000, reason: 'the step bypassed' }],
    definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 7 },
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

  it('renders the four listener states on one status line with details on demand', () => {
    const module = loadModule()
    let refreshed = 0
    for (const state of ['listener-down', 'journal-readonly', 'waiting', 'healthy']) {
      const rendered = renderTree(
        module.StatusLine?.({
          health: health({ state }),
          t: translate,
          onRefresh: () => (refreshed += 1),
        }),
      )
      expect(childText(rendered)).toContain(`health.${state}`)
      expect(elements(rendered).some((element) => element.props['data-state'] === state)).toBe(true)
    }
    const failed = health({ state: 'listener-down', lastError: 'registration threw' })
    expect(module.statusDetails?.(failed, translate)).toContain('registration threw')
    expect(module.statusDetails?.(failed, translate)).toContain('5 health.listeners')
    expect(module.statusDetails?.(failed, translate)).toContain('9 health.triggers')
    const rendered = renderTree(module.StatusLine?.({ health: failed, t: translate }))
    const tooltip = elements(rendered).find((element) =>
      String(element.props.label).includes('registration threw'),
    )
    expect(tooltip).toBeDefined()
    const refresh = elements(
      renderTree(
        module.StatusLine?.({
          health: health(),
          t: translate,
          onRefresh: () => (refreshed += 1),
        }),
      ),
    ).find((element) => element.type === 'button' && childText(element) === 'state.refresh')
    ;(refresh?.props.onClick as (() => void) | undefined)?.()
    expect(refreshed).toBe(1)
    expect(
      childText(
        renderTree(
          module.StatusLine?.({
            health: health(),
            t: translate,
            refreshing: true,
            onRefresh: () => {},
          }),
        ),
      ),
    ).toContain('state.refreshing')
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
    expect(text).toContain('would-fire')
    const empty = renderTree(module.TriggersTable?.({ triggers: [], t: translate }))
    expect(childText(empty)).toContain('triggers.empty')
  })

  it('renders each event’s evaluations inline and links only an evaluation with a run id', () => {
    const module = loadModule()
    let opened: string | undefined
    const events = [
      {
        v: 1,
        at: 1,
        session: 'session-1',
        kind: 'tool.pre-execute',
        subject: 'shell',
        summary: 'ran a shell call',
        bytes: 20,
        truncated: true,
        triggers: [
          { id: 'change-intake', matched: true, reason: 'run-created', runId: 'run-1' },
          { id: 'openspec-tasks-checked', matched: true, reason: 'would-fire' },
          {
            id: 'task-review',
            matched: false,
            reason: 'run-suppressed',
            detail: 'the run limit was reached',
          },
          { id: 'verify', matched: false, reason: 'not-applicable' },
          {
            id: 'delegate-result',
            matched: false,
            reason: 'filter-mismatch',
            path: 'src/index.ts',
            filter: 'path: openspec/changes/**',
          },
        ],
      },
    ]
    const rendered = renderTree(
      module.JournalList?.({
        events,
        t: translate,
        onOpenRun: (runId: string) => (opened = runId),
      }),
    )
    const text = childText(rendered)
    expect(text).toContain('run-created')
    expect(text).toContain('would-fire')
    expect(text).toContain('run-suppressed')
    expect(text).toContain('not-applicable')
    expect(text).toContain('the run limit was reached')
    expect(text).toContain('src/index.ts')
    expect(text).toContain('openspec/changes/**')
    expect(text).toContain('events.truncated')
    const links = elements(rendered).filter(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.props['data-run']).toBe('workflow:run-1')
    ;(links[0]?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toBe('workflow:run-1')
    expect(childText(renderTree(module.JournalList?.({ events: [], t: translate })))).toContain(
      'events.empty',
    )
  })

  it('renders the newest-first run rows with the title, trigger, status, and duration', () => {
    const module = loadModule()
    const opened: string[] = []
    const runs = [
      runView({ id: 'workflow:run-2', startedAt: NOW - 120_000, endedAt: NOW - 60_000 }),
      runView({
        id: 'delegation:run-1',
        source: 'delegation',
        title: 'task-review redesign-workflows-ui',
        trigger: undefined,
        endedAt: undefined,
        definition: undefined,
      }),
    ] as unknown as readonly Record<string, unknown>[]
    const list = renderTree(
      module.RunList?.({
        runs,
        t: translate,
        now: NOW,
        onOpen: (runId: string) => opened.push(runId),
      }),
    )
    const text = childText(list)
    expect(text).toContain('OpenSpec change intake · auth')
    expect(text).toContain('runs.trigger: tool.pre-execute')
    expect(text).toContain('runs.status.done')
    expect(text).toContain('runs.source.delegation')
    const buttons = elements(list).filter(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    expect(buttons.map((button) => button.props['data-run'])).toEqual([
      'workflow:run-2',
      'delegation:run-1',
    ])
    ;(buttons[0]?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual(['workflow:run-2'])
    expect(module.durationText?.(1_000, 61_000)).toBe('1m 0s')
    expect(module.durationText?.(1_000, undefined)).toBeUndefined()
    const durations = elements(list).filter(
      (element) => element.props['data-duration'] !== undefined,
    )
    expect(durations.map((element) => element.props['data-duration'])).toEqual(['1m 0s'])
    // The relative start label is visible and the absolute time is its hover copy.
    expect(childText(list)).toContain('2time.minutes')
    expect(
      elements(list).some(
        (element) => element.props.label === new Date(NOW - 120_000).toLocaleString(),
      ),
    ).toBe(true)
    expect(elements(list).filter((element) => element.props.state === 'done').length).toBe(2)
    expect(childText(renderTree(module.RunList?.({ runs: [], t: translate, now: NOW })))).toContain(
      'runs.empty',
    )
  })

  it('renders one run’s detail page with identity, trigger, times, steps, and violations', () => {
    const module = loadModule()
    let backed = 0
    const detail = renderTree(
      module.RunDetailPage?.({
        run: runView(),
        t: translate,
        session: 'session-1',
        onBack: () => (backed += 1),
      }),
    )
    const text = childText(detail)
    expect(text).toContain('OpenSpec change intake · auth')
    expect(text).toContain('OpenSpec change intake · v7')
    expect(text).toContain('tool.pre-execute')
    expect(text).toContain('runs.ended')
    expect(text).toContain('1m 0s')
    expect(text).toContain('no-call')
    expect(text).toContain('the tool was not observed')
    expect(text).toContain('the step bypassed')
    expect(text).toContain('runs.violations')
    const link = elements(detail).find(
      (element) => element.type === 'a' && element.props['data-evidence-kind'] === 'record',
    )
    expect(String(link?.props.href)).toContain('/api/workflows/evidence')
    expect(String(link?.props.href)).toContain('.dsh%2Fdelegation%2Frecord.json')
    const back = elements(detail).find((element) => element.type === 'button')
    ;(back?.props.onClick as (() => void) | undefined)?.()
    expect(backed).toBe(1)
    const unreadable = renderTree(
      module.RunDetailPage?.({
        run: runView({
          title: 'Unreadable workflow record',
          definition: undefined,
          trigger: undefined,
          endedAt: undefined,
          steps: [],
          violations: undefined,
          error: 'bad JSON',
        }),
        t: translate,
        onBack: () => {},
      }),
    )
    expect(childText(unreadable)).toContain('bad JSON')
    expect(childText(unreadable)).toContain('runs.source.workflow')
  })

  it('renders a confirmed-absent run with the back control', () => {
    const module = loadModule()
    let backed = 0
    const rendered = renderTree(
      module.MissingRunPage?.({ t: translate, onBack: () => (backed += 1) }),
    )
    expect(childText(rendered)).toContain('runs.missing')
    const back = elements(rendered).find((element) => element.type === 'button')
    ;(back?.props.onClick as (() => void) | undefined)?.()
    expect(backed).toBe(1)
  })

  it('restores the list scroll position and focus to the originating row', () => {
    const module = loadModule()
    const focused: string[] = []
    const row = (runId: string): Record<string, unknown> => ({
      getAttribute: (name: string) => (name === 'data-run' ? runId : null),
      focus: (options?: { preventScroll?: boolean }) =>
        focused.push(`${runId}:${options?.preventScroll === true ? 'no-scroll' : 'scroll'}`),
    })
    const quoted = 'workflow:run-"quoted"\\path'
    const host = {
      scrollTop: 0,
      querySelectorAll: (selector: string) => {
        expect(selector).toBe('[data-run]')
        return [row('workflow:run-2'), row(quoted)]
      },
    }
    module.restoreListPosition?.(host, quoted, 320)
    expect(host.scrollTop).toBe(320)
    expect(focused).toEqual([`${quoted}:no-scroll`])
    expect(() => module.restoreListPosition?.(null, 'workflow:run-1', 320)).not.toThrow()
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

  it('deduplicates appended runs and re-reads the loaded pages newest first', async () => {
    const module = loadModule()
    const first = [
      { id: 'workflow:run-2', title: 'two' },
      { id: 'workflow:run-1', title: 'one' },
    ]
    expect(
      module.dedupeRuns?.([...first, first[1] as Record<string, unknown>])?.map((run) => run.id),
    ).toEqual(['workflow:run-2', 'workflow:run-1'])
    const urls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: unknown, init?: Record<string, unknown>) => {
      expect(init?.method ?? 'GET').toBe('GET')
      const url = String(input)
      urls.push(url)
      const body = url.includes('cursor=2') ? { runs: [first[1]] } : { runs: first, next: '2' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const page = await module.readRuns?.('session-1', 2)
      expect(page?.items.map((run) => run.id)).toEqual(['workflow:run-2', 'workflow:run-1'])
      expect(page?.next).toBeUndefined()
    } finally {
      globalThis.fetch = original
    }
    expect(urls).toHaveLength(2)
    expect(urls.every((url) => url.includes('order=newest'))).toBe(true)
    expect(urls[1]).toContain('cursor=2')
  })

  it('builds document-relative API URLs and never redefines a shipped token', () => {
    const module = loadModule()
    expect(module.eventsUrl?.('session-1')).toContain('/api/workflows/events?session=session-1')
    expect(module.eventsUrl?.('session-1', '50')).toContain('cursor=50')
    expect(module.healthUrl?.('session-1')).toBe('/api/workflows/health?session=session-1')
    expect(module.runsUrl?.('session-1', undefined, 5, { order: 'newest' })).toContain(
      'order=newest',
    )
    expect(module.runsUrl?.('session-1', undefined, 5, { run: 'workflow:run-1' })).toContain(
      'run=workflow%3Arun-1',
    )
    const css = module.VIEW_CSS ?? ''
    expect(css).not.toMatch(/--dsw-[a-z0-9-]+\s*:/u)
    expect(css).toContain('var(--dsw-')
  })

  it('renders every dynamic state with dictionary-backed copy', () => {
    const module = loadModule()
    const dictionary = module.EN ?? {}
    const strict = (key: string): string => {
      const value = dictionary[key]
      // A missing key would render raw in the view; fail loudly instead.
      if (value === undefined) throw new Error(`missing locale key: ${key}`)
      return value
    }
    for (const state of ['listener-down', 'journal-readonly', 'waiting', 'healthy']) {
      renderTree(module.StatusLine?.({ health: health({ state }), t: strict }))
    }
    for (const status of ['running', 'done', 'failed', 'unknown']) {
      renderTree(module.RunList?.({ runs: [runView({ status })], t: strict, now: NOW }))
    }
    for (const source of ['checkpoint', 'delegation', 'review', 'workflow']) {
      renderTree(
        module.RunList?.({
          runs: [runView({ trigger: undefined, source })],
          t: strict,
          now: NOW,
        }),
      )
      renderTree(
        module.RunDetailPage?.({
          run: runView({ source, definition: undefined }),
          t: strict,
          onBack: () => {},
        }),
      )
    }
    const reasons = [
      'would-fire',
      'event-mismatch',
      'filter-mismatch',
      'dedupe',
      'disabled',
      'not-ready',
      'error',
      'run-created',
      'run-suppressed',
      'not-applicable',
    ]
    renderTree(
      module.JournalList?.({
        events: [
          {
            v: 1,
            at: 1,
            session: 'session-1',
            kind: 'tool.pre-execute',
            subject: 'shell',
            summary: 'ran a shell call',
            bytes: 3,
            truncated: false,
            triggers: reasons.map((reason) => ({ id: `trigger-${reason}`, matched: true, reason })),
          },
        ],
        t: strict,
      }),
    )
    for (const unit of ['now', 'minutes', 'hours', 'days', 'months', 'years']) {
      expect(module.relativeLabel?.({ unit, n: 2 }, strict)).toBeDefined()
    }
  })
})

describe('Workflows loaded view', () => {
  const loaded = {
    health: health(),
    events: {
      items: [
        {
          v: 1,
          at: 1,
          session: 'session-1',
          kind: 'tool.pre-execute',
          subject: 'shell',
          summary: 'ran a shell call',
          bytes: 20,
          truncated: false,
          triggers: [{ id: 'change-intake', matched: true, reason: 'run-created', runId: 'run-1' }],
        },
      ],
    },
    runs: { items: [runView()] },
  }

  it('renders the runs first and no catalog or authoring section', () => {
    const module = loadModule()
    const tree = renderTree(
      module.WorkflowsLoaded?.({ loaded, t: translate, sessionId: 'session-1', now: NOW }),
    )
    expect(childText(tree)).toContain('OpenSpec change intake · auth')
    const treeElements = elements(tree)
    for (const section of ['definitions', 'triggers', 'receipts', 'why-not']) {
      expect(treeElements.some((element) => element.props['data-section'] === section)).toBe(false)
    }
    expect(treeElements.some((element) => element.props['data-view'] === 'list')).toBe(true)
    // A failed background refresh keeps the list and offers a retry.
    const failedRefresh = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        refreshError: 'the refresh failed',
        onRetryRefresh: () => {},
        now: NOW,
      }),
    )
    expect(childText(failedRefresh)).toContain('OpenSpec change intake · auth')
    expect(childText(failedRefresh)).toContain('the refresh failed')
    expect(
      elements(failedRefresh).some(
        (element) => element.type === 'button' && childText(element) === 'state.retry',
      ),
    ).toBe(true)
  })

  it('renders the journal segment with evaluations inline', () => {
    const module = loadModule()
    const opened: string[] = []
    const tree = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        segment: 'journal',
        onOpenRun: (runId: string) => opened.push(runId),
      }),
    )
    const text = childText(tree)
    expect(text).toContain('ran a shell call')
    expect(text).toContain('run-created')
    const link = elements(tree).find(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    ;(link?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual(['workflow:run-1'])
  })

  it('opens the selected run’s detail and returns to the list', () => {
    const module = loadModule()
    let backed = 0
    const tree = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        selected: 'workflow:run-1',
        now: NOW,
        onBack: () => (backed += 1),
      }),
    )
    const text = childText(tree)
    expect(text).toContain('OpenSpec change intake · v7')
    expect(text).toContain('runs.steps')
    expect(elements(tree).some((element) => element.props['data-view'] === 'detail')).toBe(true)
    const back = elements(tree).find(
      (element) => element.type === 'button' && childText(element) === 'runs.back',
    )
    ;(back?.props.onClick as (() => void) | undefined)?.()
    expect(backed).toBe(1)
  })

  it('renders a run resolved outside the pages and a confirmed lookup miss', () => {
    const module = loadModule()
    const resolved = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        selected: 'workflow:run-outside',
        detail: runView({ id: 'workflow:run-outside', title: 'Work checkpoint · turn 6' }),
        now: NOW,
      }),
    )
    expect(childText(resolved)).toContain('Work checkpoint · turn 6')
    const absent = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        selected: 'workflow:run-outside',
        missing: true,
        onBack: () => {},
      }),
    )
    expect(childText(absent)).toContain('runs.missing')
    const failed = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        selected: 'workflow:run-outside',
        detailError: 'the request failed',
        onRetryDetail: () => {},
      }),
    )
    expect(childText(failed)).toContain('the request failed')
    expect(childText(failed)).toContain('state.retry')
    // The Back control survives a pending and a failed lookup.
    const backButtons = elements(failed).filter(
      (element) => element.type === 'button' && childText(element) === 'runs.back',
    )
    expect(backButtons).toHaveLength(1)
    const pending = renderTree(
      module.WorkflowsLoaded?.({
        loaded,
        t: translate,
        sessionId: 'session-1',
        selected: 'workflow:run-outside',
        onBack: () => {},
      }),
    )
    expect(
      elements(pending).some(
        (element) => element.type === 'button' && childText(element) === 'runs.back',
      ),
    ).toBe(true)
    expect(childText(pending)).toContain('state.loading')
  })
})

describe('Workflow design page', () => {
  function noopEffect(callback: () => () => void): () => void {
    callback()
    return () => {}
  }

  it('registers the page type, guide card, body, and close handler with the sidebar services', () => {
    const module = loadModule()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tabs: Array<Record<string, unknown>> = []
    const bodies: Array<Record<string, unknown>> = []
    const sidebarSlots: string[] = []
    const closeKinds: string[] = []
    const locale = {
      register: () => () => {},
      bind: () => (key: string) => key,
    }
    const viewSlots = {
      inject: (_key: string, callback: () => () => void) => noopEffect(callback),
      register: () => () => {},
    }
    const slots = {
      inject: (key: string, callback: () => () => void) => {
        sidebarSlots.push(key)
        return noopEffect(callback)
      },
      register: (options: Record<string, unknown>) => {
        bodies.push(options)
        return () => {}
      },
    }
    const tabsService = {
      register: (definition: Record<string, unknown>) => {
        tabs.push(definition)
        return () => {}
      },
    }
    const sidebarRight = {
      registerCloseHandler: (kind: string) => {
        closeKinds.push(kind)
        return () => {}
      },
    }
    let injected: readonly string[] = []
    // A pending inject means the sidebar services are absent: view only, no error.
    module.apply?.({
      get: (name: string) => (name === 'resources' ? {} : undefined),
      effect: noopEffect,
      locale,
      slots: viewSlots,
      inject: (deps: readonly string[]) => {
        injected = deps
        return () => {}
      },
    })
    expect(injected).toEqual(module.DESIGN_SERVICES)
    expect(tabs).toEqual([])
    expect(errors).not.toHaveBeenCalled()
    // Present sidebar services: the page registers next to the session view.
    module.apply?.({
      get: (name: string) => (name === 'resources' ? {} : undefined),
      effect: noopEffect,
      locale,
      slots: viewSlots,
      inject: (_deps: readonly string[], callback: (ctx: unknown) => void) => {
        callback({
          get: (name: string) =>
            ({ sidebarRightTabs: tabsService, sidebarRight, slots, locale, resources: {} })[name],
          effect: noopEffect,
        })
        return () => {}
      },
    })
    expect(tabs).toHaveLength(1)
    const tabDefinition = tabs[0]
    expect(tabDefinition).toBeDefined()
    expect(tabDefinition?.id).toBe(module.DESIGN_ID)
    expect(tabDefinition?.kind).toBe(module.DESIGN_KIND)
    // Hiding a tab unmounts an unretained body and loses the unsaved draft.
    expect(tabDefinition?.keepMounted).toBe(true)
    const title = tabDefinition?.title as (() => string) | undefined
    expect(title?.()).toBe('design.pageTitle')
    const guide = tabDefinition?.guide as
      | Array<{ title: () => string; description?: () => string }>
      | undefined
    expect(guide?.[0]?.title()).toBe('design.guideTitle')
    expect(guide?.[0]?.description?.()).toBe('design.guideDescription')
    expect(sidebarSlots).toEqual(['sidebar.right.pane.tab'])
    expect(bodies[0]?.name).toBe('sidebar.right.pane.tab')
    expect(bodies[0]?.key).toBe(module.DESIGN_ID)
    expect(closeKinds).toEqual([module.DESIGN_KIND])
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('renders the editor and the read-only workspace sections on the page', () => {
    const module = loadModule()
    const tree = renderTree(
      module.DesignPageBody?.({
        sessionId: 'session-1',
        t: translate,
        dirtyKey: 'session-1:tab-1',
        close: () => {},
      }),
    )
    const text = childText(tree)
    expect(text).toContain('design.intro')
    expect(text).toContain('definitions.heading')
    expect(text).toContain('triggers.title')
    expect(text).toContain('receipts.heading')
    expect(elements(tree).some((element) => element.type === 'menu')).toBe(true)
  })

  it('closes the tab from the page and asks only for a dirty draft', () => {
    const module = loadModule()
    let closed = 0
    const tree = renderTree(
      module.DesignPage?.({
        sessionId: 'session-1',
        t: translate,
        useTabInfo: () => ({ tab: { id: 'tab-1', actions: { close: () => (closed += 1) } } }),
      }),
    )
    const closeButton = elements(tree).find(
      (element) => element.type === 'button' && childText(element) === 'design.close',
    )
    expect(closeButton).toBeDefined()
    ;(closeButton?.props.onClick as (() => void) | undefined)?.()
    expect(closed).toBe(1)
    let asked = 0
    module.closeWithGuard?.({ dirty: false }, () => {
      asked += 1
      return true
    })
    expect(asked).toBe(0)
    module.closeWithGuard?.({ dirty: true }, () => {
      asked += 1
      return true
    })
    expect(asked).toBe(1)
    expect(() =>
      module.closeWithGuard?.({ dirty: true }, () => {
        asked += 1
        return false
      }),
    ).toThrow()
    expect(asked).toBe(2)
  })

  it('scopes the editor connect shortcut to its root, never the window', () => {
    const source = readFileSync(join(packageDir, 'src', 'client', 'design.tsx'), 'utf8')
    // Keep-mounted pages coexist; a hidden editor must not hear the visible one.
    expect(source).not.toMatch(/window\.addEventListener\('keydown'/)
    expect(source).toMatch(/root = useRef<HTMLDivElement \| null>\(null\)/)
    expect(source).toMatch(/element\.addEventListener\('keydown', onKeyDown\)/)
  })

  it('renders every action through a shared primitive, with no ad-hoc focus ring', () => {
    const dir = join(packageDir, 'src', 'client')
    for (const file of readdirSync(dir).filter(
      (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
    )) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/<button\b/)
      expect(source, file).not.toMatch(/\boutline:/)
    }
  })

  it('tracks the dirty flag per tab occurrence', () => {
    const control = { answer: false, prompts: 0 }
    const module = loadModule(control)
    const keyOf = module.designTabKey
    if (keyOf === undefined) throw new Error('designTabKey is not exported')
    const dirty = keyOf('session-1', 'tab-a')
    const clean = keyOf('session-1', 'tab-b')
    module.setDesignDirty?.(dirty, true)
    expect(module.isDesignDirty?.(dirty)).toBe(true)
    expect(module.isDesignDirty?.(clean)).toBe(false)
    // The clean page closes without a prompt even while another is dirty.
    expect(() => module.closeDesignOnTabClose?.(translate, clean)).not.toThrow()
    expect(control.prompts).toBe(0)
    // The dirty page asks; a declined prompt keeps the tab and its dirty state.
    expect(() => module.closeDesignOnTabClose?.(translate, dirty)).toThrow()
    expect(control.prompts).toBe(1)
    expect(module.isDesignDirty?.(dirty)).toBe(true)
    control.answer = true
    expect(() => module.closeDesignOnTabClose?.(translate, dirty)).not.toThrow()
    expect(control.prompts).toBe(2)
  })
})
