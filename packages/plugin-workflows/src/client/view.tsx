import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { definitionEvaluationId, WorkflowOverview, WorkflowPage } from './overview.tsx'
import {
  type DefinitionView,
  definitionsUrl,
  ErrorLine,
  emptyPageStates,
  eventsUrl,
  type HealthView,
  healthUrl,
  type JournalEvent,
  LoadingLine,
  LoadMore,
  type Page,
  type PageStates,
  pageLoadProps,
  type RunStatsView,
  type RunView,
  requestJson,
  runsUrl,
  type Translate,
  type TriggerView,
  triggersUrl,
  updatePageState,
} from './panel.tsx'
import { MissingRunPage, RunDetailPage, RunLookupPage } from './run-detail.tsx'
import { RunList, StatusLine } from './run-history.tsx'

/** Layout only; every colour and spacing value is a shipped token. */
export const VIEW_CSS = `
.dsh-wf { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; height: 100%; min-height: 0; padding: 12px; overflow: hidden; color: var(--dsw-alias-label-primary); }
.dsh-wf-body { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
.dsh-wf-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-wf-status-text { font-weight: 600; }
.dsh-wf-segments { flex: none; }
.dsh-wf-scroll { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow: auto; }
.dsh-wf-rows { display: flex; flex-direction: column; gap: 4px; list-style: none; margin: 0; padding: 0; }
.dsh-wf-row-button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; }
.dsh-wf-run-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.dsh-wf-run-status { color: var(--dsw-alias-label-secondary); }
.dsh-wf-time { color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-wf-subject { font-weight: 600; }
.dsh-wf-summary { color: var(--dsw-alias-label-secondary); }
.dsh-wf-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.dsh-wf-event-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.dsh-wf-evaluations { list-style: none; margin: 4px 0 0; padding: 0 0 0 12px; display: flex; flex-direction: column; gap: 2px; }
.dsh-wf-evaluations li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-trigger { color: var(--dsw-alias-label-primary); }
.dsh-wf-detail { display: flex; flex-direction: column; gap: 12px; }
.dsh-wf-detail-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-wf-detail-title { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.dsh-wf-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 12px; }
.dsh-wf-facts dt { color: var(--dsw-alias-label-secondary); }
.dsh-wf-facts dd { margin: 0; overflow-wrap: anywhere; }
.dsh-wf-evidence-kind { color: var(--dsw-alias-label-secondary); }
.dsh-wf-section { display: flex; flex-direction: column; gap: 6px; }
.dsh-wf-heading { margin: 8px 0 2px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-wf-table { width: 100%; border-collapse: collapse; }
.dsh-wf-table th, .dsh-wf-table td { padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
.dsh-wf-table th { color: var(--dsw-alias-label-caption); font-size: 11px; font-weight: 600; }
.dsh-wf-violations { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; }
.dsh-wf-empty-title { margin: 0; font-weight: 600; }
.dsh-wf-muted { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-wf-error { color: var(--dsw-alias-state-error-primary); }
.dsh-wf-error-block { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.dsh-wf-overview { display: flex; flex-direction: column; gap: 12px; }
.dsh-wf-group { display: flex; flex-direction: column; gap: 6px; }
.dsh-wf-group-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.dsh-wf-group-title { margin: 8px 0 2px; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.dsh-wf-workflow-row { flex-wrap: wrap; align-items: baseline; }
`

/** One page of the session's own surface, as the host returned it. */
export interface Loaded {
  readonly health: HealthView
  readonly runs: Page<RunView>
  readonly definitions: readonly DefinitionView[]
  readonly triggers: readonly TriggerView[]
  /** Present only when the host serves the additive `stats=1` response. */
  readonly stats?: RunStatsView
}

export type Segment = 'workflows' | 'runs'

/** The open workflow page's own read-only data. */
export interface WorkflowPageState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly document?: DefinitionView
  readonly runs?: Page<RunView>
  readonly events?: Page<JournalEvent>
  readonly message?: string
}

