import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeIdOf } from '../src/client/graph.ts'

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

/** The shipped icons the workbench renders; the test tree only needs elements. */
const iconStubs = Object.fromEntries(
  [
    'IconPlayOutlineRegular',
    'IconSparkleRegular',
    'IconCodeOutlineRegular',
    'IconUsersOutlineRegular',
    'IconUserOutlineRegular',
    'IconBranchOutlineRegular',
    'IconRefreshOutlineRegular',
    'IconPlusOutlineRegular',
    'IconEllipsisOutlineRegular',
    'IconCloseOutlineRegular',
    'IconSlidersTwoOutlineRegular',
    'IconTrashOutlineRegular',
    'IconListPenOutlineRegular',
  ].map((name) => [
    name,
    (props: Record<string, unknown>) => ({ type: 'icon', props: { name, ...props } }),
  ]),
)

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
  '@xyflow/react',
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
    Component: class {
      constructor(props: Record<string, unknown>) {
        ;(this as { props?: Record<string, unknown> }).props = props
      }
    },
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
    DisclosureRow: (props: Record<string, unknown>) => ({ type: 'disclosure', props }),
    Menu: (props: Record<string, unknown>) => ({ type: 'menu', props }),
    ...iconStubs,
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
        if (id === '@xyflow/react') {
          return {
            ReactFlow: (props: Record<string, unknown>) => ({ type: 'reactflow', props }),
            Handle: (props: Record<string, unknown>) => ({ type: 'handle', props }),
            Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
            Background: (props: Record<string, unknown>) => ({ type: 'background', props }),
            Controls: (props: Record<string, unknown>) => ({ type: 'controls', props }),
            BackgroundVariant: { Lines: 'lines', Dots: 'dots', Cross: 'cross' },
          }
        }
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

/** Render one element type: a class component through `new`, a function by call. */
function renderComponent(type: unknown, props: Record<string, unknown>): unknown {
  const prototype = (type as { prototype?: { render?: unknown } }).prototype
  if (prototype !== undefined && typeof prototype.render === 'function') {
    const instance = new (
      type as new (
        props: Record<string, unknown>,
      ) => { render: () => unknown }
    )(props)
    return instance.render()
  }
  return (type as (props: Record<string, unknown>) => unknown)(props)
}

function renderElements(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) renderElements(child, found)
    return found
  }
  const element = node as Element
  if (typeof element.type === 'function') {
    renderElements(renderComponent(element.type, element.props), found)
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
    return renderText(renderComponent(element.type, element.props))
  }
  return renderText(element.props?.children)
}

