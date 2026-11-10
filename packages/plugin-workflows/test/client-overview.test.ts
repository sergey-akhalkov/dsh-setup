import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * Pure checks for the session overview's joins and renders: the trigger groups,
 * their counters, the workflow rows, the definition-scoped evaluation history,
 * and the step chain. The stateful view is covered by the interaction test.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))

type Element = { type: unknown; props: Record<string, unknown>; key?: string }
const Fragment = Symbol('Fragment')
function jsx(type: unknown, props: Record<string, unknown> | null, key?: string): Element {
  return { type, props: props ?? {}, ...(key === undefined ? {} : { key }) }
}

function elements(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found)
    return found
  }
  const element = node as Element
  if (typeof element.type === 'function') {
    elements((element.type as (props: Record<string, unknown>) => unknown)(element.props), found)
    return found
  }
  if (element.type !== undefined && element.props !== undefined) {
    found.push(element)
    for (const value of Object.values(element.props)) elements(value, found)
  }
  return found
}

function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (node === null || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(text).join('')
  const element = node as Element
  if (typeof element.type === 'function') {
    return text((element.type as (props: Record<string, unknown>) => unknown)(element.props))
  }
  return text(element.props?.children)
}

function loadModule(): Record<string, unknown> {
  const result = buildSync({
    stdin: {
      contents: `export * from './src/client/overview.tsx'`,
      resolveDir: packageDir,
      sourcefile: 'workflows-overview-test-entry.tsx',
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
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    logLevel: 'silent',
  })
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error('the overview source did not bundle')
  const module = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', 'require', output.text)(
    module,
    module.exports,
    (id: string) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
      if (id === 'react') return {}
      return {
        Button: (props: Record<string, unknown>) => jsx('button', props),
        Tag: (props: Record<string, unknown>) => jsx('span', props),
        Tooltip: (props: Record<string, unknown>) => jsx('span', props),
        StateDot: (props: Record<string, unknown>) => jsx('span', props),
        AnimatedRows: (props: Record<string, unknown>) => jsx('div', props),
        relativeTime: (at: number, now: number) => {
          const minutes = Math.floor(Math.max(0, now - at) / 60_000)
          return minutes > 0 ? { unit: 'minutes', n: minutes } : { unit: 'now', n: 0 }
        },
      }
    },
  )
  return module.exports
}

const NOW = 1_762_500_300_000
const translate = (key: string): string => key

const DEFINITIONS = [
  {
    id: 'change-intake',
    name: 'OpenSpec change intake',
    version: 1,
    risk: 'low',
    trigger: { kind: 'tool.pre-execute', mode: 'active', match: { tool: 'shell' } },
  },
  {
    id: 'task-review',
    name: 'Task review',
    version: 1,
    risk: 'medium',
    trigger: { kind: 'fs.change', mode: 'shadow', match: { path: 'openspec/changes/**' } },
  },
  {
    id: 'retro',
    name: 'Work checkpoint',
    version: 1,
    trigger: { kind: 'turn.stopping', mode: 'active', match: {} },
  },
  {
    id: 'verify',
    name: 'Verification check',
    version: 1,
    trigger: { kind: 'turn.stopping', mode: 'shadow', match: {} },
  },
  {
    id: 'intent-only',
    name: 'Intent workflow',
    version: 1,
    trigger: { kind: 'intent', mode: 'active', match: { intent: 'archive' } },
  },
]

const FS_CHANGE_CATALOG = [
  'openspec-tasks-checked',
  'openspec-review-recorded',
  'openspec-change-created',
  'openspec-change-archived',
].map((id) => ({
  id,
  event: 'fs.change',
  filter: { path: 'openspec/changes/**' },
  mode: 'shadow',
  dedupe: 'path+content-hash',
  // The base catalog's own counts must never reach the group counter.
  counts: { matched: 9, total: 20 },
}))

const TRIGGERS = [
  ...FS_CHANGE_CATALOG,
  {
    id: 'definition:change-intake',
    event: 'tool.pre-execute',
    source: 'workflow-definition',
    counts: { matched: 2, total: 3 },
  },
  {
    id: 'definition:task-review',
    event: 'fs.change',
    source: 'workflow-definition',
    counts: { matched: 1, total: 1 },
  },
  {
    id: 'definition:retro',
    event: 'turn.stopping',
    source: 'workflow-definition',
    counts: { matched: 3, total: 4 },
  },
  {
    id: 'definition:verify',
    event: 'turn.stopping',
    source: 'workflow-definition',
    counts: { matched: 1, total: 2 },
  },
  {
    id: 'definition:intent-only',
    event: 'intent',
    source: 'workflow-definition',
    counts: { matched: 0, total: 1 },
  },
  {
    id: 'worker-end',
    event: 'subagent.end',
    filter: {},
    mode: 'shadow',
    dedupe: 'none',
    counts: { matched: 7, total: 7 },
  },
]

