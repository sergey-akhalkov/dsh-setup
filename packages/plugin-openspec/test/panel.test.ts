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
  StateDot: (props: Record<string, unknown>) => ({ type: 'StateDot', props }),
  Tag: (props: Record<string, unknown>) => ({ type: 'Tag', props }),
}))

import {
  apply,
  CapabilityBody,
  CapabilityView,
  ChangeBody,
  ChangeView,
  createHandoff,
  FileWatch,
  OpenSpecTab,
  type ResourceFacts,
  RootBody,
  RootView,
  registerPanel,
} from '../src/client/index.tsx'
import {
  applyDraft,
  type CapabilityDetail,
  type CapabilitySummary,
  CHANGE_PATH,
  type ChangeDetail,
  type ChangePresence,
  type ChangeRow,
  canOpenOpenSpec,
  capabilityAddress,
  capabilitySpecPath,
  changeAddress,
  changeArtifactPath,
  changeWatchPaths,
  deltaSpecPath,
  fileAddress,
  LOADING,
  OPENSPEC_ID,
  OPENSPEC_KIND,
  openSpecTarget,
  openSpecTitle,
  PROPOSE_DRAFT,
  ROOT_ADDRESS,
  requestCapabilities,
  requestCapability,
  requestChange,
  SPECS_ADDRESS,
  SPECS_PATH,
  sortChanges,
  updatedLabel,
} from '../src/client/panel.ts'
import { MISSING_CLI_MESSAGE, NO_LOCAL_ROOT_MESSAGE } from '../src/host/change-list.ts'

const COPY: Record<string, string> = {
  'guide.title': 'OpenSpec',
  'guide.description': 'Browse OpenSpec changes and capability specs',
  'segment.label': 'OpenSpec view',
  'segment.changes': 'Changes',
  'segment.specs': 'Specs',
  'state.loading': 'Loading…',
  'state.retry': 'Retry',
  'changes.empty': 'No open changes in this workspace.',
  'changes.propose': 'Propose a change',
  'capabilities.empty': 'No capability specs yet. Sync an accepted change to add one.',
  'presence.proposal': 'proposal',
  'presence.design': 'design',
  'presence.spec': 'spec',
  'presence.specs': 'specs',
  'presence.tasks': 'tasks',
  'status.complete': 'complete',
  'status.inProgress': 'in progress',
  'status.noTasks': 'no tasks',
  'change.apply': 'Apply change',
  'change.tasks': 'tasks',
  'change.artifactLabel': 'Change artifacts',
  'change.deltas': 'delta specs',
  'artifact.proposal': 'Why',
  'artifact.design': 'Design',
  'artifact.specs': 'Specs',
  'artifact.tasks': 'Tasks',
  'artifact.notWritten': 'Not written yet.',
  'capability.requirements': 'requirements',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
}

const t = (key: string): string => COPY[key] ?? key

const LABELS = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
}

const FULL: ChangeDetail = {
  name: 'add-auth',
  status: 'in-progress',
  completedTasks: 4,
  totalTasks: 12,
  artifacts: { proposal: '# Why', design: '# Design', tasks: '- [ ] task' },
  specs: [{ capability: 'auth', body: '# auth delta', modified: '2026-11-05T14:03:00' }],
  modified: '2026-11-05T14:03:00',
}

const LATER: ChangeDetail = {
  ...FULL,
  completedTasks: 5,
  artifacts: { proposal: '# Why, revised', design: '# Design', tasks: '- [x] task' },
  specs: [{ capability: 'auth', body: '# auth delta, revised', modified: '2026-11-05T15:20:00' }],
  modified: '2026-11-05T15:20:00',
}

const TWO_SPECS: ChangeDetail = {
  ...FULL,
  specs: [
    { capability: 'auth', body: '# auth delta', modified: '2026-11-05T14:03:00' },
    { capability: 'billing', body: '# billing delta', modified: '2026-11-05T14:05:00' },
  ],
}

/** A change with no delta specs: its view observes exactly the three artifacts. */
const NO_DELTAS: ChangeDetail = { ...FULL, specs: [] }