/** A response from a previous session generation must never commit. */
export function isStaleGeneration(requested: number, current: number): boolean {
  return requested !== current
}

/** A scroll host the list restore needs; the DOM element satisfies it. */
export interface ListScrollHost {
  scrollTop: number
  querySelectorAll(selector: string): ArrayLike<unknown>
}

function isRow(
  value: unknown,
  attribute: 'data-run' | 'data-workflow',
  id: string,
): value is { focus(options?: { preventScroll?: boolean }): void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getAttribute' in value &&
    (value as { getAttribute(name: string): string | null }).getAttribute(attribute) === id &&
    'focus' in value &&
    typeof (value as { focus?: unknown }).focus === 'function'
  )
}

/**
 * Restore the list's scroll position and focus the row the detail came from.
 * The row is located by comparing its data attribute, never by building a
 * selector from a recorded id (which may contain selector syntax).
 */
export function restoreListPosition(
  host: ListScrollHost | null,
  id: string,
  scrollTop: number,
  kind: 'run' | 'workflow' = 'run',
): void {
  if (host === null) return
  host.scrollTop = scrollTop
  const attribute = kind === 'run' ? 'data-run' : 'data-workflow'
  const rows = host.querySelectorAll(`[${attribute}]`)
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!isRow(row, attribute, id)) continue
    // A restored row outside the saved viewport must not scroll itself in.
    row.focus({ preventScroll: true })
    return
  }
}

/** The API's newest-first order, applied to a merged page list. */
export function sortNewestFirst(runs: readonly RunView[]): RunView[] {
  return [...runs].sort((left, right) =>
    left.startedAt !== right.startedAt
      ? right.startedAt - left.startedAt
      : right.id.localeCompare(left.id),
  )
}

/**
 * Appended pages are offset over a newest-first list, so a run that arrives
 * between two pages repeats one row; an id appears once.
 */
export function dedupeRuns(runs: readonly RunView[]): RunView[] {
  const seen = new Set<string>()
  const unique: RunView[] = []
  for (const run of runs) {
    if (seen.has(run.id)) continue
    seen.add(run.id)
    unique.push(run)
  }
  return unique
}

function pageOf<T>(body: { next?: string }, items: readonly T[]): Page<T> {
  return { items, ...(body.next === undefined ? {} : { next: body.next }) }
}

/** Re-read the run pages the user already opened, newest first. */
export async function readRuns(session: string, pages: number): Promise<Page<RunView>> {
  const items: RunView[] = []
  let next: string | undefined
  for (let index = 0; index < Math.max(1, pages); index += 1) {
    const page = await requestJson<{ runs?: RunView[]; next?: string }>(
      runsUrl(session, next, undefined, { order: 'newest' }),
    )
    items.push(...(page.runs ?? []))
    next = page.next
    if (next === undefined) break
  }
  return pageOf({ ...(next === undefined ? {} : { next }) }, sortNewestFirst(dedupeRuns(items)))
}

/** The installed definitions; an incomplete row still renders by id and name. */
export async function readDefinitions(session: string): Promise<readonly DefinitionView[]> {
  const body = await requestJson<{ definitions?: DefinitionView[] }>(definitionsUrl(session))
  return Array.isArray(body.definitions) ? body.definitions : []
}

/** The trigger catalog plus the per-definition entries with their counts. */
export async function readTriggers(session: string): Promise<readonly TriggerView[]> {
  const body = await requestJson<{ triggers?: TriggerView[] }>(triggersUrl(session))
  return Array.isArray(body.triggers) ? body.triggers : []
}

/** The additive per-definition run statistics; absent on a host without them. */
export async function readRunStats(session: string): Promise<RunStatsView | undefined> {
  const body = await requestJson<{ stats?: { definitions?: unknown } }>(
    runsUrl(session, undefined, undefined, { stats: true }),
  )
  const definitions = body.stats?.definitions
  if (definitions === null || definitions === undefined || typeof definitions !== 'object') {
    return undefined
  }
  return { definitions: definitions as RunStatsView['definitions'] }
}

