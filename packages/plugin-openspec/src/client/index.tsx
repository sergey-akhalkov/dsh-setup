/**
 * OpenSpec apply picker: `/openspec-apply` opens DSH's native `popupSelect`
 * shell with the session workspace's unfinished changes. A pick writes the
 * literal `/openspec-apply-change <name>` into the composer draft and never
 * submits, so the ordinary skill-invocation path runs when the user sends it.
 *
 * The shell owns search, keyboard handling, the empty state, the error strip,
 * and styling; this module supplies option data and the selection handler only.
 *
 * The OpenSpec panel below adds one read-only right-sidebar tab type: a root
 * with counted Changes | Specs | Archive segments, structured change and
 * capability views, and no write but the composer drafts.
 *
 * shortcut: the structural commandUi / sessions / conversation faces below are
 * copied from DSH 0.2.1-rc.5; re-verify them when the supported DSH version
 * moves. A host without the command service registers nothing.
 */

import type {
  MarkdownLabels,
  SegmentedControlOption,
  SegmentedTab,
  TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
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
  archivedChangeAddress,
  type CapabilityDetail,
  type CapabilitySummary,
  type ChangeDetail,
  type ChangeListResponse,
  type ChangePresence,
  type ChangeRow,
  canOpenOpenSpec,
  capabilityAddress,
  capabilitySpecPath,
  changeAddress,
  changeWatchPaths,
  type Delta,
  type DeltaSpec,
  defaultSegmentStorage,
  deltaCapabilities,
  EXPLORE_DRAFT,
  fileAddress,
  type HistoryEntry,
  initialArtifact,
  initialRootSegment,
  isoDate,
  LOADING,
  matchesQuery,
  OPENSPEC_ID,
  OPENSPEC_KIND,
  openSpecTarget,
  openSpecTitle,
  type Phase,
  PROPOSE_DRAFT,
  parseTaskGroups,
  parseTaskLines,
  phaseDot,
  phaseOf,
  phaseTone,
  type ReadState,
  type Requirement,
  ROOT_ADDRESS,
  ROOT_SEGMENTS,
  type RootSegment,
  readSegment,
  relativeLabel,
  requestCapabilities,
  requestCapability,
  requestChange,
  requestChangeList,
  type SegmentStorage,
  sortArchived,
  sortChanges,
  sortHistory,
  summaryText,
  type TaskFile,
  type TaskLine,
  writeSegment,
} from './panel.ts'

/**
 * Document-relative form of the Host route that lists the session workspace's
 * changes. It stays relative so the desktop shell page and the Web page address
 * the same `/api` Fetch route.
 */
export { CHANGES_PATH } from './panel.ts'

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

/** The picker lists unfinished active changes only; archived rows never reach it. */
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
        options: async (session) => optionsOf((await requestChangeList(session.sessionId)).changes),
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
 * changes, archived changes, and accepted capability specs.
 */

/** Services the panel needs on top of the picker's; absent means no panel. */
const PANEL_SERVICES = ['sidebarRight', 'sidebarRightTabs', 'slots', 'locale', 'resources']

/** Panel copy, registered into the Client locale registry. */
const NS = 'dsh-setup-openspec-panel'

const EN: Record<string, string> = {
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
  readonly storage?: SegmentStorage
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
        storage={props.storage}
      />
    )
  } else if (target.view === 'change') {
    body = (
      <ChangeBody
        tab={tab}
        name={target.name}
        archived={target.archived === true}
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
        open={open}
        useResource={props.useResource}
      />
    )
  }
  return (
    <>
      <style>{PANEL_CSS}</style>
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
  readonly storage?: SegmentStorage
}

/** Root container: one change-list read for totals and the archive, lazy Specs. */
export function RootBody(props: RootBodyProps): ReactNode {
  const { tab, initialSegment, sessionId, t, draft, open } = props
  const storage = props.storage ?? defaultSegmentStorage()
  const start = initialRootSegment(initialSegment, readSegment(storage, sessionId))
  const [segment, setSegment] = useState<RootSegment>(start)
  const [specQuery, setSpecQuery] = useState('')
  const [archiveQuery, setArchiveQuery] = useState('')
  const changes = useRead<ChangeListResponse>(() => requestChangeList(sessionId))
  const capabilities = useRead<CapabilitySummary[]>(() => requestCapabilities(sessionId))
  const started = useRef({ specs: false })
  const loadSpecs = (): void => {
    started.current.specs = true
    capabilities.reload()
  }
  useEffect(() => {
    changes.reload()
    // A remembered Specs segment must load its rows on mount, not only after a click.
    if (start === 'specs') loadSpecs()
    // The initial segment is fixed for the tab's lifetime.
  }, [])
  useTabRefresh(tab, () => {
    if (segment === 'specs') capabilities.reload()
    else changes.reload()
  })
  const choose = (next: RootSegment): void => {
    setSegment(next)
    writeSegment(storage, sessionId, next)
    if (next === 'specs' && !started.current.specs) loadSpecs()
  }
  return (
    <RootView
      segment={segment}
      changes={changes.state}
      capabilities={capabilities.state}
      specQuery={specQuery}
      archiveQuery={archiveQuery}
      t={t}
      onSegment={choose}
      onSpecQuery={setSpecQuery}
      onArchiveQuery={setArchiveQuery}
      onRetry={() => {
        if (segment === 'specs') loadSpecs()
        else changes.reload()
      }}
      onOpenChange={(name, archived) =>
        open(archived ? archivedChangeAddress(name) : changeAddress(name))
      }
      onOpenCapability={(id) => open(capabilityAddress(id))}
      onExplore={() => draft(EXPLORE_DRAFT)}
      onPropose={() => draft(PROPOSE_DRAFT)}
      onSeeArchive={() => choose('archive')}
    />
  )
}

interface ChangeBodyProps extends DraftAndOpen {
  readonly tab: TabFace
  readonly name: string
  readonly archived?: boolean
  readonly useResource?: UseResource
}

