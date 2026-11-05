/**
 * OpenSpec apply picker: `/openspec-apply` opens DSH's native `popupSelect`
 * shell with the session workspace's unfinished changes. A pick writes the
 * literal `/openspec-apply-change <name>` into the composer draft and never
 * submits, so the ordinary skill-invocation path runs when the user sends it.
 *
 * The shell owns search, keyboard handling, the empty state, the error strip,
 * and styling; this module supplies option data and the selection handler only.
 *
 * shortcut: the structural commandUi / sessions / conversation faces below are
 * copied from DSH 0.2.1-rc.5; re-verify them when the supported DSH version
 * moves. A host without the command service registers nothing.
 */

import type { MarkdownLabels, SegmentedControlOption } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Button,
  MarkdownText,
  Pill,
  SegmentedControl,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ARTIFACT_KINDS,
  type ArtifactKind,
  applyDraft,
  type CapabilityDetail,
  type CapabilitySummary,
  type ChangeDetail,
  type ChangePresence,
  type ChangeRow,
  canOpenOpenSpec,
  capabilityAddress,
  capabilitySpecPath,
  changeAddress,
  changeWatchPaths,
  fileAddress,
  hasArtifact,
  initialArtifact,
  LOADING,
  OPENSPEC_ID,
  OPENSPEC_KIND,
  openSpecTarget,
  openSpecTitle,
  PROPOSE_DRAFT,
  type ReadState,
  ROOT_ADDRESS,
  requestCapabilities,
  requestCapability,
  requestChange,
  sortChanges,
  updatedLabel,
} from './panel.ts'

/**
 * Document-relative form of the Host route that lists the session workspace's
 * changes. It stays relative so the desktop shell page and the Web page address
 * the same `/api` Fetch route.
 */
export const CHANGES_PATH = 'api/plugins/dsh-setup-openspec/changes'

/** Client services the picker needs; a host without them stays inert. */
export const inject = ['commandUi', 'sessions', 'conversation']

interface SessionLike {
  readonly sessionId: string
}

interface AgentContextLike {
  readonly remote: unknown
}

interface PopupOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

interface PopupSpec {
  readonly kind: 'popupSelect'
  options(session: SessionLike): Promise<PopupOption[]>
  onSelect(option: PopupOption, session: SessionLike): Promise<void>
}

interface CommandContribution {
  readonly name: string
  readonly label: () => string
  readonly description: () => string
  readonly available: (session: SessionLike) => boolean
  readonly ui: PopupSpec
}

interface CommandUi {
  register(contribution: CommandContribution): () => void
}

interface Sessions {
  scope(id: string): AgentContextLike | undefined
}

interface Conversation {
  readonly input: {
    for(actx: AgentContextLike): { setDraft(text: string): void }
  }
}

interface ClientContext {
  get(name: string): unknown
  effect(callback: () => () => void): () => void
  inject(deps: readonly string[], callback: (ctx: ClientContext) => void): () => void
}

async function requestChanges(sessionId: string): Promise<ChangeRow[]> {
  const response = await fetch(`${CHANGES_PATH}?session=${encodeURIComponent(sessionId)}`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `The OpenSpec change list request failed (${String(response.status)}).`,
    )
  }
  const body = (await response.json()) as { changes?: unknown }
  if (!Array.isArray(body.changes)) {
    throw new Error('The OpenSpec change list response was not understood.')
  }
  return body.changes as ChangeRow[]
}

/** The picker lists unfinished changes only; a fully closed root stays empty. */
function optionsOf(changes: readonly ChangeRow[]): PopupOption[] {
  return changes
    .filter((change) => change.status !== 'complete')
    .map((change) => ({
      id: change.name,
      label: change.name,
      detail: `${String(change.completedTasks)}/${String(change.totalTasks)}`,
    }))
}