/** One full definition document, including its description and step targets. */
export async function readDefinitionDocument(
  session: string,
  definitionId: string,
): Promise<DefinitionView> {
  const body = await requestJson<{ definition?: DefinitionView }>(
    definitionsUrl(session, definitionId),
  )
  if (body.definition === undefined) throw new Error('the definition document is missing')
  return body.definition
}

/** Re-read the workflow page's run pages, newest first. */
export async function readDefinitionRuns(
  session: string,
  definitionId: string,
  pages: number,
): Promise<Page<RunView>> {
  const items: RunView[] = []
  let next: string | undefined
  for (let index = 0; index < Math.max(1, pages); index += 1) {
    const page = await requestJson<{ runs?: RunView[]; next?: string }>(
      runsUrl(session, next, undefined, { definition: definitionId }),
    )
    items.push(...(page.runs ?? []))
    next = page.next
    if (next === undefined) break
  }
  return pageOf({ ...(next === undefined ? {} : { next }) }, sortNewestFirst(dedupeRuns(items)))
}

/** Re-read the session journal pages the workflow history shows. */
export async function readDefinitionEvents(
  session: string,
  pages: number,
): Promise<Page<JournalEvent>> {
  const items: JournalEvent[] = []
  let next: string | undefined
  for (let index = 0; index < Math.max(1, pages); index += 1) {
    const page = await requestJson<{ events?: JournalEvent[]; next?: string }>(
      eventsUrl(session, next),
    )
    items.push(...(page.events ?? []))
    next = page.next
    if (next === undefined) break
  }
  return pageOf({ ...(next === undefined ? {} : { next }) }, items)
}

export interface WorkflowsLoadedProps {
  readonly loaded: Loaded
  readonly t: Translate
  readonly sessionId?: string
  readonly segment?: Segment
  /** The selected workflow definition id; its page replaces the segment body. */
  readonly definition?: string
  readonly workflow?: WorkflowPageState
  readonly selected?: string
  /** The open run resolved outside the loaded pages. */
  readonly detail?: RunView
  readonly missing?: boolean
  readonly detailError?: string
  readonly now?: number
  readonly pageStates?: PageStates
  readonly refreshing?: boolean
  /** A background refresh failed; the shown rows stay on screen. */
  readonly refreshError?: string
  readonly scrollRef?: RefObject<HTMLDivElement | null>
  onSegment?(segment: Segment): void
  onOpenWorkflow?(definitionId: string): void
  onBackWorkflow?(): void
  onRetryWorkflow?(): void
  onOpenWorkflowRun?(runId: string): void
  onLoadWorkflowRuns?(): void
  onLoadHistory?(): void
  onSelect?(runId: string): void
  onBack?(): void
  onRetryDetail?(): void
  onRefresh?(): void
  onRetryRefresh?(): void
  onLoadRuns?(): void
}