/** Change container: one read, artifact selection kept in this body. */
export function ChangeBody(props: ChangeBodyProps): ReactNode {
  const { tab, name, sessionId, t, draft } = props
  const archived = props.archived === true
  const read = useRead<ChangeDetail>(() => requestChange(sessionId, name, archived))
  const [artifact, setArtifact] = useState<ArtifactKind | undefined>(undefined)
  const [delta, setDelta] = useState<string | undefined>(undefined)
  const [requirementQuery, setRequirementQuery] = useState('')
  useEffect(() => {
    read.reload()
    // The change name and family are fixed for the tab's lifetime.
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
    for (const entry of read.state.value.deltas ?? []) knownDeltas.current.add(entry.capability)
  }
  // Archived views are immutable by convention: no file observation (D12).
  const addresses = archived
    ? []
    : changeWatchPaths(name, [...knownDeltas.current]).map((path) => fileAddress(sessionId, path))
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
          delta={delta ?? capabilityList(change)[0]}
          requirementQuery={requirementQuery}
          t={t}
          labels={labels}
          onArtifact={setArtifact}
          onDelta={setDelta}
          onRequirementQuery={setRequirementQuery}
          onApply={() => draft(applyDraft(change.name))}
          onOpenCapability={(id) => props.open(capabilityAddress(id))}
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
  readonly open: (address: string) => void
  readonly useResource?: UseResource
}

/** Capability container: one read of the accepted spec and its history. */
export function CapabilityBody(props: CapabilityBodyProps): ReactNode {
  const { tab, id, sessionId, t, open } = props
  const read = useRead<CapabilityDetail>(() => requestCapability(sessionId, id))
  const [section, setSection] = useState<'requirements' | 'history'>('requirements')
  const [requirementQuery, setRequirementQuery] = useState('')
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
        <CapabilityView
          capability={capability}
          requirementQuery={requirementQuery}
          t={t}
          labels={labels}
          section={section}
          onSection={setSection}
          onRequirementQuery={setRequirementQuery}
          onOpenArchived={(name) => open(archivedChangeAddress(name))}
        />
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
        <div className="dsh-openspec-scroll">{loadingLine(t)}</div>
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div className="dsh-openspec-panel">
        <div className="dsh-openspec-scroll">
          {errorState({ message: state.message, t, onRetry: retry })}
        </div>
      </div>
    )
  }
  return ready(state.value)
}

/** One quiet shimmer line: the designed loading state. */
function loadingLine(t: Translate): ReactNode {
  return (
    <p className="dsh-openspec-state" role="status">
      <primitives.TextShimmer active>{t('state.loading')}</primitives.TextShimmer>
    </p>
  )
}

/** Warning icon + cause + Retry, on the same card surface as a row. */
function errorState(props: {
  readonly message: string
  readonly t: Translate
  onRetry(): void
}): ReactNode {
  return (
    <div className="dsh-openspec-error">
      <primitives.IconWarningTriangleOutlineRegular size={14} />
      <p role="alert">{props.message}</p>
      <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
        {props.t('state.retry')}
      </Button>
    </div>
  )
}

export interface RootViewProps {
  readonly segment: RootSegment
  readonly changes: ReadState<ChangeListResponse>
  readonly capabilities: ReadState<CapabilitySummary[]>
  readonly specQuery: string
  readonly archiveQuery: string
  readonly t: Translate
  readonly now?: Date
  onSegment(segment: RootSegment): void
  onSpecQuery(value: string): void
  onArchiveQuery(value: string): void
  onRetry(): void
  onOpenChange(name: string, archived: boolean): void
  onOpenCapability(id: string): void
  onExplore(): void
  onPropose(): void
  onSeeArchive(): void
}

