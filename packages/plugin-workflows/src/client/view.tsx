import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  ErrorLine,
  EventList,
  eventsUrl,
  HealthStrip,
  type HealthView,
  healthUrl,
  type JournalEvent,
  LoadingLine,
  LoadMore,
  type Page,
  RunDetail,
  RunsList,
  type RunView,
  requestJson,
  runsUrl,
  type Translate,
  TriggersTable,
  type TriggerView,
  triggersUrl,
  WhyNotTable,
} from './panel.tsx'

import {
  DefinitionsTable,
  type DefinitionView,
  definitionsUrl,
  ReceiptsList,
  type ReceiptView,
  receiptsUrl,
} from './workflows.tsx'

/** Layout only; every colour and spacing value is a shipped token. */
export const VIEW_CSS = `
.dsh-wf { display: flex; flex-direction: column; gap: var(--dsw-space-3, 12px); padding: 12px; overflow: auto; }
.dsh-wf-health { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
.dsh-wf-health[data-state="listener-down"] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-wf-health[data-state="journal-readonly"] { border-color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-health-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
.dsh-wf-health-dot[data-state="done"] { background: var(--dsw-alias-state-success-primary); }
.dsh-wf-health-dot[data-state="warning"] { background: var(--dsw-alias-state-warning-primary); }
.dsh-wf-health-dot[data-state="error"] { background: var(--dsw-alias-state-error-primary); }
.dsh-wf-section { display: flex; flex-direction: column; gap: 6px; }
.dsh-wf-heading { margin: 8px 0 2px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-wf-table { width: 100%; border-collapse: collapse; }
.dsh-wf-table th, .dsh-wf-table td { padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
.dsh-wf-table th { color: var(--dsw-alias-label-caption); font-size: 11px; font-weight: 600; }
.dsh-wf-events, .dsh-wf-runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dsh-wf-events li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.dsh-wf-time { color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
.dsh-wf-kind { color: var(--dsw-alias-label-secondary); }
.dsh-wf-subject { font-weight: 600; }
.dsh-wf-summary { color: var(--dsw-alias-label-secondary); }
.dsh-wf-run { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100%; padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-wf-run[data-status="failed"] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-wf-run-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsh-wf-muted { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-wf-error { color: var(--dsw-alias-state-error-primary); }
.dsh-wf-error-block { display: flex; flex-direction: column; gap: 6px; }
.dsh-wf-retry, .dsh-wf-more { align-self: flex-start; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; cursor: pointer; }
`

export interface Loaded {
  readonly health: HealthView
  readonly triggers: readonly TriggerView[]
  readonly events: Page<JournalEvent>
  readonly runs: Page<RunView>
  readonly definitions: readonly DefinitionView[]
  readonly receipts: readonly ReceiptView[]
}

interface ViewState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly loaded?: Loaded
  readonly message?: string
}

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

function pageOf<T>(body: { next?: string }, items: readonly T[]): Page<T> {
  return { items, ...(body.next === undefined ? {} : { next: body.next }) }
}

/**
 * The Workflows conversation view: health, catalog, session events, runs, and
 * the Why-not rows. It requests bounded pages and never the whole journal.
 */
/** A response from a previous session generation must never commit. */
export function isStaleGeneration(requested: number, current: number): boolean {
  return requested !== current
}

/** The loaded view body; pure so it renders without hooks in tests. */
export function WorkflowsLoaded(props: {
  readonly loaded: Loaded
  readonly t: Translate
  readonly sessionId?: string
  readonly selected?: string
  readonly onSelect?: (run: RunView) => void
  readonly onLoadEvents?: () => void
  readonly onLoadRuns?: () => void
  readonly pageStates?: PageStates
}): ReactNode {
  const { loaded, t, sessionId } = props
  const selectedRun = loaded.runs.items.find((run) => run.id === props.selected)
  const pageProps = (
    kind: 'events' | 'runs',
    next: string | undefined,
  ): Record<string, unknown> => {
    const page = props.pageStates?.[kind]
    if (next === undefined || page?.key !== `${kind}:${next}`) return {}
    if (page.phase === 'loading') return { loading: true }
    return { error: page.message ?? t('state.error') }
  }
  return (
    <>
      <HealthStrip health={loaded.health} t={t} />
      <DefinitionsTable definitions={loaded.definitions} t={t} />
      <TriggersTable triggers={loaded.triggers} t={t} />
      <ReceiptsList receipts={loaded.receipts} t={t} />
      <EventList events={loaded.events.items} t={t} />
      <LoadMore
        next={loaded.events.next}
        t={t}
        onLoad={props.onLoadEvents ?? (() => {})}
        {...pageProps('events', loaded.events.next)}
      />
      <RunsList
        runs={loaded.runs.items}
        t={t}
        {...(props.selected === undefined ? {} : { selected: props.selected })}
        onSelect={props.onSelect ?? (() => {})}
      />
      <LoadMore
        next={loaded.runs.next}
        t={t}
        onLoad={props.onLoadRuns ?? (() => {})}
        {...pageProps('runs', loaded.runs.next)}
      />
      {selectedRun === undefined ? null : <RunDetail run={selectedRun} t={t} session={sessionId} />}
      <WhyNotTable events={loaded.events.items} t={t} />
    </>
  )
}

