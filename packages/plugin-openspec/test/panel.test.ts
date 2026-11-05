import type { ReactNode } from 'react'
import { useEffect as registerEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface HooksFace {
  useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void]
  useEffect(callback: () => void | (() => void), deps?: readonly unknown[]): void
  useRef<T>(initial: T): { current: T }
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T
}

const active = vi.hoisted(() => ({ hooks: undefined as unknown }))
const { element } = vi.hoisted(() => ({
  element: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))

vi.mock('react', () => ({
  useState: (initial: unknown) => (active.hooks as HooksFace).useState(initial),
  useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) =>
    (active.hooks as HooksFace).useEffect(callback, deps),
  useRef: (initial: unknown) => (active.hooks as HooksFace).useRef(initial),
  useMemo: (factory: () => unknown, deps: readonly unknown[]) =>
    (active.hooks as HooksFace).useMemo(factory, deps),
}))
vi.mock('react/jsx-runtime', () => ({ jsx: element, jsxs: element, Fragment: Symbol('Fragment') }))
vi.mock('react/jsx-dev-runtime', () => ({
  jsxDEV: element,
  Fragment: Symbol('Fragment'),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => ({ type: 'Button', props }),
  MarkdownText: (props: Record<string, unknown>) => ({ type: 'MarkdownText', props }),
  Pill: (props: Record<string, unknown>) => ({ type: 'Pill', props }),
  SegmentedControl: (props: Record<string, unknown>) => ({ type: 'SegmentedControl', props }),
  SegmentedTabs: (props: Record<string, unknown>) => ({ type: 'SegmentedTabs', props }),
  Input: (props: Record<string, unknown>) => ({ type: 'Input', props }),
  StateDot: (props: Record<string, unknown>) => ({ type: 'StateDot', props }),
  Tag: (props: Record<string, unknown>) => ({ type: 'Tag', props }),
  TextShimmer: (props: Record<string, unknown>) => ({ type: 'TextShimmer', props }),
  Tooltip: (props: Record<string, unknown>) => ({ type: 'Tooltip', props }),
  IconBranchOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconBranchOutlineRegular',
    props,
  }),
  IconBrowseOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconBrowseOutlineRegular',
    props,
  }),
  IconCheckCircleOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconCheckCircleOutlineRegular',
    props,
  }),
  IconChevronDownOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconChevronDownOutlineRegular',
    props,
  }),
  IconPlusOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconPlusOutlineRegular',
    props,
  }),
  IconRightUpOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconRightUpOutlineRegular',
    props,
  }),
  IconSearchOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconSearchOutlineRegular',
    props,
  }),
  IconWarningTriangleOutlineRegular: (props: Record<string, unknown>) => ({
    type: 'IconWarningTriangleOutlineRegular',
    props,
  }),
  // Keeps the shipped bucketing contract without loading the real CSS modules.
  relativeTime: (at: number, now: number) => {
    const minute = 60_000
    const hour = 3_600_000
    const day = 86_400_000
    const diff = Math.max(0, now - at)
    if (diff < minute) return { unit: 'now', n: 0 }
    if (diff < hour) return { unit: 'minutes', n: Math.floor(diff / minute) }
    if (diff < day) return { unit: 'hours', n: Math.floor(diff / hour) }
    if (diff < 30 * day) return { unit: 'days', n: Math.floor(diff / day) }
    if (diff < 365 * day) return { unit: 'months', n: Math.floor(diff / (30 * day)) }
    return { unit: 'years', n: Math.floor(diff / (365 * day)) }
  },
}))

import {
  apply,
  CapabilityBody,
  CapabilityView,
  type CapabilityViewProps,
  ChangeBody,
  ChangeView,
  type ChangeViewProps,
  createHandoff,
  FileWatch,
  InlineText,
  OpenSpecTab,
  PANEL_CSS,
  RequirementList,
  type ResourceFacts,
  RootBody,
  RootView,
  type RootViewProps,
  registerPanel,
  TaskChecklist,
} from '../src/client/index.tsx'
import {
  applyDraft,
  archivedChangeAddress,
  type CapabilityDetail,
  type CapabilitySummary,
  CHANGE_PATH,
  CHANGES_PATH,
  type ChangeDetail,
  type ChangeListResponse,
  type ChangePresence,
  type ChangeRow,
  type CommitFact,
  canOpenOpenSpec,
  capabilityAddress,
  changeAddress,
  type Delta,
  derivePhase,
  fileAddress,
  type HistoryEntry,
  hasArtifact,
  initialArtifact,
  initialRootSegment,
  isoDate,
  isRootSegment,
  LOADING,
  matchesQuery,
  OPENSPEC_ID,
  OPENSPEC_KIND,
  openSpecTarget,
  openSpecTitle,
  parseTaskGroups,
  parseTaskLines,
  phaseDot,
  phaseOf,
  phaseTone,
  type Requirement,
  ROOT_ADDRESS,
  readSegment,
  relativeLabel,
  requestCapabilities,
  requestCapability,
  requestChange,
  requestChangeList,
  type SegmentStorage,
  SPECS_ADDRESS,
  SPECS_PATH,
  segmentStorageKey,
  sortArchived,
  sortChanges,
  sortHistory,
  summaryText,
  type WorkspaceCounts,
  writeSegment,
} from '../src/client/panel.ts'

/** The Host's readable causes, as literals so the client test stays host-independent. */
const NO_LOCAL_ROOT_MESSAGE =
  'No workspace-local OpenSpec root was found. Run `openspec init --tools none` in the workspace root first.'
const MISSING_CLI_MESSAGE =
  'The OpenSpec CLI (`openspec`) was not found on PATH. Install it with `npm install -g @fission-ai/openspec`.'

const COPY: Record<string, string> = {
  'guide.title': 'OpenSpec',
  'guide.description': 'Browse OpenSpec changes, archive, and capability specs',
  'segment.label': 'OpenSpec view',
  'segment.changes': 'Changes',
  'segment.specs': 'Specs',
  'segment.archive': 'Archive',
  'summary.changes': 'changes',
  'summary.specs': 'specs',
  'summary.archived': 'archived',
  'root.explore': 'Explore',
  'root.propose': 'Propose',
  'root.exploreBody': 'Outline a change before proposing it.',
  'root.proposeBody': 'Write a new change proposal.',
  'actions.seeArchive': 'See all archive',
  'group.inProgress': 'In progress',
  'group.complete': 'Complete',
  'group.recentlyArchived': 'Recently archived',
  'state.loading': 'Loading…',
  'state.retry': 'Retry',
  'specs.emptyTitle': 'No accepted specs yet',
  'specs.emptyBody': 'Archive a completed change to add one.',
  'specs.archive': 'Open archive',
  'specs.filterLabel': 'Filter capabilities',
  'specs.filterPlaceholder': 'Search capabilities…',
  'specs.noMatch': 'No capabilities match this filter.',
  'specs.req': 'req',
  'specs.acceptedVia': 'Accepted via',
  'archive.emptyTitle': 'Nothing archived yet',
  'archive.emptyBody': 'Complete a change and archive it to keep its history here.',
  'archive.filterLabel': 'Filter archived changes',
  'archive.filterPlaceholder': 'Search archive…',
  'archive.noMatch': 'No archived changes match this filter.',
  'presence.proposal': 'proposal',
  'presence.design': 'design',
  'presence.spec': 'spec',
  'presence.specs': 'specs',
  'presence.tasks': 'tasks',
  'phase.planning': 'planning',
  'phase.ready-to-apply': 'ready to apply',
  'phase.applying': 'applying',
  'phase.complete': 'complete',
  'phase.archived': 'archived',
  'change.apply': 'Apply change',
  'change.tasks': 'tasks',
  'change.artifactLabel': 'Change artifacts',
  'change.deltas': 'delta specs',
  'change.updated': 'updated',
  'change.tasksNotWritten': 'tasks not written yet',
  'change.unparsedTasks': 'tasks not parsed from the file.',
  'artifact.proposal': 'Why',
  'artifact.design': 'Design',
  'artifact.specs': 'Specs',
  'artifact.tasks': 'Tasks',
  'artifact.notWritten': 'Not written yet.',
  'capability.requirements': 'requirements',
  'capability.scenarios': 'scenarios',
  'capability.accepted': 'Accepted',
  'capability.via': 'via',
  'capability.openAccepted': 'Open accepted spec',
  'capability.sections': 'Capability sections',
  'capability.requirementsTab': 'Requirements',
  'capability.historyTab': 'History',
  'capability.historyEmpty': 'No archived change produced this capability.',
  'requirements.filterLabel': 'Filter requirements',
  'requirements.filterPlaceholder': 'Search requirements…',
  'requirements.noMatch': 'No requirements match this filter.',
  'delta.from': 'from',
  'delta.to': 'to',
  'scenario.label': 'Scenario:',
  'scenario.when': 'WHEN',
  'scenario.then': 'THEN',
  'scenario.and': 'AND',
  'scenario.but': 'BUT',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
}

const t = (key: string): string => COPY[key] ?? key

const LABELS = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
}

const NOW = new Date('2026-11-05T17:00:00')

const COMMIT: CommitFact = {
  short: '7e87448',
  at: '2026-10-27T10:00:00Z',
  subject: 'feat: add the admin indicator',
}

const EMPTY_PRESENCE: ChangePresence = {
  proposal: false,
  design: false,
  tasks: false,
  specs: 0,
}

const SIGN_IN: Requirement = {
  name: 'Sign-in',
  text: 'The system SHALL sign in with `token` and MUST NOT log it.',
  scenarios: [
    {
      name: 'Valid token',
      rawText:
        '- **WHEN** a token arrives\n- **THEN** the session starts\n- **AND** the audit log records it',
    },
  ],
}

const AUTH_DELTA: Delta = {
  capability: 'auth',
  operation: 'ADDED',
  requirements: [SIGN_IN],
}

const BILLING_DELTA: Delta = {
  capability: 'billing',
  operation: 'MODIFIED',
  requirements: [
    {
      name: 'Billing window',
      text: 'The system MUST bill monthly.',
      scenarios: [
        {
          name: 'Month end',
          rawText: '- **WHEN** the month ends\n- **THEN** an invoice is issued',
        },
      ],
    },
  ],
}

const FULL: ChangeDetail = {
  name: 'add-auth',
  status: 'in-progress',
  completedTasks: 4,
  totalTasks: 12,
  artifacts: { proposal: '# Why', design: '# Design', tasks: '## Group\n- [ ] task' },
  specs: [],
  deltas: [AUTH_DELTA],
  modified: '2026-11-05T14:03:00',
  summary: 'Add authentication to the product.',
  commit: COMMIT,
  phase: 'applying',
  presence: { proposal: true, design: true, tasks: true, specs: 1 },
}

const LATER: ChangeDetail = {
  ...FULL,
  completedTasks: 5,
  artifacts: { proposal: '# Why, revised', design: '# Design', tasks: '## Group\n- [x] task' },
  modified: '2026-11-05T15:20:00',
}

const TWO_DELTAS: ChangeDetail = { ...FULL, deltas: [AUTH_DELTA, BILLING_DELTA] }

const NO_DELTAS: ChangeDetail = { ...FULL, deltas: [], specs: [] }

const NO_DESIGN: ChangeDetail = {
  ...FULL,
  artifacts: { proposal: '# Why', design: null, tasks: '## Group\n- [ ] task' },
}

/** A pre-redesign response body: deltas only as raw Markdown. */
const LEGACY_DELTAS: ChangeDetail = {
  ...FULL,
  deltas: [],
  specs: [{ capability: 'auth', body: '# auth delta', modified: '2026-11-05T14:03:00' }],
}

const RENAMED: ChangeDetail = {
  ...FULL,
  deltas: [
    {
      capability: 'auth',
      operation: 'RENAMED',
      requirements: [],
      rename: { from: 'Old name', to: 'New name' },
    },
    {
      capability: 'auth',
      operation: 'ADDED',
      requirements: [{ name: 'New requirement', text: 'The system MUST keep it.', scenarios: [] }],
    },
  ],
}

const ARCHIVED: ChangeDetail = {
  ...FULL,
  name: '2026-10-27-add-admin-indicator',
  status: 'complete',
  completedTasks: 5,
  totalTasks: 5,
  phase: 'archived',
  archived: true,
  archivedAt: '2026-10-27',
  modified: '2026-10-27T10:00:00',
}

const CAPABILITY: CapabilityDetail = {
  id: 'auth',
  requirementCount: 2,
  body: '# auth',
  modified: '2026-10-27T10:00:00',
  purpose: 'Authenticate requests before they reach a capability.',
  requirements: [
    SIGN_IN,
    { name: 'No logging', text: 'The system MUST NOT log tokens.', scenarios: [] },
  ],
  history: [
    {
      name: '2026-10-20-earlier',
      date: '2026-10-20',
      completedTasks: 2,
      totalTasks: 4,
      commit: null,
    },
    {
      name: '2026-10-27-add-admin-indicator',
      date: '2026-10-27',
      completedTasks: 5,
      totalTasks: 5,
      commit: COMMIT,
    },
  ],
  commit: COMMIT,
}

const CAPABILITY_ROWS: CapabilitySummary[] = [
  {
    id: 'admin-indicator',
    requirementCount: 10,
    purpose: 'Shows whether the running DSH Desktop has administrator rights.',
    modified: '2026-10-27T10:00:00',
    lastChange: {
      name: '2026-10-27-add-admin-indicator',
      date: '2026-10-27',
      completedTasks: 5,
      totalTasks: 5,
      commit: COMMIT,
    },
    commit: COMMIT,
  },
  {
    id: 'openspec-panel',
    requirementCount: 4,
    purpose: 'A read-only right-sidebar panel for OpenSpec changes.',
  },
]