const NO_DESIGN: ChangeDetail = {
  ...FULL,
  artifacts: { proposal: '# Why', design: null, tasks: '- [ ] task' },
}

function row(
  name: string,
  status: string,
  completedTasks = 0,
  totalTasks = 0,
  presence: ChangePresence = { proposal: false, design: false, tasks: false, specs: 0 },
): ChangeRow {
  return { name, status, completedTasks, totalTasks, presence }
}

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

function segmented(tree: unknown): Found {
  const found = nodes(tree).find(
    (node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function',
  )
  if (found === undefined) throw new Error('segmented control missing')
  return found
}

function rowButtons(tree: unknown): Found[] {
  return nodes(tree).filter(
    (node) => node.type === 'button' && node.props.className === 'dsh-openspec-row',
  )
}

function buttonByText(tree: unknown, label: string): Found {
  const found = typed(tree, 'Button').find((node) => node.props.children === label)
  if (found === undefined) throw new Error(`button ${label} missing`)
  return found
}

/** Invoke a found control's click handler, failing loudly when it is absent. */
function click(node: Found | undefined): void {
  if (node === undefined) throw new Error('control missing')
  const action = node.props.onClick
  if (typeof action !== 'function') throw new Error('control onClick missing')
  ;(action as () => void)()
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

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OpenSpec panel addresses', () => {
  it('accepts exactly the four documented shapes', () => {
    expect(canOpenOpenSpec(ROOT_ADDRESS)).toBe(true)
    expect(canOpenOpenSpec(SPECS_ADDRESS)).toBe(true)
    expect(canOpenOpenSpec(changeAddress('add-auth'))).toBe(true)
    expect(canOpenOpenSpec(capabilityAddress('auth'))).toBe(true)
    for (const address of [
      'sidebar://openspec/extra',
      'dsh-resource://openspec/specs/',
      'dsh-resource://openspec/change/',
      'dsh-resource://openspec/change/add-auth/design',
      'dsh-resource://openspec/spec/%E0%A4%A',
      'dsh-resource://openspec/change/add-auth?artifact=design',
      'sidebar://files',
      'https://example.com/openspec/change/add-auth',
    ]) {
      expect(canOpenOpenSpec(address)).toBe(false)
      expect(openSpecTarget(address)).toBeUndefined()
    }
  })

  it('keeps one address and title per change and capability', () => {
    expect(changeAddress('add-auth')).toBe('dsh-resource://openspec/change/add-auth')
    expect(changeAddress('add-auth')).not.toContain('?')
    expect(openSpecTarget(ROOT_ADDRESS)).toEqual({ view: 'root', segment: 'changes' })
    expect(openSpecTarget(SPECS_ADDRESS)).toEqual({ view: 'root', segment: 'specs' })
    expect(openSpecTarget(changeAddress('add-auth'))).toEqual({
      view: 'change',
      name: 'add-auth',
    })
    expect(openSpecTarget(capabilityAddress('auth'))).toEqual({ view: 'capability', id: 'auth' })
    expect(openSpecTitle(changeAddress('add-auth'))).toBe('add-auth')
    expect(openSpecTitle(capabilityAddress('auth'))).toBe('auth')
    expect(openSpecTitle(ROOT_ADDRESS)).toBe('OpenSpec')
  })

  it('sorts unfinished changes first, stable within each group', () => {
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

  it('builds the file address and watched paths the panel observes', () => {
    expect(fileAddress('s1', 'openspec/changes/add-auth/tasks.md')).toBe(
      'dsh-resource://file/session/s1/openspec/changes/add-auth/tasks.md',
    )
    expect(changeArtifactPath('add-auth', 'design')).toBe('openspec/changes/add-auth/design.md')
    expect(deltaSpecPath('add-auth', 'auth')).toBe('openspec/changes/add-auth/specs/auth/spec.md')
    expect(capabilitySpecPath('auth')).toBe('openspec/specs/auth/spec.md')
    expect(changeWatchPaths('add-auth', ['auth', 'billing'])).toEqual([
      'openspec/changes/add-auth/proposal.md',
      'openspec/changes/add-auth/design.md',
      'openspec/changes/add-auth/tasks.md',
      'openspec/changes/add-auth/specs/auth/spec.md',
      'openspec/changes/add-auth/specs/billing/spec.md',
    ])
  })

  it('formats the last-updated fact in local time', () => {
    const now = new Date('2026-11-05T18:00:00')
    expect(updatedLabel('2026-11-05T14:03:00', now)).toBe('Updated 14:03')
    expect(updatedLabel('2026-11-04T09:05:00', now)).toBe('Updated 2026-11-04 09:05')
    expect(updatedLabel(null, now)).toBeNull()
    expect(updatedLabel('not-a-date', now)).toBeNull()
  })
})

describe('OpenSpec panel reads', () => {
  it('requests a change with the session and name, and decodes the Host error', async () => {
    const fetchMock = vi.fn(async () => response({ change: FULL }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestChange('s1', 'add-auth')).resolves.toEqual(FULL)
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHANGE_PATH}?session=s1&name=add-auth`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: NO_LOCAL_ROOT_MESSAGE }, false)),
    )
    await expect(requestChange('s1', 'add-auth')).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
  })

  it('requests the capability inventory and one capability', async () => {
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
    await expect(requestCapabilities('s1')).resolves.toEqual([{ id: 'auth', requirementCount: 2 }])
    await expect(requestCapability('s1', 'auth')).resolves.toEqual({
      id: 'auth',
      requirementCount: 2,
      body: '# a',
      modified: '2026-11-05T14:03:00',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${SPECS_PATH}?session=s1`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${SPECS_PATH}?session=s1&id=auth`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
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
    expect(fake.tabs).toHaveLength(1)
    const definition = fake.tabs[0]
    expect(definition?.id).toBe(OPENSPEC_ID)
    expect(definition?.kind).toBe(OPENSPEC_KIND)
    expect(definition?.patterns).toEqual([ROOT_ADDRESS, 'dsh-resource://openspec/**'])
    expect(definition?.priority).toBe('extension')
    expect(definition?.canOpen?.(ROOT_ADDRESS)).toBe(true)
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
    const definition = fake.tabs[0]
    expect(definition?.id).toBe(OPENSPEC_ID)
    expect(definition?.kind).toBe(OPENSPEC_KIND)
    expect(definition?.patterns).toEqual([ROOT_ADDRESS, 'dsh-resource://openspec/**'])
    expect(definition?.priority).toBe('extension')
    expect(definition?.canOpen?.(ROOT_ADDRESS)).toBe(true)
    expect(definition?.canOpen?.(SPECS_ADDRESS)).toBe(true)
    expect(definition?.canOpen?.(changeAddress('add-auth'))).toBe(true)
    expect(definition?.canOpen?.(capabilityAddress('auth'))).toBe(true)
    expect(definition?.canOpen?.('sidebar://files')).toBe(false)
    expect(definition?.title(changeAddress('add-auth'))).toBe('add-auth')
    expect(definition?.guide).toHaveLength(1)
    expect(definition?.guide?.[0]).toMatchObject({
      id: 'open',
      commandId: 'openspec.panel',
      order: 10,
    })
    expect(definition?.guide?.[0]?.title()).toBe('OpenSpec')
    expect(fake.injections).toEqual(['sidebar.right.pane.tab'])
    expect(fake.slotOptions[0]).toMatchObject({
      name: 'sidebar.right.pane.tab',
      key: OPENSPEC_ID,
      locale: 'dsh-setup-openspec-panel',
    })
    expect(fake.bodies).toHaveLength(1)
  })

  it('registers no panel without the right-sidebar services, while the picker still registers', () => {
    const fake = panelFake(true, false)
    expect(() => apply(fake.ctx as never)).not.toThrow()
    expect(fake.injects).toEqual([
      ['sidebarRight', 'sidebarRightTabs', 'slots', 'locale', 'resources'],
    ])
    expect(fake.commands).toHaveLength(1)
    expect(fake.tabs).toEqual([])
    expect(fake.locales).toEqual([])
    expect(fake.injections).toEqual([])
    expect(fake.slotOptions).toEqual([])
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
    handoff.draft('s1', PROPOSE_DRAFT)
    expect(drafts).toEqual(['/openspec-apply-change add-auth', '/openspec-propose '])
    expect(() => handoff.draft('closed', applyDraft('add-auth'))).toThrow(/not open/)
  })

  it('opens resources through the sidebar when the tab action is unavailable', () => {
    const opened: string[] = []
    const handoff = createHandoff(undefined, undefined, {
      openResource: (address) => {
        opened.push(address)
      },
    })
    handoff.open(changeAddress('add-auth'))
    expect(opened).toEqual(['dsh-resource://openspec/change/add-auth'])
  })

  it('fills the propose draft from the mounted empty root state without submitting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ changes: [] })),
    )
    const drafts: string[] = []
    const submits: string[] = []
    const opened: string[] = []
    const actx = { remote: {} }
    const handoff = createHandoff(
      { scope: (id) => (id === 's1' ? actx : undefined) },
      {
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
      },
      {
        openResource: (address) => {
          opened.push(address)
        },
      },
    )
    const dispatch = mount(
      OpenSpecTab as never,
      {
        useTabInfo: () => ({ tab: fakeTab(ROOT_ADDRESS).tab }),
        sessionId: 's1',
        t,
        handoff,
      } as never,
    )
    dispatch.render()
    const rootBody = nodes(dispatch.tree).find((node) => node.type === RootBody)
    if (rootBody === undefined) throw new Error('root body missing')
    const body = mount(RootBody as never, rootBody.props as never)
    body.render()
    await settle()
    body.render()
    click(buttonByText(RootView(viewProps(body.tree, RootView) as never), 'Propose a change'))
    expect(drafts).toEqual(['/openspec-propose '])
    expect(submits).toEqual([])
    expect(opened).toEqual([])
    body.destroy()
    dispatch.destroy()
  })
})

describe('OpenSpec root view', () => {
  const base = {
    segment: 'changes' as const,
    changes: LOADING,
    capabilities: LOADING,
    t,
    onSegment: () => {},
    onRetry: () => {},
    onOpenChange: () => {},
    onOpenCapability: () => {},
    onPropose: () => {},
  }

  it('shows loading instead of an empty list', () => {
    const tree = RootView(base)
    expect(textOf(tree)).toContain('Loading…')
    expect(textOf(tree)).not.toContain('No open changes')
  })

  it('lists change rows with status, progress, and artifact facts', () => {
    const changes = {
      phase: 'ready' as const,
      value: [
        row('add-auth', 'in-progress', 4, 12, {
          proposal: true,
          design: true,
          tasks: false,
          specs: 0,
        }),
      ],
    }
    const tree = RootView({ ...base, changes })
    const rows = rowButtons(tree)
    expect(rows).toHaveLength(1)
    const text = textOf(rows[0])
    expect(text).toContain('add-auth')
    expect(text).toContain('4/12')
    expect(text).toContain('in progress')
    expect(text).toContain('proposal')
    expect(text).toContain('design')
    expect(typed(tree, 'StateDot')[0]?.props.state).toBe('ongoing')
    const tags = typed(tree, 'Tag')
    expect(tags).toHaveLength(2)
    expect(tags.every((tag) => tag.props.tone === 'quiet')).toBe(true)
  })

  it('puts unfinished changes before complete ones', () => {
    const changes = {
      phase: 'ready' as const,
      value: [
        row('z-complete', 'complete'),
        row('a-open', 'in-progress'),
        row('b-open', 'no-tasks'),
      ],
    }
    const tree = RootView({ ...base, changes })
    expect(rowButtons(tree).map((entry) => textOf(entry))).toEqual([
      expect.stringContaining('a-open'),
      expect.stringContaining('b-open'),
      expect.stringContaining('z-complete'),
    ])
  })

  it('shows the empty change state with a propose action', () => {
    const onPropose = vi.fn()
    const tree = RootView({ ...base, changes: { phase: 'ready', value: [] }, onPropose })
    expect(textOf(tree)).toContain('No open changes in this workspace.')
    const button = buttonByText(tree, 'Propose a change')
    ;(button.props.onClick as () => void)()
    expect(onPropose).toHaveBeenCalledTimes(1)
  })

  it('lists capabilities with requirement counts in the specs segment', () => {
    const onOpenCapability = vi.fn()
    const capabilities: CapabilitySummary[] = [
      { id: 'auth', requirementCount: 4 },
      { id: 'billing', requirementCount: 2 },
    ]
    const tree = RootView({
      ...base,
      segment: 'specs',
      capabilities: { phase: 'ready', value: capabilities },
      onOpenCapability,
    })
    expect(segmented(tree).props.value).toBe('specs')
    const rows = rowButtons(tree)
    expect(textOf(rows[0])).toContain('auth')
    expect(textOf(rows[0])).toContain('4 requirements')
    expect(textOf(rows[1])).toContain('billing')
    click(rows[1])
    expect(onOpenCapability).toHaveBeenCalledWith('billing')
  })

  it('offers the capability empty next action', () => {
    const tree = RootView({
      ...base,
      segment: 'specs',
      capabilities: { phase: 'ready', value: [] },
    })
    expect(textOf(tree)).toContain('No capability specs yet')
  })

  it('shows the Host cause for a missing root and a missing CLI, with retry', () => {
    for (const message of [NO_LOCAL_ROOT_MESSAGE, MISSING_CLI_MESSAGE]) {
      const onRetry = vi.fn()
      const tree = RootView({
        ...base,
        changes: { phase: 'error', message },
        onRetry,
      })
      expect(textOf(tree)).toContain(message)
      const button = buttonByText(tree, 'Retry')
      ;(button.props.onClick as () => void)()
      expect(onRetry).toHaveBeenCalledTimes(1)
    }
  })

  it('opens the chosen change canonical address', () => {
    const onOpenChange = vi.fn()
    const tree = RootView({
      ...base,
      changes: {
        phase: 'ready',
        value: [row('add-auth', 'in-progress', 1, 2)],
      },
      onOpenChange,
    })
    click(rowButtons(tree)[0])
    expect(onOpenChange).toHaveBeenCalledWith('add-auth')
  })
})

describe('OpenSpec change view', () => {
  const base = {
    change: FULL,
    artifact: 'proposal' as const,
    delta: 'auth',
    t,
    labels: LABELS,
    onArtifact: () => {},
    onDelta: () => {},
    onApply: () => {},
  }

  it('offers the four artifact kinds as one segmented control', () => {
    const tree = ChangeView(base)
    expect(segmented(tree).props.options).toEqual([
      { value: 'proposal', label: 'Why' },
      { value: 'design', label: 'Design' },
      { value: 'specs', label: 'Specs' },
      { value: 'tasks', label: 'Tasks' },
    ])
    expect(typed(tree, 'MarkdownText')[0]?.props.text).toBe('# Why')
    expect(typed(tree, 'MarkdownText')[0]?.props.labels).toBe(LABELS)
  })

  it('disables a missing artifact with the reason as its title', () => {
    const tree = ChangeView({ ...base, change: NO_DESIGN })
    const options = segmented(tree).props.options as Array<{
      value: string
      disabled?: boolean
      title?: string
    }>
    const design = options.find((option) => option.value === 'design')
    expect(design?.disabled).toBe(true)
    expect(design?.title).toBe('Not written yet.')
  })

  it('switches between two delta specs and shows their count', () => {
    const deltas: string[] = []
    const tree = ChangeView({
      ...base,
      change: TWO_SPECS,
      artifact: 'specs',
      onDelta: (capability) => deltas.push(capability),
    })
    expect(textOf(tree)).toContain('2 delta specs')
    const pills = typed(tree, 'Pill')
    expect(pills.map((pill) => pill.props.children)).toEqual(['auth', 'billing'])
    expect(pills[0]?.props.active).toBe(true)
    click(pills[1])
    expect(deltas).toEqual(['billing'])
    const switched = ChangeView({ ...base, change: TWO_SPECS, artifact: 'specs', delta: 'billing' })
    expect(typed(switched, 'MarkdownText')[0]?.props.text).toBe('# billing delta')
  })

  it('renders tasks as written while keeping progress in the header', () => {
    const tree = ChangeView({ ...base, artifact: 'tasks' })
    expect(textOf(tree)).toContain('4/12 tasks')
    expect(typed(tree, 'MarkdownText')[0]?.props.text).toBe('- [ ] task')
  })

  it('fills the apply draft through the header action', () => {
    const applied: string[] = []
    const tree = ChangeView({ ...base, onApply: () => applied.push('apply') })
    ;(buttonByText(tree, 'Apply change').props.onClick as () => void)()
    expect(applied).toEqual(['apply'])
  })

  it('shows the last-updated fact and hides it when the route has none', () => {
    const now = new Date('2026-11-05T18:00:00')
    expect(textOf(ChangeView({ ...base, now }))).toContain('Updated 14:03')
    expect(textOf(ChangeView({ ...base, change: { ...FULL, modified: null }, now }))).not.toContain(
      'Updated',
    )
    const older = ChangeView({
      ...base,
      change: { ...FULL, modified: '2026-11-03T09:05:00' },
      now,
    })
    expect(textOf(older)).toContain('Updated 2026-11-03 09:05')
  })
})

describe('OpenSpec capability view', () => {
  it('renders the accepted spec body with its count', () => {
    const capability: CapabilityDetail = {
      id: 'auth',
      requirementCount: 4,
      body: '# auth',
      modified: '2026-11-05T14:03:00',
    }
    const tree = CapabilityView({ capability, t, labels: LABELS })
    expect(textOf(tree)).toContain('auth')
    expect(textOf(tree)).toContain('4 requirements')
    expect(typed(tree, 'MarkdownText')[0]?.props.text).toBe('# auth')
    expect(
      textOf(
        CapabilityView({ capability, t, labels: LABELS, now: new Date('2026-11-05T18:00:00') }),
      ),
    ).toContain('Updated 14:03')
  })
})

describe('OpenSpec tab bodies', () => {
  it('keeps a different artifact selection in each tab body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ change: FULL })),
    )
    const first = mount(
      ChangeBody as never,
      {
        tab: fakeTab(changeAddress('add-auth')).tab,
        name: 'add-auth',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
      } as never,
    )
    const second = mount(
      ChangeBody as never,
      {
        tab: fakeTab(changeAddress('add-auth')).tab,
        name: 'add-auth',
        sessionId: 's1',
        t,
        draft: () => {},
        open: () => {},
      } as never,
    )
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
  })

  it('keeps the canonical change address through every artifact and Apply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('name=add-auth')
          ? response({ change: FULL })
          : response({ changes: [row('add-auth', 'in-progress', 4, 12)] }),
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
    click(rowButtons(RootView(viewProps(root.tree, RootView) as never))[0])
    const firstCall = open.mock.calls[0]
    if (firstCall === undefined) throw new Error('navigation missing')
    const address: unknown = firstCall[0]
    if (typeof address !== 'string') throw new Error('navigation address missing')
    expect(address).toBe('dsh-resource://openspec/change/add-auth')
    expect(address).toBe(changeAddress('add-auth'))
    expect(address).not.toContain('?')
    expect(address).not.toContain('#')
    expect(address).not.toContain('artifact=')
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
    expect(tab.opened).toEqual([])
    expect(open).toHaveBeenCalledTimes(1)
    body.destroy()
    dispatch.destroy()
    root.destroy()
  })

  it('registers one refresh command, re-reads once per refresh and on show, then disposes', async () => {
    const fetchMock = vi.fn(async () => response({ change: FULL }))
    vi.stubGlobal('fetch', fetchMock)
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const interval = vi.spyOn(globalThis, 'setInterval')
    const fake = fakeTab(changeAddress('add-auth'))
    const props = {
      tab: fake.tab,
      name: 'add-auth',
      sessionId: 's1',
      t,
      draft: () => {},
      open: () => {},
    }
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
    expect(fake.commands).toHaveLength(1)
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
    const retry = buttonByText(view(), 'Retry')
    ;(retry.props.onClick as () => void)()
    await settle()
    body.render()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(textOf(view())).toContain('add-auth')
  })

  it('starts the Specs segment for the specs root address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ capabilities: [{ id: 'auth', requirementCount: 1 }] })),
    )
    const body = mount(
      RootBody as never,
      {
        tab: fakeTab(SPECS_ADDRESS).tab,
        initialSegment: openSpecTarget(SPECS_ADDRESS)?.view === 'root' ? 'specs' : 'changes',
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
    expect(textOf(view())).toContain('auth')
  })

  it('dispatches a URL to the body view it names', () => {
    const tree = OpenSpecTab({
      useTabInfo: () => ({ tab: fakeTab(changeAddress('add-auth')).tab }),
      sessionId: 's1',
      t,
      handoff: { draft: () => {}, open: () => {} },
    } as never)
    expect(nodes(tree).some((node) => node.type === ChangeBody)).toBe(true)
    const root = OpenSpecTab({
      useTabInfo: () => ({ tab: fakeTab(ROOT_ADDRESS).tab }),
      sessionId: 's1',
      t,
      handoff: { draft: () => {}, open: () => {} },
    } as never)
    expect(nodes(root).some((node) => node.type === RootBody)).toBe(true)
  })
})

describe('OpenSpec live observation', () => {
  type WatchMount = Mounted<never>

  function watchesOf(tree: unknown): Found[] {
    return nodes(tree).filter((node) => node.type === FileWatch)
  }

  function changeProps(): Record<string, unknown> {
    return {
      tab: fakeTab(changeAddress('add-auth')).tab,
      name: 'add-auth',
      sessionId: 's1',
      t,
      draft: () => {},
      open: () => {},
    }
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
      syncWatches(body.tree, watches, () => ({
        status: 'live',
        value: { version: 'v-b' },
      }))
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const change = viewProps(body.tree, ChangeView).change as ChangeDetail
      expect(change.artifacts.proposal).toBe('# Why, revised')
      syncWatches(body.tree, watches, () => ({
        status: 'live',
        value: { version: 'v-b' },
      }))
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
        ...TWO_SPECS,
        specs: [{ capability: 'auth', body: '# auth delta', modified: '2026-11-05T14:03:00' }],
      }
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response({ change: TWO_SPECS }))
        .mockResolvedValueOnce(response({ change: authOnly }))
        .mockResolvedValueOnce(response({ change: TWO_SPECS }))
      vi.stubGlobal('fetch', fetchMock)
      const body = mount(ChangeBody as never, changeProps() as never)
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const billingAddress = fileAddress('s1', deltaSpecPath('add-auth', 'billing'))
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
        } as never,
      )
      body.render()
      await settle()
      body.render()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const element = watchesOf(body.tree)[0]
      if (element === undefined) throw new Error('watch missing')
      expect(element.props.address).toBe(fileAddress('s1', capabilitySpecPath('auth')))
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
      const fetchMock = vi.fn(async () => response({ change: TWO_SPECS }))
      vi.stubGlobal('fetch', fetchMock)
      const observed: string[] = []
      const subscribed = new Set<string>()
      const disposals = new Map<string, number>()
      const useResource = (address: string): ResourceFacts => {
        observed.push(address)
        // One subscription per mounted watch, cleaned up by the watch's own
        // effect cleanup when the tree unmounts.
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
      const expected = changeWatchPaths('add-auth', ['auth', 'billing']).map((path) =>
        fileAddress('s1', path),
      )
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

  it('advances the last-updated fact after a live re-read', async () => {
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
      const now = new Date('2026-11-05T18:00:00')
      const before = viewProps(body.tree, ChangeView)
      expect(textOf(ChangeView({ ...before, now } as never))).toContain('Updated 14:03')
      const element = watchesOf(body.tree)[0]
      if (element === undefined) throw new Error('watch missing')
      ;(element.props.change as () => void)()
      vi.advanceTimersByTime(300)
      await settle()
      body.render()
      const after = viewProps(body.tree, ChangeView)
      expect(textOf(ChangeView({ ...after, now } as never))).toContain('Updated 15:20')
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
      } as never,
    )
    body.render()
    await settle()
    body.render()
    const view = nodes(body.tree).find((node) => node.type === CapabilityView)
    expect(view).toBeDefined()
  })
})