export function apply(ctx: ClientContext): void {
  const commands = ctx.get('commandUi') as CommandUi | undefined
  const sessions = ctx.get('sessions') as Sessions | undefined
  const conversation = ctx.get('conversation') as Conversation | undefined
  if (commands === undefined || sessions === undefined || conversation === undefined) return

  ctx.effect(() =>
    commands.register({
      name: 'openspec-apply',
      label: () => 'OpenSpec: apply a change',
      description: () =>
        'Pick an unfinished OpenSpec change and fill the apply-change command line',
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: async (session) => optionsOf(await requestChanges(session.sessionId)),
        onSelect: async (option, session) => {
          const actx = sessions.scope(session.sessionId)
          if (actx === undefined) {
            throw new Error('The session is not open, so the command line was not filled.')
          }
          conversation.input.for(actx).setDraft(`/openspec-apply-change ${option.id}`)
        },
      },
    }),
  )

  ctx.inject(PANEL_SERVICES, (panelCtx) => {
    registerPanel(panelCtx)
  })
}

/**
 * OpenSpec panel: a read-only right-sidebar tab for the session workspace's
 * changes and accepted capability specs. It borrows the host's whole frame and
 * renders artifacts through the shipped Markdown renderer.
 */

/** Services the panel needs on top of the picker's; absent means no panel. */
const PANEL_SERVICES = ['sidebarRight', 'sidebarRightTabs', 'slots', 'locale', 'resources']

/** Panel copy, registered into the Client locale registry. */
const NS = 'dsh-setup-openspec-panel'