/** Root view: the counted workspace header and its three segments. */
export function RootView(props: RootViewProps): ReactNode {
  const { t } = props
  const list = props.changes.phase === 'ready' ? props.changes.value : undefined
  const capabilityRows = props.capabilities.phase === 'ready' ? props.capabilities.value : undefined
  const capabilityTotal = capabilityRows?.length ?? list?.counts.capabilities
  const labels: Record<RootSegment, string> = {
    changes: t('segment.changes'),
    specs: t('segment.specs'),
    archive: t('segment.archive'),
  }
  const totals: Record<RootSegment, number | undefined> = {
    changes: list?.counts.active,
    specs: capabilityTotal,
    archive: list?.counts.archived,
  }
  const options: SegmentedControlOption<RootSegment>[] = ROOT_SEGMENTS.map((value) => ({
    value,
    label:
      totals[value] === undefined ? labels[value] : `${labels[value]} ${String(totals[value])}`,
  }))
  let body: ReactNode
  if (props.segment === 'changes') {
    body = readContent(props.changes, t, props.onRetry, (response) => changesBody(response, props))
  } else if (props.segment === 'specs') {
    body = readContent(props.capabilities, t, props.onRetry, (rows) => specsBody(rows, props, list))
  } else {
    body = readContent(props.changes, t, props.onRetry, (response) =>
      archiveBody(response.archived, props),
    )
  }
  return (
    <div className="dsh-openspec-panel">
      <header className="dsh-openspec-root-header">
        <div className="dsh-openspec-title-row">
          <h2 className="dsh-openspec-panel-title">{t('guide.title')}</h2>
          {list === undefined ? null : (
            <span className="dsh-openspec-summary">
              {workspaceSummary(list.counts, capabilityTotal, t)}
            </span>
          )}
        </div>
        <div className="dsh-openspec-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<primitives.IconBrowseOutlineRegular size={14} />}
            onClick={props.onExplore}
          >
            {t('root.explore')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={<primitives.IconPlusOutlineRegular size={14} />}
            onClick={props.onPropose}
          >
            {t('root.propose')}
          </Button>
        </div>
      </header>
      <SegmentedControl
        id="dsh-openspec-root"
        value={props.segment}
        options={options}
        onChange={props.onSegment}
        label={t('segment.label')}
        className="dsh-openspec-segments"
      />
      <div className="dsh-openspec-scroll">{body}</div>
    </div>
  )
}

/** `2 changes · 19 specs · 34 archived` for the header and the empty state. */
function workspaceSummary(
  counts: ChangeListResponse['counts'],
  capabilityTotal: number | undefined,
  t: Translate,
): string {
  return [
    `${String(counts.active)} ${t('summary.changes')}`,
    `${String(capabilityTotal ?? counts.capabilities)} ${t('summary.specs')}`,
    `${String(counts.archived)} ${t('summary.archived')}`,
  ].join(' · ')
}

/** The Changes segment: In progress and Complete groups, or the empty state. */
function changesBody(response: ChangeListResponse, props: RootViewProps): ReactNode {
  const active = sortChanges(response.changes).filter((row) => phaseOf(row) !== 'archived')
  if (active.length === 0) return changesEmpty(response, props)
  const inProgress = active.filter((row) => phaseOf(row) !== 'complete')
  const complete = active.filter((row) => phaseOf(row) === 'complete')
  return (
    <>
      {inProgress.length > 0 ? (
        <section className="dsh-openspec-section">
          <span className="dsh-openspec-group-label">{props.t('group.inProgress')}</span>
          <div className="dsh-openspec-list">
            {inProgress.map((row) =>
              ChangeCard({
                row,
                t: props.t,
                now: props.now,
                onOpen: (name) => props.onOpenChange(name, false),
              }),
            )}
          </div>
        </section>
      ) : null}
      {complete.length > 0 ? (
        <section className="dsh-openspec-section">
          <span className="dsh-openspec-group-label">{props.t('group.complete')}</span>
          <div className="dsh-openspec-list">
            {complete.map((row) =>
              ChangeCard({
                row,
                t: props.t,
                now: props.now,
                onOpen: (name) => props.onOpenChange(name, false),
              }),
            )}
          </div>
        </section>
      ) : null}
    </>
  )
}

/** No open work: totals, both next steps, and the newest archived changes. */
function changesEmpty(response: ChangeListResponse, props: RootViewProps): ReactNode {
  const recent = sortArchived(response.archived).slice(0, 3)
  return (
    <div className="dsh-openspec-section">
      <p className="dsh-openspec-summary">
        {workspaceSummary(response.counts, response.counts.capabilities, props.t)}
      </p>
      <div className="dsh-openspec-actions">
        {ActionCard({
          icon: <primitives.IconBrowseOutlineRegular size={14} />,
          title: props.t('root.explore'),
          body: props.t('root.exploreBody'),
          onClick: props.onExplore,
        })}
        {ActionCard({
          icon: <primitives.IconPlusOutlineRegular size={14} />,
          title: props.t('root.propose'),
          body: props.t('root.proposeBody'),
          onClick: props.onPropose,
        })}
      </div>
      {recent.length > 0 ? (
        <section className="dsh-openspec-section">
          <span className="dsh-openspec-group-label">{props.t('group.recentlyArchived')}</span>
          <div className="dsh-openspec-list">
            {recent.map((row) =>
              ChangeCard({
                row,
                t: props.t,
                now: props.now,
                archived: true,
                onOpen: (name) => props.onOpenChange(name, true),
              }),
            )}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={props.onSeeArchive}>
            {props.t('actions.seeArchive')}
          </Button>
        </section>
      ) : null}
    </div>
  )
}

/** One action card in the empty change list. */
function ActionCard(props: {
  readonly icon: ReactNode
  readonly title: string
  readonly body: string
  onClick(): void
}): ReactNode {
  return (
    <button type="button" className="dsh-openspec-action-card" onClick={props.onClick}>
      <span className="dsh-openspec-action-head">
        {props.icon}
        <span className="dsh-openspec-action-title">{props.title}</span>
      </span>
      <span className="dsh-openspec-action-body">{props.body}</span>
    </button>
  )
}

/** The Specs segment: searchable capability rows with purpose and provenance. */
function specsBody(
  rows: readonly CapabilitySummary[],
  props: RootViewProps,
  list: ChangeListResponse | undefined,
): ReactNode {
  if (rows.length === 0) {
    return (
      <div className="dsh-openspec-section">
        <p className="dsh-openspec-empty-title">{props.t('specs.emptyTitle')}</p>
        <p className="dsh-openspec-meta">{props.t('specs.emptyBody')}</p>
        {(list?.counts.archived ?? 0) > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={props.onSeeArchive}>
            {props.t('specs.archive')}
          </Button>
        ) : null}
      </div>
    )
  }
  const visible = rows.filter((row) => matchesQuery(props.specQuery, row.id, row.purpose))
  return (
    <div className="dsh-openspec-section">
      {FilterField({
        label: props.t('specs.filterLabel'),
        placeholder: props.t('specs.filterPlaceholder'),
        value: props.specQuery,
        onChange: props.onSpecQuery,
      })}
      {visible.length === 0 ? (
        <p className="dsh-openspec-state">{props.t('specs.noMatch')}</p>
      ) : (
        <div className="dsh-openspec-list">
          {visible.map((row) =>
            CapabilityCard({
              row,
              t: props.t,
              onOpen: props.onOpenCapability,
            }),
          )}
        </div>
      )}
    </div>
  )
}

/** The Archive segment: newest-first closed work, searchable, read-only. */
function archiveBody(rows: readonly ChangeRow[], props: RootViewProps): ReactNode {
  if (rows.length === 0) {
    return (
      <div className="dsh-openspec-section">
        <p className="dsh-openspec-empty-title">{props.t('archive.emptyTitle')}</p>
        <p className="dsh-openspec-meta">{props.t('archive.emptyBody')}</p>
      </div>
    )
  }
  const visible = sortArchived(rows).filter((row) =>
    matchesQuery(props.archiveQuery, row.name, row.summary),
  )
  return (
    <div className="dsh-openspec-section">
      {FilterField({
        label: props.t('archive.filterLabel'),
        placeholder: props.t('archive.filterPlaceholder'),
        value: props.archiveQuery,
        onChange: props.onArchiveQuery,
      })}
      {visible.length === 0 ? (
        <p className="dsh-openspec-state">{props.t('archive.noMatch')}</p>
      ) : (
        <div className="dsh-openspec-list">
          {visible.map((row) =>
            ChangeCard({
              row,
              t: props.t,
              now: props.now,
              archived: true,
              onOpen: (name) => props.onOpenChange(name, true),
            }),
          )}
        </div>
      )}
    </div>
  )
}