const STATS = {
  definitions: {
    'change-intake': {
      completed: 3,
      failed: 1,
      cancelled: 0,
      interrupted: 0,
      running: 1,
      blocked: 1,
      total: 5,
    },
  },
}

describe('overview grouping and joins', () => {
  it('groups by the definitions’ trigger kind in definition order, then unbound catalog kinds', () => {
    const module = loadModule()
    const groupByTrigger = module.groupByTrigger as (
      definitions: readonly Record<string, unknown>[],
      triggers: readonly Record<string, unknown>[],
      stats?: Record<string, unknown>,
    ) => Array<{
      kind: string
      workflows: Array<{
        definition: Record<string, unknown>
        stats?: Record<string, unknown>
        firings?: { matched: number; total: number }
      }>
      firings?: { matched: number; total: number }
    }>
    const groups = groupByTrigger(DEFINITIONS, TRIGGERS, STATS)
    expect(groups.map((group) => group.kind)).toEqual([
      'tool.pre-execute',
      'fs.change',
      'turn.stopping',
      'intent',
      'subagent.end',
    ])
    // A kind with no base catalog entry still renders from the definitions.
    expect(groups.find((group) => group.kind === 'intent')?.workflows).toHaveLength(1)
    // A kind without bound definitions states so and carries no counter.
    const unbound = groups.find((group) => group.kind === 'subagent.end')
    expect(unbound?.workflows).toEqual([])
    expect(unbound?.firings).toBeUndefined()
    // Two workflows of one kind keep their own mode and filter.
    const stopping = groups.find((group) => group.kind === 'turn.stopping')
    expect(stopping?.workflows.map((bucket) => bucket.definition.id)).toEqual(['retro', 'verify'])
    expect(
      (module.triggerText as (trigger: unknown, t: (key: string) => string) => string)(
        stopping?.workflows[0]?.definition.trigger ?? {},
        translate,
      ),
    ).toContain('active')
    expect(
      (module.triggerText as (trigger: unknown, t: (key: string) => string) => string)(
        stopping?.workflows[1]?.definition.trigger ?? {},
        translate,
      ),
    ).toContain('shadow')
  })

  it('sums only the bound definitions’ own evaluation counts, never the catalog counts', () => {
    const module = loadModule()
    const groups = (
      module.groupByTrigger as (
        definitions: readonly Record<string, unknown>[],
        triggers: readonly Record<string, unknown>[],
        stats?: Record<string, unknown>,
      ) => Array<{ kind: string; firings?: { matched: number; total: number } }>
    )(DEFINITIONS, TRIGGERS, STATS)
    const fsChange = groups.find((group) => group.kind === 'fs.change')
    expect(fsChange?.firings).toEqual({ matched: 1, total: 1 })
    const stopping = groups.find((group) => group.kind === 'turn.stopping')
    expect(stopping?.firings).toEqual({ matched: 4, total: 6 })
    const changeIntake = groups.find((group) => group.kind === 'tool.pre-execute')
    expect(changeIntake?.firings).toEqual({ matched: 2, total: 3 })
  })

  it('keeps per-definition statistics and the four shipped fs.change triggers separate', () => {
    const module = loadModule()
    const triggers = module.triggerCountsFor as (
      entries: readonly Record<string, unknown>[],
      definitionId: string,
    ) => { matched: number; total: number } | undefined
    // The catalog triggers carry their own inflated counts; only the
    // definition:<id> entry is the workflow's own evaluation count.
    expect(triggers(FS_CHANGE_CATALOG, 'task-review')).toBeUndefined()
    expect(triggers(TRIGGERS, 'task-review')).toEqual({ matched: 1, total: 1 })
    const label = module.runStatsLabel as (
      stats: Record<string, unknown> | undefined,
      t: (key: string) => string,
    ) => string
    const stats = (STATS.definitions as Record<string, Record<string, unknown>>)['change-intake']
    const rendered = label(stats, translate)
    expect(rendered).toContain('3 / 5 overview.runs')
    expect(rendered).toContain('overview.failed 1')
    expect(rendered).toContain('overview.running 1')
    expect(rendered).toContain('overview.blocked 1')
    expect(rendered).toContain('overview.cancelled 0')
    expect(rendered).toContain('overview.interrupted 0')
    // No host statistics is a truthful line, never an inferred bucket.
    expect(label(undefined, translate)).toBe('overview.statsUnavailable')
  })
})

