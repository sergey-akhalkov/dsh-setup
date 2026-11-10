import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ErrorLine,
  eventsUrl,
  type HealthView,
  healthUrl,
  type JournalEvent,
  LoadingLine,
  LoadMore,
  type Page,
  type RunView,
  requestJson,
  runsUrl,
  type Translate,
} from './panel.tsx'
import { MissingRunPage, RunDetailPage, RunLookupPage } from './run-detail.tsx'
import { JournalList, RunList, StatusLine } from './run-history.tsx'

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
`

/** One page of the session surface, as the host returned it. */
export interface Loaded {
  readonly health: HealthView
  readonly events: Page<JournalEvent>
  readonly runs: Page<RunView>
}

export type Segment = 'runs' | 'journal'

export type PageKind = 'events' | 'runs'
export interface PageState {
  readonly key: string
  readonly phase: 'loading' | 'error'
  readonly message?: string
}
export type PageStates = Record<PageKind, PageState | undefined>

export function emptyPageStates(): PageStates {
  return { events: undefined, runs: undefined }
}

/** Replace only one list's pagination state; a sibling request keeps its own. */
export function updatePageState(
  states: PageStates,
  kind: PageKind,
  value: PageState | undefined,
): PageStates {
  return { ...states, [kind]: value }
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
  runId: string,
): value is { focus(options?: { preventScroll?: boolean }): void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getAttribute' in value &&
    (value as { getAttribute(name: string): string | null }).getAttribute('data-run') === runId &&
    'focus' in value &&
    typeof (value as { focus?: unknown }).focus === 'function'
  )
}

/**
 * Restore the list's scroll position and focus the row the detail came from.
 * The row is located by comparing its `data-run` value, never by building a
 * selector from a recorded run id (which may contain selector syntax).
 */
export function restoreListPosition(
  host: ListScrollHost | null,
  runId: string,
  scrollTop: number,
): void {
  if (host === null) return
  host.scrollTop = scrollTop
  const rows = host.querySelectorAll('[data-run]')
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!isRow(row, runId)) continue
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

/** Re-read the journal pages the user already opened. */
export async function readEvents(session: string, pages: number): Promise<Page<JournalEvent>> {
  const items: JournalEvent[] = []
  let next: string | undefined
  for (let index = 0; index < Math.max(1, pages); index += 1) {
    const page = await requestJson<{ events: JournalEvent[]; next?: string }>(
      eventsUrl(session, next),
    )
    items.push(...page.events)
    next = page.next
    if (next === undefined) break
  }
  return pageOf({ ...(next === undefined ? {} : { next }) }, items)
}

/** Re-read the run pages the user already opened, newest first. */
export async function readRuns(session: string, pages: number): Promise<Page<RunView>> {
  const items: RunView[] = []
  let next: string | undefined
  for (let index = 0; index < Math.max(1, pages); index += 1) {
    const page = await requestJson<{ runs: RunView[]; next?: string }>(
      runsUrl(session, next, undefined, { order: 'newest' }),
    )
    items.push(...page.runs)
    next = page.next
    if (next === undefined) break
  }
  return pageOf({ ...(next === undefined ? {} : { next }) }, sortNewestFirst(dedupeRuns(items)))
}

export interface WorkflowsLoadedProps {
  readonly loaded: Loaded
  readonly t: Translate
  readonly sessionId?: string
  readonly segment?: Segment
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
  onSelect?(runId: string): void
  onOpenRun?(runId: string): void
  onBack?(): void
  onRetryDetail?(): void
  onRefresh?(): void
  onRetryRefresh?(): void
  onLoadEvents?(): void
  onLoadRuns?(): void
}

/** The loaded view body; pure so it renders without hooks in tests. */
export function WorkflowsLoaded(props: WorkflowsLoadedProps): ReactNode {
  const { loaded, t } = props
  const segment = props.segment ?? 'runs'
  const selectedRun = props.detail ?? loaded.runs.items.find((run) => run.id === props.selected)
  const pageProps = (kind: PageKind, next: string | undefined): Record<string, unknown> => {
    const page = props.pageStates?.[kind]
    if (next === undefined || page?.key !== `${kind}:${next}`) return {}
    if (page.phase === 'loading') return { loading: true }
    return { error: page.message ?? t('state.error') }
  }
  const empty = (): void => {}
  const options: SegmentedControlOption<Segment>[] = [
    { value: 'runs', label: t('segment.runs') },
    { value: 'journal', label: t('segment.journal') },
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
  } else if (segment === 'journal') {
    body = (
      <>
        <JournalList
          events={loaded.events.items}
          t={t}
          {...(props.onOpenRun === undefined ? {} : { onOpenRun: props.onOpenRun })}
        />
        <LoadMore
          next={loaded.events.next}
          t={t}
          onLoad={props.onLoadEvents ?? empty}
          {...(props.refreshing === true ? { loading: true } : {})}
          {...pageProps('events', loaded.events.next)}
        />
      </>
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
          {...pageProps('runs', loaded.runs.next)}
        />
      </>
    )
  }
  return (
    <div
      className="dsh-wf-body"
      data-segment={segment}
      data-view={props.selected === undefined ? 'list' : 'detail'}
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
      {props.selected === undefined ? (
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
      ) : (
        <div className="dsh-wf-scroll" ref={props.scrollRef}>
          {body}
        </div>
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

/**
 * The Workflows conversation view: the session's runs newest first, one run's
 * detail page, and the journal. It reloads on open, on demand, and when the
 * window becomes visible again.
 */
export function WorkflowsView(props: {
  readonly sessionId?: string
  readonly t: Translate
}): ReactNode {
  const { sessionId, t } = props
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  const [segment, setSegment] = useState<Segment>('runs')
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<RunView>()
  const [missing, setMissing] = useState(false)
  const [detailError, setDetailError] = useState<string>()
  const [pageStates, setPageStates] = useState<PageStates>(emptyPageStates())
  const loadId = useRef(0)
  const lookupId = useRef(0)
  const runsPages = useRef(1)
  const eventsPages = useRef(1)
  const pendingPages = useRef(new Set<string>())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<{ runId: string; scrollTop: number } | undefined>(undefined)
  const selectedRef = useRef<string | undefined>(undefined)
  selectedRef.current = selected
  /** The last known record of the open run, kept across a refresh. */
  const knownRun = useRef<RunView | undefined>(undefined)
  const stateRef = useRef<ViewState>(state)
  stateRef.current = state

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
    void requestJson<{ runs: RunView[] }>(
      runsUrl(session, undefined, undefined, { run: runId }),
    ).then(
      (body) => {
        if (!current()) return
        const run = body.runs[0]
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

  const load = (mode: 'initial' | 'background'): void => {
    if (sessionId === undefined) return
    const generation = ++loadId.current
    // A new load supersedes every pending selected-run lookup.
    lookupId.current += 1
    pendingPages.current.clear()
    setPageStates(emptyPageStates())
    if (mode === 'initial') setState({ phase: 'loading' })
    else setState((current) => ({ ...current, refreshing: true }))
    const runPages = Math.max(1, runsPages.current)
    const eventPages = Math.max(1, eventsPages.current)
    void Promise.all([
      requestJson<HealthView>(healthUrl(sessionId)),
      readEvents(sessionId, eventPages),
      readRuns(sessionId, runPages),
    ]).then(
      ([health, events, runs]) => {
        if (isStaleGeneration(generation, loadId.current)) return
        runsPages.current = runPages
        eventsPages.current = eventPages
        setState({ phase: 'ready', loaded: { health, events, runs } })
        const open = selectedRef.current
        if (open === undefined) return
        if (runs.items.some((run) => run.id === open)) {
          lookupId.current += 1
          knownRun.current = runs.items.find((run) => run.id === open)
          setDetail(undefined)
          setMissing(false)
          setDetailError(undefined)
          return
        }
        const token = ++lookupId.current
        resolveSelected(generation, token, sessionId, open)
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
    }
    // The session id identifies the view; a background reload re-reads it.
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
    if (selected !== undefined) return
    const restore = returnTo.current
    if (restore === undefined) return
    returnTo.current = undefined
    const container = scrollRef.current
    if (container === null) return
    restoreListPosition(container, restore.runId, restore.scrollTop)
  }, [selected])

  if (sessionId === undefined) {
    return (
      <div className="dsh-wf" data-state="no-session">
        <p className="dsh-wf-muted">{t('state.noSession')}</p>
      </div>
    )
  }

  const openRun = (runId: string, fromList: boolean): void => {
    const container = scrollRef.current
    if (fromList && container !== null) {
      returnTo.current = { runId, scrollTop: container.scrollTop }
    }
    setSegment('runs')
    setSelected(runId)
    setMissing(false)
    setDetail(undefined)
    setDetailError(undefined)
    const token = ++lookupId.current
    const loaded = stateRef.current.loaded
    const listed = loaded?.runs.items.find((run) => run.id === runId)
    knownRun.current = listed
    if (listed !== undefined) return
    resolveSelected(loadId.current, token, sessionId, runId)
  }

  const back = (): void => {
    lookupId.current += 1
    // Capture the known record before clearing the ref: a deferred state update
    // must not depend on refs that this handler resets.
    const resolved = detail ?? knownRun.current
    const confirmedMissing = missing
    const current = stateRef.current
    const loaded = current.loaded
    if (
      resolved !== undefined &&
      !confirmedMissing &&
      loaded !== undefined &&
      !loaded.runs.items.some((run) => run.id === resolved.id)
    ) {
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
    knownRun.current = undefined
    setSelected(undefined)
    setDetail(undefined)
    setMissing(false)
    setDetailError(undefined)
    setSegment('runs')
  }

  const retryDetail = (): void => {
    if (selected === undefined) return
    const token = ++lookupId.current
    resolveSelected(loadId.current, token, sessionId, selected)
  }

  const mergeEvents = (): void => {
    // A page load must not race a refresh: the refresh replaces the pages it
    // captured, so a page started during it would be lost.
    if (stateRef.current.refreshing === true) return
    const loaded = state.loaded
    const next = loaded?.events.next
    if (next === undefined) return
    const key = `events:${next}`
    if (pendingPages.current.has(key)) return
    const generation = loadId.current
    pendingPages.current.add(key)
    setPageStates((current) => updatePageState(current, 'events', { key, phase: 'loading' }))
    void requestJson<{ events: JournalEvent[]; next?: string }>(eventsUrl(sessionId, next)).then(
      (page) => {
        if (isStaleGeneration(generation, loadId.current)) return
        pendingPages.current.delete(key)
        eventsPages.current += 1
        setPageStates((current) => updatePageState(current, 'events', undefined))
        setState((current) => {
          if (current.loaded === undefined) return current
          return {
            ...current,
            loaded: {
              ...current.loaded,
              events: pageOf(page, [...current.loaded.events.items, ...page.events]),
            },
          }
        })
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current)) return
        pendingPages.current.delete(key)
        setPageStates((current) =>
          updatePageState(current, 'events', { key, phase: 'error', message: messageOf(error) }),
        )
      },
    )
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
    void requestJson<{ runs: RunView[]; next?: string }>(
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
                sortNewestFirst(dedupeRuns([...current.loaded.runs.items, ...page.runs])),
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
        {...(selected === undefined ? {} : { selected })}
        {...(detail === undefined ? {} : { detail })}
        {...(missing ? { missing: true } : {})}
        {...(detailError === undefined ? {} : { detailError })}
        {...(state.refreshing === true ? { refreshing: true } : {})}
        {...(state.refreshError === undefined ? {} : { refreshError: state.refreshError })}
        pageStates={pageStates}
        scrollRef={scrollRef}
        onSegment={setSegment}
        onSelect={(runId) => openRun(runId, true)}
        onOpenRun={(runId) => openRun(runId, false)}
        onBack={back}
        onRetryDetail={retryDetail}
        onRefresh={() => load('background')}
        onRetryRefresh={() => load('background')}
        onLoadEvents={mergeEvents}
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