function row(
  name: string,
  status: string,
  completedTasks = 0,
  totalTasks = 0,
  presence: ChangePresence = EMPTY_PRESENCE,
  extra: Partial<ChangeRow> = {},
): ChangeRow {
  return { name, status, completedTasks, totalTasks, presence, ...extra }
}

function listOf(
  changes: ChangeRow[],
  archived: ChangeRow[] = [],
  counts?: Partial<WorkspaceCounts>,
): ChangeListResponse {
  return {
    changes,
    archived,
    counts: {
      active: changes.length,
      archived: archived.length,
      capabilities: 0,
      ...counts,
    },
  }
}

const ARCHIVED_ROW = row('2026-10-27-add-admin-indicator', 'complete', 5, 5, EMPTY_PRESENCE, {
  archived: true,
  archivedAt: '2026-10-27',
  summary: 'Add the admin indicator to the app.',
  modified: '2026-10-27T10:00:00',
  commit: COMMIT,
  phase: 'archived',
})

const OLDER_ARCHIVED_ROW = row('2026-09-01-older-change', 'complete', 3, 3, EMPTY_PRESENCE, {
  archived: true,
  archivedAt: '2026-09-01',
  summary: 'Older archived work.',
  phase: 'archived',
})

function response(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

interface Mounted<P> {
  render(props?: P): void
  destroy(): void
  adopt(child: { destroy(): void }): void
  readonly tree: unknown
}

interface EffectSlot {
  deps?: readonly unknown[]
  run: () => void | (() => void)
  cleanup?: () => void
}

/** Minimal hook runtime: one instance per mount, React effect ordering. */
function mount<P>(component: (props: P) => unknown, initialProps: P): Mounted<P> {
  const states: unknown[] = []
  const refs: Array<{ current: unknown }> = []
  const memos: Array<{ deps: readonly unknown[]; value: unknown }> = []
  const effects: Array<EffectSlot | undefined> = []
  let pendingEffects: Array<{ deps?: readonly unknown[]; run: () => void | (() => void) }> = []
  let stateCursor = 0
  let props = initialProps
  let tree: unknown

  const sameDeps = (left: readonly unknown[], right: readonly unknown[]): boolean =>
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))

  const hooks = {
    useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] {
      const index = stateCursor++
      if (!(index in states)) states[index] = initial
      return [
        states[index] as T,
        (next) => {
          states[index] =
            typeof next === 'function' ? (next as (previous: T) => T)(states[index] as T) : next
        },
      ]
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]): void {
      pendingEffects.push({ deps, run: callback })
    },
    useRef<T>(initial: T): { current: T } {
      const index = stateCursor++
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index] as { current: T }
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
      const index = stateCursor++
      const previous = memos[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) {
        memos[index] = { deps, value: factory() }
      }
      return memos[index]?.value as T
    },
  }

  const render = (nextProps?: P): void => {
    if (nextProps !== undefined) props = nextProps
    stateCursor = 0
    pendingEffects = []
    active.hooks = hooks
    tree = component(props)
    for (let index = 0; index < pendingEffects.length; index += 1) {
      const next = pendingEffects[index]
      if (next === undefined) continue
      const slot = effects[index]
      const changed =
        next.deps === undefined ||
        slot === undefined ||
        slot.deps === undefined ||
        !sameDeps(slot.deps, next.deps)
      if (!changed) continue
      slot?.cleanup?.()
      const cleanup = next.run()
      effects[index] = {
        deps: next.deps,
        run: next.run,
        ...(typeof cleanup === 'function' ? { cleanup } : {}),
      }
    }
    for (let index = pendingEffects.length; index < effects.length; index += 1) {
      effects[index]?.cleanup?.()
      effects[index] = undefined
    }
  }

  const adopted: Array<{ destroy(): void }> = []

  return {
    render,
    adopt(child) {
      adopted.push(child)
    },
    destroy() {
      for (const slot of effects) slot?.cleanup?.()
      for (const child of adopted) child.destroy()
    },
    get tree() {
      return tree
    },
  }
}

interface Found {
  type: unknown
  props: Record<string, unknown>
}

function nodes(tree: unknown): Found[] {
  const found: Found[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const value = node as { type?: unknown; props?: unknown }
    if (value.type === undefined || value.props === null || typeof value.props !== 'object') return
    const props = value.props as Record<string, unknown>
    found.push({ type: value.type, props })
    walk(props.children)
  }
  walk(tree)
  return found
}

function textOf(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (typeof tree === 'number') return String(tree)
  if (tree === null || typeof tree !== 'object') return ''
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  const props = (tree as { props?: unknown }).props
  if (props === null || typeof props !== 'object') return ''
  return textOf((props as Record<string, unknown>).children)
}

function typed(tree: unknown, name: string): Found[] {
  return nodes(tree).filter(
    (node) => typeof node.type === 'function' && (node.type as { name: string }).name === name,
  )
}

/** Props of one child component; pure views are invoked by the test itself. */
function viewProps(tree: unknown, component: unknown): Record<string, unknown> {
  const found = nodes(tree).find((node) => node.type === component)
  if (found === undefined) throw new Error('view missing')
  return found.props
}

/** The root's counted segmented control. */
function segmented(tree: unknown): Found {
  const found = nodes(tree).find(
    (node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function',
  )
  if (found === undefined) throw new Error('segmented control missing')
  return found
}

/** The artifact/capability tab control. */
function tabControl(tree: unknown): Found {
  const found = nodes(tree).find(
    (node) => Array.isArray(node.props.items) && typeof node.props.onChange === 'function',
  )
  if (found === undefined) throw new Error('segmented tabs missing')
  return found
}

function cardButtons(tree: unknown): Found[] {
  return nodes(tree).filter(
    (node) =>
      (node.type === 'button' || node.type === 'Button') &&
      typeof node.props.className === 'string' &&
      /dsh-openspec-(card|history-row)/.exec(node.props.className) !== null,
  )
}

function buttonByText(tree: unknown, label: string): Found {
  const found = typed(tree, 'Button').find((node) => node.props.children === label)
  if (found === undefined) throw new Error(`button ${label} missing`)
  return found
}

function actionCard(tree: unknown, title: string): Found {
  const found = nodes(tree).find(
    (node) =>
      node.type === 'button' &&
      node.props.className === 'dsh-openspec-action-card' &&
      textOf(node).startsWith(title),
  )
  if (found === undefined) throw new Error(`action card ${title} missing`)
  return found
}

function inputOf(tree: unknown): Found {
  const found = typed(tree, 'Input')[0]
  if (found === undefined) throw new Error('input missing')
  return found
}

/** Invoke a found control's click handler, failing loudly when it is absent. */
function click(node: Found | undefined): void {
  if (node === undefined) throw new Error('control missing')
  const action = node.props.onClick
  if (typeof action !== 'function') throw new Error('control onClick missing')
  ;(action as () => void)()
}

function typeInto(node: Found, value: string): void {
  const action = node.props.onChange
  if (typeof action !== 'function') throw new Error('input onChange missing')
  ;(action as (event: { target: { value: string } }) => void)({ target: { value } })
}

interface FakeTab {
  readonly tab: {
    visible: boolean
    navigation: { address: string }
    actions: {
      bindCommands(commands: { refresh?: () => void }): () => void
      openResource(address: string): void
    }
  }
  readonly commands: Array<{ refresh?: () => void }>
  readonly releases: Array<ReturnType<typeof vi.fn>>
  readonly opened: string[]
}

function fakeTab(address: string, visible = true): FakeTab {
  const commands: Array<{ refresh?: () => void }> = []
  const releases: Array<ReturnType<typeof vi.fn>> = []
  const opened: string[] = []
  return {
    tab: {
      visible,
      navigation: { address },
      actions: {
        bindCommands(next) {
          commands.push(next)
          const release = vi.fn()
          releases.push(release)
          return release
        },
        openResource(value) {
          opened.push(value)
        },
      },
    },
    commands,
    releases,
    opened,
  }
}

interface TabRegistration {
  id: string
  kind: string
  patterns?: readonly string[]
  priority?: string
  canOpen?: (address: string) => boolean
  title: (address: string) => string
  guide?: Array<{
    id: string
    commandId: string
    order: number
    title: () => string
    description?: () => string
  }>
}

interface FakePanel {
  ctx: unknown
  tabs: TabRegistration[]
  locales: Array<{ namespace: string; locale: string; dictionary: Record<string, string> }>
  injections: string[]
  slotOptions: Array<Record<string, unknown>>
  bodies: unknown[]
  opened: string[]
  drafts: string[]
  submits: string[]
  commands: unknown[]
  injects: Array<readonly string[]>
}

/**
 * A Client context fake. `available` says the client half is active (the
 * picker services exist); `panel` says the right-sidebar services exist too.
 * `inject` always records the dependency list and runs the callback, so the
 * `registerPanel` guard, not cordis, is what keeps a host inert.
 */
function panelFake(available = true, panel = available): FakePanel {
  const tabs: TabRegistration[] = []
  const locales: FakePanel['locales'] = []
  const injections: string[] = []
  const slotOptions: Array<Record<string, unknown>> = []
  const bodies: unknown[] = []
  const opened: string[] = []
  const drafts: string[] = []
  const submits: string[] = []
  const commands: unknown[] = []
  const injects: Array<readonly string[]> = []
  const actx = { remote: {} }
  const ctx = {
    effect(callback: () => () => void) {
      return callback()
    },
    inject(deps: readonly string[], callback: (child: unknown) => void) {
      injects.push([...deps])
      if (available) callback(ctx)
      return () => {}
    },
    get(name: string): unknown {
      if (!available) return undefined
      if (name === 'commandUi') {
        return {
          register(contribution: unknown) {
            commands.push(contribution)
            return () => {}
          },
        }
      }
      if (name === 'sessions') {
        return {
          scope(id: string) {
            return id === 's1' ? actx : undefined
          },
        }
      }
      if (name === 'conversation') {
        return {
          input: {
            for(received: unknown) {
              expect(received).toBe(actx)
              return {
                setDraft(text: string) {
                  drafts.push(text)
                },
                submit() {
                  submits.push('submit')
                },
              }
            },
          },
        }
      }
      if (!panel) return undefined
      if (name === 'sidebarRightTabs') {
        return {
          register(definition: TabRegistration) {
            tabs.push(definition)
            return () => {}
          },
        }
      }
      if (name === 'sidebarRight') {
        return {
          openResource(address: string) {
            opened.push(address)
          },
        }
      }
      if (name === 'slots') {
        return {
          inject(key: string, callback: () => () => void) {
            injections.push(key)
            return callback()
          },
          register(options: Record<string, unknown>, component: unknown) {
            slotOptions.push(options)
            bodies.push(component)
            return () => {}
          },
        }
      }
      if (name === 'locale') {
        return {
          register(namespace: string, locale: string, dictionary: Record<string, string>) {
            locales.push({ namespace, locale, dictionary })
            return () => {}
          },
          bind() {
            return t
          },
        }
      }
      if (name === 'resources') return {}
      return undefined
    },
  }
  return {
    ctx,
    tabs,
    locales,
    injections,
    slotOptions,
    bodies,
    opened,
    drafts,
    submits,
    commands,
    injects,
  }
}

function memoryStorage(): { storage: SegmentStorage; values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
    },
  }
}

function rootProps(overrides: Partial<RootViewProps> = {}): RootViewProps {
  return {
    segment: 'changes',
    changes: LOADING,
    capabilities: LOADING,
    specQuery: '',
    archiveQuery: '',
    t,
    now: NOW,
    onSegment: () => {},
    onSpecQuery: () => {},
    onArchiveQuery: () => {},
    onRetry: () => {},
    onOpenChange: () => {},
    onOpenArtifact: () => {},
    onOpenCapability: () => {},
    onExplore: () => {},
    onPropose: () => {},
    onSeeArchive: () => {},
    ...overrides,
  }
}

function changeProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tab: fakeTab(changeAddress('add-auth')).tab,
    name: 'add-auth',
    sessionId: 's1',
    t,
    draft: () => {},
    open: () => {},
    ...overrides,
  }
}

function changeViewProps(overrides: Partial<ChangeViewProps> = {}): ChangeViewProps {
  return {
    change: FULL,
    artifact: 'proposal',
    delta: 'auth',
    requirementQuery: '',
    t,
    labels: LABELS,
    now: NOW,
    onArtifact: () => {},
    onDelta: () => {},
    onRequirementQuery: () => {},
    onApply: () => {},
    onOpenCapability: () => {},
    ...overrides,
  }
}

