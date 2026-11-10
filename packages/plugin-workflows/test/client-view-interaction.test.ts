import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Interaction checks for the session view's own state: the list -> detail ->
 * back path (scroll and focus restoration) and the appended-page deduplication.
 * A tiny hook runtime stands in for React so the container's hooks run without
 * a DOM renderer; the loaded components are pure and called directly.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))

type Element = { type: unknown; props: Record<string, unknown> }
const Fragment = Symbol('Fragment')
function jsx(type: unknown, props: Record<string, unknown> | null): Element {
  return { type, props: props ?? {} }
}

function sameDeps(
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return false
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

const BASE_EXTERNAL = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

interface Runtime {
  load(requireFallback?: (id: string) => unknown): Record<string, unknown>
  commit(render: () => unknown): unknown
  changed(): boolean
  settle(render: () => unknown): Promise<unknown>
}

/**
 * A tiny hook runtime: one top-level component render per commit, with real
 * effect scheduling and state updates. Nested components reached by the tree
 * walker must stay hook-free (or be replaced by a stub, as with the editor).
 */
function createRuntime(
  entry = './src/client/view.tsx',
  extraExternal: readonly string[] = [],
): Runtime {
  const states: Array<[unknown, (next: unknown) => void]> = []
  const refs: Array<{ current: unknown }> = []
  const effectDeps: Array<readonly unknown[] | undefined> = []
  let effects: Array<() => unknown> = []
  let layouts: Array<() => unknown> = []
  let index = 0
  let dirty = false

  const React = {
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
    useEffect: (callback: () => unknown, deps?: readonly unknown[]) => {
      const slot = index++
      if (sameDeps(deps, effectDeps[slot])) return
      effectDeps[slot] = deps
      effects.push(callback)
    },
    useId: () => 'id',
    useLayoutEffect: (callback: () => unknown, deps?: readonly unknown[]) => {
      const slot = index++
      if (sameDeps(deps, effectDeps[slot])) return
      effectDeps[slot] = deps
      layouts.push(callback)
    },
    useMemo: (factory: () => unknown) => factory(),
    useRef: (value: unknown) => {
      const slot = index++
      refs[slot] ??= { current: value }
      return refs[slot]
    },
    useState: (initial: unknown) => {
      const slot = index++
      states[slot] ??= [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        (next: unknown) => {
          const state = states[slot] as [unknown, (next: unknown) => void]
          state[0] =
            typeof next === 'function' ? (next as (current: unknown) => unknown)(state[0]) : next
          dirty = true
        },
      ]
      return states[slot]
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  }

  const primitives = {
    Tag: (props: Record<string, unknown>) => ({ type: 'span', props }),
    StateDot: (props: Record<string, unknown>) => ({ type: 'span', props }),
    Button: (props: Record<string, unknown>) => ({ type: 'button', props }),
    Tooltip: (props: Record<string, unknown>) => ({ type: 'span', props }),
    PathLabel: (props: Record<string, unknown>) => ({
      type: 'span',
      props: { children: props.path },
    }),
    SegmentedControl: (props: Record<string, unknown>) => ({ type: 'div', props }),
    AnimatedRows: (props: Record<string, unknown>) => ({ type: 'div', props }),
    relativeTime: (at: number, now: number) => {
      const minutes = Math.floor(Math.max(0, now - at) / 60_000)
      return minutes > 0 ? { unit: 'minutes', n: minutes } : { unit: 'now', n: 0 }
    },
  }

  const load = (requireFallback: (id: string) => unknown = () => ({})): Record<string, unknown> => {
    const result = buildSync({
      stdin: {
        contents: `export * from '${entry}'`,
        resolveDir: packageDir,
        sourcefile: 'workflows-interaction-entry.tsx',
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      external: [...BASE_EXTERNAL, ...extraExternal],
      logLevel: 'silent',
    })
    const output = result.outputFiles?.[0]
    if (output === undefined) throw new Error('the client source did not bundle')
    const module = { exports: {} as Record<string, unknown> }
    new Function('module', 'exports', 'require', output.text)(
      module,
      module.exports,
      (id: string) => {
        if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
        if (id === 'react') return React
        if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
        return requireFallback(id)
      },
    )
    return module.exports
  }

  return {
    load,
    commit(render) {
      index = 0
      effects = []
      layouts = []
      const tree = render()
      for (const effect of effects) effect()
      for (const layout of layouts) layout()
      return tree
    },
    changed() {
      const value = dirty
      dirty = false
      return value
    },
    async settle(render) {
      // Flush the asynchronous load chains: several macrotask turns, committing
      // whatever state the resolved responses produced.
      let tree = this.commit(render)
      for (let turn = 0; turn < 8; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        tree = this.commit(render)
      }
      return tree
    },
  }
}

function renderElements(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) renderElements(child, found)
    return found
  }
  const element = node as Element
  if (typeof element.type === 'function') {
    renderElements(
      (element.type as (props: Record<string, unknown>) => unknown)(element.props),
      found,
    )
    return found
  }
  if (element.type !== undefined && element.props !== undefined) {
    found.push(element)
    for (const value of Object.values(element.props)) renderElements(value, found)
  }
  return found
}

function renderText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (node === null || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(renderText).join('')
  const element = node as Element
  if (typeof element.type === 'function') {
    return renderText((element.type as (props: Record<string, unknown>) => unknown)(element.props))
  }
  return renderText(element.props?.children)
}

const NOW = 1_762_500_300_000

function run(id: string, startedAt: number): Record<string, unknown> {
  return {
    id,
    source: 'workflow',
    session: 'session-1',
    attribution: 'local',
    title: `OpenSpec change intake · ${id}`,
    startedAt,
    status: 'done',
    trigger: 'turn.stopping',
    endedAt: startedAt + 5_000,
    definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 7 },
    steps: [],
  }
}