/** The loaded view body; pure so it renders without hooks in tests. */
export function WorkflowsLoaded(props: WorkflowsLoadedProps): ReactNode {
  const { loaded, t } = props
  const segment = props.segment ?? 'workflows'
  const currentDefinition = props.definition
  const selectedRun =
    props.detail ??
    loaded.runs.items.find((run) => run.id === props.selected) ??
    props.workflow?.runs?.items.find((run) => run.id === props.selected)
  const definitionTrigger =
    currentDefinition === undefined
      ? undefined
      : loaded.triggers.find((trigger) => trigger.id === definitionEvaluationId(currentDefinition))
  const empty = (): void => {}
  const options: SegmentedControlOption<Segment>[] = [
    { value: 'workflows', label: t('segment.workflows') },
    { value: 'runs', label: t('segment.runs') },
  ]
  let body: ReactNode
  if (props.selected !== undefined) {
    if (props.missing === true) {
      body = <MissingRunPage t={t} onBack={props.onBack ?? empty} />
    } else if (props.detailError !== undefined) {
      body = (
        <RunLookupPage
          t={t}
          message={props.detailError}
          onRetry={props.onRetryDetail ?? empty}
          onBack={props.onBack ?? empty}
        />
      )
    } else if (selectedRun === undefined) {
      body = <RunLookupPage t={t} onBack={props.onBack ?? empty} />
    } else {
      body = (
        <RunDetailPage
          run={selectedRun}
          t={t}
          {...(props.sessionId === undefined ? {} : { session: props.sessionId })}
          onBack={props.onBack ?? empty}
        />
      )
    }
  } else if (currentDefinition !== undefined) {
    const workflow = props.workflow ?? { phase: 'loading' as const }
    body = (
      <WorkflowPage
        definitionId={currentDefinition}
        phase={workflow.phase}
        {...(workflow.document === undefined ? {} : { document: workflow.document })}
        {...(definitionTrigger === undefined ? {} : { trigger: definitionTrigger })}
        {...(workflow.runs === undefined ? {} : { runs: workflow.runs })}
        {...(workflow.events === undefined ? {} : { events: workflow.events })}
        {...(workflow.message === undefined ? {} : { message: workflow.message })}
        {...(props.now === undefined ? {} : { now: props.now })}
        {...(props.pageStates === undefined ? {} : { pageStates: props.pageStates })}
        t={t}
        onBack={props.onBackWorkflow ?? empty}
        onOpenRun={props.onOpenWorkflowRun ?? empty}
        onLoadRuns={props.onLoadWorkflowRuns ?? empty}
        onLoadHistory={props.onLoadHistory ?? empty}
        onRetry={props.onRetryWorkflow ?? empty}
      />
    )
  } else if (segment === 'workflows') {
    body = (
      <WorkflowOverview
        definitions={loaded.definitions}
        triggers={loaded.triggers}
        {...(loaded.stats === undefined ? {} : { stats: loaded.stats })}
        runs={loaded.runs.items}
        t={t}
        {...(props.now === undefined ? {} : { now: props.now })}
        onOpen={props.onOpenWorkflow ?? empty}
      />
    )
  } else {
    body = (
      <>
        <RunList
          runs={loaded.runs.items}
          t={t}
          {...(props.now === undefined ? {} : { now: props.now })}
          {...(props.onSelect === undefined ? {} : { onOpen: props.onSelect })}
        />
        <LoadMore
          next={loaded.runs.next}
          t={t}
          onLoad={props.onLoadRuns ?? empty}
          {...(props.refreshing === true ? { loading: true } : {})}
          {...pageLoadProps(props.pageStates, 'runs', loaded.runs.next, t)}
        />
      </>
    )
  }
  const detail = props.selected !== undefined || currentDefinition !== undefined
  return (
    <div
      className="dsh-wf-body"
      data-segment={segment}
      data-view={
        props.selected !== undefined
          ? 'detail'
          : currentDefinition === undefined
            ? 'list'
            : 'workflow'
      }
    >
      <StatusLine
        health={loaded.health}
        t={t}
        {...(props.refreshing === undefined ? {} : { refreshing: props.refreshing })}
        {...(props.onRefresh === undefined ? {} : { onRefresh: props.onRefresh })}
      />
      {props.refreshError === undefined ? null : (
        <ErrorLine message={props.refreshError} t={t} onRetry={props.onRetryRefresh ?? empty} />
      )}
      {detail ? (
        <div className="dsh-wf-scroll" ref={props.scrollRef}>
          {body}
        </div>
      ) : (
        <>
          <SegmentedControl
            id="dsh-wf-segments"
            value={segment}
            options={options}
            onChange={props.onSegment ?? empty}
            label={t('segment.label')}
            className="dsh-wf-segments"
          />
          <div className="dsh-wf-scroll" ref={props.scrollRef}>
            {body}
          </div>
        </>
      )}
    </div>
  )
}

interface ViewState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly loaded?: Loaded
  readonly message?: string
  readonly refreshing?: boolean
  /** A background refresh failed; the loaded pages stay on screen. */
  readonly refreshError?: string
}

/** Where a detail page returns to when its back control is used. */
interface ReturnTarget {
  readonly id: string
  readonly scrollTop: number
  readonly surface: 'overview' | 'runs' | 'workflow'
}