function capabilityViewProps(overrides: Partial<CapabilityViewProps> = {}): CapabilityViewProps {
  return {
    capability: CAPABILITY,
    requirementQuery: '',
    t,
    labels: LABELS,
    now: NOW,
    section: 'requirements',
    onSection: () => {},
    onRequirementQuery: () => {},
    onOpenArchived: () => {},
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OpenSpec panel addresses', () => {
  it('accepts the root, active change, archived change, and capability shapes', () => {
    expect(canOpenOpenSpec(ROOT_ADDRESS)).toBe(true)
    expect(canOpenOpenSpec(SPECS_ADDRESS)).toBe(true)
    expect(canOpenOpenSpec(changeAddress('add-auth'))).toBe(true)
    expect(canOpenOpenSpec(changeAddress('add-auth', 'design'))).toBe(true)
    expect(canOpenOpenSpec(archivedChangeAddress('add-auth'))).toBe(true)
    expect(canOpenOpenSpec(archivedChangeAddress('add-auth', 'specs'))).toBe(true)
    expect(canOpenOpenSpec(capabilityAddress('auth'))).toBe(true)
    for (const address of [
      'sidebar://openspec/extra',
      'dsh-resource://openspec/specs/',
      'dsh-resource://openspec/change/',
      'dsh-resource://openspec/archive-change/',
      'dsh-resource://openspec/change/add-auth/bogus',
      'dsh-resource://openspec/change/add-auth/design/extra',
      'dsh-resource://openspec/archive-change/add-auth/design/extra',
      'dsh-resource://openspec/spec/%E0%A4%A',
      'dsh-resource://openspec/change/add-auth?artifact=design',
      'sidebar://files',
      'https://example.com/openspec/change/add-auth',
    ]) {
      expect(canOpenOpenSpec(address)).toBe(false)
      expect(openSpecTarget(address)).toBeUndefined()
    }
  })

  it('keeps the archived address distinct from a same-named active change', () => {
    const name = '2026-10-27-add-admin-indicator'
    expect(changeAddress(name)).toBe(`dsh-resource://openspec/change/${name}`)
    expect(archivedChangeAddress(name)).toBe(`dsh-resource://openspec/archive-change/${name}`)
    expect(changeAddress(name)).not.toBe(archivedChangeAddress(name))
    expect(openSpecTarget(changeAddress(name))).toEqual({ view: 'change', name })
    expect(openSpecTarget(archivedChangeAddress(name))).toEqual({
      view: 'change',
      name,
      archived: true,
    })
    expect(openSpecTitle(archivedChangeAddress(name))).toBe(name)
    expect(openSpecTitle(changeAddress(name))).toBe(name)
    expect(openSpecTarget(changeAddress(name, 'design'))).toEqual({
      view: 'change',
      name,
      artifact: 'design',
    })
    expect(openSpecTarget(archivedChangeAddress(name, 'tasks'))).toEqual({
      view: 'change',
      name,
      archived: true,
      artifact: 'tasks',
    })
    expect(openSpecTarget(ROOT_ADDRESS)).toEqual({ view: 'root', segment: 'changes' })
    expect(openSpecTarget(SPECS_ADDRESS)).toEqual({ view: 'root', segment: 'specs' })
    expect(openSpecTarget(capabilityAddress('auth'))).toEqual({ view: 'capability', id: 'auth' })
    expect(openSpecTitle(ROOT_ADDRESS)).toBe('OpenSpec')
  })
})