/** A labelled text filter; the label stays visible above the input. */
function FilterField(props: {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  onChange(value: string): void
}): ReactNode {
  const id = `dsh-openspec-filter-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <label className="dsh-openspec-filter" htmlFor={id}>
      <span className="dsh-openspec-filter-label">{props.label}</span>
      <primitives.Input
        id={id}
        type="search"
        value={props.value}
        placeholder={props.placeholder}
        icon={<primitives.IconSearchOutlineRegular size={14} />}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  )
}

/** One change card: phase, purpose, progress, and provenance. */
function ChangeCard(props: {
  readonly row: ChangeRow
  readonly t: Translate
  readonly now?: Date
  readonly archived?: boolean
  onOpen(name: string): void
}): ReactNode {
  const archived = props.archived === true || props.row.archived === true
  const phase = archived ? 'archived' : phaseOf(props.row)
  const updated = relativeLabel(props.row.modified, props.now)
  const archivedOn = isoDate(props.row.archivedAt)
  return (
    <button
      type="button"
      className={`dsh-openspec-card${archived ? ' dsh-openspec-card-archived' : ''}`}
      onClick={() => props.onOpen(props.row.name)}
    >
      <span className="dsh-openspec-card-head">
        {archived ? (
          <primitives.IconCheckCircleOutlineRegular size={14} />
        ) : (
          <StateDot state={phaseDot(phase)} />
        )}
        <Tag tone={phaseTone(phase)}>
          {archived ? (archivedOn ?? props.t('phase.archived')) : props.t(`phase.${phase}`)}
        </Tag>
        <span className="dsh-openspec-card-title">{props.row.name}</span>
        {props.row.totalTasks > 0 ? (
          <span className="dsh-openspec-card-count">
            {`${String(props.row.completedTasks)}/${String(props.row.totalTasks)}`}
          </span>
        ) : null}
      </span>
      {summaryText(props.row.summary) === null ? null : (
        <primitives.Tooltip label={props.row.summary ?? ''}>
          <span className="dsh-openspec-purpose">{props.row.summary}</span>
        </primitives.Tooltip>
      )}
      {props.row.totalTasks > 0 ? (
        ProgressBar({ done: props.row.completedTasks, total: props.row.totalTasks, t: props.t })
      ) : (
        <span className="dsh-openspec-meta">{props.t('change.tasksNotWritten')}</span>
      )}
      <span className="dsh-openspec-meta">
        <span className="dsh-openspec-tags">{presenceFacts(props.row.presence, props.t)}</span>
        {updated === null ? null : <span>{`${props.t('change.updated')} ${updated}`}</span>}
        {props.row.commit === undefined || props.row.commit === null
          ? null
          : CommitFactView({ commit: props.row.commit })}
      </span>
    </button>
  )
}

/** One capability row: name, purpose, requirement count, and provenance. */
function CapabilityCard(props: {
  readonly row: CapabilitySummary
  readonly t: Translate
  onOpen(id: string): void
}): ReactNode {
  const provenance = props.row.lastChange
  const commit = props.row.commit ?? provenance?.commit ?? null
  return (
    <button type="button" className="dsh-openspec-card" onClick={() => props.onOpen(props.row.id)}>
      <span className="dsh-openspec-card-head">
        <span className="dsh-openspec-card-title">{props.row.id}</span>
        <span className="dsh-openspec-card-count">
          {`${String(props.row.requirementCount)} ${props.t('specs.req')}`}
        </span>
      </span>
      {summaryText(props.row.purpose) === null ? null : (
        <span className="dsh-openspec-purpose dsh-openspec-purpose-one">{props.row.purpose}</span>
      )}
      <span className="dsh-openspec-meta">
        {provenance === undefined || provenance === null ? (
          <span>{`${String(props.row.requirementCount)} ${props.t('capability.requirements')}`}</span>
        ) : (
          <>
            <span>{`${props.t('specs.acceptedVia')} ${provenance.name}`}</span>
            <span>{isoDate(provenance.date) ?? provenance.date}</span>
            <span>{`${String(provenance.completedTasks)}/${String(provenance.totalTasks)}`}</span>
          </>
        )}
        {commit === null ? null : CommitFactView({ commit })}
      </span>
    </button>
  )
}

/** Task progress: the bar and the `4/12 tasks` text. */
export function ProgressBar(props: {
  readonly done: number
  readonly total: number
  readonly t: Translate
}): ReactNode {
  const ratio = props.total <= 0 ? 0 : Math.min(1, props.done / props.total)
  return (
    <span
      className="dsh-openspec-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={props.total}
      aria-valuenow={props.done}
    >
      <span className="dsh-openspec-progress-track">
        <span className="dsh-openspec-progress-fill" style={{ width: `${String(ratio * 100)}%` }} />
      </span>
      <span className="dsh-openspec-progress-label">
        {`${String(props.done)}/${String(props.total)} ${props.t('change.tasks')}`}
      </span>
    </span>
  )
}

/** The branch icon, short hash, commit date, and the subject on demand. */
function CommitFactView(props: {
  readonly commit: { readonly short: string; readonly at: string; readonly subject: string }
}): ReactNode {
  return (
    <span className="dsh-openspec-commit">
      <primitives.IconBranchOutlineRegular size={14} />
      <primitives.Tooltip
        label={props.commit.subject === '' ? props.commit.short : props.commit.subject}
      >
        <span>{props.commit.short}</span>
      </primitives.Tooltip>
      {props.commit.at === '' ? null : (
        <span className="dsh-openspec-meta">{props.commit.at.slice(0, 10)}</span>
      )}
    </span>
  )
}

/** Quiet artifact facts for a change card. */
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
  readonly requirementQuery: string
  readonly t: Translate
  readonly labels: MarkdownLabels
  readonly now?: Date
  onArtifact(kind: ArtifactKind): void
  onDelta(capability: string): void
  onRequirementQuery(value: string): void
  onApply(): void
  onOpenCapability(id: string): void
}

/** Change view: header, artifact tabs, and the selected readable body. */
export function ChangeView(props: ChangeViewProps): ReactNode {
  const { change, artifact, delta, t, labels } = props
  const archived = change.archived === true
  const phase: Phase = archived ? 'archived' : phaseOf(change)
  const deltas = change.deltas ?? []
  const baseId = `dsh-openspec-artifacts-${encodeURIComponent(change.name)}`
  const items: [SegmentedTab<ArtifactKind>, ...SegmentedTab<ArtifactKind>[]] = ARTIFACT_KINDS.map(
    (kind) => ({
      value: kind,
      label: artifactLabel(kind, change, t),
      id: `${baseId}-${kind}`,
      panelId: `${baseId}-${kind}-panel`,
    }),
  ) as [SegmentedTab<ArtifactKind>, ...SegmentedTab<ArtifactKind>[]]
  const updated = relativeLabel(change.modified, props.now)
  const archivedOn = isoDate(change.archivedAt)
  return (
    <div className="dsh-openspec-panel">
      <header className="dsh-openspec-detail-header">
        <div className="dsh-openspec-card-head">
          <h2 className="dsh-openspec-detail-title">{change.name}</h2>
          <Tag tone={phaseTone(phase)}>{t(`phase.${phase}`)}</Tag>
          {archivedOn === null ? null : <Tag tone="quiet">{archivedOn}</Tag>}
        </div>
        {summaryText(change.summary) === null ? null : (
          <p className="dsh-openspec-purpose">{change.summary}</p>
        )}
        <div className="dsh-openspec-progress-row">
          {change.totalTasks > 0 ? (
            ProgressBar({ done: change.completedTasks, total: change.totalTasks, t })
          ) : (
            <span className="dsh-openspec-meta">{t('change.tasksNotWritten')}</span>
          )}
          {archived ? null : (
            <Button type="button" variant="outline" size="sm" onClick={props.onApply}>
              {t('change.apply')}
            </Button>
          )}
        </div>
        <div className="dsh-openspec-meta">
          {updated === null ? null : <span>{`${t('change.updated')} ${updated}`}</span>}
          {change.commit === undefined || change.commit === null
            ? null
            : CommitFactView({ commit: change.commit })}
        </div>
      </header>
      <primitives.SegmentedTabs
        items={items}
        value={artifact}
        onChange={props.onArtifact}
        label={t('change.artifactLabel')}
      />
      <div
        className="dsh-openspec-scroll"
        id={`${baseId}-${artifact}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${artifact}`}
      >
        {artifactBody(change, artifact, delta, deltas, t, labels, props)}
      </div>
    </div>
  )
}

/** Distinct capabilities the structured deltas and raw Markdown fallbacks touch. */
function capabilityList(change: ChangeDetail): string[] {
  return [
    ...new Set([
      ...(change.deltas ?? []).map((entry) => entry.capability),
      ...change.specs.map((spec) => spec.capability),
    ]),
  ]
}

/** Tab label: the shared word, with the delta count where it matters. */
function artifactLabel(kind: ArtifactKind, change: ChangeDetail, t: Translate): string {
  if (kind !== 'specs') return t(`artifact.${kind}`)
  return `${t('artifact.specs')} (${String(capabilityList(change).length)})`
}

/** The selected artifact: Markdown body, delta cards, or the task checklist. */
function artifactBody(
  change: ChangeDetail,
  artifact: ArtifactKind,
  delta: string | undefined,
  deltas: readonly Delta[],
  t: Translate,
  labels: MarkdownLabels,
  props: ChangeViewProps,
): ReactNode {
  if (artifact === 'specs') {
    if (capabilityList(change).length === 0) {
      return <p className="dsh-openspec-state">{t('artifact.notWritten')}</p>
    }
    return DeltaView({
      deltas,
      specs: change.specs,
      selected: delta,
      query: props.requirementQuery,
      t,
      labels,
      onDelta: props.onDelta,
      onRequirementQuery: props.onRequirementQuery,
      onOpenCapability: props.onOpenCapability,
    })
  }
  if (artifact === 'tasks') {
    return TaskChecklist({
      content: change.artifacts.tasks,
      files: change.taskFiles,
      completedTasks: change.completedTasks,
      totalTasks: change.totalTasks,
      t,
    })
  }
  const body = change.artifacts[artifact]
  if (body === null) return <p className="dsh-openspec-state">{t('artifact.notWritten')}</p>
  return (
    <div className="dsh-openspec-body">
      <MarkdownText text={body} labels={labels} />
    </div>
  )
}

/** Structured delta cards, capability pills, and the accepted-spec action. */
function DeltaView(props: {
  readonly deltas: readonly Delta[]
  readonly specs: readonly DeltaSpec[]
  readonly selected: string | undefined
  readonly query: string
  readonly t: Translate
  readonly labels: MarkdownLabels
  onDelta(capability: string): void
  onRequirementQuery(value: string): void
  onOpenCapability(id: string): void
}): ReactNode {
  const capabilities = [
    ...new Set([...deltaCapabilities(props.deltas), ...props.specs.map((spec) => spec.capability)]),
  ]
  const current = capabilities.find((entry) => entry === props.selected) ?? capabilities[0]
  if (current === undefined) return null
  // A mixed delta file carries one entry per operation for the same capability.
  const groups = props.deltas.filter((entry) => entry.capability === current)
  const raw = props.specs.find((spec) => spec.capability === current)
  return (
    <div className="dsh-openspec-section">
      {capabilities.length > 1 ? (
        <div className="dsh-openspec-deltas">
          <span className="dsh-openspec-group-label">
            {`${String(capabilities.length)} ${props.t('change.deltas')}`}
          </span>
          {capabilities.map((entry) => (
            <Pill key={entry} active={entry === current} onClick={() => props.onDelta(entry)}>
              {entry}
            </Pill>
          ))}
        </div>
      ) : null}
      {groups.length === 0 ? (
        raw === undefined ? (
          <p className="dsh-openspec-state">{props.t('artifact.notWritten')}</p>
        ) : (
          <>
            <div className="dsh-openspec-delta-head">
              <span className="dsh-openspec-card-title">{current}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<primitives.IconRightUpOutlineRegular size={14} />}
                onClick={() => props.onOpenCapability(current)}
              >
                {props.t('capability.openAccepted')}
              </Button>
            </div>
            {/* Archived unparsed-file fallback: the file body stays readable. */}
            <div className="dsh-openspec-body">
              <MarkdownText text={raw.body} labels={props.labels} />
            </div>
          </>
        )
      ) : (
        groups.map((entry) => (
          <div className="dsh-openspec-section" key={`${entry.capability}-${entry.operation}`}>
            <div className="dsh-openspec-delta-head">
              <Tag tone={operationTone(entry.operation)}>{entry.operation}</Tag>
              <span className="dsh-openspec-card-title">{entry.capability}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<primitives.IconRightUpOutlineRegular size={14} />}
                onClick={() => props.onOpenCapability(entry.capability)}
              >
                {props.t('capability.openAccepted')}
              </Button>
            </div>
            {entry.rename === undefined ? null : (
              <p className="dsh-openspec-rename">
                {`${props.t('delta.from')} ${entry.rename.from} → ${props.t('delta.to')} ${entry.rename.to}`}
              </p>
            )}
            {RequirementList({
              requirements: entry.requirements,
              query: props.query,
              t: props.t,
              onQuery: props.onRequirementQuery,
            })}
          </div>
        ))
      )}
    </div>
  )
}

/** Semantic tone per delta operation; one operation always keeps one tone. */
function operationTone(operation: Delta['operation']): TagTone {
  if (operation === 'ADDED') return 'info'
  if (operation === 'REMOVED') return 'danger'
  if (operation === 'RENAMED') return 'warning'
  return 'neutral'
}

export interface RequirementListProps {
  readonly requirements: readonly Requirement[]
  readonly query: string
  readonly t: Translate
  onQuery(value: string): void
}

/** Requirement cards with the >12 filter; used by delta and capability views. */
export function RequirementList(props: RequirementListProps): ReactNode {
  const filterable = props.requirements.length > 12
  const visible = filterable
    ? props.requirements.filter((requirement) =>
        matchesQuery(props.query, requirement.name, requirement.text),
      )
    : props.requirements
  if (props.requirements.length === 0) return null
  return (
    <div className="dsh-openspec-section">
      {filterable
        ? FilterField({
            label: props.t('requirements.filterLabel'),
            placeholder: props.t('requirements.filterPlaceholder'),
            value: props.query,
            onChange: props.onQuery,
          })
        : null}
      {visible.length === 0 ? (
        <p className="dsh-openspec-state">{props.t('requirements.noMatch')}</p>
      ) : (
        <div className="dsh-openspec-list">
          {visible.map((requirement) => RequirementCard({ requirement, t: props.t }))}
        </div>
      )}
    </div>
  )
}

/** One requirement card: name, inline text, and labelled scenario blocks. */
function RequirementCard(props: {
  readonly requirement: Requirement
  readonly t: Translate
}): ReactNode {
  return (
    <article className="dsh-openspec-requirement">
      <h4 className="dsh-openspec-requirement-title">{props.requirement.name}</h4>
      <p className="dsh-openspec-requirement-text">
        {InlineText({ text: props.requirement.text })}
      </p>
      {props.requirement.scenarios.map((scenario) => ScenarioBlock({ scenario, t: props.t }))}
    </article>
  )
}

interface ScenarioStep {
  readonly label: string
  readonly text: string
}

/** Split `- **WHEN** …` scenario bullets into labelled steps. */
export function scenarioSteps(rawText: string): ScenarioStep[] {
  const steps: ScenarioStep[] = []
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const body = line.replace(/^[-*+]\s+/, '')
    const match = /^(?:\*\*)?(WHEN|THEN|AND|BUT)(?:\*\*)?\s*(.*)$/.exec(body)
    if (match === null) {
      steps.push({ label: '', text: body })
    } else {
      steps.push({ label: match[1] ?? '', text: match[2] ?? '' })
    }
  }
  return steps
}

/** One scenario with its WHEN/THEN/AND/BUT step tags. */
function ScenarioBlock(props: {
  readonly scenario: { readonly name: string; readonly rawText: string }
  readonly t: Translate
}): ReactNode {
  return (
    <div className="dsh-openspec-scenario">
      <span className="dsh-openspec-scenario-name">
        {`${props.t('scenario.label')} ${props.scenario.name}`}
      </span>
      {scenarioSteps(props.scenario.rawText).map((step, index) => (
        <span className="dsh-openspec-step" key={`${step.label}-${String(index)}`}>
          {step.label === '' ? null : (
            <span className="dsh-openspec-step-tag">
              {props.t(`scenario.${step.label.toLowerCase()}`)}
            </span>
          )}
          <span>{InlineText({ text: step.text })}</span>
        </span>
      ))}
    </div>
  )
}

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const KEYWORDS = new Set(['SHALL', 'MUST', 'MUST NOT'])
const KEYWORD_PATTERN = /\b(MUST NOT|SHALL|MUST)\b/

/**
 * The panel's small inline Markdown renderer: backticked code, strong,
 * emphasis, http(s) links, and normative keywords marked without changing text.
 */
export function InlineText(props: { readonly text: string }): ReactNode {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of props.text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > last) {
      for (const node of keywordNodes(props.text.slice(last, index), key)) {
        nodes.push(node)
        key += 1
      }
    }
    const code = match[1]
    const strong = match[2]
    const emphasis = match[3]
    const label = match[4]
    const href = match[5]
    if (code !== undefined) {
      nodes.push(
        <code className="dsh-openspec-code" key={`code-${String(key)}`}>
          {code}
        </code>,
      )
    } else if (strong !== undefined) {
      // InlineText has no hooks, so nesting it as a call keeps the renderer
      // usable from the hook-mock test harness as well as from React.
      nodes.push(<strong key={`strong-${String(key)}`}>{InlineText({ text: strong })}</strong>)
    } else if (emphasis !== undefined) {
      nodes.push(<em key={`em-${String(key)}`}>{InlineText({ text: emphasis })}</em>)
    } else if (label !== undefined && href !== undefined) {
      nodes.push(
        <a key={`link-${String(key)}`} href={href} target="_blank" rel="noreferrer">
          {InlineText({ text: label })}
        </a>,
      )
    }
    key += 1
    last = index + match[0].length
  }
  if (last < props.text.length) {
    for (const node of keywordNodes(props.text.slice(last), key)) nodes.push(node)
  }
  return <>{nodes}</>
}

/** Split plain text around the normative keywords; case-sensitive by construction. */
function keywordNodes(text: string, keyBase: number): ReactNode[] {
  const parts = text.split(KEYWORD_PATTERN)
  const nodes: ReactNode[] = []
  for (const part of parts) {
    if (part === '') continue
    if (KEYWORDS.has(part)) {
      nodes.push(
        <span className="dsh-openspec-keyword" key={`kw-${String(keyBase)}-${part}`}>
          {part}
        </span>,
      )
    } else {
      nodes.push(part)
    }
    keyBase += 1
  }
  return nodes
}

export interface TaskChecklistProps {
  readonly content: string | null
  readonly files?: readonly TaskFile[]
  readonly completedTasks: number
  readonly totalTasks: number
  readonly t: Translate
}

/**
 * The Tasks artifact: grouped checklist from the change's task files, with the
 * pinned CLI grammar and the header's counts kept authoritative.
 */
export function TaskChecklist(props: TaskChecklistProps): ReactNode {
  const sources: readonly TaskFile[] =
    props.files !== undefined && props.files.length > 0
      ? props.files
      : props.content === null
        ? []
        : [{ path: '', body: props.content }]
  if (sources.length === 0) {
    return <p className="dsh-openspec-state">{props.t('artifact.notWritten')}</p>
  }
  const groups = sources
    .flatMap((file) => parseTaskGroups(file.body))
    .filter((group) => group.tasks.length > 0)
  const parsed: TaskLine[] = sources.flatMap((file) => parseTaskLines(file.body))
  const remainder = props.totalTasks - parsed.length
  if (groups.length === 0 && props.totalTasks === 0) {
    return <p className="dsh-openspec-state">{props.t('change.tasksNotWritten')}</p>
  }
  return (
    <div className="dsh-openspec-section">
      {remainder === 0 ? null : (
        <p className="dsh-openspec-meta">
          {`${String(Math.abs(remainder))} ${props.t('change.unparsedTasks')}`}
        </p>
      )}
      {groups.map((group, index) => {
        const done = group.tasks.filter((task) => task.done).length
        return (
          <section className="dsh-openspec-task-group" key={`${group.title}-${String(index)}`}>
            <span className="dsh-openspec-task-group-head">
              <span className="dsh-openspec-group-label">
                {group.title === '' ? props.t('change.tasks') : group.title}
              </span>
              <span className="dsh-openspec-meta">
                {`${String(done)}/${String(group.tasks.length)}`}
              </span>
            </span>
            <span className="dsh-openspec-list">
              {group.tasks.map((task, taskIndex) => (
                <span
                  className={`dsh-openspec-task${task.done ? ' dsh-openspec-task-done' : ''}`}
                  key={`${task.description}-${String(taskIndex)}`}
                >
                  <StateDot state={task.done ? 'done' : 'idle'} appearance="step" size={14} />
                  <span>{InlineText({ text: task.description })}</span>
                </span>
              ))}
            </span>
          </section>
        )
      })}
    </div>
  )
}

export interface CapabilityViewProps {
  readonly capability: CapabilityDetail
  readonly requirementQuery: string
  readonly t: Translate
  readonly labels: MarkdownLabels
  readonly now?: Date
  readonly section?: 'requirements' | 'history'
  onSection(section: 'requirements' | 'history'): void
  onRequirementQuery(value: string): void
  onOpenArchived(name: string): void
}

/** Capability view: accepted-spec header and Requirements | History tabs. */
export function CapabilityView(props: CapabilityViewProps): ReactNode {
  const { capability, t, labels } = props
  const section = props.section ?? 'requirements'
  const requirements = capability.requirements ?? []
  const history = sortHistory(capability.history ?? [])
  const requirementCount =
    capability.requirementCount > 0 ? capability.requirementCount : requirements.length
  const scenarioCount = requirements.reduce(
    (sum, requirement) => sum + requirement.scenarios.length,
    0,
  )
  const producer = history[0]
  const accepted = isoDate(capability.modified)
  const tabs: [
    SegmentedTab<'requirements' | 'history'>,
    ...SegmentedTab<'requirements' | 'history'>[],
  ] = [
    {
      value: 'requirements',
      label: `${t('capability.requirementsTab')} (${String(requirementCount)})`,
      id: `dsh-openspec-capability-${encodeURIComponent(capability.id)}-requirements`,
      panelId: `dsh-openspec-capability-${encodeURIComponent(capability.id)}-requirements-panel`,
    },
    {
      value: 'history',
      label: `${t('capability.historyTab')} (${String(history.length)})`,
      id: `dsh-openspec-capability-${encodeURIComponent(capability.id)}-history`,
      panelId: `dsh-openspec-capability-${encodeURIComponent(capability.id)}-history-panel`,
    },
  ]
  return (
    <div className="dsh-openspec-panel">
      <header className="dsh-openspec-detail-header">
        <h2 className="dsh-openspec-detail-title">{capability.id}</h2>
        {summaryText(capability.purpose) === null ? null : (
          <p className="dsh-openspec-purpose">{capability.purpose}</p>
        )}
        <div className="dsh-openspec-meta">
          <Tag tone="quiet">{`${String(requirementCount)} ${t('capability.requirements')}`}</Tag>
          {scenarioCount === 0 ? null : (
            <Tag tone="quiet">{`${String(scenarioCount)} ${t('capability.scenarios')}`}</Tag>
          )}
          {accepted === null ? null : (
            <Tag tone="quiet">{`${t('capability.accepted')} ${accepted}`}</Tag>
          )}
          {producer === undefined ? null : (
            <Tag tone="quiet">{`${t('capability.via')} ${producer.name}`}</Tag>
          )}
          {capability.commit === undefined || capability.commit === null
            ? null
            : CommitFactView({ commit: capability.commit })}
        </div>
      </header>
      <primitives.SegmentedTabs
        items={tabs}
        value={section}
        onChange={props.onSection}
        label={t('capability.sections')}
      />
      <div className="dsh-openspec-scroll">
        {section === 'history' ? (
          HistoryList({ history, t, onOpenArchived: props.onOpenArchived })
        ) : requirements.length > 0 ? (
          RequirementList({
            requirements,
            query: props.requirementQuery,
            t,
            onQuery: props.onRequirementQuery,
          })
        ) : (
          <div className="dsh-openspec-body">
            <MarkdownText text={capability.body} labels={labels} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Newest-first archive timeline; each row opens the archived change tab. */
function HistoryList(props: {
  readonly history: readonly HistoryEntry[]
  readonly t: Translate
  onOpenArchived(name: string): void
}): ReactNode {
  const history = props.history ?? []
  if (history.length === 0) {
    return <p className="dsh-openspec-state">{props.t('capability.historyEmpty')}</p>
  }
  return (
    <div className="dsh-openspec-list">
      {history.map((entry) => (
        <button
          key={entry.name}
          type="button"
          className="dsh-openspec-history-row"
          onClick={() => props.onOpenArchived(entry.name)}
        >
          <span className="dsh-openspec-history-date">{isoDate(entry.date) ?? entry.date}</span>
          <span className="dsh-openspec-card-title">{entry.name}</span>
          <span className="dsh-openspec-card-count">
            {`${String(entry.completedTasks)}/${String(entry.totalTasks)}`}
          </span>
          {entry.commit === null ? null : CommitFactView({ commit: entry.commit })}
        </button>
      ))}
    </div>
  )
}

/** Layout only: the host owns colour, type, controls, and focus rings. */
export const PANEL_CSS = `
.dsh-openspec-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 12px;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
}
.dsh-openspec-root-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-panel-title {
  margin: 0;
  font: var(--dsw-font-base-strong-16);
}
.dsh-openspec-detail-title {
  margin: 0;
  font: var(--dsw-font-m-18);
  overflow-wrap: anywhere;
}
.dsh-openspec-summary {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-segments {
  min-width: 0;
}
.dsh-openspec-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.dsh-openspec-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-group-label {
  font: var(--dsw-font-xxxs-strong-11);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.dsh-openspec-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-openspec-card-archived {
  opacity: 0.8;
}
.dsh-openspec-card-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.dsh-openspec-card-title {
  font: var(--dsw-font-s-strong-14);
  overflow-wrap: anywhere;
}
.dsh-openspec-card-count {
  margin-left: auto;
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}
.dsh-openspec-purpose {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin: 0;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-openspec-purpose-one {
  -webkit-line-clamp: 1;
}
.dsh-openspec-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.dsh-openspec-progress {
  display: flex;
  flex-direction: column;
  flex: 1 1 120px;
  gap: 4px;
  min-width: 0;
}
.dsh-openspec-progress-track {
  display: block;
  height: 4px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-module-platform);
  overflow: hidden;
}
.dsh-openspec-progress-fill {
  display: block;
  height: 100%;
  background: var(--dsw-alias-state-business-primary);
}
.dsh-openspec-progress-label {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-progress-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-commit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.dsh-openspec-commit > span {
  overflow-wrap: anywhere;
}
.dsh-openspec-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 12px;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xs-13);
}
.dsh-openspec-error {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-error-primary);
}
.dsh-openspec-error p {
  flex: 1 1 160px;
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
}
.dsh-openspec-empty-title {
  margin: 0;
  font: var(--dsw-font-s-strong-14);
}
.dsh-openspec-action-card {
  display: flex;
  flex-direction: column;
  flex: 1 1 160px;
  gap: 4px;
  box-sizing: border-box;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.dsh-openspec-action-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-openspec-action-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh-openspec-action-title {
  font: var(--dsw-font-s-strong-14);
}
.dsh-openspec-action-body {
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-secondary);
}
.dsh-openspec-filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh-openspec-filter-label {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-detail-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-body {
  box-sizing: border-box;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  overflow-x: auto;
}
.dsh-openspec-deltas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.dsh-openspec-delta-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.dsh-openspec-rename {
  margin: 0;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-openspec-requirement {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-openspec-requirement-title {
  margin: 0;
  font: var(--dsw-font-s-strong-14);
  overflow-wrap: anywhere;
}
.dsh-openspec-requirement-text {
  margin: 0;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-openspec-keyword {
  color: var(--dsw-alias-state-business-primary);
}
.dsh-openspec-code {
  font: var(--dsw-font-markdown-code);
  padding: 0 4px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-module-platform);
}
.dsh-openspec-scenario {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 4px 8px;
  border-left: 2px solid var(--dsw-alias-state-business-primary);
}
.dsh-openspec-scenario-name {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
}
.dsh-openspec-step {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-openspec-step-tag {
  flex: none;
  font: var(--dsw-font-xxxs-strong-11);
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-task-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dsh-openspec-task-group-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-openspec-task {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font: var(--dsw-font-xs-13);
  overflow-wrap: anywhere;
}
.dsh-openspec-task-done {
  color: var(--dsw-alias-label-tertiary);
}
.dsh-openspec-history-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.dsh-openspec-history-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-openspec-history-date {
  flex: none;
  min-width: 84px;
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
@media (prefers-reduced-motion: reduce) {
  .dsh-openspec-card,
  .dsh-openspec-action-card,
  .dsh-openspec-history-row {
    transition: none;
  }
}
`