const EN: Record<string, string> = {
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

type Translate = (key: string) => string

const fallbackTranslate: Translate = (key) => EN[key] ?? key

/** One open tab occurrence, as the shipped hook reports it. */
export interface TabFace {
  readonly visible: boolean
  readonly navigation: { readonly address: string }
  readonly actions: {
    bindCommands(commands: { readonly refresh?: () => void }): () => void
    openResource(address: string): void
  }
}

/** Framework props a session-scoped tab body receives. */
export interface TabBodyProps {
  readonly useTabInfo: () => { readonly tab: TabFace }
  readonly sessionId: string
  readonly t?: Translate
  readonly handoff?: PanelHandoff
  readonly useResource?: UseResource
}

/** One observation of a resource address, as the shipped hook reports it. */
export interface ResourceFacts {
  readonly status: 'none' | 'loading' | 'live' | 'failed'
  readonly value?: { readonly version?: string }
  readonly failure?: { readonly code?: string }
}

/** The standard per-body resource hook; a host without it has no live watch. */
export type UseResource = (address: string) => ResourceFacts

/** A host with no file provider: every address reports `none`. */
const noResource: UseResource = () => ({ status: 'none' })

/** The only effects the panel has outside itself. */
export interface PanelHandoff {
  draft(sessionId: string, text: string): void
  open(address: string): void
}

interface GuideEntry {
  readonly id: string
  readonly commandId: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
}

interface TabDefinition {
  readonly id: string
  readonly kind: string
  readonly patterns?: readonly string[]
  readonly priority?: string
  readonly canOpen?: (address: string) => boolean
  readonly title: (address: string) => string
  readonly guide?: readonly GuideEntry[]
}

interface TabsFace {
  register(definition: TabDefinition): () => void
}

interface SlotOptions {
  readonly name: string
  readonly key: string
  readonly locale?: string
}

interface SlotsFace {
  inject(key: string, callback: () => () => void): () => void
  register(options: SlotOptions, component: (props: TabBodyProps) => ReactNode): () => void
}

interface LocaleFace {
  register(namespace: string, locale: string, dictionary: Record<string, string>): () => void
  bind(namespace: string): Translate
}

interface SidebarRightFace {
  openResource(address: string): void
}

/**
 * Register the panel's locale dictionary, tab type, Start card, and body.
 * Returns silently when the host has no right sidebar (cordis also gates this).
 * @param ctx - panel context carrying the right-sidebar services.
 */
export function registerPanel(ctx: ClientContext): void {
  const tabs = ctx.get('sidebarRightTabs') as TabsFace | undefined
  const slots = ctx.get('slots') as SlotsFace | undefined
  const locale = ctx.get('locale') as LocaleFace | undefined
  const sidebarRight = ctx.get('sidebarRight') as SidebarRightFace | undefined
  if (
    tabs === undefined ||
    slots === undefined ||
    locale === undefined ||
    sidebarRight === undefined ||
    ctx.get('resources') === undefined
  ) {
    return
  }

  const sessions = ctx.get('sessions') as Sessions | undefined
  const conversation = ctx.get('conversation') as Conversation | undefined
  const handoff = createHandoff(sessions, conversation, sidebarRight)

  ctx.effect(() => locale.register(NS, 'en', EN))

  const t = locale.bind(NS)
  ctx.effect(() =>
    tabs.register({
      id: OPENSPEC_ID,
      kind: OPENSPEC_KIND,
      patterns: [ROOT_ADDRESS, 'dsh-resource://openspec/**'],
      priority: 'extension',
      canOpen: canOpenOpenSpec,
      title: openSpecTitle,
      guide: [
        {
          id: 'open',
          commandId: 'openspec.panel',
          order: 10,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
        },
      ],
    }),
  )

  ctx.effect(() =>
    slots.inject('sidebar.right.pane.tab', () =>
      slots.register({ name: 'sidebar.right.pane.tab', key: OPENSPEC_ID, locale: NS }, (props) => (
        <OpenSpecTab {...props} handoff={handoff} />
      )),
    ),
  )
}

/** The composer handoff: one draft, never a submit. */
export function createHandoff(
  sessions: Sessions | undefined,
  conversation: Conversation | undefined,
  sidebarRight: SidebarRightFace,
): PanelHandoff {
  return {
    draft(sessionId, text) {
      const actx = sessions?.scope(sessionId)
      if (actx === undefined || conversation === undefined) {
        throw new Error('The session is not open, so the command line was not filled.')
      }
      conversation.input.for(actx).setDraft(text)
    },
    open(address) {
      sidebarRight.openResource(address)
    },
  }
}

/** Dispatch the tab body by its canonical address; owns the one style block. */
export function OpenSpecTab(props: TabBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const target = openSpecTarget(tab.navigation.address)
  const t = props.t ?? fallbackTranslate
  if (target === undefined) return null
  const draft = (text: string): void => {
    props.handoff?.draft(props.sessionId, text)
  }
  const open = (address: string): void => {
    const action = tab.actions.openResource
    if (typeof action === 'function') action(address)
    else props.handoff?.open(address)
  }
  let body: ReactNode
  if (target.view === 'root') {
    body = (
      <RootBody
        tab={tab}
        initialSegment={target.segment}
        sessionId={props.sessionId}
        t={t}
        draft={draft}
        open={open}
      />
    )
  } else if (target.view === 'change') {
    body = (
      <ChangeBody
        tab={tab}
        name={target.name}
        sessionId={props.sessionId}
        t={t}
        draft={draft}
        open={open}
        useResource={props.useResource}
      />
    )
  } else {
    body = (
      <CapabilityBody
        tab={tab}
        id={target.id}
        sessionId={props.sessionId}
        t={t}
        useResource={props.useResource}
      />
    )
  }
  return (
    <>
      <style>{CSS}</style>
      {body}
    </>
  )
}

/** A panel read that keeps its latest request when refresh runs repeatedly. */
function useRead<T>(read: () => Promise<T>): {
  state: ReadState<T>
  reload: () => void
} {
  const [state, setState] = useState<ReadState<T>>(LOADING)
  const sequence = useRef(0)
  const reload = (): void => {
    const current = sequence.current + 1
    sequence.current = current
    setState(LOADING)
    read().then(
      (value) => {
        if (sequence.current === current) setState({ phase: 'ready', value })
      },
      (error: unknown) => {
        if (sequence.current === current) {
          setState({
            phase: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
  }
  return { state, reload }
}

/**
 * Publish the tab's refresh command and re-read on the hidden -> visible edge.
 * One registration per body; the effect cleanup disposes it.
 */
function useTabRefresh(tab: TabFace, reload: () => void): void {
  const latest = useRef(reload)
  latest.current = reload
  useEffect(() => tab.actions.bindCommands({ refresh: () => latest.current() }), [tab.actions])
  const wasVisible = useRef(tab.visible)
  useEffect(() => {
    if (tab.visible && !wasVisible.current) latest.current()
    wasVisible.current = tab.visible
  }, [tab.visible])
}

/** One re-read after the last observed file change. */
const LIVE_DEBOUNCE_MS = 300

interface WatchState {
  settled: boolean
  live: boolean
  baseline?: string
}

/**
 * One hidden, no-output observation of a workspace file.
 *
 * Its first non-loading report settles the view's observation batch and states
 * whether the file is observable; later version changes, appearances after a
 * failure/absence, and live -> failed/absent transitions report a change.
 */
export function FileWatch(props: {
  readonly address: string
  readonly useResource: UseResource
  settle(address: string, observable: boolean): void
  change(): void
}): null {
  const file = props.useResource(props.address)
  const state = useRef<WatchState>({ settled: false, live: false })
  const settled = useRef(props.settle)
  settled.current = props.settle
  const changed = useRef(props.change)
  changed.current = props.change
  const status = file.status
  const version = file.value?.version
  useEffect(() => {
    const current = state.current
    if (status === 'loading') return
    if (!current.settled) {
      current.settled = true
      settled.current(props.address, status === 'live')
      current.baseline = version
      current.live = status === 'live'
      return
    }
    if (status === 'live') {
      if (!current.live) {
        changed.current()
        current.baseline = version
        current.live = true
      } else if (version !== current.baseline) {
        current.baseline = version
        changed.current()
      }
      return
    }
    if (current.live) {
      current.live = false
      changed.current()
    }
  }, [status, version])
  return null
}

/** Coordinates the first observation of every subscription a view renders. */
interface ObservationBatch {
  add(addresses: readonly string[]): void
  settle(address: string, observable: boolean): void
  clear(): void
}

/**
 * The view owns one batch at a time. Every address it renders joins the open
 * batch; only when all joined addresses have reported once and at least one
 * was observable is one reconciliation read scheduled. A newly discovered
 * address opens a new batch, so even staggered first reports cannot schedule
 * one read per file.
 */
function createObservationBatch(reconcile: () => void): ObservationBatch {
  const known = new Set<string>()
  const pending = new Set<string>()
  let observable = false
  let closed = true
  return {
    add(addresses) {
      let added = false
      for (const address of addresses) {
        if (known.has(address)) continue
        known.add(address)
        pending.add(address)
        added = true
      }
      if (added) closed = false
    },
    settle(address, live) {
      if (closed || !pending.delete(address)) return
      if (live) observable = true
      if (pending.size > 0) return
      const fire = observable
      observable = false
      closed = true
      if (fire) reconcile()
    },
    clear() {
      known.clear()
      pending.clear()
      observable = false
      closed = true
    },
  }
}

/** View-level observation bookkeeping; all of it disposed with the body. */
function useObservation(reconcile: () => void): {
  add(addresses: readonly string[]): void
  settle(address: string, observable: boolean): void
  change(): void
} {
  const batch = useRef<ObservationBatch | undefined>(undefined)
  if (batch.current === undefined) batch.current = createObservationBatch(reconcile)
  const disposed = useRef(false)
  useEffect(
    () => () => {
      disposed.current = true
      batch.current?.clear()
    },
    [],
  )
  return {
    add(addresses) {
      if (!disposed.current) batch.current?.add(addresses)
    },
    settle(address, observable) {
      if (!disposed.current) batch.current?.settle(address, observable)
    },
    change() {
      if (!disposed.current) reconcile()
    },
  }
}

/** Schedule one debounced route re-read; later calls reset the 300 ms window. */
function useLiveReload(reload: () => void): () => void {
  const latest = useRef(reload)
  latest.current = reload
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = undefined
    },
    [],
  )
  return () => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      latest.current()
    }, LIVE_DEBOUNCE_MS)
  }
}

/** Reference-stable Markdown chrome for the current locale. */
function useMarkdownLabels(t: Translate): MarkdownLabels {
  return useMemo(
    () => ({
      code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
      footnotes: t('markdown.footnotes'),
    }),
    [t],
  )
}

interface DraftAndOpen {
  readonly sessionId: string
  readonly t: Translate
  draft(text: string): void
  open(address: string): void
}

interface RootBodyProps extends DraftAndOpen {
  readonly tab: TabFace
  readonly initialSegment: 'changes' | 'specs'
}

/** Root container: one lazy read per segment, refresh over the shown one. */
export function RootBody(props: RootBodyProps): ReactNode {
  const { tab, initialSegment, sessionId, t, draft, open } = props
  const [segment, setSegment] = useState<'changes' | 'specs'>(initialSegment)
  const changes = useRead<ChangeRow[]>(() => requestChanges(sessionId))
  const capabilities = useRead<CapabilitySummary[]>(() => requestCapabilities(sessionId))
  const started = useRef({ changes: false, specs: false })
  const load = (next: 'changes' | 'specs'): void => {
    started.current[next] = true
    if (next === 'changes') changes.reload()
    else capabilities.reload()
  }
  useEffect(() => {
    load(initialSegment)
    // The initial segment is fixed for the tab's lifetime.
  }, [])
  useTabRefresh(tab, () => {
    if (segment === 'changes') changes.reload()
    else capabilities.reload()
  })
  const choose = (next: 'changes' | 'specs'): void => {
    setSegment(next)
    if (!started.current[next]) load(next)
  }
  return (
    <RootView
      segment={segment}
      changes={changes.state}
      capabilities={capabilities.state}
      t={t}
      onSegment={choose}
      onRetry={() => load(segment)}
      onOpenChange={(name) => open(changeAddress(name))}
      onOpenCapability={(id) => open(capabilityAddress(id))}
      onPropose={() => draft(PROPOSE_DRAFT)}
    />
  )
}

interface ChangeBodyProps extends DraftAndOpen {
  readonly tab: TabFace
  readonly name: string
  readonly useResource?: UseResource
}

/** Change container: one read, artifact selection kept in this body. */
export function ChangeBody(props: ChangeBodyProps): ReactNode {
  const { tab, name, sessionId, t, draft } = props
  const read = useRead<ChangeDetail>(() => requestChange(sessionId, name))
  const [artifact, setArtifact] = useState<ArtifactKind | undefined>(undefined)
  const [delta, setDelta] = useState<string | undefined>(undefined)
  useEffect(() => {
    read.reload()
    // The change name is fixed for the tab's lifetime.
  }, [])
  useTabRefresh(tab, read.reload)
  const notify = useLiveReload(read.reload)
  const observation = useObservation(notify)
  const labels = useMarkdownLabels(t)
  // Keep every delta ever reported for this body's lifetime: a response that
  // omits a deleted file must not unmount its watch, or recreation is missed.
  const knownDeltas = useRef<Set<string>>(new Set())
  if (read.state.phase === 'ready') {
    for (const spec of read.state.value.specs) knownDeltas.current.add(spec.capability)
  }
  const addresses = changeWatchPaths(name, [...knownDeltas.current]).map((path) =>
    fileAddress(sessionId, path),
  )
  observation.add(addresses)
  const useResource = props.useResource ?? noResource
  return (
    <>
      {addresses.map((address) => (
        <FileWatch
          key={address}
          address={address}
          useResource={useResource}
          settle={observation.settle}
          change={observation.change}
        />
      ))}
      {readContent(read.state, t, read.reload, (change) => (
        <ChangeView
          change={change}
          artifact={artifact ?? initialArtifact(change)}
          delta={delta ?? change.specs[0]?.capability}
          t={t}
          labels={labels}
          onArtifact={setArtifact}
          onDelta={setDelta}
          onApply={() => draft(applyDraft(change.name))}
        />
      ))}
    </>
  )
}

interface CapabilityBodyProps {
  readonly tab: TabFace
  readonly id: string
  readonly sessionId: string
  readonly t: Translate
  readonly useResource?: UseResource
}

/** Capability container: one read of the accepted spec body. */
export function CapabilityBody(props: CapabilityBodyProps): ReactNode {
  const { tab, id, sessionId, t } = props
  const read = useRead<CapabilityDetail>(() => requestCapability(sessionId, id))
  useEffect(() => {
    read.reload()
    // The capability id is fixed for the tab's lifetime.
  }, [])
  useTabRefresh(tab, read.reload)
  const notify = useLiveReload(read.reload)
  const observation = useObservation(notify)
  const labels = useMarkdownLabels(t)
  const address = fileAddress(sessionId, capabilitySpecPath(id))
  observation.add([address])
  const useResource = props.useResource ?? noResource
  return (
    <>
      <FileWatch
        address={address}
        useResource={useResource}
        settle={observation.settle}
        change={observation.change}
      />
      {readContent(read.state, t, read.reload, (capability) => (
        <CapabilityView capability={capability} t={t} labels={labels} />
      ))}
    </>
  )
}

/** The designed loading, error, and success states shared by every read. */
function readContent<T>(
  state: ReadState<T>,
  t: Translate,
  retry: () => void,
  ready: (value: T) => ReactNode,
): ReactNode {
  if (state.phase === 'loading') {
    return (
      <div className="dsh-openspec-panel">
        <div className="dsh-openspec-scroll">
          <p className="dsh-openspec-state" role="status">
            {t('state.loading')}
          </p>
        </div>
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div className="dsh-openspec-panel">
        <div className="dsh-openspec-scroll">
          <div className="dsh-openspec-state">
            <p role="alert">{state.message}</p>
            <Button type="button" variant="outline" onClick={retry}>
              {t('state.retry')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  return ready(state.value)
}

export interface RootViewProps {
  readonly segment: 'changes' | 'specs'
  readonly changes: ReadState<ChangeRow[]>
  readonly capabilities: ReadState<CapabilitySummary[]>
  readonly t: Translate
  onSegment(segment: 'changes' | 'specs'): void
  onRetry(): void
  onOpenChange(name: string): void
  onOpenCapability(id: string): void
  onPropose(): void
}

/** Root view: Changes | Specs over one segmented control. */
export function RootView(props: RootViewProps): ReactNode {
  const { segment, changes, capabilities, t } = props
  return (
    <div className="dsh-openspec-panel">
      <SegmentedControl
        id="dsh-openspec-root"
        value={segment}
        options={[
          { value: 'changes', label: t('segment.changes') },
          { value: 'specs', label: t('segment.specs') },
        ]}
        onChange={props.onSegment}
        label={t('segment.label')}
        className="dsh-openspec-segments"
      />
      <div className="dsh-openspec-scroll">
        {segment === 'changes'
          ? readContent(changes, t, props.onRetry, (rows) =>
              changeRows(rows, t, props.onOpenChange, props.onPropose),
            )
          : readContent(capabilities, t, props.onRetry, (rows) =>
              capabilityRows(rows, t, props.onOpenCapability),
            )}
      </div>
    </div>
  )
}

/** One row per reported change: the facts a reader decides with. */
function changeRows(
  rows: readonly ChangeRow[],
  t: Translate,
  onOpen: (name: string) => void,
  onPropose: () => void,
): ReactNode {
  const sorted = sortChanges(rows)
  if (sorted.length === 0) {
    return (
      <div className="dsh-openspec-state">
        <p>{t('changes.empty')}</p>
        <Button type="button" variant="outline" onClick={onPropose}>
          {t('changes.propose')}
        </Button>
      </div>
    )
  }
  return (
    <div className="dsh-openspec-list">
      {sorted.map((row) => (
        <button
          key={row.name}
          type="button"
          className="dsh-openspec-row"
          onClick={() => onOpen(row.name)}
        >
          <span className="dsh-openspec-row-head">
            <span className="dsh-openspec-name">{row.name}</span>
            <span className="dsh-openspec-progress">
              {`${String(row.completedTasks)}/${String(row.totalTasks)}`}
            </span>
          </span>
          <span className="dsh-openspec-facts">
            <StateDot state={row.status === 'complete' ? 'done' : 'ongoing'} />
            <span>{statusLabel(row.status, t)}</span>
            <span className="dsh-openspec-tags">{presenceFacts(row.presence, t)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** One row per capability: its accepted requirement count. */
function capabilityRows(
  rows: readonly CapabilitySummary[],
  t: Translate,
  onOpen: (id: string) => void,
): ReactNode {
  if (rows.length === 0) {
    return (
      <div className="dsh-openspec-state">
        <p>{t('capabilities.empty')}</p>
      </div>
    )
  }
  return (
    <div className="dsh-openspec-list">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="dsh-openspec-row"
          onClick={() => onOpen(row.id)}
        >
          <span className="dsh-openspec-row-head">
            <span className="dsh-openspec-name">{row.id}</span>
          </span>
          <span className="dsh-openspec-facts">
            <span>{`${String(row.requirementCount)} ${t('capability.requirements')}`}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** Visible status words paired with the state dot. */
function statusLabel(status: string, t: Translate): string {
  if (status === 'complete') return t('status.complete')
  if (status === 'no-tasks') return t('status.noTasks')
  return t('status.inProgress')
}

/** Quiet artifact facts for a change row. */
function presenceFacts(presence: ChangePresence | undefined, t: Translate): ReactNode[] {
  if (presence === undefined) return []
  const facts: ReactNode[] = []
  if (presence.proposal) {
    facts.push(
      <Tag key="proposal" tone="quiet">
        {t('presence.proposal')}
      </Tag>,
    )
  }
  if (presence.design) {
    facts.push(
      <Tag key="design" tone="quiet">
        {t('presence.design')}
      </Tag>,
    )
  }
  if (presence.specs > 0) {
    facts.push(
      <Tag key="specs" tone="quiet">
        {presence.specs === 1 ? t('presence.spec') : t('presence.specs')}
      </Tag>,
    )
  }
  if (presence.tasks) {
    facts.push(
      <Tag key="tasks" tone="quiet">
        {t('presence.tasks')}
      </Tag>,
    )
  }
  return facts
}

export interface ChangeViewProps {
  readonly change: ChangeDetail
  readonly artifact: ArtifactKind
  readonly delta: string | undefined
  readonly t: Translate
  readonly labels: MarkdownLabels
  readonly now?: Date
  onArtifact(kind: ArtifactKind): void
  onDelta(capability: string): void
  onApply(): void
}

/** Change view: header, artifact segments, Markdown body. */
export function ChangeView(props: ChangeViewProps): ReactNode {
  const { change, artifact, delta, t, labels } = props
  const updated = updatedLabel(change.modified, props.now)
  const options: SegmentedControlOption<ArtifactKind>[] = ARTIFACT_KINDS.map((kind) => {
    const option: SegmentedControlOption<ArtifactKind> = {
      value: kind,
      label: t(`artifact.${kind}`),
    }
    if (!hasArtifact(change, kind)) {
      option.disabled = true
      option.title = t('artifact.notWritten')
    }
    return option
  })
  const selectedSpec = change.specs.find((spec) => spec.capability === delta) ?? change.specs[0]
  const body = artifact === 'specs' ? null : change.artifacts[artifact]
  return (
    <div className="dsh-openspec-panel">
      <div className="dsh-openspec-header">
        <span className="dsh-openspec-name">{change.name}</span>
        {updated === null ? null : <span className="dsh-openspec-updated">{updated}</span>}
        <span className="dsh-openspec-progress">
          {`${String(change.completedTasks)}/${String(change.totalTasks)}`} {t('change.tasks')}
        </span>
        <Button type="button" variant="outline" onClick={props.onApply}>
          {t('change.apply')}
        </Button>
      </div>
      <SegmentedControl
        id={`dsh-openspec-artifacts-${encodeURIComponent(change.name)}`}
        value={artifact}
        options={options}
        onChange={props.onArtifact}
        label={t('change.artifactLabel')}
        className="dsh-openspec-segments"
      />
      <div className="dsh-openspec-scroll">
        {artifact === 'specs' ? (
          selectedSpec === undefined ? (
            <p className="dsh-openspec-state">{t('artifact.notWritten')}</p>
          ) : (
            <>
              {change.specs.length > 1 ? (
                <div className="dsh-openspec-deltas">
                  <span>{`${String(change.specs.length)} ${t('change.deltas')}`}</span>
                  {change.specs.map((spec) => (
                    <Pill
                      key={spec.capability}
                      active={spec.capability === selectedSpec.capability}
                      onClick={() => props.onDelta(spec.capability)}
                    >
                      {spec.capability}
                    </Pill>
                  ))}
                </div>
              ) : null}
              <div className="dsh-openspec-body">
                <MarkdownText text={selectedSpec.body} labels={labels} />
              </div>
            </>
          )
        ) : (
          <div className="dsh-openspec-body">
            {body === null ? (
              <p className="dsh-openspec-state">{t('artifact.notWritten')}</p>
            ) : (
              <MarkdownText text={body} labels={labels} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export interface CapabilityViewProps {
  readonly capability: CapabilityDetail
  readonly t: Translate
  readonly labels: MarkdownLabels
  readonly now?: Date
}

/** Capability view: the accepted spec rendered as Markdown. */
export function CapabilityView(props: CapabilityViewProps): ReactNode {
  const { capability, t, labels } = props
  const updated = updatedLabel(capability.modified, props.now)
  return (
    <div className="dsh-openspec-panel">
      <div className="dsh-openspec-header">
        <span className="dsh-openspec-name">{capability.id}</span>
        {updated === null ? null : <span className="dsh-openspec-updated">{updated}</span>}
        <span className="dsh-openspec-progress">
          {`${String(capability.requirementCount)} ${t('capability.requirements')}`}
        </span>
      </div>
      <div className="dsh-openspec-scroll">
        <div className="dsh-openspec-body">
          <MarkdownText text={capability.body} labels={labels} />
        </div>
      </div>
    </div>
  )
}

/** Layout only: the host owns colour, type, controls, and focus rings. */
const CSS = `
.dsh-openspec-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 8px;
  overflow: hidden;
}
.dsh-openspec-segments {
  min-width: 0;
}
.dsh-openspec-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.dsh-openspec-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.dsh-openspec-progress {
  margin-left: auto;
}
.dsh-openspec-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh-openspec-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-openspec-row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-row-head .dsh-openspec-progress {
  margin-left: auto;
}
.dsh-openspec-facts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.dsh-openspec-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.dsh-openspec-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 8px;
}
.dsh-openspec-deltas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.dsh-openspec-body {
  min-width: 0;
  overflow-x: auto;
}
`