describe('OpenSpec panel data layer', () => {
  it('decodes a legacy list response and derives the missing totals', async () => {
    const fetchMock = vi.fn(async () =>
      response({
        changes: [
          {
            name: 'add-auth',
            completedTasks: 4,
            totalTasks: 12,
            status: 'in-progress',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const decoded = await requestChangeList('s1')
    expect(decoded.changes).toHaveLength(1)
    expect(decoded.changes[0]?.phase).toBeUndefined()
    expect(phaseOf(decoded.changes[0] as ChangeRow)).toBe('applying')
    expect(decoded.archived).toEqual([])
    expect(decoded.counts).toEqual({ active: 1, archived: 0, capabilities: 0 })
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHANGES_PATH}?session=s1`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('decodes the additive list response with archive rows and counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          changes: [row('add-auth', 'in-progress', 4, 12, EMPTY_PRESENCE, { phase: 'applying' })],
          archived: [ARCHIVED_ROW],
          counts: { active: 2, archived: 34, capabilities: 19 },
        }),
      ),
    )
    const decoded = await requestChangeList('s1')
    expect(decoded.changes).toHaveLength(1)
    expect(decoded.archived[0]?.name).toBe(ARCHIVED_ROW.name)
    expect(decoded.archived[0]?.archivedAt).toBe('2026-10-27')
    expect(decoded.archived[0]?.summary).toBe('Add the admin indicator to the app.')
    expect(decoded.archived[0]?.commit).toEqual(COMMIT)
    expect(decoded.counts).toEqual({ active: 2, archived: 34, capabilities: 19 })
  })

  it('derives every phase and prefers an explicit host phase', () => {
    expect(derivePhase({ status: 'no-tasks' })).toBe('planning')
    expect(derivePhase({ status: 'in-progress', completedTasks: 0, totalTasks: 0 })).toBe(
      'planning',
    )
    expect(derivePhase({ status: 'in-progress', completedTasks: 0, totalTasks: 3 })).toBe(
      'ready-to-apply',
    )
    expect(derivePhase({ status: 'in-progress', completedTasks: 4, totalTasks: 12 })).toBe(
      'applying',
    )
    expect(derivePhase({ status: 'in-progress', completedTasks: 12, totalTasks: 12 })).toBe(
      'complete',
    )
    expect(derivePhase({ status: 'complete', completedTasks: 3, totalTasks: 3 })).toBe('complete')
    expect(derivePhase({ status: 'in-progress', archived: true })).toBe('archived')
    expect(phaseOf(row('a', 'complete', 1, 1, EMPTY_PRESENCE, { phase: 'planning' }))).toBe(
      'planning',
    )
  })

  it('decodes a renamed delta and its from/to pair', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          change: {
            name: 'add-auth',
            status: 'in-progress',
            completedTasks: 4,
            totalTasks: 12,
            artifacts: { proposal: '# Why', design: null, tasks: null },
            specs: [],
            deltas: [
              {
                capability: 'auth',
                operation: 'RENAMED',
                requirements: [],
                rename: { from: 'Old name', to: 'New name' },
              },
              {
                capability: 'auth',
                operation: 'ADDED',
                requirements: [
                  { name: 'New requirement', text: 'The system MUST keep it.', scenarios: [] },
                ],
              },
            ],
            modified: '2026-11-05T14:03:00',
          },
        }),
      ),
    )
    const change = await requestChange('s1', 'add-auth')
    expect(change.deltas).toHaveLength(2)
    expect(change.deltas?.[0]).toMatchObject({
      capability: 'auth',
      operation: 'RENAMED',
      requirements: [],
      rename: { from: 'Old name', to: 'New name' },
    })
    expect(change.deltas?.[1]?.requirements[0]?.name).toBe('New requirement')
    expect(change.archived).toBeUndefined()
    expect(change.summary).toBeUndefined()
  })

  it('decodes the task files the checklist must parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          change: {
            name: 'add-auth',
            status: 'in-progress',
            completedTasks: 1,
            totalTasks: 2,
            artifacts: { proposal: '# Why', design: null, tasks: '## A\n- [x] one' },
            specs: [],
            deltas: [],
            taskFiles: [
              { path: 'openspec/changes/add-auth/tasks.md', body: '## A\n- [x] one' },
              { path: 'openspec/changes/add-auth/tasks/nested.md', body: '## B\n- [ ] two' },
            ],
            modified: null,
          },
        }),
      ),
    )
    const change = await requestChange('s1', 'add-auth')
    expect(change.taskFiles).toEqual([
      { path: 'openspec/changes/add-auth/tasks.md', body: '## A\n- [x] one' },
      { path: 'openspec/changes/add-auth/tasks/nested.md', body: '## B\n- [ ] two' },
    ])
  })

  it('requests an archived change through the same route with the archived flag', async () => {
    const fetchMock = vi.fn(async () => response({ change: ARCHIVED }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      requestChange('s1', '2026-10-27-add-admin-indicator', true),
    ).resolves.toMatchObject({ name: ARCHIVED.name, archived: true, archivedAt: '2026-10-27' })
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHANGE_PATH}?session=s1&name=2026-10-27-add-admin-indicator&archived=1`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('decodes legacy capability responses without the structured fields', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('id=auth')
        ? response({
            capability: {
              id: 'auth',
              requirementCount: 2,
              body: '# a',
              modified: '2026-11-05T14:03:00',
            },
          })
        : response({ capabilities: [{ id: 'auth', requirementCount: 2 }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestCapabilities('s1')).resolves.toHaveLength(1)
    await expect(requestCapability('s1', 'auth')).resolves.toMatchObject({
      id: 'auth',
      requirementCount: 2,
      body: '# a',
      requirements: [],
      history: [],
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${SPECS_PATH}?session=s1`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('searches case-insensitively and treats a missing summary as absent', () => {
    expect(matchesQuery('AUTH', 'add-auth', null)).toBe(true)
    expect(matchesQuery('  auth  ', 'ADD-AUTH')).toBe(true)
    expect(matchesQuery('billing', 'add-auth')).toBe(false)
    expect(matchesQuery('', 'anything')).toBe(true)
    expect(matchesQuery('purpose', undefined, 'A Purpose Here')).toBe(true)
    expect(summaryText(undefined)).toBeNull()
    expect(summaryText('   ')).toBeNull()
    expect(summaryText('  one line  ')).toBe('one line')
    const withoutSummary = row('add-auth', 'in-progress', 1, 2)
    expect(withoutSummary.summary).toBeUndefined()
  })

  it('formats relative update facts and ISO dates', () => {
    expect(relativeLabel(null, NOW)).toBeNull()
    expect(relativeLabel('not-a-date', NOW)).toBeNull()
    expect(relativeLabel('2026-11-05T17:00:00', NOW)).toBe('just now')
    expect(relativeLabel('2026-11-05T16:55:00', NOW)).toBe('5m ago')
    expect(relativeLabel('2026-11-05T14:03:00', NOW)).toBe('2h ago')
    expect(relativeLabel('2026-11-03T17:00:00', NOW)).toBe('2d ago')
    expect(relativeLabel('2026-09-05T17:00:00', NOW)).toBe('2mo ago')
    expect(relativeLabel('2025-11-05T17:00:00', NOW)).toBe('1y ago')
    expect(relativeLabel('2025-11-05T17:00:00', NOW)).toBe('1y ago')
    expect(isoDate('2026-10-27T10:00:00Z')).toBe('2026-10-27')
    expect(isoDate('2026-10-27')).toBe('2026-10-27')
    expect(isoDate(null)).toBeNull()
    expect(isoDate('nonsense')).toBeNull()
  })

  it('sorts archive newest first and history newest first', () => {
    expect(sortArchived([OLDER_ARCHIVED_ROW, ARCHIVED_ROW]).map((entry) => entry.name)).toEqual([
      ARCHIVED_ROW.name,
      OLDER_ARCHIVED_ROW.name,
    ])
    const history: HistoryEntry[] = [
      { name: 'old', date: '2026-09-01', completedTasks: 1, totalTasks: 1, commit: null },
      { name: 'new', date: '2026-10-27', completedTasks: 5, totalTasks: 5, commit: COMMIT },
    ]
    expect(sortHistory(history).map((entry) => entry.name)).toEqual(['new', 'old'])
  })

  it('treats nested task files as the Tasks artifact', () => {
    const nested: ChangeDetail = {
      ...FULL,
      deltas: [],
      specs: [],
      artifacts: { proposal: null, design: null, tasks: null },
      taskFiles: [
        { path: 'openspec/changes/add-auth/tasks/nested.md', body: '## Nested\n- [ ] one' },
      ],
    }
    expect(hasArtifact(nested, 'tasks')).toBe(true)
    expect(initialArtifact(nested)).toBe('tasks')
    expect(hasArtifact({ ...nested, taskFiles: [] }, 'tasks')).toBe(false)
  })

  it('sorts unfinished changes before complete ones, stable within each group', () => {
    const rows = [
      row('complete-a', 'complete'),
      row('open-b', 'in-progress'),
      row('complete-c', 'complete'),
      row('open-d', 'no-tasks'),
    ]
    expect(sortChanges(rows).map((entry) => entry.name)).toEqual([
      'open-b',
      'open-d',
      'complete-a',
      'complete-c',
    ])
  })

  it('builds the file addresses and watched paths the panel observes', () => {
    expect(fileAddress('s1', 'openspec/changes/add-auth/tasks.md')).toBe(
      'dsh-resource://file/session/s1/openspec/changes/add-auth/tasks.md',
    )
    expect(fileAddress('s1', 'openspec/changes/add-auth/specs/auth/spec.md')).toBe(
      'dsh-resource://file/session/s1/openspec/changes/add-auth/specs/auth/spec.md',
    )
  })

  it('remembers the root segment in injected storage', () => {
    const { storage, values } = memoryStorage()
    expect(readSegment(storage, 's1')).toBeUndefined()
    expect(readSegment(undefined, 's1')).toBeUndefined()
    writeSegment(storage, 's1', 'specs')
    expect(readSegment(storage, 's1')).toBe('specs')
    expect(values.get(segmentStorageKey('s1'))).toBe('specs')
    expect(readSegment(storage, 's2')).toBeUndefined()
    writeSegment(storage, 's2', 'archive')
    expect(readSegment(storage, 's1')).toBe('specs')
    expect(readSegment(storage, 's2')).toBe('archive')
    values.set(segmentStorageKey('s1'), 'nonsense')
    expect(isRootSegment('nonsense')).toBe(false)
    expect(readSegment(storage, 's1')).toBeUndefined()
    const throwing: SegmentStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readSegment(throwing, 's1')).toBeUndefined()
    expect(() => writeSegment(throwing, 's1', 'changes')).not.toThrow()
    expect(initialRootSegment('specs', 'archive')).toBe('specs')
    expect(initialRootSegment('changes', 'archive')).toBe('archive')
    expect(initialRootSegment('changes', undefined)).toBe('changes')
  })
})

describe('OpenSpec panel renderers', () => {
  it('renders inline code, strong, emphasis, and http links', () => {
    const tree = InlineText({
      text: 'Use `administrator`, **bold**, *em*, and [docs](https://example.com/docs).',
    })
    expect(textOf(tree)).toBe('Use administrator, bold, em, and docs.')
    expect(textOf(tree)).not.toContain('`')
    expect(nodes(tree).find((node) => node.type === 'code')?.props.children).toBe('administrator')
    expect(nodes(tree).some((node) => node.type === 'strong')).toBe(true)
    expect(nodes(tree).some((node) => node.type === 'em')).toBe(true)
    const link = nodes(tree).find((node) => node.type === 'a')
    expect(link?.props.href).toBe('https://example.com/docs')
    expect(link?.props.target).toBe('_blank')
  })

  it('renders nested formatting inside strong, emphasis, and links', () => {
    const strongTree = InlineText({ text: '**Use `probe`.**' })
    expect(textOf(strongTree)).toBe('Use probe.')
    expect(nodes(strongTree).find((node) => node.type === 'code')?.props.children).toBe('probe')
    const emphasisTree = InlineText({ text: '*The system SHALL comply.*' })
    expect(textOf(emphasisTree)).toBe('The system SHALL comply.')
    expect(
      nodes(emphasisTree).some(
        (node) => node.type === 'span' && node.props.className === 'dsh-openspec-keyword',
      ),
    ).toBe(true)
    const linkTree = InlineText({ text: '[`docs`](https://example.com/docs)' })
    expect(textOf(linkTree)).toBe('docs')
    expect(nodes(linkTree).some((node) => node.type === 'code')).toBe(true)
  })

  it('keeps asterisks inside nested inline code', () => {
    const strong = InlineText({ text: '**Use `*.ts`.**' })
    expect(textOf(strong)).toBe('Use *.ts.')
    expect(nodes(strong).find((node) => node.type === 'code')?.props.children).toBe('*.ts')
    expect(nodes(strong).some((node) => node.type === 'strong')).toBe(true)
    const emphasis = InlineText({ text: '*Run `a * b`.*' })
    expect(textOf(emphasis)).toBe('Run a * b.')
    expect(nodes(emphasis).find((node) => node.type === 'code')?.props.children).toBe('a * b')
    expect(nodes(emphasis).some((node) => node.type === 'em')).toBe(true)
  })

  it('marks SHALL, MUST, and MUST NOT without changing the text', () => {
    const source = 'The system SHALL keep it; a client MUST NOT lose it; lower-case shall stays.'
    const tree = InlineText({ text: source })
    expect(textOf(tree)).toBe(source)
    const keywords = nodes(tree).filter(
      (node) => node.type === 'span' && node.props.className === 'dsh-openspec-keyword',
    )
    expect(keywords.map((node) => node.props.children)).toEqual(['SHALL', 'MUST NOT'])
  })

  it('renders a requirement with several labelled scenarios', () => {
    const requirement: Requirement = {
      name: 'Long requirement',
      text: 'The system MUST branch.',
      scenarios: [
        {
          name: 'First',
          rawText: '- **WHEN** one\n- **THEN** two\n- **AND** three\n- **BUT** not four',
        },
        { name: 'Second', rawText: '- **WHEN** five\n- **THEN** six' },
      ],
    }
    const tree = RequirementList({ requirements: [requirement], query: '', t, onQuery: () => {} })
    const text = textOf(tree)
    expect(text).toContain('Long requirement')
    expect(text).toContain('Scenario: First')
    expect(text).toContain('Scenario: Second')
    const tags = nodes(tree).filter(
      (node) => node.type === 'span' && node.props.className === 'dsh-openspec-step-tag',
    )
    expect(tags.map((node) => node.props.children)).toEqual([
      'WHEN',
      'THEN',
      'AND',
      'BUT',
      'WHEN',
      'THEN',
    ])
  })

  it('renders a requirement without scenarios and keeps its inline code', () => {
    const tree = RequirementList({
      requirements: [
        { name: 'No scenarios', text: 'The system SHALL call `probe` once.', scenarios: [] },
      ],
      query: '',
      t,
      onQuery: () => {},
    })
    expect(textOf(tree)).toContain('No scenarios')
    expect(textOf(tree)).not.toContain('Scenario:')
    expect(nodes(tree).find((node) => node.type === 'code')?.props.children).toBe('probe')
  })

  it('filters more than twelve requirements and states an empty match', () => {
    const requirements: Requirement[] = Array.from({ length: 13 }, (_value, index) => ({
      name: `Requirement ${String(index + 1)}`,
      text: `The system SHALL do step ${String(index + 1)}.`,
      scenarios: [],
    }))
    const base = { requirements, t, onQuery: () => {} }
    const all = RequirementList({ ...base, query: '' })
    expect(typed(all, 'Input')).toHaveLength(1)
    expect(textOf(all)).toContain('Requirement 13')
    const filtered = RequirementList({ ...base, query: 'requirement 7' })
    expect(textOf(filtered)).toContain('Requirement 7')
    expect(textOf(filtered)).not.toContain('Requirement 8')
    const empty = RequirementList({ ...base, query: 'nothing' })
    expect(textOf(empty)).toContain('No requirements match this filter.')
  })

  it('does not filter twelve or fewer requirements', () => {
    const requirements: Requirement[] = Array.from({ length: 12 }, (_value, index) => ({
      name: `Requirement ${String(index + 1)}`,
      text: 'The system SHALL do it.',
      scenarios: [],
    }))
    const tree = RequirementList({ requirements, query: '', t, onQuery: () => {} })
    expect(typed(tree, 'Input')).toHaveLength(0)
    expect(textOf(tree)).toContain('Requirement 12')
  })

  it('renders task groups with per-group done/total and step marks', () => {
    const content = [
      '## First',
      '- [x] alpha',
      '- [ ] beta',
      '## Second',
      '- [x] gamma',
      '- [x] delta',
      '- [ ] epsilon',
      '- [x] zeta',
      '## Third',
      '- [ ] eta',
    ].join('\n')
    const tree = TaskChecklist({ content, completedTasks: 4, totalTasks: 7, t })
    const text = textOf(tree)
    expect(text).toContain('First')
    expect(text).toContain('Second')
    expect(text).toContain('Third')
    expect(text).toContain('1/2')
    expect(text).toContain('3/4')
    expect(text).toContain('0/1')
    const steps = typed(tree, 'StateDot')
    expect(steps).toHaveLength(7)
    expect(steps.filter((step) => step.props.state === 'done')).toHaveLength(4)
    expect(steps.filter((step) => step.props.state === 'idle')).toHaveLength(3)
    expect(steps.every((step) => step.props.appearance === 'step')).toBe(true)
    expect(
      nodes(tree).some(
        (node) =>
          node.type === 'span' &&
          typeof node.props.className === 'string' &&
          node.props.className.includes('dsh-openspec-task-done'),
      ),
    ).toBe(true)
  })

  it('parses the pinned CLI task grammar to the same 2/3 the CLI reports', () => {
    const content = '* [x] done\n1. [ ] pending\n- [X] also done'
    expect(parseTaskLines(content)).toEqual([
      { done: true, description: 'done' },
      { done: false, description: 'pending' },
      { done: true, description: 'also done' },
    ])
    const tree = TaskChecklist({ content, completedTasks: 2, totalTasks: 3, t })
    expect(textOf(tree)).toContain('2/3')
  })

  it('counts every checkbox form and skips link bullets', () => {
    const content = [
      '- [Some doc](./doc.md)',
      '- [A](https://example.com)',
      '  - [~] waiting',
      '2) [ ] ordered',
      '+ [] empty',
      '- [ x ] padded',
      '- [1] unusual',
      '- [x] real',
    ].join('\n')
    const tasks = parseTaskLines(content)
    expect(tasks).toEqual([
      { done: false, description: 'waiting' },
      { done: false, description: 'ordered' },
      { done: false, description: 'empty' },
      { done: true, description: 'padded' },
      { done: false, description: 'unusual' },
      { done: true, description: 'real' },
    ])
    expect(parseTaskGroups(content)).toHaveLength(1)
  })

  it('groups CRLF task files by their headings', () => {
    const groups = parseTaskGroups('## First\r\n- [x] a\r\n## Second\r\n- [ ] b')
    expect(groups.map((group) => group.title)).toEqual(['First', 'Second'])
    expect(groups.map((group) => group.tasks.length)).toEqual([1, 1])
    expect(groups[1]?.tasks[0]).toEqual({ done: false, description: 'b' })
  })

  it('states when tasks are not written and names an unparsed remainder', () => {
    expect(textOf(TaskChecklist({ content: null, completedTasks: 0, totalTasks: 0, t }))).toContain(
      'Not written yet.',
    )
    expect(
      textOf(
        TaskChecklist({ content: 'No checkboxes here.', completedTasks: 0, totalTasks: 0, t }),
      ),
    ).toContain('tasks not written yet')
    expect(
      textOf(
        TaskChecklist({ content: 'No checkboxes here.', completedTasks: 0, totalTasks: 3, t }),
      ),
    ).toContain('3 tasks not parsed from the file.')
    const tree = TaskChecklist({
      content: '## Group\n- [x] one\n- [ ] two',
      completedTasks: 1,
      totalTasks: 4,
      t,
    })
    expect(textOf(tree)).toContain('2 tasks not parsed from the file.')
  })
})

describe('OpenSpec panel registration', () => {
  it('registers the locale, tab type, Start card, and body when the services exist', () => {
    const fake = panelFake()
    registerPanel(fake.ctx as never)
    expect(fake.locales).toHaveLength(1)
    expect(fake.locales[0]?.namespace).toBe('dsh-setup-openspec-panel')
    expect(fake.locales[0]?.locale).toBe('en')
    expect(fake.locales[0]?.dictionary['guide.title']).toBe('OpenSpec')
    expect(fake.locales[0]?.dictionary['segment.archive']).toBe('Archive')
    expect(fake.locales[0]?.dictionary['phase.ready-to-apply']).toBe('ready to apply')
    expect(fake.locales[0]?.dictionary['capability.historyEmpty']).toBe(
      'No archived change produced this capability.',
    )
    expect(fake.tabs).toHaveLength(1)
    const definition = fake.tabs[0]
    expect(definition?.id).toBe(OPENSPEC_ID)
    expect(definition?.kind).toBe(OPENSPEC_KIND)
    expect(definition?.patterns).toEqual([ROOT_ADDRESS, 'dsh-resource://openspec/**'])
    expect(definition?.priority).toBe('extension')
    expect(definition?.canOpen?.(ROOT_ADDRESS)).toBe(true)
    expect(definition?.canOpen?.(SPECS_ADDRESS)).toBe(true)
    expect(definition?.canOpen?.(changeAddress('add-auth'))).toBe(true)
    expect(definition?.canOpen?.(archivedChangeAddress('add-auth'))).toBe(true)
    expect(definition?.canOpen?.('sidebar://files')).toBe(false)
    expect(definition?.guide).toHaveLength(1)
    expect(definition?.guide?.[0]).toMatchObject({
      id: 'open',
      commandId: 'openspec.panel',
      order: 10,
    })
    expect(definition?.guide?.[0]?.title()).toBe('OpenSpec')
    expect(definition?.guide?.[0]?.description?.()).toContain('OpenSpec')
    expect(fake.injections).toEqual(['sidebar.right.pane.tab'])
    expect(fake.slotOptions[0]).toMatchObject({
      name: 'sidebar.right.pane.tab',
      key: OPENSPEC_ID,
      locale: 'dsh-setup-openspec-panel',
    })
    expect(typeof fake.bodies[0]).toBe('function')
  })

  it('registers nothing and raises nothing without the right-sidebar services', () => {
    const fake = panelFake(false)
    expect(() => registerPanel(fake.ctx as never)).not.toThrow()
    expect(fake.tabs).toEqual([])
    expect(fake.locales).toEqual([])
    expect(fake.injections).toEqual([])
  })

  it('activates the panel through apply with the exact service list', () => {
    const fake = panelFake()
    expect(() => apply(fake.ctx as never)).not.toThrow()
    expect(fake.injects).toEqual([
      ['sidebarRight', 'sidebarRightTabs', 'slots', 'locale', 'resources'],
    ])
    expect(fake.commands).toHaveLength(1)
    expect((fake.commands[0] as { name: string }).name).toBe('openspec-apply')
    expect(fake.locales).toHaveLength(1)
    expect(fake.tabs).toHaveLength(1)
    expect(fake.bodies).toHaveLength(1)
  })

  it('registers no panel without the right-sidebar services, while the picker still registers', () => {
    const fake = panelFake(true, false)
    expect(() => apply(fake.ctx as never)).not.toThrow()
    expect(fake.commands).toHaveLength(1)
    expect(fake.tabs).toEqual([])
    expect(fake.locales).toEqual([])
    expect(fake.injections).toEqual([])
    expect(fake.bodies).toEqual([])
  })
})

describe('OpenSpec panel composer handoff', () => {
  it('fills the apply draft and never submits', () => {
    const drafts: string[] = []
    const submits: string[] = []
    const scope = { remote: {} }
    const handoff = createHandoff(
      { scope: (id) => (id === 's1' ? scope : undefined) },
      {
        input: {
          for() {
            return {
              setDraft(text: string) {
                drafts.push(text)
              },
              submit() {
                submits.push('submit')
              },
            }
          },
        },
      },
      { openResource: () => {} },
    )
    handoff.draft('s1', applyDraft('add-auth'))
    expect(drafts).toEqual(['/openspec-apply-change add-auth'])
    expect(submits).toEqual([])
    expect(() => handoff.draft('closed', applyDraft('add-auth'))).toThrow(/not open/)
  })

  it('fills the exact explore and propose drafts from the mounted root without submitting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          changes: [],
          archived: [],
          counts: { active: 0, archived: 0, capabilities: 0 },
        }),
      ),
    )
    const drafts: string[] = []
    const submits: string[] = []
    const handoff = createHandoff(
      { scope: (id) => (id === 's1' ? { remote: {} } : undefined) },
      {
        input: {
          for() {
            return {
              setDraft(text: string) {
                drafts.push(text)
              },
              submit() {
                submits.push('submit')
              },
            }
          },
        },
      },
      { openResource: () => {} },
    )
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: (text: string) => handoff.draft('s1', text),
        open: () => {},
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = RootView(viewProps(body.tree, RootView) as never)
    click(actionCard(view, 'Explore'))
    click(actionCard(view, 'Propose'))
    expect(drafts).toEqual(['/openspec-explore ', '/openspec-propose '])
    expect(submits).toEqual([])
    body.destroy()
  })

  it('opens resources through the sidebar when the tab action is unavailable', () => {
    const opened: string[] = []
    const handoff = createHandoff(undefined, undefined, {
      openResource: (address) => {
        opened.push(address)
      },
    })
    handoff.open(archivedChangeAddress('add-auth'))
    expect(opened).toEqual(['dsh-resource://openspec/archive-change/add-auth'])
  })
})

describe('OpenSpec root view', () => {
  it('shows the counted header and all three totals before Specs loads', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      response({
        changes: [row('add-auth', 'in-progress', 4, 12)],
        archived: [ARCHIVED_ROW],
        counts: { active: 2, archived: 34, capabilities: 19 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
      } as never,
    )
    body.render()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/changes')
    const view = RootView(viewProps(body.tree, RootView) as never)
    const options = segmented(view).props.options as Array<{ value: string; label: string }>
    expect(options.map((option) => option.label)).toEqual(['Changes 2', 'Specs 19', 'Archive 34'])
    expect(actionCard(view, 'Explore')).toBeDefined()
    expect(actionCard(view, 'Propose')).toBeDefined()
    body.destroy()
  })

  it('shows one quiet loading line instead of an empty list', () => {
    const tree = RootView(rootProps())
    expect(textOf(tree)).toContain('Loading…')
    expect(typed(tree, 'TextShimmer')[0]?.props.active).toBe(true)
    expect(textOf(tree)).not.toContain('No open changes')
  })

  it('renders the change card decision facts', () => {
    const applying = row(
      'add-auth',
      'in-progress',
      4,
      12,
      {
        proposal: true,
        design: true,
        tasks: false,
        specs: 2,
      },
      {
        summary: 'Add authentication to the product.',
        modified: '2026-11-05T15:00:00',
        commit: COMMIT,
        phase: 'applying',
      },
    )
    const tree = RootView(
      rootProps({
        changes: { phase: 'ready', value: listOf([applying]) },
        now: NOW,
      }),
    )
    const card = cardButtons(tree)[0]
    if (card === undefined) throw new Error('card missing')
    const text = textOf(card)
    expect(text).toContain('applying')
    expect(text).toContain('add-auth')
    expect(text).toContain('4/12')
    expect(text).toContain('Add authentication to the product.')
    expect(text).toContain('proposal')
    expect(text).toContain('design')
    expect(text).toContain('specs')
    expect(text).toContain('updated 2h ago')
    expect(text).toContain('7e87448')
    expect(text).toContain('2026-10-27')
    const head = nodes(card).find((node) => node.props.className === 'dsh-openspec-card-head')
    expect(textOf(head)).toContain('updated 2h ago')
    expect(textOf(head)).not.toContain('4/12')
    const purpose = nodes(card).find((node) =>
      String(node.props.className ?? '').includes('dsh-openspec-purpose-clamp'),
    )
    expect(String(purpose?.props.className)).toContain('dsh-openspec-purpose-clamp')
    const phaseTag = typed(tree, 'Tag').find((tag) => tag.props.children === 'applying')
    expect(phaseTag?.props.tone).toBe('info')
    expect(typed(tree, 'StateDot')[0]?.props.state).toBe('ongoing')
    const progress = nodes(tree).find((node) => node.props.role === 'progressbar')
    expect(progress?.props['aria-valuenow']).toBe(4)
    expect(progress?.props['aria-valuemax']).toBe(12)
    expect(typed(tree, 'Tooltip')[0]?.props.label).toBe('Add authentication to the product.')
  })

  it('shows the whole Why in the card tooltip and expands it on focus', () => {
    const why = 'Add authentication to the product.\n\nSecond paragraph.'
    const tree = RootView(
      rootProps({
        changes: {
          phase: 'ready',
          value: listOf([
            row('add-auth', 'in-progress', 1, 2, undefined, {
              summary: 'Add authentication',
              why,
            }),
          ]),
        },
      }),
    )
    const card = cardButtons(tree)[0]
    if (card === undefined) throw new Error('card missing')
    expect(typed(card, 'Tooltip')[0]?.props.label).toBe(why)
    const toggle = nodes(card).find((node) =>
      String(node.props.className ?? '').includes('dsh-openspec-purpose-toggle'),
    )
    expect(toggle?.props.tabIndex).toBe(0)
    expect(toggle?.props.role).toBe('button')
    expect(PANEL_CSS).toContain(':focus-within')
    expect(PANEL_CSS).toContain('-webkit-line-clamp: unset')
  })

  it('opens a change at the artifact whose card tag was clicked', () => {
    const onOpenArtifact = vi.fn()
    const tree = RootView(
      rootProps({
        changes: {
          phase: 'ready',
          value: listOf([
            row('add-auth', 'in-progress', 4, 12, {
              proposal: true,
              design: true,
              tasks: true,
              specs: 2,
            }),
          ]),
        },
        onOpenArtifact,
      }),
    )
    const card = cardButtons(tree)[0]
    if (card === undefined) throw new Error('card missing')
    const link = nodes(card).find(
      (node) => node.props.className === 'dsh-openspec-artifact-link' && textOf(node) === 'design',
    )
    if (link === undefined) throw new Error('artifact link missing')
    ;(link.props.onClick as (event: { stopPropagation(): void }) => void)({
      stopPropagation: () => {},
    })
    expect(onOpenArtifact).toHaveBeenCalledWith('add-auth', false, 'design')
  })

  it('maps planning, complete, and archived cards to their semantic tones', () => {
    const planning = row(
      'new-idea',
      'no-tasks',
      0,
      0,
      { proposal: true, design: false, tasks: false, specs: 0 },
      { phase: 'planning', summary: 'An idea.' },
    )
    const complete = row('done-change', 'complete', 2, 2, EMPTY_PRESENCE, { summary: 'Done.' })
    const tree = RootView(
      rootProps({
        changes: { phase: 'ready', value: listOf([planning, complete]) },
      }),
    )
    const tags = typed(tree, 'Tag')
    expect(tags.find((tag) => tag.props.children === 'planning')?.props.tone).toBe('warning')
    expect(tags.find((tag) => tag.props.children === 'complete')?.props.tone).toBe('success')
    expect(textOf(tree)).toContain('tasks not written yet')
    const archivedTree = RootView(
      rootProps({
        segment: 'archive',
        changes: {
          phase: 'ready',
          value: listOf([], [ARCHIVED_ROW], { archived: 1 }),
        },
      }),
    )
    const archivedTag = typed(archivedTree, 'Tag').find(
      (tag) => tag.props.children === '2026-10-27',
    )
    expect(archivedTag?.props.tone).toBe('quiet')
    expect(cardButtons(archivedTree)[0]?.props.className).toContain('dsh-openspec-card-archived')
  })

  it('groups unfinished changes before complete ones', () => {
    const tree = RootView(
      rootProps({
        changes: {
          phase: 'ready',
          value: listOf([
            row('z-complete', 'complete'),
            row('a-open', 'in-progress', 1, 2),
            row('b-open', 'no-tasks'),
          ]),
        },
      }),
    )
    const text = textOf(tree)
    expect(text).toContain('In progress')
    expect(text).toContain('Complete')
    expect(cardButtons(tree).map((entry) => textOf(entry))).toEqual([
      expect.stringContaining('a-open'),
      expect.stringContaining('b-open'),
      expect.stringContaining('z-complete'),
    ])
  })

  it('filters capability rows by name or purpose and states an empty match', () => {
    const tree = RootView(
      rootProps({
        segment: 'specs',
        changes: { phase: 'ready', value: listOf([], [], { capabilities: 2 }) },
        capabilities: { phase: 'ready', value: CAPABILITY_ROWS },
        specQuery: 'right-sidebar',
      }),
    )
    expect(cardButtons(tree)).toHaveLength(1)
    expect(textOf(cardButtons(tree)[0])).toContain('openspec-panel')
    const upper = RootView(
      rootProps({
        segment: 'specs',
        changes: { phase: 'ready', value: listOf([], [], { capabilities: 2 }) },
        capabilities: { phase: 'ready', value: CAPABILITY_ROWS },
        specQuery: 'ADMIN',
      }),
    )
    expect(cardButtons(upper)).toHaveLength(1)
    expect(textOf(cardButtons(upper)[0])).toContain('admin-indicator')
    const empty = RootView(
      rootProps({
        segment: 'specs',
        changes: { phase: 'ready', value: listOf([], [], { capabilities: 2 }) },
        capabilities: { phase: 'ready', value: CAPABILITY_ROWS },
        specQuery: 'nothing-matches',
      }),
    )
    expect(textOf(empty)).toContain('No capabilities match this filter.')
    expect(segmented(empty).props.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'specs', label: 'Specs 2' })]),
    )
  })

  it('renders the capability card with the change-card head and meta layout', () => {
    const tree = RootView(
      rootProps({
        segment: 'specs',
        changes: { phase: 'ready', value: listOf([], [], { capabilities: 2 }) },
        capabilities: { phase: 'ready', value: CAPABILITY_ROWS },
        now: new Date('2026-10-27T12:00:00'),
      }),
    )
    const card = cardButtons(tree)[0]
    if (card === undefined) throw new Error('capability card missing')
    const head = nodes(card).find((node) => node.props.className === 'dsh-openspec-card-head')
    expect(textOf(head)).toContain('2026-10-27')
    expect(textOf(head)).toContain('admin-indicator')
    expect(textOf(head)).toContain('updated 2h ago')
    expect(textOf(head)).not.toContain('10 req')
    const text = textOf(card)
    expect(text).toContain('Accepted via 2026-10-27-add-admin-indicator')
    expect(text).toContain('10 req')
    expect(text).toContain('7e87448')
    expect(text).not.toContain('5/5')
    expect(typed(card, 'Tooltip')[0]?.props.label).toBe(
      'Shows whether the running DSH Desktop has administrator rights.',
    )
  })

  it('filters archived changes and states an empty match', () => {
    const rows = [ARCHIVED_ROW, OLDER_ARCHIVED_ROW]
    const tree = RootView(
      rootProps({
        segment: 'archive',
        changes: { phase: 'ready', value: listOf([], rows, { archived: 2 }) },
        archiveQuery: 'ADMIN',
      }),
    )
    expect(cardButtons(tree)).toHaveLength(1)
    expect(textOf(cardButtons(tree)[0])).toContain(ARCHIVED_ROW.name)
    const empty = RootView(
      rootProps({
        segment: 'archive',
        changes: { phase: 'ready', value: listOf([], rows, { archived: 2 }) },
        archiveQuery: 'zzz',
      }),
    )
    expect(textOf(empty)).toContain('No archived changes match this filter.')
  })

  it('renders an empty change list with totals, both actions, and recent archive', () => {
    const onSeeArchive = vi.fn()
    const rows = [
      ARCHIVED_ROW,
      OLDER_ARCHIVED_ROW,
      row('2026-08-01-third', 'complete', 1, 1, EMPTY_PRESENCE, {
        archived: true,
        archivedAt: '2026-08-01',
        summary: 'Third.',
      }),
      row('2026-07-01-fourth', 'complete', 1, 1, EMPTY_PRESENCE, {
        archived: true,
        archivedAt: '2026-07-01',
        summary: 'Fourth.',
      }),
    ]
    const tree = RootView(
      rootProps({
        changes: {
          phase: 'ready',
          value: listOf([], rows, { archived: 4, capabilities: 19 }),
        },
        onSeeArchive,
      }),
    )
    const text = textOf(tree)
    expect(text).toContain('Recently archived')
    expect(text).toContain(ARCHIVED_ROW.name)
    expect(text).not.toContain('0 changes · 19 specs · 4 archived')
    expect(text).toContain('2026-08-01-third')
    expect(text).not.toContain('2026-07-01-fourth')
    expect(actionCard(tree, 'Explore')).toBeDefined()
    expect(actionCard(tree, 'Propose')).toBeDefined()
    click(buttonByText(tree, 'See all archive'))
    expect(onSeeArchive).toHaveBeenCalledTimes(1)
  })

  it('renders the specs and archive empty states with their next actions', () => {
    const onSeeArchive = vi.fn()
    const specs = RootView(
      rootProps({
        segment: 'specs',
        capabilities: { phase: 'ready', value: [] },
        changes: {
          phase: 'ready',
          value: listOf([], [ARCHIVED_ROW], { archived: 1, capabilities: 0 }),
        },
        onSeeArchive,
      }),
    )
    expect(textOf(specs)).toContain('No accepted specs yet')
    expect(textOf(specs)).toContain('Archive a completed change to add one.')
    click(buttonByText(specs, 'Open archive'))
    expect(onSeeArchive).toHaveBeenCalledTimes(1)
    const archive = RootView(
      rootProps({
        segment: 'archive',
        changes: { phase: 'ready', value: listOf([], [], { archived: 0 }) },
      }),
    )
    expect(textOf(archive)).toContain('Nothing archived yet')
    expect(textOf(archive)).toContain('Complete a change and archive it to keep its history here.')
  })

  it('shows the Host cause for a missing root and a missing CLI, with retry', () => {
    for (const message of [NO_LOCAL_ROOT_MESSAGE, MISSING_CLI_MESSAGE]) {
      const onRetry = vi.fn()
      const tree = RootView(
        rootProps({
          changes: { phase: 'error', message },
          onRetry,
        }),
      )
      expect(textOf(tree)).toContain(message)
      expect(typed(tree, 'IconWarningTriangleOutlineRegular')).toHaveLength(1)
      click(buttonByText(tree, 'Retry'))
      expect(onRetry).toHaveBeenCalledTimes(1)
    }
  })

  it('opens the exact active and archived addresses', async () => {
    const opened: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          changes: [row('add-auth', 'in-progress', 1, 2)],
          archived: [ARCHIVED_ROW],
          counts: { active: 1, archived: 1, capabilities: 0 },
        }),
      ),
    )
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open: (address: string) => opened.push(address),
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = () => RootView(viewProps(body.tree, RootView) as never)
    click(cardButtons(view())[0])
    expect(opened).toEqual([changeAddress('add-auth')])
    ;(segmented(view()).props.onChange as (value: string) => void)('archive')
    body.render()
    click(cardButtons(view())[0])
    expect(opened).toEqual([changeAddress('add-auth'), archivedChangeAddress(ARCHIVED_ROW.name)])
    expect(openSpecTarget(opened[1] as string)).toEqual({
      view: 'change',
      name: ARCHIVED_ROW.name,
      archived: true,
    })
    body.destroy()
  })

  it('restores the remembered Specs segment after a capability was opened', async () => {
    const { storage } = memoryStorage()
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/specs')
        ? response({ capabilities: CAPABILITY_ROWS })
        : response({
            changes: [],
            archived: [],
            counts: { active: 0, archived: 0, capabilities: 2 },
          }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const first = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
        storage,
      } as never,
    )
    first.render()
    await settle()
    first.render()
    ;(
      segmented(RootView(viewProps(first.tree, RootView) as never)).props.onChange as (
        value: string,
      ) => void
    )('specs')
    first.render()
    await settle()
    first.render()
    expect(viewProps(first.tree, RootView).segment).toBe('specs')
    expect(readSegment(storage, 's1')).toBe('specs')
    first.destroy()

    const second = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
        storage,
      } as never,
    )
    second.render()
    await settle()
    second.render()
    expect(viewProps(second.tree, RootView).segment).toBe('specs')
    expect((viewProps(second.tree, RootView).capabilities as { phase: string }).phase).toBe('ready')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/specs'))).toBe(true)
    second.destroy()
  })

  it('persists an explicit Specs address so returning from a capability keeps Specs', async () => {
    const { storage } = memoryStorage()
    writeSegment(storage, 's1', 'archive')
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/specs')
        ? response({ capabilities: CAPABILITY_ROWS })
        : response({
            changes: [],
            archived: [],
            counts: { active: 0, archived: 0, capabilities: 2 },
          }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const first = mount(
      RootBody as never,
      {
        tab: fakeTab(SPECS_ADDRESS).tab,
        initialSegment: 'specs',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
        storage,
      } as never,
    )
    first.render()
    await settle()
    first.render()
    expect(viewProps(first.tree, RootView).segment).toBe('specs')
    expect(readSegment(storage, 's1')).toBe('specs')
    first.destroy()

    const second = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
        storage,
      } as never,
    )
    second.render()
    await settle()
    second.render()
    expect(viewProps(second.tree, RootView).segment).toBe('specs')
    expect((viewProps(second.tree, RootView).capabilities as { phase: string }).phase).toBe('ready')
    second.destroy()
  })

  it('lets the explicit Specs address win over a remembered segment', async () => {
    const { storage } = memoryStorage()
    writeSegment(storage, 's1', 'archive')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/specs')
          ? response({ capabilities: CAPABILITY_ROWS })
          : response({
              changes: [],
              archived: [],
              counts: { active: 0, archived: 0, capabilities: 2 },
            }),
      ),
    )
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(SPECS_ADDRESS).tab,
        initialSegment: 'specs',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
        storage,
      } as never,
    )
    body.render()
    await settle()
    body.render()
    expect(viewProps(body.tree, RootView).segment).toBe('specs')
    body.destroy()
  })
})