const RUNS = [run('workflow:run-a', NOW - 120_000), run('workflow:run-b', NOW - 60_000)]
const LATER = [run('workflow:run-b', NOW - 60_000), run('workflow:run-c', NOW)]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const HEALTH = {
  state: 'healthy',
  listenerCount: 5,
  triggerCount: 9,
  journalWritable: true,
  session: 'session-1',
}

const DEFINITION = {
  id: 'change-intake',
  name: 'OpenSpec change intake',
  version: 7,
  description: 'Intake a new OpenSpec change.',
  risk: 'low',
  gateOwnership: 'own',
  trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
  steps: [
    { id: 'requirements', title: 'Requirements', executor: 'main', next: 'spec-review' },
    {
      id: 'spec-review',
      title: 'Spec review',
      executor: 'tool',
      // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
      branch: { then: 'verify', else: 'requirements' },
    },
  ],
}

const TRIGGERS = {
  triggers: [
    {
      id: 'definition:change-intake',
      event: 'turn.stopping',
      filter: {},
      mode: 'active',
      dedupe: 'turn',
      source: 'workflow-definition',
      counts: { matched: 2, total: 3 },
    },
  ],
}

const STATS = {
  stats: {
    definitions: {
      'change-intake': {
        completed: 1,
        failed: 1,
        cancelled: 0,
        interrupted: 0,
        running: 0,
        blocked: 0,
        total: 2,
      },
    },
  },
}

const HISTORY = {
  events: [
    {
      v: 1,
      at: 1,
      session: 'session-1',
      kind: 'turn.stopping',
      subject: 'turn 3',
      summary: 'the turn is stopping',
      bytes: 3,
      truncated: false,
      triggers: [
        { id: 'definition:change-intake', matched: true, reason: 'run-created', runId: 'run-w' },
        { id: 'agent-turn-stop', matched: true, reason: 'would-fire' },
      ],
    },
  ],
}

/** The initial read of the overview's own endpoints. */
function overviewResponse(url: string): Response | undefined {
  if (url.includes('/api/workflows/definitions')) {
    return url.includes('id=')
      ? json({ definition: DEFINITION, revision: null, source: 'shipped' })
      : json({ definitions: [DEFINITION] })
  }
  if (url.includes('/api/workflows/triggers')) return json(TRIGGERS)
  if (url.includes('/api/workflows/runs') && url.includes('stats=1')) return json(STATS)
  return undefined
}

/** Switch the session view to its Runs segment (the overview is the default). */
function openRunsSegment(tree: unknown): void {
  const segments = renderElements(tree).find((element) => element.props.id === 'dsh-wf-segments')
  ;(segments?.props.onChange as ((next: string) => void) | undefined)?.('runs')
}

function button(tree: unknown, text: string): Element | undefined {
  return renderElements(tree).find(
    (element) => element.type === 'button' && renderText(element) === text,
  )
}

