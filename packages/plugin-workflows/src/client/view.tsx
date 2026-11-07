import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
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

interface Loaded {
  readonly health: HealthView
  readonly triggers: readonly TriggerView[]
  readonly events: Page<JournalEvent>
  readonly runs: Page<RunView>
}

interface ViewState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly loaded?: Loaded
  readonly message?: string
}

function pageOf<T>(body: { next?: string }, items: readonly T[]): Page<T> {
  return { items, ...(body.next === undefined ? {} : { next: body.next }) }
}

/**
 * The Workflows conversation view: health, catalog, session events, runs, and
 * the Why-not rows. It requests bounded pages and never the whole journal.
 */
export function WorkflowsView(props: {
  readonly sessionId?: string
  readonly t: Translate
}): ReactNode {
  const { sessionId, t } = props
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  const [selected, setSelected] = useState<string | undefined>(undefined)

  const load = (): void => {
    if (sessionId === undefined) return
    setState({ phase: 'loading' })
    Promise.all([
      requestJson<HealthView>(healthUrl(sessionId)),
      requestJson<{ triggers: TriggerView[] }>(triggersUrl(sessionId)),
      requestJson<{ events: JournalEvent[]; next?: string }>(eventsUrl(sessionId)),
      requestJson<{ runs: RunView[]; next?: string }>(runsUrl(sessionId)),
    ]).then(
      ([health, triggers, events, runs]) => {
        setState({
          phase: 'ready',
          loaded: {
            health,
            triggers: triggers.triggers,
            events: pageOf(events, events.events),
            runs: pageOf(runs, runs.runs),
          },
        })
      },
      (error: unknown) => {
        setState({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  useEffect(load, [sessionId])

  if (sessionId === undefined) {
    return (
      <div className="dsh-wf" data-state="no-session">
        <p className="dsh-wf-muted">{t('state.noSession')}</p>
      </div>
    )
  }

  const mergeEvents = (): void => {
    if (state.loaded?.events.next === undefined) return
    void requestJson<{ events: JournalEvent[]; next?: string }>(
      eventsUrl(sessionId, state.loaded.events.next),
    ).then((page) => {
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
    })
  }

  const mergeRuns = (): void => {
    if (state.loaded?.runs.next === undefined) return
    void requestJson<{ runs: RunView[]; next?: string }>(
      runsUrl(sessionId, state.loaded.runs.next),
    ).then((page) => {
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
    })
  }

  let body: ReactNode
  if (state.phase === 'loading') {
    body = <LoadingLine t={t} />
  } else if (state.phase === 'error') {
    body = <ErrorLine message={state.message ?? ''} t={t} onRetry={load} />
  } else {
    const loaded = state.loaded as Loaded
    const selectedRun = loaded.runs.items.find((run) => run.id === selected)
    body = (
      <>
        <HealthStrip health={loaded.health} t={t} />
        <TriggersTable triggers={loaded.triggers} t={t} />
        <EventList events={loaded.events.items} t={t} />
        <LoadMore next={loaded.events.next} t={t} onLoad={mergeEvents} />
        <RunsList
          runs={loaded.runs.items}
          t={t}
          {...(selected === undefined ? {} : { selected })}
          onSelect={(run) => setSelected(run.id)}
        />
        <LoadMore next={loaded.runs.next} t={t} onLoad={mergeRuns} />
        {selectedRun === undefined ? null : <RunDetail run={selectedRun} t={t} />}
        <WhyNotTable events={loaded.events.items} t={t} />
      </>
    )
  }
  return (
    <div className="dsh-wf" data-state={state.phase}>
      <style>{VIEW_CSS}</style>
      {body}
    </div>
  )
}