export function WorkflowsView(props: {
  readonly sessionId?: string
  readonly t: Translate
}): ReactNode {
  const { sessionId, t } = props
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const loadId = useRef(0)
  const pendingPages = useRef(new Set<string>())
  const [pageStates, setPageStates] = useState<PageStates>({
    events: undefined,
    runs: undefined,
  })

  const load = (): void => {
    if (sessionId === undefined) return
    const generation = ++loadId.current
    pendingPages.current.clear()
    setPageStates(emptyPageStates())
    setState({ phase: 'loading' })
    Promise.all([
      requestJson<HealthView>(healthUrl(sessionId)),
      requestJson<{ triggers: TriggerView[] }>(triggersUrl(sessionId)),
      requestJson<{ events: JournalEvent[]; next?: string }>(eventsUrl(sessionId)),
      requestJson<{ runs: RunView[]; next?: string }>(runsUrl(sessionId)),
      requestJson<{ definitions: DefinitionView[] }>(definitionsUrl(sessionId)),
      requestJson<{ receipts: ReceiptView[] }>(receiptsUrl(sessionId)),
    ]).then(
      ([health, triggers, events, runs, definitions, receipts]) => {
        if (isStaleGeneration(generation, loadId.current)) return
        setState({
          phase: 'ready',
          loaded: {
            health,
            triggers: triggers.triggers,
            events: pageOf(events, events.events),
            runs: pageOf(runs, runs.runs),
            definitions: definitions.definitions,
            receipts: receipts.receipts,
          },
        })
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current)) return
        setState({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  useEffect(() => {
    load()
    return () => {
      loadId.current += 1
    }
  }, [sessionId])

  if (sessionId === undefined) {
    return (
      <div className="dsh-wf" data-state="no-session">
        <p className="dsh-wf-muted">{t('state.noSession')}</p>
      </div>
    )
  }

  const mergeEvents = (): void => {
    const next = state.loaded?.events.next
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
          updatePageState(current, 'events', {
            key,
            phase: 'error',
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      },
    )
  }

  const mergeRuns = (): void => {
    const next = state.loaded?.runs.next
    if (next === undefined) return
    const key = `runs:${next}`
    if (pendingPages.current.has(key)) return
    const generation = loadId.current
    pendingPages.current.add(key)
    setPageStates((current) => updatePageState(current, 'runs', { key, phase: 'loading' }))
    void requestJson<{ runs: RunView[]; next?: string }>(runsUrl(sessionId, next)).then(
      (page) => {
        if (isStaleGeneration(generation, loadId.current)) return
        pendingPages.current.delete(key)
        setPageStates((current) => updatePageState(current, 'runs', undefined))
        setState((current) => {
          if (current.loaded === undefined) return current
          return {
            ...current,
            loaded: {
              ...current.loaded,
              runs: pageOf(page, [...current.loaded.runs.items, ...page.runs]),
            },
          }
        })
      },
      (error: unknown) => {
        if (isStaleGeneration(generation, loadId.current)) return
        pendingPages.current.delete(key)
        setPageStates((current) =>
          updatePageState(current, 'runs', {
            key,
            phase: 'error',
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      },
    )
  }

  let body: ReactNode
  if (state.phase === 'loading') {
    body = <LoadingLine t={t} />
  } else if (state.phase === 'error') {
    body = <ErrorLine message={state.message ?? ''} t={t} onRetry={load} />
  } else {
    body = (
      <WorkflowsLoaded
        loaded={state.loaded as Loaded}
        t={t}
        sessionId={sessionId}
        selected={selected}
        onSelect={(run) => setSelected(run.id)}
        onLoadEvents={mergeEvents}
        onLoadRuns={mergeRuns}
        pageStates={pageStates}
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