function runButton(tree: unknown, runId: string): Element | undefined {
  return renderElements(tree).find(
    (element) => element.type === 'button' && element.props['data-run'] === runId,
  )
}

function workflowButton(tree: unknown, definitionId: string): Element | undefined {
  return renderElements(tree).find(
    (element) => element.type === 'button' && element.props['data-workflow'] === definitionId,
  )
}

const TEMP: Array<() => void> = []

afterEach(() => {
  while (TEMP.length > 0) TEMP.pop()?.()
})

interface ReadTracker {
  readonly urls: string[]
  readonly violations: string[]
}

/**
 * Install a fetch whose every call is checked for read-only traffic: only GET
 * on a workflows read endpoint is allowed. A planted write lands in
 * `violations`, so a test asserting an empty list fails.
 */
function installFetch(handler: (url: string) => Response | Promise<Response>): ReadTracker {
  const urls: string[] = []
  const violations: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET') violations.push(`${method} ${url}`)
    if (!url.startsWith('/api/workflows/')) violations.push(`non-read endpoint ${url}`)
    return handler(url)
  }) as typeof fetch
  TEMP.push(() => {
    globalThis.fetch = original
  })
  return { urls, violations }
}

describe('Workflows session view interaction', () => {
  it('fails the read-only guard on a planted write request', async () => {
    const tracker = installFetch(() => json({}))
    await fetch('/api/workflows/runs', { method: 'POST' })
    expect(tracker.violations).toEqual(['POST /api/workflows/runs'])
  })

  it('restores the list scroll and focus after Back and deduplicates an appended page', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('/api/workflows/runs')) {
        return json(url.includes('cursor=2') ? { runs: LATER } : { runs: RUNS, next: '2' })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const urls = tracker.urls
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    // The overview is the first segment and loads no journal page at all.
    expect(renderText(tree)).toContain('OpenSpec change intake')
    expect(workflowButton(tree, 'change-intake')).toBeDefined()
    expect(urls.some((url) => url.includes('/api/workflows/events'))).toBe(false)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    // The first page renders newest-first as returned.
    let rows = renderElements(tree).filter(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    // The newest-first order the API serves, applied to the loaded page.
    expect(rows.map((row) => row.props['data-run'])).toEqual(['workflow:run-b', 'workflow:run-a'])
    // Simulate a scrolled list; the row click captures the position.
    const scroll = renderElements(tree).find(
      (element) => element.props.className === 'dsh-wf-scroll',
    )
    const host = {
      scrollTop: 140,
      rows: [
        {
          getAttribute: (name: string) => (name === 'data-run' ? 'workflow:run-a' : null),
          focus: () => {},
        },
        {
          getAttribute: (name: string) => (name === 'data-run' ? 'workflow:run-b' : null),
          focus: () => focused.push('workflow:run-b'),
        },
      ] as unknown[],
      querySelectorAll: (selector: string) => {
        expect(selector).toBe('[data-run]')
        return host.rows
      },
    }
    const focused: string[] = []
    const scrollRef = scroll?.props.ref as { current: unknown } | undefined
    expect(scrollRef).toBeDefined()
    if (scrollRef !== undefined) scrollRef.current = host
    ;(rows[0]?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · v')
    host.scrollTop = 0
    const back = renderElements(tree).find(
      (element) => element.type === 'button' && renderText(element) === 'runs.back',
    )
    expect(back).toBeDefined()
    ;(back?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(host.scrollTop).toBe(140)
    expect(focused).toEqual(['workflow:run-b'])
    // Load more appends an overlapping page; each run id renders once.
    const more = renderElements(tree).find(
      (element) => element.type === 'button' && renderText(element) === 'paging.more',
    )
    expect(more).toBeDefined()
    ;(more?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    rows = renderElements(tree).filter(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    expect(rows.map((row) => row.props['data-run'])).toEqual([
      'workflow:run-c',
      'workflow:run-b',
      'workflow:run-a',
    ])
    expect(urls.some((url) => url.includes('cursor=2'))).toBe(true)
    expect(tracker.violations).toEqual([])
  })

  it('re-reads on demand and keeps the rows when a background refresh fails', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let runCalls = 0
    let fail = false
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      runCalls += 1
      if (fail) return json({ error: 'the refresh failed' }, 500)
      return json({ runs: RUNS })
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    expect(runCalls).toBe(1)
    fail = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(runCalls).toBe(2)
    const body = renderText(tree)
    // The loaded rows and the detail stay; the failure is retryable.
    expect(body).toContain('OpenSpec change intake · workflow:run-a')
    expect(body).toContain('the refresh failed')
    expect(button(tree, 'state.retry')).toBeDefined()
    expect(tracker.violations).toEqual([])
  })

  it('refreshes when the window becomes visible again', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const root = globalThis as { document?: unknown }
    const previousDocument = root.document
    const handlers: Array<() => void> = []
    root.document = {
      visibilityState: 'visible',
      addEventListener: (type: string, handler: () => void) => {
        if (type === 'visibilitychange') handlers.push(handler)
      },
      removeEventListener: () => {},
    }
    TEMP.push(() => {
      if (previousDocument === undefined) delete root.document
      else root.document = previousDocument
    })
    let runCalls = 0
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      runCalls += 1
      return json({ runs: RUNS })
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    expect(handlers).toHaveLength(1)
    expect(runCalls).toBe(1)
    handlers[0]?.()
    tree = await runtime.settle(render)
    expect(runCalls).toBe(2)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-a')
    expect(tracker.violations).toEqual([])
  })

  it('keeps a run selected when a refresh pushes it out of the window, and returns to its row', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let pageRuns: readonly Record<string, unknown>[] = RUNS
    let lookupMissing = false
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('run=workflow%3Arun-b')) {
        return json({ runs: lookupMissing ? [] : [run('workflow:run-b', NOW - 60_000)] })
      }
      if (url.includes('/api/workflows/runs')) return json({ runs: pageRuns })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    const focused: string[] = []
    const host = {
      scrollTop: 90,
      querySelectorAll: () => [
        {
          getAttribute: (name: string) => (name === 'data-run' ? 'workflow:run-b' : null),
          focus: () => focused.push('workflow:run-b'),
        },
      ],
    }
    const scrollRef = renderElements(tree).find(
      (element) => element.props.className === 'dsh-wf-scroll',
    )?.props.ref as { current: unknown } | undefined
    if (scrollRef !== undefined) scrollRef.current = host
    ;(runButton(tree, 'workflow:run-b')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-b')
    // A new run arrives first; the refreshed pages no longer contain run-b.
    pageRuns = [run('workflow:run-d', NOW + 1_000), RUNS[0] as Record<string, unknown>]
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    // The id lookup confirms run-b, so it stays selected.
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-b')
    ;(button(tree, 'runs.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    // The confirmed row is back in the list and receives focus.
    expect(runButton(tree, 'workflow:run-b')).toBeDefined()
    expect(focused).toEqual(['workflow:run-b'])
    // Re-open it, then let a later lookup confirm it is gone.
    ;(runButton(tree, 'workflow:run-b')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    lookupMissing = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('runs.missing')
    ;(button(tree, 'runs.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('workflow:run-d')
    expect(renderText(tree)).toContain('workflow:run-a')
    expect(tracker.violations).toEqual([])
  })

  it('does not let a delayed lookup overwrite a later selection', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let resolveLookup: ((value: Response) => void) | undefined
    let pageRuns: readonly Record<string, unknown>[] = RUNS
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('run=workflow%3Arun-b')) {
        return new Promise<Response>((resolve) => {
          resolveLookup = resolve
        })
      }
      if (url.includes('/api/workflows/runs')) return json({ runs: pageRuns })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    // Open the newest run; it is in the loaded page, so no lookup starts.
    ;(runButton(tree, 'workflow:run-b')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-b')
    // A refresh pushes run-b out of the page: its id lookup stays pending.
    pageRuns = [run('workflow:run-d', NOW + 1_000), RUNS[0] as Record<string, unknown>]
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(resolveLookup).toBeDefined()
    // Back, then select a different run that is already in the loaded page.
    ;(button(tree, 'runs.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    ;(runButton(tree, 'workflow:run-a')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · v7')
    // The earlier lookup now answers; it must not replace the open run.
    resolveLookup?.(json({ runs: [run('workflow:run-b', NOW - 60_000)] }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-a')
    expect(renderText(tree)).not.toContain('OpenSpec change intake · workflow:run-b')
    expect(renderText(tree)).not.toContain('runs.missing')
    expect(tracker.violations).toEqual([])
  })

  it('never shows a page that a refresh then discards', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let resolvePage: ((value: Response) => void) | undefined
    let resolveRefresh: ((value: Response) => void) | undefined
    let runCalls = 0
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      runCalls += 1
      if (runCalls === 1) return json({ runs: RUNS, next: '2' })
      if (url.includes('cursor=2')) {
        return new Promise<Response>((resolve) => {
          resolvePage = resolve
        })
      }
      return new Promise<Response>((resolve) => {
        resolveRefresh = resolve
      })
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    ;(button(tree, 'paging.more')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    // Pagination is disabled while the refresh is in flight.
    expect(button(tree, 'paging.more')?.props.disabled).toBe(true)
    resolvePage?.(json({ runs: LATER }))
    tree = await runtime.settle(render)
    resolveRefresh?.(
      json({ runs: [run('workflow:run-d', NOW + 1_000), RUNS[0] as Record<string, unknown>] }),
    )
    tree = await runtime.settle(render)
    const rows = renderElements(tree).filter(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    // The refresh's pages are the consistent result; no appended page flickers.
    expect(rows.map((row) => row.props['data-run'])).toEqual(['workflow:run-d', 'workflow:run-a'])
    expect(tracker.violations).toEqual([])
  })

  it('renders the trigger-grouped overview, then the runs feed, without a journal request', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('/api/workflows/runs')) return json({ runs: RUNS })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    const body = renderText(tree)
    expect(body).toContain('OpenSpec change intake')
    expect(body).toContain('2 / 3 overview.firings')
    expect(body).toContain('1 / 2 overview.runs')
    expect(body).toContain('definitions.mode: active')
    expect(body).toContain('turn.stopping')
    expect(workflowButton(tree, 'change-intake')).toBeDefined()
    // The overview load reads its own endpoints and never the journal.
    expect(tracker.urls.some((url) => url.includes('/api/workflows/definitions'))).toBe(true)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/triggers'))).toBe(true)
    expect(tracker.urls.some((url) => url.includes('stats=1'))).toBe(true)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/events'))).toBe(false)
    const segments = renderElements(tree).find((element) => element.props.id === 'dsh-wf-segments')
    if (segments === undefined) throw new Error('the segment control is missing')
    expect(
      (segments.props.options as Array<{ value: string }>).map((option) => option.value),
    ).toEqual(['workflows', 'runs'])
    openRunsSegment(tree)
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-a')
    expect(tracker.urls.some((url) => url.includes('/api/workflows/events'))).toBe(false)
    expect(tracker.violations).toEqual([])
  })

  it('orders delegate and review runs newest first in the runs feed', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const review = {
      ...run('review:task-review-demo', NOW - 10_000),
      source: 'review',
      trigger: undefined,
      definition: undefined,
    }
    const delegation = {
      ...run('delegation:task-review-demo', NOW - 60_000),
      source: 'delegation',
      trigger: undefined,
      definition: undefined,
    }
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      // The host serves runs oldest-first; the view applies newest-first.
      if (url.includes('/api/workflows/runs')) return json({ runs: [delegation, review] })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    const order = renderElements(tree)
      .filter((element) => element.type === 'button' && element.props['data-run'] !== undefined)
      .map((element) => element.props['data-run'])
    expect(order).toEqual(['review:task-review-demo', 'delegation:task-review-demo'])
    expect(tracker.violations).toEqual([])
  })

  it('opens the workflow page, then its run, and Back returns to the workflow page', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const current = run('workflow:run-w', NOW - 1_000)
    const older = run('workflow:run-w-old', NOW - 9_000)
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('/api/workflows/events')) return json(HISTORY)
      if (url.includes('definition=change-intake') && url.includes('cursor=2')) {
        return json({ runs: [older] })
      }
      if (url.includes('definition=change-intake')) return json({ runs: [current], next: '2' })
      if (url.includes('run=workflow%3Arun-w')) return json({ runs: [current] })
      if (url.includes('/api/workflows/runs')) return json({ runs: RUNS })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    const focused: string[] = []
    const workflowRow = {
      getAttribute: (name: string) => (name === 'data-workflow' ? 'change-intake' : null),
      focus: () => focused.push('workflow:change-intake'),
    }
    const runRow = {
      getAttribute: (name: string) => (name === 'data-run' ? 'workflow:run-w' : null),
      focus: () => focused.push('run:workflow:run-w'),
    }
    const host = {
      scrollTop: 55,
      querySelectorAll: (selector: string) =>
        selector === '[data-workflow]' ? [workflowRow] : selector === '[data-run]' ? [runRow] : [],
    }
    const scrollRef = renderElements(tree).find(
      (element) => element.props.className === 'dsh-wf-scroll',
    )?.props.ref as { current: unknown } | undefined
    if (scrollRef !== undefined)
      scrollRef.current = host
      // Open the workflow page from the overview.
    ;(workflowButton(tree, 'change-intake')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    const pageBody = renderText(tree)
    expect(pageBody).toContain('Intake a new OpenSpec change.')
    expect(pageBody).toContain('workflow.architecture')
    expect(pageBody).toContain('next: spec-review')
    expect(pageBody).toContain('workflow.history')
    expect(pageBody).toContain('run-created')
    // Another trigger id on the same event is excluded from the history.
    expect(pageBody).not.toContain('would-fire')
    expect(tracker.urls.some((url) => url.includes('/api/workflows/events'))).toBe(true)
    // The workflow page's own runs page and appended page stay newest first.
    ;(button(tree, 'paging.more')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    const runIds = renderElements(tree)
      .filter((element) => element.type === 'button' && element.props['data-run'] !== undefined)
      .map((element) => element.props['data-run'])
    expect(runIds.slice(0, 2)).toEqual(['workflow:run-w', 'workflow:run-w-old'])
    // Open a run from the workflow page: Back returns to the workflow page.
    ;(runButton(tree, 'workflow:run-w')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-w')
    expect(renderText(tree)).not.toContain('workflow.history')
    ;(button(tree, 'runs.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('workflow.history')
    expect(focused).toContain('run:workflow:run-w')
    // Back from the workflow page restores the overview row and scroll.
    ;(button(tree, 'workflow.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('overview.runs')
    expect(host.scrollTop).toBe(55)
    expect(focused).toContain('workflow:change-intake')
    expect(tracker.violations).toEqual([])
  })

  it('keeps the open workflow page when its refresh fails', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let failPage = false
    const tracker = installFetch((url) => {
      if (failPage && url.includes('/api/workflows/definitions') && url.includes('id=')) {
        return json({ error: 'the page refresh failed' }, 500)
      }
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('/api/workflows/events')) return json(HISTORY)
      if (url.includes('definition=change-intake'))
        return json({ runs: [run('workflow:run-w', NOW)] })
      if (url.includes('/api/workflows/runs')) return json({ runs: RUNS })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    ;(workflowButton(tree, 'change-intake')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('Intake a new OpenSpec change.')
    failPage = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    const body = renderText(tree)
    expect(body).toContain('Intake a new OpenSpec change.')
    expect(body).toContain('workflow.history')
    expect(body).toContain('the page refresh failed')
    expect(button(tree, 'state.retry')).toBeDefined()
    expect(tracker.violations).toEqual([])
  })

  it('loads the definition, trigger, and receipt sections from the read-only endpoints', async () => {
    const runtime = createRuntime('./src/client/design-page.tsx')
    const module = runtime.load() as {
      DesignPageBody?: (props: Record<string, unknown>) => unknown
    }
    const tracker = installFetch((url) => {
      if (url.includes('/api/workflows/definitions')) {
        return json({
          definitions: [
            {
              id: 'change-intake',
              name: 'OpenSpec change intake',
              version: 1,
              trigger: { kind: 'tool.pre-execute', mode: 'active', dedupe: 'name' },
              risk: 'low',
              allowModelStart: false,
              gateOwnership: 'own',
              steps: [
                {
                  id: 'requirements',
                  title: 'Requirements',
                  executor: 'main',
                  ownership: 'own',
                  blockTurnClose: true,
                },
              ],
            },
          ],
        })
      }
      if (url.includes('/api/workflows/triggers')) {
        return json({
          triggers: [
            {
              id: 'change-intake',
              event: 'tool.pre-execute',
              filter: { tool: 'shell' },
              mode: 'active',
              dedupe: 'name',
              last: { at: 1, matched: true, reason: 'run-created' },
            },
          ],
        })
      }
      if (url.includes('/api/workflows/receipts')) {
        return json({
          receipts: [{ change: 'auth', kind: 'adoption', digest: 'a'.repeat(64), issuedAt: 1 }],
        })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const body = module.DesignPageBody
    if (body === undefined) throw new Error('DesignPageBody is not exported')
    const render = (): unknown =>
      body({
        sessionId: 'session-1',
        t: (key: string) => key,
        dirtyKey: 'session-1:tab-1',
        close: () => {},
      })
    const tree = await runtime.settle(render)
    expect(tracker.urls).toHaveLength(3)
    const text = renderText(tree)
    expect(text).toContain('change-intake')
    expect(text).toContain('tool.pre-execute')
    expect(text).toContain('run-created')
    expect(text).toContain('auth')
    expect(text).toContain('adoption')
    expect(text).toContain('design.intro')
    expect(tracker.urls).toHaveLength(3)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/definitions'))).toBe(true)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/triggers'))).toBe(true)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/receipts'))).toBe(true)
    expect(tracker.violations).toEqual([])
  })

  it('keeps newest-first order after Back reinsertion and a later page', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const newer = run('workflow:run-d', NOW)
    const middle = run('workflow:run-c', NOW - 10_000)
    const older = run('workflow:run-b', NOW - 20_000)
    const oldest = run('workflow:run-a', NOW - 30_000)
    let pageRuns: readonly Record<string, unknown>[] = [newer, middle]
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('run=workflow%3Arun-c')) return json({ runs: [middle] })
      if (url.includes('cursor=2')) return json({ runs: [older, oldest] })
      return json({ runs: pageRuns, next: '2' })
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    const rowIds = (tree: unknown): unknown[] =>
      renderElements(tree)
        .filter((element) => element.type === 'button' && element.props['data-run'] !== undefined)
        .map((element) => element.props['data-run'])
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    expect(rowIds(tree)).toEqual(['workflow:run-d', 'workflow:run-c'])
    // Open a run from the loaded page, then push it out of the refreshed window.
    ;(runButton(tree, 'workflow:run-c')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-c')
    pageRuns = [newer]
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    // The id lookup confirms it, so it stays selected through the refresh.
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-c')
    ;(button(tree, 'runs.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(rowIds(tree)).toEqual(['workflow:run-d', 'workflow:run-c'])
    // The next page carries older runs; newest first survives the reinsertion.
    ;(button(tree, 'paging.more')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(rowIds(tree)).toEqual([
      'workflow:run-d',
      'workflow:run-c',
      'workflow:run-b',
      'workflow:run-a',
    ])
    expect(tracker.violations).toEqual([])
  })

  it('restores the originating row when Back is pressed before the lookup answers', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let resolveLookup: ((value: Response) => void) | undefined
    let pageRuns: readonly Record<string, unknown>[] = RUNS
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('run=workflow%3Arun-b')) {
        return new Promise<Response>((resolve) => {
          resolveLookup = resolve
        })
      }
      if (url.includes('/api/workflows/runs')) return json({ runs: pageRuns })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    const focused: string[] = []
    let tree = await runtime.settle(render)
    openRunsSegment(tree)
    tree = runtime.commit(render)
    const scrollRef = renderElements(tree).find(
      (element) => element.props.className === 'dsh-wf-scroll',
    )?.props.ref as { current: unknown } | undefined
    if (scrollRef !== undefined) {
      scrollRef.current = {
        scrollTop: 70,
        querySelectorAll: () => [
          {
            getAttribute: (name: string) => (name === 'data-run' ? 'workflow:run-b' : null),
            focus: () => focused.push('workflow:run-b'),
          },
        ],
      }
    }
    // The newest-first page is [run-b, run-a]; open run-b from the list.
    ;(runButton(tree, 'workflow:run-b')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-b')
    // A refresh replaces the window; the selected run's lookup stays pending.
    pageRuns = [run('workflow:run-d', NOW + 1_000), RUNS[0] as Record<string, unknown>]
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(resolveLookup).toBeDefined()
    // Back before the answer: the known record restores the row and focus.
    ;(button(tree, 'runs.back')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(runButton(tree, 'workflow:run-b')).toBeDefined()
    expect(focused).toEqual(['workflow:run-b'])
    // The late answer is discarded; the list stays.
    resolveLookup?.(json({ runs: [RUNS[1]] }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('workflow:run-d')
    expect(renderText(tree)).not.toContain('runs.steps')
    expect(tracker.violations).toEqual([])
  })
})