/** Find the first element matching a predicate without invoking any component. */
function findElement(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  const element = node as Element
  if (element.props === undefined || element.props === null) return undefined
  if (predicate(element)) return element
  for (const value of Object.values(element.props)) {
    const found = findElement(value, predicate)
    if (found !== undefined) return found
  }
  return undefined
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
      if (url.includes('definition=')) return json({ runs: [] })
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
      if (url.includes('definition=')) return json({ runs: [] })
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
      if (url.includes('definition=')) return json({ runs: [] })
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

  it('loads the diagnostics trigger and receipt sections from the read-only endpoints', async () => {
    const runtime = createRuntime('./src/client/design-page.tsx')
    const module = runtime.load() as {
      DesignPageBody?: (props: Record<string, unknown>) => unknown
    }
    const tracker = installFetch((url) => {
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
    expect(tracker.urls).toHaveLength(2)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/definitions'))).toBe(false)
    const text = renderText(tree)
    expect(text).toContain('design.intro')
    expect(renderElements(tree).find((element) => element.type === 'disclosure')?.props.title).toBe(
      'design.diagnostics',
    )
    // With no installed workflow the workbench still shows the wide blank-canvas layout:
    // the rail beside the blank canvas, not stacked above it.
    expect(
      renderElements(tree).some(
        (element) => element.props.className === 'dsh-wf-canvas dsh-wf-blank-canvas',
      ),
    ).toBe(true)
    const rendered = renderElements(tree)
    expect(
      rendered.find((element) => element.props.className === 'dsh-wf-workbench')?.props[
        'data-mode'
      ],
    ).toBe('canvas')
    expect(rendered.some((element) => element.props.className === 'dsh-wf-rail')).toBe(true)
    expect(text).toContain('tool.pre-execute')
    expect(text).toContain('run-created')
    expect(text).toContain('auth')
    expect(text).toContain('adoption')
    expect(tracker.urls.some((url) => url.includes('/api/workflows/triggers'))).toBe(true)
    expect(tracker.urls.some((url) => url.includes('/api/workflows/receipts'))).toBe(true)
    expect(tracker.violations).toEqual([])
  })

  it('opens the first installed workflow on the canvas with the rail and no write', async () => {
    const runtime = createRuntime('./src/client/design.tsx')
    const definition = {
      v: 1,
      id: 'change-intake',
      name: 'OpenSpec change intake',
      description: 'Intake a new change.',
      version: 1,
      trigger: { kind: 'tool.pre-execute', match: {}, mode: 'active', dedupe: 'name' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'one',
          title: 'One',
          executor: 'main',
          prompt: 'One.',
          evidence: { kind: 'declaration' },
          nonCritical: true,
          next: 'end',
        },
      ],
    }
    const tracker = installFetch((url) => {
      if (url.includes('/api/workflows/editor/definitions')) {
        return json({
          definitions: [
            {
              id: 'change-intake',
              name: 'OpenSpec change intake',
              description: 'Intake a new change.',
              version: 1,
              stepCount: 1,
              source: 'shipped',
              revision: null,
            },
          ],
        })
      }
      if (url.includes('/api/workflows/editor/templates')) return json({ templates: [] })
      if (url.includes('/api/workflows/editor/drafts')) return json({ drafts: [] })
      if (url.includes('/api/workflows/editor/definition')) {
        return json({ definition, revision: null, source: 'shipped' })
      }
      if (url.includes('/api/workflows/editor/layout'))
        return json({ layout: null, revision: null })
      if (url.includes('/api/workflows/runs')) return json({ runs: [] })
      throw new Error(`unexpected request ${url}`)
    })
    const module = runtime.load() as { DesignMode?: (props: Record<string, unknown>) => unknown }
    const mode = module.DesignMode
    if (mode === undefined) throw new Error('DesignMode is not exported')
    const render = (): unknown =>
      mode({ sessionId: 'session-1', t: (key: string) => key, surfaceWidth: 1024 })
    let tree = await runtime.settle(render)
    // The rail is the first installed workflow's code path.
    expect(
      findElement(
        tree,
        (element) =>
          Array.isArray(element.props.definitions) &&
          (element.props.definitions as { id: string }[]).some(
            (entry) => entry.id === 'change-intake',
          ),
      ),
    ).toBeDefined()
    // The wide pane renders the inspector as the third column beside the canvas.
    const workbench = findElement(tree, (element) => element.props.className === 'dsh-wf-workbench')
    expect(workbench?.props['data-layout']).toBe('column')
    expect(workbench?.props['data-mode']).toBe('canvas')
    expect(
      findElement(tree, (element) => element.props.className === 'dsh-wf-inspector'),
    ).toBeDefined()
    // The page opened the definition on the read-only canvas, not a list.
    const boundary = findElement(tree, (element) => element.props.fallback !== undefined)
    const canvas = boundary?.props.children as Element | undefined
    const nodes = canvas?.props.nodes as { kind: string }[] | undefined
    expect(nodes?.map((node) => node.kind)).toEqual(['trigger', 'step', 'end'])
    // The header has one primary Save and one lifecycle menu.
    const save = findElement(
      tree,
      (element) =>
        typeof element.type === 'function' &&
        element.props.variant === 'primary' &&
        element.props.children === 'design.save',
    )
    expect(save).toBeDefined()
    const menu = findElement(tree, (element) => Array.isArray(element.props.items))
    const itemIds = ((menu?.props.items as { id: string }[]) ?? []).map((item) => item.id)
    expect(itemIds).toEqual(expect.arrayContaining(['new', 'reload', 'surface', 'delete']))
    // Selecting a canvas node fills the inspector beside the canvas.
    const canvasElement = findElement(
      tree,
      (element) =>
        typeof element.props.onSelect === 'function' &&
        typeof element.props.onDropBrick === 'function',
    )
    expect(canvasElement).toBeDefined()
    const selectNode = canvasElement?.props.onSelect as ((id: string) => void) | undefined
    selectNode?.(nodeIdOf('one'))
    tree = await runtime.settle(render)
    const inspector = findElement(tree, (element) => element.props.className === 'dsh-wf-inspector')
    expect(inspector).toBeDefined()
    expect(inspector?.props['data-open']).toBe('true')
    // Search inside the inspector itself: the list fallback held by the canvas
    // boundary also receives the selected node, so a whole-tree search would
    // pass even if the inspector dropped its selection.
    const inspectorPanel = findElement(
      inspector,
      (element) => element.props.state !== undefined && element.props.selected !== undefined,
    )
    expect(inspectorPanel?.props.selected).toBe(nodeIdOf('one'))
    // A dropped step keeps the converted drop position and is selected.
    const liveCanvas = findElement(
      tree,
      (element) =>
        typeof element.props.onSelect === 'function' &&
        typeof element.props.onDropBrick === 'function',
    )
    const dropBrick = liveCanvas?.props.onDropBrick as
      | ((executor: string, position: { x: number; y: number }) => void)
      | undefined
    dropBrick?.('branch', { x: 12, y: 34 })
    tree = await runtime.settle(render)
    const afterDrop = findElement(
      tree,
      (element) =>
        typeof element.props.onSelect === 'function' &&
        typeof element.props.onDropBrick === 'function',
    )
    const droppedNodes = afterDrop?.props.nodes as
      | { id: string; kind: string; position: { x: number; y: number } }[]
      | undefined
    const branchNode = droppedNodes?.find((node) => node.kind === 'branch')
    expect(branchNode?.position).toEqual({ x: 12, y: 34 })
    expect(afterDrop?.props.selected).toBe(branchNode?.id)
    expect(tracker.violations).toEqual([])
  })

  it('asks before a draft replaces a dirty document', async () => {
    const runtime = createRuntime('./src/client/design.tsx')
    const module = runtime.load() as { DesignMode?: (props: Record<string, unknown>) => unknown }
    const mode = module.DesignMode
    if (mode === undefined) throw new Error('DesignMode is not exported')
    const definition = {
      v: 1,
      id: 'change-intake',
      name: 'OpenSpec change intake',
      description: 'Intake a new change.',
      version: 1,
      trigger: { kind: 'tool.pre-execute', match: {}, mode: 'active', dedupe: 'name' },
      settings: { allowModelStart: false, risk: 'low', gateOwnership: 'own', maxBlocks: 3 },
      steps: [{ id: 'one', title: 'One', executor: 'main', next: 'end' }],
    }
    const tracker = installFetch((url) => {
      if (url.includes('/api/workflows/editor/definitions')) {
        return json({
          definitions: [
            {
              id: 'change-intake',
              name: 'OpenSpec change intake',
              version: 1,
              stepCount: 1,
              source: 'shipped',
              revision: null,
            },
          ],
        })
      }
      if (url.includes('/api/workflows/editor/templates')) return json({ templates: [] })
      if (url.includes('/api/workflows/editor/drafts')) {
        return json({
          drafts: [{ name: 'draft-a', id: 'draft-a', title: 'Draft A', stepCount: 1 }],
        })
      }
      if (url.includes('/api/workflows/editor/draft?')) return json({ definition })
      if (url.includes('/api/workflows/editor/definition')) {
        return json({ definition, revision: null, source: 'shipped' })
      }
      if (url.includes('/api/workflows/editor/layout'))
        return json({ layout: null, revision: null })
      if (url.includes('/api/workflows/runs')) return json({ runs: [] })
      throw new Error(`unexpected request ${url}`)
    })
    const originalWindow = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = { confirm: () => false }
    try {
      const render = (): unknown =>
        mode({ sessionId: 'session-1', t: (key: string) => key, surfaceWidth: 1024 })
      let tree = await runtime.settle(render)
      // A dropped step makes the document dirty.
      const canvas = findElement(
        tree,
        (element) =>
          typeof element.props.onSelect === 'function' &&
          typeof element.props.onDropBrick === 'function',
      )
      const dropBrick = canvas?.props.onDropBrick as
        | ((executor: string, position: { x: number; y: number }) => void)
        | undefined
      dropBrick?.('branch', { x: 1, y: 2 })
      tree = await runtime.settle(render)
      const menu = findElement(tree, (element) => Array.isArray(element.props.items))
      const select = menu?.props.onSelect as ((id: string) => void) | undefined
      select?.('draft:draft-a')
      tree = await runtime.settle(render)
      // The declined confirmation keeps the document and never reads the draft.
      expect(tracker.urls.some((url) => url.includes('/api/workflows/editor/draft?'))).toBe(false)
      const stillCanvas = findElement(
        tree,
        (element) =>
          typeof element.props.onDropBrick === 'function' &&
          typeof element.props.onSelect === 'function',
      )
      expect(
        (stillCanvas?.props.nodes as { kind: string }[] | undefined)?.some(
          (node) => node.kind === 'branch',
        ),
      ).toBe(true)
    } finally {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }
    expect(tracker.violations).toEqual([])
  })

  it('keeps a newer edit when a reload answers after it', async () => {
    const runtime = createRuntime('./src/client/design.tsx')
    const module = runtime.load() as { DesignMode?: (props: Record<string, unknown>) => unknown }
    const mode = module.DesignMode
    if (mode === undefined) throw new Error('DesignMode is not exported')
    const definition = {
      v: 1,
      id: 'change-intake',
      name: 'OpenSpec change intake',
      description: 'Intake a new change.',
      version: 1,
      trigger: { kind: 'tool.pre-execute', match: {}, mode: 'active', dedupe: 'name' },
      settings: { allowModelStart: false, risk: 'low', gateOwnership: 'own', maxBlocks: 3 },
      steps: [{ id: 'one', title: 'One', executor: 'main', next: 'end' }],
    }
    let resolveReload: (() => void) | undefined
    let definitionReads = 0
    const tracker = installFetch((url) => {
      if (url.includes('/api/workflows/editor/definitions')) {
        return json({
          definitions: [
            {
              id: 'change-intake',
              name: 'OpenSpec change intake',
              version: 1,
              stepCount: 1,
              source: 'shipped',
              revision: null,
            },
          ],
        })
      }
      if (url.includes('/api/workflows/editor/templates')) return json({ templates: [] })
      if (url.includes('/api/workflows/editor/drafts')) return json({ drafts: [] })
      if (url.includes('/api/workflows/editor/definition')) {
        definitionReads += 1
        if (definitionReads === 1) return json({ definition, revision: null, source: 'shipped' })
        // The reload's read answers only after the test edits the document.
        return new Promise<Response>((resolve) => {
          resolveReload = () => resolve(json({ definition, revision: null, source: 'shipped' }))
        })
      }
      if (url.includes('/api/workflows/editor/layout'))
        return json({ layout: null, revision: null })
      if (url.includes('/api/workflows/runs')) return json({ runs: [] })
      throw new Error(`unexpected request ${url}`)
    })
    const render = (): unknown =>
      mode({ sessionId: 'session-1', t: (key: string) => key, surfaceWidth: 1024 })
    let tree = await runtime.settle(render)
    const menu = findElement(tree, (element) => Array.isArray(element.props.items))
    const selectReload = menu?.props.onSelect as ((id: string) => void) | undefined
    selectReload?.('reload')
    tree = await runtime.settle(render)
    // The lifecycle menu refuses every action while the reload is pending.
    const busyMenu = findElement(tree, (element) => Array.isArray(element.props.items))
    const busyItems = busyMenu?.props.items as { disabled?: boolean }[] | undefined
    expect(busyItems?.every((item) => item.disabled === true)).toBe(true)
    // An edit lands while the request is in flight; the old response must not win.
    const panel = findElement(
      tree,
      (element) => typeof element.props.onDefinitionPatch === 'function',
    )
    const patchDefinition = panel?.props.onDefinitionPatch as
      | ((patch: Record<string, unknown>) => void)
      | undefined
    patchDefinition?.({ name: 'Edited while loading' })
    tree = await runtime.settle(render)
    resolveReload?.()
    tree = await runtime.settle(render)
    expect(
      findElement(tree, (element) => element.props.className === 'dsh-wf-head-name')?.props
        .children,
    ).toBe('Edited while loading')
    expect(tracker.violations).toEqual([])
  })

  it('opens and closes the inspector drawer between the narrow and wide thresholds', async () => {
    const runtime = createRuntime('./src/client/design.tsx')
    const module = runtime.load() as { DesignMode?: (props: Record<string, unknown>) => unknown }
    const mode = module.DesignMode
    if (mode === undefined) throw new Error('DesignMode is not exported')
    const definition = {
      v: 1,
      id: 'change-intake',
      name: 'OpenSpec change intake',
      description: 'Intake a new change.',
      version: 1,
      trigger: { kind: 'tool.pre-execute', match: {}, mode: 'active', dedupe: 'name' },
      settings: { allowModelStart: false, risk: 'low', gateOwnership: 'own', maxBlocks: 3 },
      steps: [{ id: 'one', title: 'One', executor: 'main', next: 'end' }],
    }
    const tracker = installFetch((url) => {
      if (url.includes('/api/workflows/editor/definitions')) {
        return json({
          definitions: [
            {
              id: 'change-intake',
              name: 'OpenSpec change intake',
              version: 1,
              stepCount: 1,
              source: 'shipped',
              revision: null,
            },
          ],
        })
      }
      if (url.includes('/api/workflows/editor/templates')) return json({ templates: [] })
      if (url.includes('/api/workflows/editor/drafts')) return json({ drafts: [] })
      if (url.includes('/api/workflows/editor/definition')) {
        return json({ definition, revision: null, source: 'shipped' })
      }
      if (url.includes('/api/workflows/editor/layout'))
        return json({ layout: null, revision: null })
      if (url.includes('/api/workflows/runs')) return json({ runs: [] })
      throw new Error(`unexpected request ${url}`)
    })
    const render = (): unknown =>
      mode({ sessionId: 'session-1', t: (key: string) => key, surfaceWidth: 800 })
    let tree = await runtime.settle(render)
    const inspectorOpen = (): unknown =>
      findElement(tree, (element) => element.props.className === 'dsh-wf-inspector')?.props[
        'data-open'
      ]
    // The medium pane keeps the drawer closed until a node or Details opens it.
    expect(inspectorOpen()).toBe('false')
    const canvas = findElement(
      tree,
      (element) =>
        typeof element.props.onSelect === 'function' &&
        typeof element.props.onDropBrick === 'function',
    )
    const selectNode = canvas?.props.onSelect as ((id: string) => void) | undefined
    selectNode?.(nodeIdOf('one'))
    tree = await runtime.settle(render)
    expect(inspectorOpen()).toBe('true')
    const inspector = findElement(tree, (element) => element.props.className === 'dsh-wf-inspector')
    const selectedPanel = findElement(
      inspector,
      (element) => element.props.state !== undefined && element.props.selected !== undefined,
    )
    expect(selectedPanel?.props.selected).toBe(nodeIdOf('one'))
    const close = findElement(
      inspector,
      (element) => element.props['aria-label'] === 'design.closeInspector',
    )
    const closeDrawer = close?.props.onClick as (() => void) | undefined
    closeDrawer?.()
    tree = await runtime.settle(render)
    expect(inspectorOpen()).toBe('false')
    // Details opens the definition form with no selection.
    const details = findElement(tree, (element) => element.props['aria-label'] === 'design.details')
    const openDetails = details?.props.onClick as (() => void) | undefined
    openDetails?.()
    tree = await runtime.settle(render)
    expect(inspectorOpen()).toBe('true')
    const definitionPanel = findElement(
      findElement(tree, (element) => element.props.className === 'dsh-wf-inspector'),
      (element) => element.props.state !== undefined,
    )
    expect(definitionPanel?.props.selected).toBeUndefined()
    expect(tracker.violations).toEqual([])
  })

  it('switches the workflow canvas overlay to an older run without leaving the page', () => {
    const runtime = createRuntime('./src/client/overview.tsx')
    const module = runtime.load() as {
      WorkflowPage?: (props: Record<string, unknown>) => unknown
    }
    const WorkflowPage = module.WorkflowPage
    if (WorkflowPage === undefined) throw new Error('WorkflowPage is not exported')
    const definition = {
      id: 'change-intake',
      name: 'OpenSpec change intake',
      version: 1,
      risk: 'low',
      gateOwnership: 'own',
      trigger: { kind: 'tool.pre-execute', match: {}, mode: 'active', dedupe: 'name' },
      steps: [
        { id: 'one', title: 'One', executor: 'main', next: 'two' },
        { id: 'two', title: 'Two', executor: 'tool' },
      ],
    }
    const newest = {
      id: 'workflow:run-new',
      source: 'workflow',
      attribution: 'local',
      title: 'newest',
      startedAt: 2,
      status: 'running',
      definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 1 },
      steps: [{ id: 'one', title: 'One', state: 'running' }],
    }
    const older = {
      ...newest,
      id: 'workflow:run-old',
      title: 'older',
      startedAt: 1,
      status: 'done',
      steps: [{ id: 'one', title: 'One', state: 'done' }],
    }
    let opened = 0
    const render = (): unknown =>
      WorkflowPage({
        definitionId: 'change-intake',
        phase: 'ready',
        document: definition,
        runs: { items: [newest, older] },
        events: { items: [] },
        t: (key: string) => key,
        onBack: () => {},
        onOpenRun: () => {
          opened += 1
        },
        onLoadRuns: () => {},
        onLoadHistory: () => {},
        onRetry: () => {},
      })
    let tree = runtime.commit(render)
    const canvasElement = (): Element | undefined =>
      findElement(tree, (element) => element.props.fallback !== undefined)?.props.children as
        | Element
        | undefined
    const stepStates = (): Record<string, string | undefined> => {
      const nodes = canvasElement()?.props.nodes as
        | { id: string; kind: string; position: unknown; runState?: string }[]
        | undefined
      return Object.fromEntries(
        (nodes ?? [])
          .filter((node) => node.id.startsWith('step:'))
          .map((node) => [node.id, node.runState]),
      )
    }
    const positions = (): unknown[] =>
      ((canvasElement()?.props.nodes as { position: unknown }[] | undefined) ?? []).map(
        (node) => node.position,
      )
    const beforePositions = positions()
    expect(stepStates()['step:one']).toBe('running')
    const select = findElement(
      tree,
      (element) =>
        element.type === 'select' && element.props['aria-label'] === 'workflow.overlayRun',
    )
    const change = select?.props.onChange as ((event: unknown) => void) | undefined
    if (change === undefined) throw new Error('no overlay run selector')
    change({ currentTarget: { value: 'workflow:run-old' } })
    tree = runtime.commit(render)
    // Only the overlay changed: the older run's step state is drawn on the same graph.
    expect(stepStates()['step:one']).toBe('done')
    expect(stepStates()['step:two']).toBeUndefined()
    expect(positions()).toEqual(beforePositions)
    expect(
      findElement(tree, (element) => element.props['data-workflow-page'] !== undefined),
    ).toBeDefined()
    expect(opened).toBe(0)
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

describe('Workflows overview isolation and latest runs', () => {
  it('loads the latest run per definition even when it is outside the session page', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const newest = run('workflow:run-new', NOW)
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('definition=change-intake')) return json({ runs: [newest] })
      return json({ runs: [run('workflow:run-old', NOW - 60_000)], next: '2' })
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    const tree = await runtime.settle(render)
    const latest = renderElements(tree).find(
      (element) => element.props['data-latest-run'] === 'workflow:run-new',
    )
    expect(latest).toBeDefined()
    expect(tracker.violations).toEqual([])
  })

  it('drops the previous session data when the next session load fails', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const tracker = installFetch((url) => {
      if (url.includes('session=session-2')) return json({ error: 'the session load failed' }, 500)
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      return json({ runs: RUNS })
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    let session = 'session-1'
    const render = (): unknown => view({ sessionId: session, t: (key: string) => key })
    let tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('OpenSpec change intake')
    session = 'session-2'
    tree = await runtime.settle(render)
    expect(renderText(tree)).not.toContain('OpenSpec change intake')
    expect(renderText(tree)).toContain('the session load failed')
    expect(tracker.violations).toEqual([])
  })

  it('opens the run copy from the surface that opened it', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const workflowCopy = run('workflow:run-w', NOW)
    const feedCopy = { ...workflowCopy, status: 'running', endedAt: undefined }
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('/api/workflows/events')) return json(HISTORY)
      if (url.includes('definition=change-intake')) return json({ runs: [workflowCopy] })
      if (url.includes('/api/workflows/runs')) return json({ runs: [feedCopy] })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    ;(workflowButton(tree, 'change-intake')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    ;(runButton(tree, 'workflow:run-w')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('runs.status.done')
    expect(renderText(tree)).not.toContain('runs.status.running')
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('runs.status.done')
    expect(renderText(tree)).not.toContain('runs.status.running')
    expect(tracker.violations).toEqual([])
  })

  it('reconciles the open workflow run with the refreshed workflow response', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let workflowDone = false
    const runningCopy = { ...run('workflow:run-w', NOW), status: 'running', endedAt: undefined }
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('/api/workflows/events')) return json(HISTORY)
      if (url.includes('definition=change-intake')) {
        return json({ runs: [workflowDone ? run('workflow:run-w', NOW) : runningCopy] })
      }
      if (url.includes('/api/workflows/runs')) return json({ runs: [runningCopy] })
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    ;(workflowButton(tree, 'change-intake')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    ;(runButton(tree, 'workflow:run-w')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    expect(renderText(tree)).toContain('runs.status.running')
    workflowDone = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('runs.status.done')
    expect(renderText(tree)).not.toContain('runs.status.running')
    expect(tracker.violations).toEqual([])
  })

  it('keeps the known latest run when the latest lookup fails', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    const newest = run('workflow:run-new', NOW)
    let failLatest = false
    let emptyLatest = false
    const tracker = installFetch((url) => {
      const overview = overviewResponse(url)
      if (overview !== undefined) return overview
      if (url.includes('/api/workflows/health')) return json(HEALTH)
      if (url.includes('definition=change-intake')) {
        return failLatest
          ? json({ error: 'latest failed' }, 500)
          : json({ runs: emptyLatest ? [] : [newest] })
      }
      if (url.includes('/api/workflows/runs')) {
        return json({ runs: [run('workflow:run-a', NOW - 120_000)] })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const view = module.WorkflowsView
    if (view === undefined) throw new Error('WorkflowsView is not exported')
    const render = (): unknown => view({ sessionId: 'session-1', t: (key: string) => key })
    let tree = await runtime.settle(render)
    expect(
      renderElements(tree).some(
        (element) => element.props['data-latest-run'] === 'workflow:run-new',
      ),
    ).toBe(true)
    failLatest = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(
      renderElements(tree).some(
        (element) => element.props['data-latest-run'] === 'workflow:run-new',
      ),
    ).toBe(true)
    expect(renderText(tree)).toContain('overview.latestUnavailable')
    failLatest = false
    emptyLatest = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    expect(
      renderElements(tree).some(
        (element) => element.props['data-latest-run'] === 'workflow:run-new',
      ),
    ).toBe(false)
    expect(tracker.violations).toEqual([])
  })

  it('restarts a pending run lookup after a failed refresh', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let failOverview = false
    const pendingLookups: Array<(value: Response) => void> = []
    const tracker = installFetch((url) => {
      if (decodeURIComponent(url).includes('run=workflow:run-w')) {
        return new Promise<Response>((resolve) => pendingLookups.push(resolve))
      }
      if (url.includes('/api/workflows/definitions') && url.includes('id=')) {
        return json({ definition: DEFINITION, revision: null, source: 'shipped' })
      }
      if (url.includes('/api/workflows/events')) return json(HISTORY)
      if (url.includes('definition=change-intake')) {
        return json({ runs: [run('workflow:run-w-old', NOW - 5_000)] })
      }
      if (
        failOverview &&
        (url.includes('/api/workflows/definitions') ||
          url.includes('/api/workflows/triggers') ||
          url.includes('/api/workflows/health') ||
          url.includes('stats=1') ||
          url.includes('/api/workflows/runs'))
      ) {
        return json({ error: 'the overview refresh failed' }, 500)
      }
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
    ;(workflowButton(tree, 'change-intake')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    // The history link resolves to a run outside the workflow's run page.
    ;(runButton(tree, 'workflow:run-w')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    failOverview = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    for (const resolve of pendingLookups) resolve(json({ runs: [run('workflow:run-w', NOW)] }))
    tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('OpenSpec change intake · workflow:run-w')
    expect(renderText(tree)).not.toContain('state.loading')
    expect(tracker.violations).toEqual([])
  })

  it('does not strand an opening workflow page when a refresh fails', async () => {
    const runtime = createRuntime()
    const module = runtime.load() as {
      WorkflowsView?: (props: Record<string, unknown>) => unknown
    }
    let failOverview = false
    let released = false
    const pendingDocs: Array<(value: Response) => void> = []
    const docResponse = (): Response =>
      json({ definition: DEFINITION, revision: null, source: 'shipped' })
    const tracker = installFetch((url) => {
      if (url.includes('/api/workflows/definitions') && url.includes('id=')) {
        if (released) return docResponse()
        return new Promise<Response>((resolve) => pendingDocs.push(resolve))
      }
      if (url.includes('/api/workflows/events')) return json(HISTORY)
      if (url.includes('definition=change-intake'))
        return json({ runs: [run('workflow:run-w', NOW)] })
      if (
        failOverview &&
        (url.includes('/api/workflows/definitions') ||
          url.includes('/api/workflows/triggers') ||
          url.includes('/api/workflows/health') ||
          url.includes('stats=1') ||
          url.includes('/api/workflows/runs'))
      ) {
        return json({ error: 'the overview refresh failed' }, 500)
      }
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
    ;(workflowButton(tree, 'change-intake')?.props.onClick as (() => void) | undefined)?.()
    tree = runtime.commit(render)
    failOverview = true
    ;(button(tree, 'state.refresh')?.props.onClick as (() => void) | undefined)?.()
    tree = await runtime.settle(render)
    released = true
    for (const resolve of pendingDocs) resolve(docResponse())
    tree = await runtime.settle(render)
    expect(renderText(tree)).toContain('Intake a new OpenSpec change.')
    expect(renderText(tree)).not.toContain('state.loading')
    expect(tracker.violations).toEqual([])
  })
})