describe('definition-scoped evaluation history', () => {
  const event = {
    v: 1,
    at: 1,
    session: 'session-1',
    kind: 'tool.pre-execute',
    subject: 'shell',
    summary: 'ran a shell call',
    bytes: 20,
    truncated: false,
    triggers: [
      { id: 'definition:change-intake', matched: true, reason: 'run-created', runId: 'run-1' },
      { id: 'openspec-tasks-checked', matched: true, reason: 'would-fire' },
      { id: 'definition:task-review', matched: false, reason: 'not-applicable' },
    ],
  }

  it('filters evaluations to the definition and links only a run-carrying one', () => {
    const module = loadModule()
    const evaluationsFor = module.evaluationsFor as (
      value: Record<string, unknown>,
      definitionId: string,
    ) => Array<Record<string, unknown>>
    const historyEvents = module.historyEvents as (
      events: readonly Record<string, unknown>[],
      definitionId: string,
    ) => Array<Record<string, unknown>>
    expect(evaluationsFor(event, 'change-intake')).toHaveLength(1)
    const scoped = historyEvents([event], 'change-intake')
    expect(scoped).toHaveLength(1)
    const first = scoped[0]
    if (first === undefined) throw new Error('the scoped event is missing')
    expect((first.triggers as Array<Record<string, unknown>>).map((entry) => entry.id)).toEqual([
      'definition:change-intake',
    ])
    const DefinitionHistory = module.DefinitionHistory as (
      props: Record<string, unknown>,
    ) => unknown
    let opened: string | undefined
    const rendered = elements(
      DefinitionHistory({
        events: [event],
        definitionId: 'change-intake',
        t: translate,
        onOpenRun: (runId: string) => (opened = runId),
      }),
    )
    const body = rendered.map((element) => text(element)).join('')
    expect(body).toContain('run-created')
    expect(body).not.toContain('would-fire')
    expect(body).not.toContain('not-applicable')
    const links = rendered.filter(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.props['data-run']).toBe('workflow:run-1')
    ;(links[0]?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toBe('workflow:run-1')
    // A matched evaluation without a run renders its reason with no link.
    const noRun = elements(
      DefinitionHistory({
        events: [
          {
            ...event,
            triggers: [{ id: 'definition:change-intake', matched: true, reason: 'run-suppressed' }],
          },
        ],
        definitionId: 'change-intake',
        t: translate,
        onOpenRun: () => {},
      }),
    )
    expect(noRun.some((element) => element.props['data-run'] !== undefined)).toBe(false)
    expect(text(noRun)).toContain('run-suppressed')
    const empty = DefinitionHistory({
      events: [event],
      definitionId: 'intent-only',
      t: translate,
      onOpenRun: () => {},
    })
    expect(text(empty)).toBe('workflow.noHistory')
  })
})

describe('architecture chain', () => {
  it('renders each step’s executor and next, branch, and loop targets', () => {
    const module = loadModule()
    const architectureChain = module.architectureChain as (
      steps: readonly Record<string, unknown>[],
    ) => Array<{ step: Record<string, unknown>; targets: Array<Record<string, unknown>> }>
    const chain = architectureChain([
      { id: 'one', title: 'One', executor: 'main', next: 'two' },
      // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
      { id: 'two', title: 'Two', executor: 'branch', branch: { then: 'three', else: 'one' } },
      {
        id: 'three',
        title: 'Three',
        executor: 'loop',
        loop: { maxIterations: 3, next: 'one', cap: 'blocked' },
      },
    ])
    expect(chain.map((row) => row.step.id)).toEqual(['one', 'two', 'three'])
    const chainTargetsText = module.chainTargetsText as (
      row: Record<string, unknown>,
      t: (key: string) => string,
    ) => string
    expect(chainTargetsText(chain[0] as Record<string, unknown>, translate)).toBe(
      'workflow.next: two',
    )
    expect(chainTargetsText(chain[1] as Record<string, unknown>, translate)).toBe(
      'workflow.then: three · workflow.else: one',
    )
    expect(chainTargetsText(chain[2] as Record<string, unknown>, translate)).toBe(
      'workflow.loop: one (3 iterations, cap blocked)',
    )
  })
})

describe('overview and workflow page render', () => {
  const run = {
    id: 'workflow:run-1',
    source: 'workflow',
    attribution: 'local',
    title: 'OpenSpec change intake · auth',
    startedAt: NOW - 120_000,
    status: 'done',
    definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 1 },
    steps: [],
  }

  it('renders each group, its workflows, counters, and unbound kinds', () => {
    const module = loadModule()
    const WorkflowOverview = module.WorkflowOverview as (props: Record<string, unknown>) => unknown
    const opened: string[] = []
    const tree = WorkflowOverview({
      definitions: DEFINITIONS,
      triggers: TRIGGERS,
      stats: STATS,
      runs: [run],
      t: translate,
      now: NOW,
      onOpen: (id: string) => opened.push(id),
    })
    const rendered = elements(tree)
    const body = text(tree)
    expect(body).toContain('OpenSpec change intake')
    expect(body).toContain('2 / 3 overview.firings')
    expect(body).toContain('1 / 1 overview.firings')
    expect(body).toContain('3 / 5 overview.runs')
    expect(body).toContain('overview.noWorkflows')
    expect(body).toContain('2time.minutes')
    const rows = rendered.filter((element) => element.props['data-workflow'] !== undefined)
    expect(rows.map((row) => row.props['data-workflow'])).toEqual([
      'change-intake',
      'task-review',
      'retro',
      'verify',
      'intent-only',
    ])
    ;(rows[0]?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual(['change-intake'])
    // A failed host statistics response renders no invented counts.
    const noStats = WorkflowOverview({
      definitions: [DEFINITIONS[0]],
      triggers: TRIGGERS,
      runs: [],
      t: translate,
      onOpen: () => {},
    })
    expect(text(noStats)).toContain('overview.statsUnavailable')
    expect(text(noStats)).toContain('overview.noRuns')
    // An empty definition list is one truthful line, not an empty screen.
    expect(
      text(
        WorkflowOverview({ definitions: [], triggers: TRIGGERS, t: translate, onOpen: () => {} }),
      ),
    ).toContain('overview.empty')
  })

  it('renders the workflow page document, chain, runs, and history', () => {
    const module = loadModule()
    const WorkflowPage = module.WorkflowPage as (props: Record<string, unknown>) => unknown
    let backed = 0
    const opened: string[] = []
    const tree = WorkflowPage({
      definitionId: 'change-intake',
      phase: 'ready',
      document: {
        ...DEFINITIONS[0],
        description: 'Intake a new OpenSpec change.',
        gateOwnership: 'own',
        steps: [
          { id: 'one', title: 'One', executor: 'main', next: 'two' },
          { id: 'two', title: 'Two', executor: 'tool' },
        ],
      },
      trigger: TRIGGERS[4],
      runs: { items: [run] },
      events: {
        items: [
          {
            v: 1,
            at: 1,
            session: 'session-1',
            kind: 'tool.pre-execute',
            subject: 'shell',
            summary: 'ran',
            bytes: 1,
            truncated: false,
            triggers: [
              {
                id: 'definition:change-intake',
                matched: true,
                reason: 'run-created',
                runId: 'run-1',
              },
            ],
          },
        ],
      },
      t: translate,
      now: NOW,
      onBack: () => (backed += 1),
      onOpenRun: (runId: string) => opened.push(runId),
      onLoadRuns: () => {},
      onLoadHistory: () => {},
      onRetry: () => {},
    })
    const body = text(tree)
    expect(body).toContain('Intake a new OpenSpec change.')
    expect(body).toContain('workflow.version')
    expect(body).toContain('v1')
    expect(body).toContain('definitions.risk')
    expect(body).toContain('workflow.gateOwnership')
    expect(body).toContain('2 / 3 overview.firings')
    expect(body).toContain('workflow.architecture')
    expect(body).toContain('next: two')
    expect(body).toContain('workflow.history')
    expect(body).toContain('run-created')
    const rendered = elements(tree)
    const back = rendered.find(
      (element) => element.type === 'button' && text(element) === 'workflow.back',
    )
    ;(back?.props.onClick as (() => void) | undefined)?.()
    expect(backed).toBe(1)
    const link = rendered.find(
      (element) => element.type === 'button' && element.props['data-run'] !== undefined,
    )
    ;(link?.props.onClick as (() => void) | undefined)?.()
    expect(opened).toEqual(['workflow:run-1'])
  })
})