describe('OpenSpec change view', () => {
  it('offers the four artifact tabs with ids and the delta count', () => {
    const chosen: string[] = []
    const tree = ChangeView(
      changeViewProps({
        change: TWO_DELTAS,
        onArtifact: (kind) => chosen.push(kind),
      }),
    )
    const control = tabControl(tree)
    const items = control.props.items as Array<Record<string, string>>
    expect(items.map((item) => item.label)).toEqual(['Why', 'Design', 'Specs (2)', 'Tasks'])
    expect(items.map((item) => item.value)).toEqual(['proposal', 'design', 'specs', 'tasks'])
    expect(new Set(items.map((item) => item.id)).size).toBe(4)
    expect(items.every((item) => String(item.panelId).endsWith('-panel'))).toBe(true)
    const selected = items.find((item) => item.value === 'proposal')
    const panel = nodes(tree).find((node) => node.props.role === 'tabpanel')
    expect(panel?.props.id).toBe(selected?.panelId)
    expect(panel?.props['aria-labelledby']).toBe(selected?.id)
    ;(control.props.onChange as (value: string) => void)('design')
    expect(chosen).toEqual(['design'])
    expect(typed(tree, 'MarkdownText')[0]?.props.text).toBe('# Why')
    expect(typed(tree, 'MarkdownText')[0]?.props.labels).toBe(LABELS)
    const purpose = nodes(tree).find((node) =>
      String(node.props.className ?? '').includes('dsh-openspec-purpose'),
    )
    expect(String(purpose?.props.className)).not.toContain('purpose-clamp')
  })

  it('shows a missing artifact body as unavailable with its reason', () => {
    const tree = ChangeView(changeViewProps({ change: NO_DESIGN, artifact: 'design' }))
    expect(textOf(tree)).toContain('Not written yet.')
    expect(typed(tree, 'MarkdownText')).toHaveLength(0)
  })

  it('marks the missing Design tab unavailable while a written artifact is selected', () => {
    const chosen: string[] = []
    const tree = ChangeView(
      changeViewProps({
        change: NO_DESIGN,
        artifact: 'proposal',
        onArtifact: (kind) => chosen.push(kind),
      }),
    )
    const items = tabControl(tree).props.items as Array<{ value: string; label: unknown }>
    const design = items.find((item) => item.value === 'design')
    const unavailable = nodes(design?.label).find(
      (node) => node.props.className === 'dsh-openspec-tab-unavailable',
    )
    expect(unavailable?.props.title).toBe('Not written yet.')
    expect(textOf(design?.label)).toContain('Not written yet.')
    // The shipped control moves focus and selection together; the view honours
    // its change and the unavailable body carries the reason.
    ;(tabControl(tree).props.onChange as (value: string) => void)('design')
    expect(chosen).toEqual(['design'])
  })

  it('namespaces tab and panel ids by the active/archive family', () => {
    const idsOf = (tree: unknown): string[] =>
      (tabControl(tree).props.items as Array<{ id: string; panelId: string }>).map(
        (item) => `${item.id}|${item.panelId}`,
      )
    const active = idsOf(ChangeView(changeViewProps({ change: { ...FULL, name: 'same' } })))
    const archived = idsOf(ChangeView(changeViewProps({ change: { ...ARCHIVED, name: 'same' } })))
    expect(active.some((id) => archived.includes(id))).toBe(false)
    expect(active.every((id) => id.includes('-active-'))).toBe(true)
    expect(archived.every((id) => id.includes('-archived-'))).toBe(true)
  })

  it('switches between delta capabilities and maps operation tones', () => {
    const deltas: string[] = []
    const tree = ChangeView(
      changeViewProps({
        change: TWO_DELTAS,
        artifact: 'specs',
        delta: 'auth',
        onDelta: (capability) => deltas.push(capability),
      }),
    )
    expect(textOf(tree)).toContain('2 delta specs')
    const pills = typed(tree, 'Pill')
    expect(pills.map((pill) => pill.props.children)).toEqual(['auth', 'billing'])
    expect(pills[0]?.props.active).toBe(true)
    click(pills[1])
    expect(deltas).toEqual(['billing'])
    const switched = ChangeView(
      changeViewProps({ change: TWO_DELTAS, artifact: 'specs', delta: 'billing' }),
    )
    expect(textOf(switched)).toContain('Billing window')
    expect(textOf(switched)).not.toContain('Sign-in')
    const tags = typed(tree, 'Tag')
    expect(tags.find((tag) => tag.props.children === 'ADDED')?.props.tone).toBe('info')
  })

  it('renders the RENAMED pair and keeps the other requirement groups', () => {
    const tree = ChangeView(changeViewProps({ change: RENAMED, artifact: 'specs', delta: 'auth' }))
    const text = textOf(tree)
    expect(text).toContain('RENAMED')
    expect(text).toContain('ADDED')
    expect(text).toContain('Old name')
    expect(text).toContain('New name')
    expect(text).toContain('New requirement')
    const tags = typed(tree, 'Tag')
    expect(tags.find((tag) => tag.props.children === 'RENAMED')?.props.tone).toBe('warning')
    expect(tags.find((tag) => tag.props.children === 'ADDED')?.props.tone).toBe('info')
  })

  it('opens the accepted capability from a delta', () => {
    const opened: string[] = []
    const tree = ChangeView(
      changeViewProps({
        artifact: 'specs',
        onOpenCapability: (id) => opened.push(id),
      }),
    )
    click(buttonByText(tree, 'Open accepted spec'))
    expect(opened).toEqual(['auth'])
  })

  it('renders the pre-redesign delta body as Markdown', () => {
    const tree = ChangeView(
      changeViewProps({ change: LEGACY_DELTAS, artifact: 'specs', delta: 'auth' }),
    )
    expect(typed(tree, 'MarkdownText')[0]?.props.text).toBe('# auth delta')
    expect(typed(tree, 'Tag').some((tag) => tag.props.children === 'ADDED')).toBe(false)
  })

  it('falls back to raw Markdown for a capability without a structured delta', () => {
    const opened: string[] = []
    const change: ChangeDetail = {
      ...TWO_DELTAS,
      deltas: [AUTH_DELTA],
      specs: [{ capability: 'archived-cap', body: '# archived raw', modified: '' }],
    }
    const fallback = ChangeView(
      changeViewProps({
        change,
        artifact: 'specs',
        delta: 'archived-cap',
        onOpenCapability: (id) => opened.push(id),
      }),
    )
    expect(typed(fallback, 'Pill').map((pill) => pill.props.children)).toEqual([
      'auth',
      'archived-cap',
    ])
    expect(typed(fallback, 'MarkdownText')[0]?.props.text).toBe('# archived raw')
    click(buttonByText(fallback, 'Open accepted spec'))
    expect(opened).toEqual(['archived-cap'])
    const structured = ChangeView(changeViewProps({ change, artifact: 'specs', delta: 'auth' }))
    expect(textOf(structured)).toContain('Sign-in')
    expect(typed(structured, 'MarkdownText')).toHaveLength(0)
  })

  it('parses every task file the Host reports and keeps the CLI total', () => {
    const change: ChangeDetail = {
      ...FULL,
      completedTasks: 2,
      totalTasks: 3,
      taskFiles: [
        { path: 'openspec/changes/add-auth/tasks.md', body: '## One\n- [x] a\n- [ ] b' },
        { path: 'openspec/changes/add-auth/tasks/nested.md', body: '## Two\n- [x] c' },
      ],
    }
    const tree = ChangeView(changeViewProps({ change, artifact: 'tasks' }))
    const text = textOf(tree)
    expect(text).toContain('One')
    expect(text).toContain('Two')
    expect(text).toContain('1/2')
    expect(text).toContain('1/1')
    expect(text).toContain('2/3 tasks')
    expect(text).not.toContain('tasks not parsed from the file.')
  })

  it('renders nested-only task files when the top-level tasks.md is absent', () => {
    const change: ChangeDetail = {
      ...ARCHIVED,
      artifacts: { proposal: null, design: null, tasks: null },
      completedTasks: 1,
      totalTasks: 1,
      taskFiles: [
        { path: 'openspec/changes/archive/x/tasks/nested.md', body: '## Nested\n- [x] one' },
      ],
    }
    const tree = ChangeView(changeViewProps({ change, artifact: 'tasks' }))
    expect(textOf(tree)).toContain('Nested')
    expect(textOf(tree)).not.toContain('Not written yet.')
    expect(textOf(tree)).toContain('1/1 tasks')
  })

  it('renders the grouped task checklist while keeping the header progress', () => {
    const tree = ChangeView(changeViewProps({ artifact: 'tasks' }))
    expect(textOf(tree)).toContain('4/12 tasks')
    expect(textOf(tree)).toContain('Group')
    expect(typed(tree, 'MarkdownText')).toHaveLength(0)
  })

  it('fills the apply draft through the header action and hides it when archived', () => {
    const applied: string[] = []
    const tree = ChangeView(changeViewProps({ onApply: () => applied.push('apply') }))
    click(buttonByText(tree, 'Apply change'))
    expect(applied).toEqual(['apply'])
    const archived = ChangeView(changeViewProps({ change: ARCHIVED, artifact: 'specs' }))
    expect(textOf(archived)).toContain('archived')
    expect(textOf(archived)).toContain('2026-10-27')
    expect(
      typed(archived, 'Button').some((button) => button.props.children === 'Apply change'),
    ).toBe(false)
  })

  it('shows the relative last-updated fact and hides it when the route has none', () => {
    expect(textOf(ChangeView(changeViewProps()))).toContain('updated 2h ago')
    expect(
      textOf(ChangeView(changeViewProps({ change: { ...FULL, modified: null } }))),
    ).not.toContain('updated')
    expect(
      textOf(
        ChangeView(
          changeViewProps({
            change: { ...FULL, modified: '2026-11-03T17:00:00' },
          }),
        ),
      ),
    ).toContain('updated 2d ago')
  })
})