/**
 * The Workflows conversation view: the trigger-grouped overview, one workflow
 * page, the session's runs newest first, and one run's detail page. It reloads
 * on open, on demand, and when the window becomes visible again.
 */
export function WorkflowsView(props: {
  readonly sessionId?: string
  readonly t: Translate
}): ReactNode {
  const { sessionId, t } = props
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  const [segment, setSegment] = useState<Segment>('workflows')
  const [definitionId, setDefinitionId] = useState<string>()
  const [workflow, setWorkflow] = useState<WorkflowPageState>({ phase: 'loading' })
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<RunView>()
  const [missing, setMissing] = useState(false)
  const [detailError, setDetailError] = useState<string>()
  const [pageStates, setPageStates] = useState<PageStates>(emptyPageStates())
  const loadId = useRef(0)
  const lookupId = useRef(0)
  const workflowToken = useRef(0)
  const runsPages = useRef(1)
  const workflowRunsPages = useRef(1)
  const historyPages = useRef(1)
  const pendingPages = useRef(new Set<string>())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** The workflow page's own return target: the overview row that opened it. */
  const overviewReturn = useRef<{ readonly id: string; readonly scrollTop: number } | undefined>(
    undefined,
  )
  /** The run page's return target: the surface and row that opened it. */
  const detailReturn = useRef<ReturnTarget | undefined>(undefined)
  const selectedRef = useRef<string | undefined>(undefined)
  selectedRef.current = selected
  const definitionRef = useRef<string | undefined>(undefined)
  definitionRef.current = definitionId
  const runOrigin = useRef<'runs' | 'workflow'>('runs')
  /** The last known record of the open run, kept across a refresh. */
  const knownRun = useRef<RunView | undefined>(undefined)
  const stateRef = useRef<ViewState>(state)
  stateRef.current = state
  const workflowRef = useRef<WorkflowPageState>(workflow)
  workflowRef.current = workflow

  const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  /**
   * Resolve one selected run by id. A response applies only while its lookup
   * token and the selection are still current, so a delayed answer for an
   * earlier selection can never overwrite a later one.
   */
  const resolveSelected = (
    generation: number,
    token: number,
    session: string,
    runId: string,
  ): void => {
    setDetailError(undefined)
    const current = (): boolean =>
      !isStaleGeneration(generation, loadId.current) &&
      token === lookupId.current &&
      selectedRef.current === runId
    void requestJson<{ runs?: RunView[] }>(
      runsUrl(session, undefined, undefined, { run: runId }),
    ).then(
      (body) => {
        if (!current()) return
        const run = body.runs?.[0]
        if (run === undefined) {
          setMissing(true)
          setDetail(undefined)
          return
        }
        setMissing(false)
        knownRun.current = run
        setDetail(run)
      },
      (error: unknown) => {
        if (!current()) return
        setDetailError(messageOf(error))
      },
    )
  }

  const loadWorkflowPage = (
    generation: number,
    token: number,
    id: string,
    mode: 'initial' | 'background',
  ): void => {
    if (sessionId === undefined) return
    if (mode === 'initial') setWorkflow({ phase: 'loading' })
    const runPages = Math.max(1, workflowRunsPages.current)
    const eventPages = Math.max(1, historyPages.current)
    const current = (): boolean =>
      !isStaleGeneration(generation, loadId.current) &&
      token === workflowToken.current &&
      definitionRef.current === id
    void Promise.all([
      readDefinitionDocument(sessionId, id),
      readDefinitionRuns(sessionId, id, runPages),
      readDefinitionEvents(sessionId, eventPages),
    ]).then(
      ([document, runs, events]) => {
        if (!current()) return
        workflowRunsPages.current = runPages
        historyPages.current = eventPages
        setWorkflow({ phase: 'ready', document, runs, events })
      },
      (error: unknown) => {
        if (!current()) return
        const message = messageOf(error)
        const loadedPage = workflowRef.current
        // A failed background refresh keeps the loaded page; only a first
        // load without data takes over the page.
        if (mode === 'background' && loadedPage.phase === 'ready') {
          setState((currentState) => ({ ...currentState, refreshError: message }))
          return
        }
        setWorkflow({ phase: 'error', message })
      },
    )
  }

  const load = (mode: 'initial' | 'background'): void => {
    if (sessionId === undefined) return
    const generation = ++loadId.current
    // A new load supersedes every pending selected-run lookup and page.
    lookupId.current += 1
    pendingPages.current.clear()
    setPageStates(emptyPageStates())
    if (mode === 'initial') setState({ phase: 'loading' })
    else setState((current) => ({ ...current, refreshing: true }))
    const runPages = Math.max(1, runsPages.current)
    void Promise.all([
      requestJson<HealthView>(healthUrl(sessionId)),
      readRuns(sessionId, runPages),
      readDefinitions(sessionId),
      readTriggers(sessionId),
      readRunStats(sessionId),
    ]).then(
      ([health, runs, definitions, triggers, stats]) => {
        if (isStaleGeneration(generation, loadId.current)) return
        runsPages.current = runPages
        setState({
          phase: 'ready',
          loaded: {
            health,
            runs,
            definitions,
            triggers,
            ...(stats === undefined ? {} : { stats }),
          },
        })
        const open = selectedRef.current
        if (open !== undefined) {
          if (runs.items.some((run) => run.id === open)) {
            lookupId.current += 1
            knownRun.current = runs.items.find((run) => run.id === open)
            setDetail(undefined)
            setMissing(false)
            setDetailError(undefined)
          } else {
            const token = ++lookupId.current
            resolveSelected(generation, token, sessionId, open)
          }
        }
        const openDefinition = definitionRef.current
        if (openDefinition !== undefined) {
          const token = ++workflowToken.current
          loadWorkflowPage(generation, token, openDefinition, 'background')
        }
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current)) return
        const message = messageOf(error)
        // A failed background refresh keeps the loaded pages; only a first
        // load without data takes over the whole surface.
        setState((current) =>
          current.loaded === undefined
            ? { phase: 'error', message }
            : { ...current, refreshing: false, refreshError: message },
        )
      },
    )
  }

  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    load('initial')
    return () => {
      loadId.current += 1
      workflowToken.current += 1
    }
    // The session id identifies the view; a background reload re-reads it.
  }, [sessionId])

  useEffect(() => {
    overviewReturn.current = undefined
    detailReturn.current = undefined
  }, [sessionId])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') loadRef.current('background')
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useLayoutEffect(() => {
    const target = detailReturn.current
    if (target === undefined) return
    const onTarget =
      target.surface === 'workflow'
        ? definitionId !== undefined && selected === undefined
        : definitionId === undefined && selected === undefined
    if (!onTarget) return
    detailReturn.current = undefined
    const container = scrollRef.current
    if (container === null) return
    restoreListPosition(
      container,
      target.id,
      target.scrollTop,
      target.surface === 'overview' ? 'workflow' : 'run',
    )
  }, [definitionId, selected])

  useLayoutEffect(() => {
    if (definitionId !== undefined || selected !== undefined) return
    const target = overviewReturn.current
    if (target === undefined) return
    overviewReturn.current = undefined
    const container = scrollRef.current
    if (container === null) return
    restoreListPosition(container, target.id, target.scrollTop, 'workflow')
  }, [definitionId, selected])

  if (sessionId === undefined) {
    return (
      <div className="dsh-wf" data-state="no-session">
        <p className="dsh-wf-muted">{t('state.noSession')}</p>
      </div>
    )
  }

  const openWorkflowPage = (id: string): void => {
    const container = scrollRef.current
    if (container !== null) {
      overviewReturn.current = { id, scrollTop: container.scrollTop }
    }
    workflowRunsPages.current = 1
    historyPages.current = 1
    setDefinitionId(id)
    setWorkflow({ phase: 'loading' })
    setSelected(undefined)
    setDetail(undefined)
    setMissing(false)
    setDetailError(undefined)
    setSegment('workflows')
    const token = ++workflowToken.current
    loadWorkflowPage(loadId.current, token, id, 'initial')
  }

  const backFromWorkflow = (): void => {
    workflowToken.current += 1
    setDefinitionId(undefined)
    setWorkflow({ phase: 'loading' })
    setSelected(undefined)
    setDetail(undefined)
    setMissing(false)
    setDetailError(undefined)
  }

  const openRun = (runId: string, origin: 'runs' | 'workflow'): void => {
    const container = scrollRef.current
    if (container !== null) {
      detailReturn.current = { id: runId, scrollTop: container.scrollTop, surface: origin }
    }
    runOrigin.current = origin
    setSelected(runId)
    setMissing(false)
    setDetail(undefined)
    setDetailError(undefined)
    const listed =
      origin === 'runs'
        ? stateRef.current.loaded?.runs.items.find((run) => run.id === runId)
        : workflowRef.current.runs?.items.find((run) => run.id === runId)
    knownRun.current = listed
    if (listed !== undefined) return
    const token = ++lookupId.current
    resolveSelected(loadId.current, token, sessionId, runId)
  }

  const backFromRun = (): void => {
    lookupId.current += 1
    // Capture the known record before clearing the ref: a deferred state update
    // must not depend on refs that this handler resets.
    const resolved = detail ?? knownRun.current
    const confirmedMissing = missing
    if (resolved !== undefined && !confirmedMissing) {
      if (runOrigin.current === 'runs') {
        const current = stateRef.current
        const loaded = current.loaded
        if (loaded !== undefined && !loaded.runs.items.some((run) => run.id === resolved.id)) {
          setState({
            ...current,
            loaded: {
              ...loaded,
              runs: {
                ...loaded.runs,
                items: sortNewestFirst([...loaded.runs.items, resolved]),
              },
            },
          })
        }
      } else {
        setWorkflow((current) =>
          current.runs === undefined || current.runs.items.some((run) => run.id === resolved.id)
            ? current
            : {
                ...current,
                runs: {
                  ...current.runs,
                  items: sortNewestFirst([...current.runs.items, resolved]),
                },
              },
        )
      }
    }
    knownRun.current = undefined
    setSelected(undefined)
    setDetail(undefined)
    setMissing(false)
    setDetailError(undefined)
  }

  const retryDetail = (): void => {
    if (selected === undefined) return
    const token = ++lookupId.current
    resolveSelected(loadId.current, token, sessionId, selected)
  }

  const retryWorkflow = (): void => {
    const id = definitionRef.current
    if (id === undefined) return
    const token = ++workflowToken.current
    loadWorkflowPage(loadId.current, token, id, 'initial')
  }

  const mergeRuns = (): void => {
    if (stateRef.current.refreshing === true) return
    const loaded = state.loaded
    const next = loaded?.runs.next
    if (next === undefined) return
    const key = `runs:${next}`
    if (pendingPages.current.has(key)) return
    const generation = loadId.current
    pendingPages.current.add(key)
    setPageStates((current) => updatePageState(current, 'runs', { key, phase: 'loading' }))
    void requestJson<{ runs?: RunView[]; next?: string }>(
      runsUrl(sessionId, next, undefined, { order: 'newest' }),
    ).then(
      (page) => {
        if (isStaleGeneration(generation, loadId.current)) return
        pendingPages.current.delete(key)
        runsPages.current += 1
        setPageStates((current) => updatePageState(current, 'runs', undefined))
        setState((current) => {
          if (current.loaded === undefined) return current
          return {
            ...current,
            loaded: {
              ...current.loaded,
              runs: pageOf(
                page,
                sortNewestFirst(dedupeRuns([...current.loaded.runs.items, ...(page.runs ?? [])])),
              ),
            },
          }
        })
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current)) return
        pendingPages.current.delete(key)
        setPageStates((current) =>
          updatePageState(current, 'runs', { key, phase: 'error', message: messageOf(error) }),
        )
      },
    )
  }

  const mergeWorkflowRuns = (): void => {
    if (stateRef.current.refreshing === true) return
    const id = definitionRef.current
    const next = workflowRef.current.runs?.next
    if (id === undefined || next === undefined) return
    const key = `workflowRuns:${next}`
    if (pendingPages.current.has(key)) return
    const generation = loadId.current
    const token = workflowToken.current
    pendingPages.current.add(key)
    setPageStates((current) => updatePageState(current, 'workflowRuns', { key, phase: 'loading' }))
    void requestJson<{ runs?: RunView[]; next?: string }>(
      runsUrl(sessionId, next, undefined, { definition: id }),
    ).then(
      (page) => {
        if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return
        pendingPages.current.delete(key)
        workflowRunsPages.current += 1
        setPageStates((current) => updatePageState(current, 'workflowRuns', undefined))
        setWorkflow((current) => {
          if (current.runs === undefined) return current
          return {
            ...current,
            runs: pageOf(
              page,
              sortNewestFirst(dedupeRuns([...current.runs.items, ...(page.runs ?? [])])),
            ),
          }
        })
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return
        pendingPages.current.delete(key)
        setPageStates((current) =>
          updatePageState(current, 'workflowRuns', {
            key,
            phase: 'error',
            message: messageOf(error),
          }),
        )
      },
    )
  }

  const mergeHistory = (): void => {
    if (stateRef.current.refreshing === true) return
    const id = definitionRef.current
    const next = workflowRef.current.events?.next
    if (id === undefined || next === undefined) return
    const key = `history:${next}`
    if (pendingPages.current.has(key)) return
    const generation = loadId.current
    const token = workflowToken.current
    pendingPages.current.add(key)
    setPageStates((current) => updatePageState(current, 'history', { key, phase: 'loading' }))
    void requestJson<{ events?: JournalEvent[]; next?: string }>(eventsUrl(sessionId, next)).then(
      (page) => {
        if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return
        pendingPages.current.delete(key)
        historyPages.current += 1
        setPageStates((current) => updatePageState(current, 'history', undefined))
        setWorkflow((current) => {
          if (current.events === undefined) return current
          return {
            ...current,
            events: pageOf(page, [...current.events.items, ...(page.events ?? [])]),
          }
        })
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return
        pendingPages.current.delete(key)
        setPageStates((current) =>
          updatePageState(current, 'history', { key, phase: 'error', message: messageOf(error) }),
        )
      },
    )
  }

  let body: ReactNode
  if (state.phase === 'loading') {
    body = <LoadingLine t={t} />
  } else if (state.phase === 'error') {
    body = <ErrorLine message={state.message ?? ''} t={t} onRetry={() => load('initial')} />
  } else {
    body = (
      <WorkflowsLoaded
        loaded={state.loaded as Loaded}
        t={t}
        sessionId={sessionId}
        segment={segment}
        {...(definitionId === undefined ? {} : { definition: definitionId })}
        workflow={workflow}
        {...(selected === undefined ? {} : { selected })}
        {...(detail === undefined ? {} : { detail })}
        {...(missing ? { missing: true } : {})}
        {...(detailError === undefined ? {} : { detailError })}
        {...(state.refreshing === true ? { refreshing: true } : {})}
        {...(state.refreshError === undefined ? {} : { refreshError: state.refreshError })}
        pageStates={pageStates}
        scrollRef={scrollRef}
        onSegment={setSegment}
        onOpenWorkflow={openWorkflowPage}
        onBackWorkflow={backFromWorkflow}
        onRetryWorkflow={retryWorkflow}
        onOpenWorkflowRun={(runId) => openRun(runId, 'workflow')}
        onLoadWorkflowRuns={mergeWorkflowRuns}
        onLoadHistory={mergeHistory}
        onSelect={(runId) => openRun(runId, 'runs')}
        onBack={backFromRun}
        onRetryDetail={retryDetail}
        onRefresh={() => load('background')}
        onRetryRefresh={() => load('background')}
        onLoadRuns={mergeRuns}
      />
    )
  }
  return (
    <div className="dsh-wf" data-state={state.phase}>
      <style>{VIEW_CSS}</style>
      {body}
    </div>
  )
}