describe('OpenSpec capability view', () => {
  it('renders the accepted-spec header facts', () => {
    const tree = CapabilityView(capabilityViewProps())
    const text = textOf(tree)
    expect(text).toContain('auth')
    expect(text).toContain('Authenticate requests before they reach a capability.')
    expect(text).toContain('2 requirements')
    expect(text).toContain('1 scenarios')
    expect(text).toContain('Accepted 2026-10-27')
    expect(text).toContain('via 2026-10-27-add-admin-indicator')
    expect(text).toContain('7e87448')
    expect(tabControl(tree).props.value).toBe('requirements')
    const items = tabControl(tree).props.items as Array<Record<string, string>>
    expect(items.map((item) => item.label)).toEqual(['Requirements (2)', 'History (2)'])
    expect(textOf(tree)).toContain('Sign-in')
    const purpose = nodes(tree).find((node) =>
      String(node.props.className ?? '').includes('dsh-openspec-purpose'),
    )
    expect(String(purpose?.props.className)).not.toContain('purpose-clamp')
    const producer = typed(tree, 'Tag').find((tag) =>
      String(tag.props.children).includes('via 2026-10-27-add-admin-indicator'),
    )
    expect(producer?.props.className).toBe('dsh-openspec-producer')
  })

  it('renders the commit date even when it differs from the modification date', () => {
    const tree = CapabilityView(
      capabilityViewProps({
        capability: {
          ...CAPABILITY,
          modified: '2026-10-30T10:00:00Z',
          commit: {
            short: 'bbb2222',
            at: '2026-10-05T08:00:00Z',
            subject: 'fix: earlier commit',
          },
        },
      }),
    )
    expect(textOf(tree)).toContain('bbb2222')
    expect(textOf(tree)).toContain('2026-10-05')
  })

  it('switches to the history section through the tabs', () => {
    const sections: string[] = []
    const tree = CapabilityView(
      capabilityViewProps({ onSection: (section) => sections.push(section) }),
    )
    ;(tabControl(tree).props.onChange as (value: string) => void)('history')
    expect(sections).toEqual(['history'])
    const history = CapabilityView(capabilityViewProps({ section: 'history' }))
    expect(textOf(history)).toContain('2026-10-27-add-admin-indicator')
    expect(textOf(history)).toContain('5/5')
  })

  it('orders history newest first and opens the exact archived address', () => {
    const opened: string[] = []
    const tree = CapabilityView(
      capabilityViewProps({
        section: 'history',
        onOpenArchived: (name) => opened.push(name),
      }),
    )
    const rows = cardButtons(tree)
    expect(rows).toHaveLength(2)
    expect(textOf(rows[0])).toContain('2026-10-27-add-admin-indicator')
    expect(textOf(rows[1])).toContain('2026-10-20-earlier')
    click(rows[0])
    expect(opened).toEqual(['2026-10-27-add-admin-indicator'])
    expect(archivedChangeAddress(opened[0] as string)).toBe(
      'dsh-resource://openspec/archive-change/2026-10-27-add-admin-indicator',
    )
  })

  it('states an empty history and falls back to the Markdown body without requirements', () => {
    const empty = CapabilityView(
      capabilityViewProps({
        capability: { ...CAPABILITY, history: [] },
        section: 'history',
      }),
    )
    expect(textOf(empty)).toContain('No archived change produced this capability.')
    const legacy = CapabilityView(
      capabilityViewProps({
        capability: {
          id: 'auth',
          requirementCount: 2,
          body: '# auth',
          modified: '2026-10-27T10:00:00',
        },
      }),
    )
    expect(typed(legacy, 'MarkdownText')[0]?.props.text).toBe('# auth')
  })
})

describe('OpenSpec tab bodies', () => {
  it('keeps a different artifact selection in each tab body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ change: FULL })),
    )
    const first = mount(ChangeBody as never, changeProps() as never)
    const second = mount(ChangeBody as never, changeProps() as never)
    first.render()
    second.render()
    await settle()
    first.render()
    second.render()
    const firstView = () =>
      nodes(first.tree).find((node) => node.type === ChangeView) as {
        props: Record<string, unknown>
      }
    const secondView = () =>
      nodes(second.tree).find((node) => node.type === ChangeView) as {
        props: Record<string, unknown>
      }
    expect(firstView().props.artifact).toBe('proposal')
    ;(firstView().props.onArtifact as (kind: string) => void)('design')
    first.render()
    expect(firstView().props.artifact).toBe('design')
    expect(secondView().props.artifact).toBe('proposal')
    first.destroy()
    second.destroy()
  })

  it('reads an archived change through the archived address without file observation', async () => {
    const fetchMock = vi.fn(async () => response({ change: ARCHIVED }))
    vi.stubGlobal('fetch', fetchMock)
    const body = mount(
      ChangeBody as never,
      {
        ...changeProps(),
        tab: fakeTab(archivedChangeAddress(ARCHIVED.name)).tab,
        archived: true,
        name: ARCHIVED.name,
      } as never,
    )
    body.render()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHANGE_PATH}?session=s1&name=${ARCHIVED.name}&archived=1`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(nodes(body.tree).filter((node) => node.type === FileWatch)).toHaveLength(0)
    const view = viewProps(body.tree, ChangeView)
    expect(view.change).toMatchObject({ archived: true, archivedAt: '2026-10-27' })
    expect(textOf(ChangeView(view as never))).toContain('2026-10-27')
    body.destroy()
  })

  it('keeps the canonical active change address through every artifact and Apply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('name=add-auth')
          ? response({ change: FULL })
          : response({
              changes: [row('add-auth', 'in-progress', 4, 12)],
              archived: [],
              counts: { active: 1, archived: 0, capabilities: 0 },
            }),
      ),
    )
    const open = vi.fn()
    const root = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open,
      } as never,
    )
    root.render()
    await settle()
    root.render()
    click(cardButtons(RootView(viewProps(root.tree, RootView) as never))[0])
    const firstCall = open.mock.calls[0]
    if (firstCall === undefined) throw new Error('navigation missing')
    const address: unknown = firstCall[0]
    if (typeof address !== 'string') throw new Error('navigation address missing')
    expect(address).toBe('dsh-resource://openspec/change/add-auth')
    expect(address).not.toContain('?')
    expect(openSpecTarget(address)).toEqual({ view: 'change', name: 'add-auth' })

    const tab = fakeTab(address)
    const draft = vi.fn()
    const dispatch = mount(
      OpenSpecTab as never,
      {
        useTabInfo: () => ({ tab: tab.tab }),
        sessionId: 's1',
        t,
        handoff: { draft, open },
      } as never,
    )
    dispatch.render()
    const changeBody = nodes(dispatch.tree).find((node) => node.type === ChangeBody)
    if (changeBody === undefined) throw new Error('change body missing')
    expect(changeBody.props.name).toBe('add-auth')
    expect(changeBody.props.archived).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
    expect(tab.opened).toEqual([])

    const body = mount(ChangeBody as never, changeBody.props as never)
    body.render()
    await settle()
    body.render()
    for (const artifact of ['proposal', 'design', 'specs', 'tasks'] as const) {
      ;(viewProps(body.tree, ChangeView).onArtifact as (kind: string) => void)(artifact)
      body.render()
      expect(viewProps(body.tree, ChangeView).artifact).toBe(artifact)
      expect(tab.tab.navigation.address).toBe(address)
      expect(tab.opened).toEqual([])
      expect(open).toHaveBeenCalledTimes(1)
    }
    ;(viewProps(body.tree, ChangeView).onApply as () => void)()
    expect(draft).toHaveBeenCalledWith('s1', '/openspec-apply-change add-auth')
    expect(tab.tab.navigation.address).toBe(address)
    body.destroy()
    dispatch.destroy()
    root.destroy()
  })

  it('dispatches the archived tab address to the archived change body', () => {
    const tree = OpenSpecTab({
      useTabInfo: () => ({ tab: fakeTab(archivedChangeAddress(ARCHIVED.name)).tab }),
      sessionId: 's1',
      t,
      handoff: { draft: () => {}, open: () => {} },
    } as never)
    const changeBody = nodes(tree).find((node) => node.type === ChangeBody)
    expect(changeBody?.props.archived).toBe(true)
    expect(changeBody?.props.name).toBe(ARCHIVED.name)
    const root = OpenSpecTab({
      useTabInfo: () => ({ tab: fakeTab(ROOT_ADDRESS).tab }),
      sessionId: 's1',
      t,
      handoff: { draft: () => {}, open: () => {} },
    } as never)
    expect(nodes(root).some((node) => node.type === RootBody)).toBe(true)
  })

  it('registers one refresh command, re-reads once per refresh and on show, then disposes', async () => {
    const fetchMock = vi.fn(async () => response({ change: FULL }))
    vi.stubGlobal('fetch', fetchMock)
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const interval = vi.spyOn(globalThis, 'setInterval')
    const fake = fakeTab(changeAddress('add-auth'))
    const props = changeProps({ tab: fake.tab })
    const body = mount(ChangeBody as never, props as never)
    body.render()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fake.commands).toHaveLength(1)
    fake.commands[0]?.refresh?.()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    body.render({ ...props, tab: { ...fake.tab, visible: false } } as never)
    body.render({ ...props, tab: { ...fake.tab, visible: true } } as never)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fake.releases[0]).not.toHaveBeenCalled()
    body.destroy()
    expect(fake.releases[0]).toHaveBeenCalledTimes(1)
    expect(timeout).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    timeout.mockRestore()
    interval.mockRestore()
  })

  it('retries a failed root read after the cause is fixed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: MISSING_CLI_MESSAGE }, false))
      .mockResolvedValueOnce(
        response({
          changes: [row('add-auth', 'in-progress', 1, 2)],
          archived: [],
          counts: { active: 1, archived: 0, capabilities: 0 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(ROOT_ADDRESS).tab,
        initialSegment: 'changes',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = (): unknown => RootView(viewProps(body.tree, RootView) as never)
    expect(textOf(view())).toContain(MISSING_CLI_MESSAGE)
    click(buttonByText(view(), 'Retry'))
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(textOf(view())).toContain('add-auth')
    body.destroy()
  })

  it('starts the Specs segment for the specs root address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/specs')
          ? response({ capabilities: CAPABILITY_ROWS })
          : response({
              changes: [],
              archived: [],
              counts: { active: 0, archived: 0, capabilities: 2 },
            }),
      ),
    )
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(SPECS_ADDRESS).tab,
        initialSegment: 'specs',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = (): unknown => RootView(viewProps(body.tree, RootView) as never)
    expect(segmented(view()).props.value).toBe('specs')
    expect(textOf(view())).toContain('admin-indicator')
    body.destroy()
  })
})

describe('OpenSpec live observation', () => {
  type WatchMount = Mounted<never>

  function watchesOf(tree: unknown): Found[] {
    return nodes(tree).filter((node) => node.type === FileWatch)
  }

  function watchElement(tree: unknown, address: string): Found {
    const element = watchesOf(tree).find((node) => node.props.address === address)
    if (element === undefined) throw new Error(`watch ${address} missing`)
    return element
  }

  /** Mount or update one hidden watch from the tree's current props. */
  function mountWatch(
    element: Found,
    watches: Map<string, WatchMount>,
    useResource: (address: string) => ResourceFacts,
    parent?: Mounted<never>,
  ): void {
    const address = element.props.address
    if (typeof address !== 'string') throw new Error('watch address missing')
    const props = { ...element.props, useResource }
    const existing = watches.get(address)
    if (existing === undefined) {
      const created = mount(FileWatch as never, props as never)
      created.render()
      watches.set(address, created)
      parent?.adopt(created)
    } else {
      existing.render(props as never)
    }
  }

  function syncWatches(
    tree: unknown,
    watches: Map<string, WatchMount>,
    useResource: (address: string) => ResourceFacts,
    parent?: Mounted<never>,
  ): void {
    for (const element of watchesOf(tree)) mountWatch(element, watches, useResource, parent)
  }

  function destroyWatches(watches: Map<string, WatchMount>): void {
    for (const watch of watches.values()) watch.destroy()
  }

  const liveV1 = (): ResourceFacts => ({ status: 'live', value: { version: 'v1' } })

  it('settles the first observation, then reports changes, absences, and appearances', () => {
    const address = 'dsh-resource://file/session/s1/openspec/changes/add-auth/tasks.md'
    let file: ResourceFacts = { status: 'live', value: { version: 'v1' } }
    const settled = vi.fn()
    const changed = vi.fn()
    const watch = mount(
      FileWatch as never,
      {
        address,
        useResource: () => file,
        settle: settled,
        change: changed,
      } as never,
    )
    watch.render()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(settled).toHaveBeenCalledWith(address, true)
    expect(changed).not.toHaveBeenCalled()
    watch.render()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(changed).not.toHaveBeenCalled()
    file = { status: 'live', value: { version: 'v2' } }
    watch.render()
    expect(changed).toHaveBeenCalledTimes(1)
    file = { status: 'failed' }
    watch.render()
    expect(changed).toHaveBeenCalledTimes(2)
    file = { status: 'live', value: { version: 'v2' } }
    watch.render()
    expect(changed).toHaveBeenCalledTimes(3)
    watch.destroy()
  })

  it('settles a missing file as not observable and reports its appearance', () => {
    const address = 'dsh-resource://file/session/s1/openspec/changes/add-auth/design.md'
    let file: ResourceFacts = { status: 'failed' }
    const settled = vi.fn()
    const changed = vi.fn()
    const watch = mount(
      FileWatch as never,
      { address, useResource: () => file, settle: settled, change: changed } as never,
    )
    watch.render()
    expect(settled).toHaveBeenCalledWith(address, false)
    expect(changed).not.toHaveBeenCalled()
    file = { status: 'live', value: { version: 'v1' } }
    watch.render()
    expect(changed).toHaveBeenCalledTimes(1)
    watch.destroy()
  })

  it('settles a provider-absent file without reporting a change', () => {
    const settled = vi.fn()
    const changed = vi.fn()
    const watch = mount(
      FileWatch as never,
      {
        address: 'dsh-resource://file/session/s1/openspec/specs/auth/spec.md',
        useResource: (): ResourceFacts => ({ status: 'none' }),
        settle: settled,
        change: changed,
      } as never,
    )
    watch.render()
    watch.render()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(settled.mock.calls[0]?.[1]).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    watch.destroy()
  })

  it('schedules one reconciliation read after all first reports and not again for unchanged versions', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => response({ change: NO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const watches = new Map<string, WatchMount>()
      syncWatches(body.tree, watches, liveV1)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
      syncWatches(body.tree, watches, liveV1)
      expect(vi.getTimerCount()).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      destroyWatches(watches)
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('collapses staggered first reports into exactly one reconciliation read', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => response({ change: NO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const addresses = watchesOf(body.tree).map((node) => node.props.address as string)
      expect(addresses).toHaveLength(3)
      const watches = new Map<string, WatchMount>()

      mountWatch(watchElement(body.tree, addresses[0] as string), watches, liveV1)
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      mountWatch(watchElement(body.tree, addresses[1] as string), watches, liveV1)
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      mountWatch(watchElement(body.tree, addresses[2] as string), watches, liveV1)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)

      syncWatches(body.tree, watches, liveV1)
      expect(vi.getTimerCount()).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      destroyWatches(watches)
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-reads when the file changes before its first observation', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response({ change: FULL }))
        .mockResolvedValueOnce(response({ change: LATER }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(viewProps(body.tree, ChangeView).change).toEqual(FULL)
      const watches = new Map<string, WatchMount>()
      syncWatches(
        body.tree,
        watches,
        (): ResourceFacts => ({
          status: 'live',
          value: { version: 'v-b' },
        }),
      )
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const change = viewProps(body.tree, ChangeView).change as ChangeDetail
      expect(change.artifacts.proposal).toBe('# Why, revised')
      syncWatches(
        body.tree,
        watches,
        (): ResourceFacts => ({
          status: 'live',
          value: { version: 'v-b' },
        }),
      )
      expect(vi.getTimerCount()).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      destroyWatches(watches)
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-reads once after a live version bump and only then', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => response({ change: NO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const bumped = watchesOf(body.tree)[0]?.props.address
      if (typeof bumped !== 'string') throw new Error('bump address missing')
      let version = 'v1'
      const useResource = (address: string): ResourceFacts => ({
        status: 'live',
        value: { version: address === bumped ? version : 'v1' },
      })
      const watches = new Map<string, WatchMount>()
      syncWatches(body.tree, watches, useResource)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
      version = 'v2'
      syncWatches(body.tree, watches, useResource)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(0)
      syncWatches(body.tree, watches, useResource)
      expect(vi.getTimerCount()).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      destroyWatches(watches)
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('debounces normal changes into one re-read and clears the timer on unmount', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => response({ change: NO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
      const changes = watchesOf(body.tree).map((element) => element.props.change)
      ;(changes[0] as () => void)()
      ;(changes[1] as () => void)()
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(299)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
      ;(changes[0] as () => void)()
      expect(vi.getTimerCount()).toBe(1)
      body.destroy()
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(300)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-reads when a watched file appears after an observed absence', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => response({ change: NO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const element = watchesOf(body.tree)[0]
      if (element === undefined) throw new Error('watch missing')
      let file: ResourceFacts = { status: 'failed' }
      const watch = mount(
        FileWatch as never,
        { ...element.props, useResource: () => file } as never,
      )
      watch.render()
      expect(vi.getTimerCount()).toBe(0)
      file = { status: 'live', value: { version: 'v1' } }
      watch.render()
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      watch.destroy()
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a disappeared delta subscription mounted and re-reads when it returns', async () => {
    vi.useFakeTimers()
    try {
      const authOnly: ChangeDetail = {
        ...TWO_DELTAS,
        deltas: [AUTH_DELTA],
      }
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response({ change: TWO_DELTAS }))
        .mockResolvedValueOnce(response({ change: authOnly }))
        .mockResolvedValueOnce(response({ change: TWO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const billingAddress = fileAddress('s1', 'openspec/changes/add-auth/specs/billing/spec.md')
      const initial = watchesOf(body.tree).find((watch) => watch.props.address === billingAddress)
      if (initial === undefined) throw new Error('billing watch missing')
      let file: ResourceFacts = { status: 'live', value: { version: 'v1' } }
      const watch = mount(
        FileWatch as never,
        { ...initial.props, useResource: () => file } as never,
      )
      const rerenderWatch = (): void => {
        const current = watchesOf(body.tree).find(
          (candidate) => candidate.props.address === billingAddress,
        )
        if (current === undefined) throw new Error('billing watch unmounted')
        watch.render({ ...current.props, useResource: () => file } as never)
      }

      watch.render()
      expect(vi.getTimerCount()).toBe(0)

      file = { status: 'failed' }
      rerenderWatch()
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      body.render()
      // The re-read's loading state keeps every discovered delta subscribed.
      expect(
        watchesOf(body.tree).some((candidate) => candidate.props.address === billingAddress),
      ).toBe(true)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
      expect(
        watchesOf(body.tree).some((candidate) => candidate.props.address === billingAddress),
      ).toBe(true)

      file = { status: 'live', value: { version: 'v2' } }
      rerenderWatch()
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(3)

      file = { status: 'live', value: { version: 'v3' } }
      rerenderWatch()
      expect(vi.getTimerCount()).toBe(1)
      body.destroy()
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(300)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      watch.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates the capability body after its spec file changes', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({
            capability: {
              id: 'auth',
              requirementCount: 2,
              body: '# a',
              modified: '2026-11-05T14:03:00',
            },
          }),
        )
        .mockResolvedValueOnce(
          response({
            capability: {
              id: 'auth',
              requirementCount: 2,
              body: '# a2',
              modified: '2026-11-05T15:20:00',
            },
          }),
        )
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(
        CapabilityBody as never,
        {
          tab: fakeTab(capabilityAddress('auth')).tab,
          id: 'auth',
          sessionId: 's1',
          t,
          open: () => {},
        } as never,
      )
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const element = watchesOf(body.tree)[0]
      if (element === undefined) throw new Error('watch missing')
      expect(element.props.address).toBe(fileAddress('s1', 'openspec/specs/auth/spec.md'))
      ;(element.props.change as () => void)()
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const capability = viewProps(body.tree, CapabilityView).capability as CapabilityDetail
      expect(capability.body).toBe('# a2')
      expect(capability.modified).toBe('2026-11-05T15:20:00')
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('disposes every file subscription and its bookkeeping with the body', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => response({ change: TWO_DELTAS }))
      vi.stubGlobal('fetch', fetchMock)
      const observed: string[] = []
      const subscribed = new Set<string>()
      const disposals = new Map<string, number>()
      const useResource = (address: string): ResourceFacts => {
        observed.push(address)
        registerEffect(() => {
          subscribed.add(address)
          return () => {
            subscribed.delete(address)
            disposals.set(address, (disposals.get(address) ?? 0) + 1)
          }
        }, [address])
        return { status: 'live', value: { version: 'v1' } }
      }
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      const expected = [
        'openspec/changes/add-auth/proposal.md',
        'openspec/changes/add-auth/design.md',
        'openspec/changes/add-auth/tasks.md',
        'openspec/changes/add-auth/specs/auth/spec.md',
        'openspec/changes/add-auth/specs/billing/spec.md',
      ].map((path) => fileAddress('s1', path))
      const watches = new Map<string, WatchMount>()
      syncWatches(body.tree, watches, useResource, body)
      expect([...subscribed].sort()).toEqual([...expected].sort())
      expect(vi.getTimerCount()).toBe(1)
      const captured = watchesOf(body.tree).map((element) => element.props)
      const observedBefore = observed.length

      // One tree destroy: the body's cleanups run, then its adopted watch
      // children unmount and release their subscriptions.
      body.destroy()

      expect(subscribed.size).toBe(0)
      for (const address of expected) expect(disposals.get(address)).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
      for (const props of captured) {
        ;(props.change as () => void)()
        ;(props.settle as (address: string, observable: boolean) => void)(
          props.address as string,
          true,
        )
      }
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(300)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(subscribed.size).toBe(0)
      expect(observed).toHaveLength(observedBefore)
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances the relative last-updated fact after a live re-read', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response({ change: FULL }))
        .mockResolvedValueOnce(response({ change: LATER }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      const now = NOW
      const before = viewProps(body.tree, ChangeView)
      expect(textOf(ChangeView({ ...before, now } as never))).toContain('updated 2h ago')
      const element = watchesOf(body.tree)[0]
      if (element === undefined) throw new Error('watch missing')
      ;(element.props.change as () => void)()
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      const after = viewProps(body.tree, ChangeView)
      expect(textOf(ChangeView({ ...after, now } as never))).toContain('updated 1h ago')
      body.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps native refresh and visibility re-reads on a host without the provider', async () => {
    const fetchMock = vi.fn(async () => response({ change: FULL }))
    vi.stubGlobal('fetch', fetchMock)
    const fake = fakeTab(changeAddress('add-auth'))
    const useResource = (): ResourceFacts => ({ status: 'none' })
    const props = { ...changeProps(), tab: fake.tab, useResource }
    const body = mount(ChangeBody as never, props as never)
    body.render()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(nodes(body.tree).some((node) => node.type === ChangeView)).toBe(true)
    expect(watchesOf(body.tree).every((watch) => watch.props.useResource === useResource)).toBe(
      true,
    )
    fake.commands[0]?.refresh?.()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    body.render({ ...props, tab: { ...fake.tab, visible: false } } as never)
    body.render({ ...props, tab: { ...fake.tab, visible: true } } as never)
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    body.destroy()
  })
})

describe('OpenSpec panel capability body', () => {
  it('reads the capability and renders it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          capability: {
            id: 'auth',
            requirementCount: 2,
            body: '# a',
            modified: '2026-11-05T14:03:00',
          },
        }),
      ),
    )
    const body = mount(
      CapabilityBody as never,
      {
        tab: fakeTab(capabilityAddress('auth')).tab,
        id: 'auth',
        sessionId: 's1',
        t,
        open: () => {},
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = nodes(body.tree).find((node) => node.type === CapabilityView)
    expect(view).toBeDefined()
    body.destroy()
  })

  it('filters a capability with more than twelve requirements through the mounted body', async () => {
    const requirements = Array.from({ length: 13 }, (_value, index) => ({
      name: `Requirement ${String(index + 1)}`,
      text: `The system SHALL do step ${String(index + 1)}.`,
      scenarios: [],
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          capability: {
            ...CAPABILITY,
            requirementCount: 13,
            requirements,
          },
        }),
      ),
    )
    const body = mount(
      CapabilityBody as never,
      {
        tab: fakeTab(capabilityAddress('auth')).tab,
        id: 'auth',
        sessionId: 's1',
        t,
        open: () => {},
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = (): ReactNode => CapabilityView(viewProps(body.tree, CapabilityView) as never)
    expect(typed(view(), 'Input')).toHaveLength(1)
    typeInto(inputOf(view()), 'Requirement 7')
    body.render()
    expect(textOf(view())).toContain('Requirement 7')
    expect(textOf(view())).not.toContain('Requirement 8')
    typeInto(inputOf(view()), 'zzz')
    body.render()
    expect(textOf(view())).toContain('No requirements match this filter.')
    body.destroy()
  })

  it('opens an archived change from the history section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ capability: CAPABILITY })),
    )
    const opened: string[] = []
    const body = mount(
      CapabilityBody as never,
      {
        tab: fakeTab(capabilityAddress('auth')).tab,
        id: 'auth',
        sessionId: 's1',
        t,
        open: (address: string) => opened.push(address),
      } as never,
    )
    body.render()
    await settle()
    body.render()
    ;(viewProps(body.tree, CapabilityView).onSection as (section: string) => void)('history')
    body.render()
    const view = CapabilityView(viewProps(body.tree, CapabilityView) as never)
    click(cardButtons(view)[0])
    expect(opened).toEqual([
      'dsh-resource://openspec/archive-change/2026-10-27-add-admin-indicator',
    ])
    body.destroy()
  })
})

describe('OpenSpec panel visual contract', () => {
  it('maps each phase to one semantic tag tone', () => {
    expect(phaseTone('planning')).toBe('warning')
    expect(phaseTone('ready-to-apply')).toBe('info')
    expect(phaseTone('applying')).toBe('info')
    expect(phaseTone('complete')).toBe('success')
    expect(phaseTone('archived')).toBe('quiet')
    expect(phaseDot('planning')).toBe('warning')
    expect(phaseDot('complete')).toBe('done')
    expect(phaseDot('archived')).toBe('idle')
  })

  it('ships no literal colour in the panel CSS and uses the theme tokens', () => {
    expect(PANEL_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(PANEL_CSS).not.toMatch(/\brgba?\(/)
    expect(PANEL_CSS).not.toMatch(/\bhsla?\(/)
    for (const token of [
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-border-l2',
      '--dsw-radius-md',
      '--dsw-font-s-strong-14',
      '--dsw-font-xs-13',
      '--dsw-font-xxs-12',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-state-business-primary',
      '--dsw-alias-bg-module-platform',
      '--dsw-alias-interactive-bg-hover',
    ]) {
      expect(PANEL_CSS).toContain(token)
    }
    expect(PANEL_CSS).toContain('prefers-reduced-motion')
    expect(PANEL_CSS).toContain('-webkit-line-clamp: 3')
    expect(PANEL_CSS).toContain('flex-wrap: wrap')
    expect(PANEL_CSS).toContain('.dsh-openspec-tab-unavailable')
    expect(PANEL_CSS).toContain('opacity: 0.55')
    expect(PANEL_CSS).toContain('.dsh-openspec-sr-only')
  })
})
