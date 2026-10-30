import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { Range } from '../host/aggregate.js'
import type { Report, ReportRow } from '../host/report.js'

type Translate = (key: string) => string

interface ClientContext {
  effect: (callback: () => () => void) => () => void
  slots: {
    inject: (key: string, callback: () => () => void) => () => void
    register: (
      options: {
        name: string
        id: string
        order?: number
        label?: string | (() => string)
      },
      component: (props: { sessionId?: string }) => ReactNode,
    ) => () => void
  }
  locale: {
    register: (namespace: string, locale: string, dictionary: Record<string, string>) => () => void
    bind: (namespace: string) => Translate
  }
}

export const inject = ['slots', 'locale']

const NS = 'dsh-setup-observability'

/** Read-only report route served by the Host half. */
export const REPORT_PATH = '/plugins/dsh-setup-observability/report'

const RANGE_OPTIONS: readonly Range[] = ['session', 'day', 'week', 'month']

const EN: Record<string, string> = {
  'view.label': 'Observability',
  'range.label': 'Range',
  'range.session': 'Session',
  'range.day': 'Day',
  'range.week': 'Week',
  'range.month': 'Month',
  'window.events': 'events',
  'window.plugins': 'plugins',
  'health.ok': 'Everything looks healthy',
  'health.attention': 'Something needs attention',
  'health.missing': 'A configured tool is not loaded',
  'health.active': 'active',
  'health.silent': 'silent',
  'health.guidance': 'guidance-only',
  'health.errors': 'errors',
  'kpi.turns': 'Turns',
  'kpi.steps': 'Steps',
  'kpi.toolCalls': 'Tool calls',
  'kpi.errors': 'Errors',
  'chart.title': 'Activity over the range',
  'chart.events': 'events',
  'chart.errors': 'errors',
  'chart.empty': 'No activity in this range.',
  'legend.events': 'Events',
  'legend.errors': 'Errors',
  'section.attention': 'Needs attention',
  'section.active': 'Active',
  'section.silent': 'Silent',
  'section.guidance': 'Guidance only',
  'card.lastActivity': 'last activity',
  'card.never': 'no traces',
  'card.recent': 'Recent traces',
  'card.tools': 'Tools',
  'card.errors': 'errors',
  'tools.title': 'Tool calls',
  'tools.empty': 'No tool calls in this range.',
  'signals.title': 'Injected messages and aborts',
  'status.guidance': 'guidance only',
  'state.loading': 'Reading session logs…',
  'state.empty': 'No sessions recorded activity in this range.',
  'state.error': 'The report could not be loaded.',
  'detail.turn': 'turn',
  'detail.failed': 'error',
  'blind.title': 'What this view cannot see',
  'time.minute': 'm ago',
  'time.hour': 'h ago',
  'time.day': 'd ago',
  'time.now': 'just now',
}

/** URL of one report request. */
export function reportUrl(range: Range, sessionId?: string): string {
  const session =
    sessionId === undefined || sessionId === '' ? '' : `&session=${encodeURIComponent(sessionId)}`
  return `${REPORT_PATH}?range=${range}${session}`
}

function formatTime(time: number): string {
  return new Date(time).toLocaleString()
}

function formatAge(time: number, now: number, t: Translate): string {
  const diff = Math.max(0, now - time)
  if (diff < 60_000) return t('time.now')
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))}${t('time.minute')}`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))}${t('time.hour')}`
  return `${String(Math.floor(diff / 86_400_000))}${t('time.day')}`
}

function byAttention(left: ReportRow, right: ReportRow): number {
  const rank = (row: ReportRow): number => {
    if (row.status === 'error') return 0
    if (row.status === 'not loaded') return 1
    if (row.status === 'active') return 2
    return 3
  }
  return (
    rank(left) - rank(right) || right.traces - left.traces || left.label.localeCompare(right.label)
  )
}

/** The four big numbers of the window, computed once by the Host. */
export function KpiStrip({ report, t }: { report: Report; t: Translate }): ReactNode {
  const cards: ReadonlyArray<{ key: string; value: number; tone?: 'error' }> = [
    { key: 'turns', value: report.totals.turns },
    { key: 'steps', value: report.totals.steps },
    { key: 'toolCalls', value: report.totals.toolCalls },
    {
      key: 'errors',
      value: report.totals.errors,
      ...(report.totals.errors > 0 ? { tone: 'error' as const } : {}),
    },
  ]
  return (
    <section className="dsh-obs-kpis">
      {cards.map((card) => (
        <div key={card.key} className="dsh-obs-kpi" data-kpi={card.key} data-tone={card.tone}>
          <span className="dsh-obs-kpi-label">{t(`kpi.${card.key}`)}</span>
          <span className="dsh-obs-kpi-value">{card.value}</span>
        </div>
      ))}
    </section>
  )
}

/** One-line verdict: healthy, erroring, or missing a configured tool. */
export function HealthBanner({ report, t }: { report: Report; t: Translate }): ReactNode {
  const plugins = report.rows.filter((row) => row.group === 'plugin')
  const errors = report.totals.errors
  const notLoaded = plugins.filter((row) => row.status === 'not loaded')
  const active = plugins.filter((row) => row.status === 'active' || row.status === 'error').length
  const silent = plugins.filter((row) => row.status === 'silent').length
  const guidance = plugins.filter((row) => row.kind === 'guidance').length
  const attention = errors > 0 || notLoaded.length > 0
  const headline =
    errors > 0 ? t('health.attention') : notLoaded.length > 0 ? t('health.missing') : t('health.ok')
  const summary = `${String(active)} ${t('health.active')} · ${String(silent)} ${t('health.silent')} · ${String(guidance)} ${t('health.guidance')}`
  return (
    <section className="dsh-obs-health" data-tone={attention ? 'attention' : 'ok'}>
      <span className="dsh-obs-health-dot" aria-hidden="true" />
      <div className="dsh-obs-health-text">
        <strong>{headline}</strong>
        <span>{summary}</span>
        {errors > 0 ? (
          <span className="dsh-obs-err">{`${String(errors)} ${t('health.errors')}`}</span>
        ) : null}
      </div>
    </section>
  )
}

/** Full-width activity chart: events per bucket with the error share on top. */
export function ActivityChart({ report, t }: { report: Report; t: Translate }): ReactNode {
  const width = 720
  const height = 190
  const pad = { left: 40, right: 14, top: 12, bottom: 30 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const max = Math.max(1, ...report.activity)
  const step = plotWidth / Math.max(1, report.activity.length)
  const barWidth = Math.max(2, step * 0.62)
  const ticks = [...new Set([0, Math.round(max / 2), max])]
  const labelIndexes = [
    ...new Set([
      0,
      Math.floor((report.bucketLabels.length - 1) / 2),
      report.bucketLabels.length - 1,
    ]),
  ].filter((index) => index >= 0)
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('chart.title')}</h2>
        <div className="dsh-obs-legend">
          <span className="dsh-obs-legend-item">
            <i className="dsh-obs-swatch" data-tone="events" />
            {t('legend.events')}
          </span>
          <span className="dsh-obs-legend-item">
            <i className="dsh-obs-swatch" data-tone="errors" />
            {t('legend.errors')}
          </span>
        </div>
      </header>
      <svg
        className="dsh-obs-chart"
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('chart.title')}
      >
        {ticks.map((tick) => {
          const y = pad.top + plotHeight - (tick / max) * plotHeight
          return (
            <g key={`tick-${String(tick)}`}>
              <line
                className="dsh-obs-gridline"
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
              />
              <text className="dsh-obs-axis" x={pad.left - 6} y={y + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          )
        })}
        {report.activity.map((count, index) => {
          const errors = report.errorSeries[index] ?? 0
          const normal = Math.max(0, count - errors)
          const totalHeight = (count / max) * plotHeight
          const normalHeight = (normal / max) * plotHeight
          const errorHeight = totalHeight - normalHeight
          const x = pad.left + index * step + (step - barWidth) / 2
          const baseline = pad.top + plotHeight
          const label = report.bucketLabels[index] ?? String(index + 1)
          return (
            <g key={`${label}:${String(index)}`}>
              <title>{`${label}: ${String(count)} ${t('chart.events')} · ${String(errors)} ${t('chart.errors')}`}</title>
              {normalHeight > 0 ? (
                <rect
                  className="dsh-obs-bar"
                  data-tone="events"
                  x={x}
                  y={baseline - normalHeight}
                  width={barWidth}
                  height={normalHeight}
                />
              ) : null}
              {errorHeight > 0 ? (
                <rect
                  className="dsh-obs-bar"
                  data-tone="errors"
                  x={x}
                  y={baseline - totalHeight}
                  width={barWidth}
                  height={errorHeight}
                />
              ) : null}
            </g>
          )
        })}
        {labelIndexes.map((index) => {
          const label = report.bucketLabels[index] ?? ''
          return (
            <text
              key={`label-${String(index)}`}
              className="dsh-obs-axis"
              x={pad.left + index * step + step / 2}
              y={height - 8}
              textAnchor={
                index === 0 ? 'start' : index === report.bucketLabels.length - 1 ? 'end' : 'middle'
              }
            >
              {label}
            </text>
          )
        })}
        {report.activity.every((count) => count === 0) ? (
          <text
            className="dsh-obs-chart-empty"
            x={width / 2}
            y={pad.top + plotHeight / 2}
            textAnchor="middle"
          >
            {t('chart.empty')}
          </text>
        ) : null}
      </svg>
    </section>
  )
}

/** One status pill: the word is always visible, colour is secondary. */
export function StatusPill({ row, t }: { row: ReportRow; t: Translate }): ReactNode {
  const guidance = row.kind === 'guidance'
  const status = guidance ? t('status.guidance') : (row.status ?? t('status.guidance'))
  return (
    <span className="dsh-obs-pill" data-status={guidance ? 'guidance' : (row.status ?? 'silent')}>
      {status}
    </span>
  )
}

/** Tiny per-row activity sparkline; each bar carries a title. */
export function Sparkline({
  counts,
  label,
}: {
  counts: readonly number[]
  label: string
}): ReactNode {
  if (counts.length === 0) return null
  const width = 120
  const height = 24
  const max = Math.max(1, ...counts)
  const barWidth = width / counts.length
  return (
    <svg
      className="dsh-obs-spark"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {counts.map((count, index) => (
        <g key={`${label}:${String(index)}`}>
          <title>{`${label}: ${String(count)}`}</title>
          <rect
            x={index * barWidth + 0.5}
            y={height - (count / max) * height}
            width={Math.max(1, barWidth - 1)}
            height={(count / max) * height}
          />
        </g>
      ))}
    </svg>
  )
}

/** At most five recent metadata entries; message text and arguments are absent by design. */
function RecentTraces({ row, t }: { row: ReportRow; t: Translate }): ReactNode {
  const recent = row.details.slice(0, 5)
  return (
    <details className="dsh-obs-more">
      <summary>{`${t('card.recent')} (${String(recent.length)})`}</summary>
      <ol>
        {recent.map((entry, index) => (
          <li key={`${String(entry.time)}:${entry.signalId}:${String(index)}`}>
            {`${formatTime(entry.time)} · ${entry.signalId}`}
            {entry.turn === undefined ? '' : ` · ${t('detail.turn')} ${String(entry.turn)}`}
            {entry.tool === undefined ? '' : ` · ${entry.tool}`}
            {entry.failed === true ? ` · ${t('detail.failed')}` : ''}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** One plugin health card. */
export function PluginCard({
  row,
  t,
  now,
}: {
  row: ReportRow
  t: Translate
  now: number
}): ReactNode {
  const silent = row.status === 'silent' || row.status === 'not loaded'
  return (
    <article className="dsh-obs-card" data-status={row.status}>
      <header className="dsh-obs-card-head">
        <span className="dsh-obs-card-name">{row.label}</span>
        <StatusPill row={row} t={t} />
      </header>
      <div className="dsh-obs-card-metrics">
        <span>
          <strong>{row.traces}</strong> {t('chart.events')}
        </span>
        {row.errors > 0 ? (
          <span className="dsh-obs-err">{`${String(row.errors)} ${t('card.errors')}`}</span>
        ) : null}
        <span className="dsh-obs-muted">
          {row.lastActivity === undefined ? t('card.never') : formatAge(row.lastActivity, now, t)}
        </span>
      </div>
      <Sparkline counts={row.counts} label={row.label} />
      {row.tools.length > 0 ? (
        <div className="dsh-obs-chips">
          {row.tools.map((tool) => (
            <span key={tool} className="dsh-obs-chip">
              {tool}
            </span>
          ))}
        </div>
      ) : null}
      {silent ? <p className="dsh-obs-muted">{row.note}</p> : null}
      <RecentTraces row={row} t={t} />
    </article>
  )
}

/** One named group of plugin cards. */
function PluginSection({
  title,
  rows,
  t,
  now,
  tone,
}: {
  title: string
  rows: readonly ReportRow[]
  t: Translate
  now: number
  tone?: 'attention'
}): ReactNode {
  if (rows.length === 0) return null
  return (
    <section className="dsh-obs-section" data-tone={tone}>
      <h2>{`${title} (${String(rows.length)})`}</h2>
      <div className="dsh-obs-grid">
        {rows.map((row) => (
          <PluginCard key={row.id} row={row} t={t} now={now} />
        ))}
      </div>
    </section>
  )
}

/** Plugin health cards grouped by attention, with guidance kept compact. */
export function PluginBoard({
  report,
  t,
  now,
}: {
  report: Report
  t: Translate
  now: number
}): ReactNode {
  const plugins = report.rows.filter((row) => row.group === 'plugin').sort(byAttention)
  const attention = plugins.filter((row) => row.status === 'error' || row.status === 'not loaded')
  const active = plugins.filter((row) => row.status === 'active')
  const silent = plugins.filter((row) => row.status === 'silent')
  const guidance = plugins.filter((row) => row.kind === 'guidance')
  return (
    <>
      <PluginSection
        title={t('section.attention')}
        rows={attention}
        t={t}
        now={now}
        tone="attention"
      />
      <PluginSection title={t('section.active')} rows={active} t={t} now={now} />
      <PluginSection title={t('section.silent')} rows={silent} t={t} now={now} />
      {guidance.length > 0 ? (
        <section className="dsh-obs-section">
          <h2>{`${t('section.guidance')} (${String(guidance.length)})`}</h2>
          <ul className="dsh-obs-guidance">
            {guidance.map((row) => (
              <li key={row.id}>
                <span className="dsh-obs-guidance-name">{row.label}</span>
                <StatusPill row={row} t={t} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

/** Tool call distribution; one bar per observed tool, errors in red text. */
export function ToolsPanel({ rows, t }: { rows: readonly ReportRow[]; t: Translate }): ReactNode {
  const tools = rows
    .filter((row) => row.group === 'tools')
    .sort((left, right) => right.traces - left.traces)
  const max = Math.max(1, ...tools.map((row) => row.traces))
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('tools.title')}</h2>
      </header>
      {tools.length === 0 ? (
        <p className="dsh-obs-muted">{t('tools.empty')}</p>
      ) : (
        <ul className="dsh-obs-bars">
          {tools.map((row) => (
            <li key={row.id}>
              <span className="dsh-obs-bars-label">{row.label}</span>
              <span className="dsh-obs-bars-track">
                <span
                  className="dsh-obs-bars-fill"
                  data-tone={row.errors > 0 ? 'errors' : undefined}
                  style={{ width: `${String((row.traces / max) * 100)}%` }}
                />
              </span>
              <span className="dsh-obs-bars-value">
                {row.traces}
                {row.errors > 0 ? (
                  <em className="dsh-obs-err">{` · ${String(row.errors)} ${t('card.errors')}`}</em>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Injected-message and abort signals the log carries by itself. */
export function SignalsPanel({ rows, t }: { rows: readonly ReportRow[]; t: Translate }): ReactNode {
  const signals = rows.filter((row) => row.group === 'sources' || row.group === 'aborts')
  if (signals.length === 0) return null
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('signals.title')}</h2>
      </header>
      <div className="dsh-obs-chips">
        {signals.map((row) => (
          <span
            key={row.id}
            className="dsh-obs-chip"
            data-tone={row.errors > 0 ? 'errors' : undefined}
          >
            {`${row.label} · ${String(row.traces)}`}
          </span>
        ))}
      </div>
    </section>
  )
}

/** Collapsed statement of what the view cannot observe. */
export function BlindSpots({ report, t }: { report: Report; t: Translate }): ReactNode {
  return (
    <details className="dsh-obs-blind">
      <summary>{t('blind.title')}</summary>
      <ul>
        {report.blindSpots.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </details>
  )
}

/** Range selector; changing it refetches the report. */
export function RangeSelector({
  range,
  t,
  onRange,
}: {
  range: Range
  t: Translate
  onRange: (range: Range) => void
}): ReactNode {
  return (
    <fieldset className="dsh-obs-ranges" aria-label={t('range.label')}>
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === range}
          onClick={() => onRange(option)}
        >
          {t(`range.${option}`)}
        </button>
      ))}
    </fieldset>
  )
}

/** Presentational body: header, dashboard, and the three request states. */
export function ObservabilityPanel({
  range,
  report,
  error,
  t,
  onRange,
  now,
}: {
  range: Range
  report: Report | null
  error: string | null
  t: Translate
  onRange: (range: Range) => void
  now: number
}): ReactNode {
  const plugins = report?.rows.filter((row) => row.group === 'plugin').length ?? 0
  return (
    <div className="dsh-obs">
      <style>{CSS}</style>
      <header className="dsh-obs-header">
        <RangeSelector range={range} t={t} onRange={onRange} />
        {report === null ? null : (
          <span className="dsh-obs-window">
            {`${String(report.totals.records)} ${t('window.events')} · ${String(plugins)} ${t('window.plugins')}`}
          </span>
        )}
      </header>
      {error !== null ? (
        <p role="alert" className="dsh-obs-error">
          {`${t('state.error')} ${error}`}
        </p>
      ) : report === null ? (
        <p className="dsh-obs-loading">{t('state.loading')}</p>
      ) : report.rows.length === 0 ? (
        <p className="dsh-obs-empty">{t('state.empty')}</p>
      ) : (
        <>
          <HealthBanner report={report} t={t} />
          <KpiStrip report={report} t={t} />
          <ActivityChart report={report} t={t} />
          <PluginBoard report={report} t={t} now={now} />
          <ToolsPanel rows={report.rows} t={t} />
          <SignalsPanel rows={report.rows} t={t} />
          <BlindSpots report={report} t={t} />
        </>
      )}
    </div>
  )
}

/** The live view: fetch the selected range and render the dashboard. */
export function ObservabilityView({
  t,
  sessionId,
}: {
  t: Translate
  sessionId?: string
}): ReactNode {
  const [range, setRange] = useState<Range>('session')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    setReport(null)
    setError(null)
    setNow(Date.now())
    fetch(reportUrl(range, sessionId), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            | { error?: unknown }
            | undefined
          throw new Error(
            typeof body?.error === 'string'
              ? body.error
              : `The report request failed (${String(response.status)}).`,
          )
        }
        return (await response.json()) as Report
      })
      .then((value) => {
        if (active) setReport(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [range, sessionId])
  return (
    <ObservabilityPanel
      range={range}
      report={report}
      error={error}
      t={t}
      onRange={setRange}
      now={now}
    />
  )
}

/** Register the Observability view beside Chat and Trajectory. */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, 'en', EN))
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        { name: 'conversation.view', id: 'observability', order: 20, label: () => t('view.label') },
        (props) => <ObservabilityView t={t} sessionId={props.sessionId} />,
      ),
    )
  } catch (error) {
    console.error('observability: Client registration failed', error)
  }
}

const CSS = `
.dsh-obs {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 20px 28px;
  overflow: auto;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dsh-obs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-obs-window {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-obs-ranges {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
}
.dsh-obs-ranges button {
  padding: 4px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
.dsh-obs-ranges button[aria-pressed="true"] {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
}
.dsh-obs-ranges button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-obs-health {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-left-width: 4px;
  border-left-color: var(--dsw-alias-state-success-primary);
  border-radius: var(--dsw-radius-sm);
}
.dsh-obs-health[data-tone="attention"] {
  border-left-color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-health-dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
}
.dsh-obs-health[data-tone="attention"] .dsh-obs-health-dot {
  background: var(--dsw-alias-state-error-primary);
}
.dsh-obs-health-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.dsh-obs-health-text strong {
  font-size: 15px;
}
.dsh-obs-health-text > span {
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}
.dsh-obs-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
}
.dsh-obs-kpi-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-obs-kpi-value {
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.dsh-obs-kpi[data-tone="error"] .dsh-obs-kpi-value {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-panel {
  padding: 12px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
}
.dsh-obs-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.dsh-obs-panel-head h2,
.dsh-obs-section h2 {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
}
.dsh-obs-legend {
  display: flex;
  gap: 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-obs-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dsh-obs-swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--dsw-alias-state-business-primary);
}
.dsh-obs-swatch[data-tone="errors"] {
  background: var(--dsw-alias-state-error-primary);
}
.dsh-obs-chart {
  display: block;
  width: 100%;
  height: 190px;
}
.dsh-obs-gridline {
  stroke: var(--dsw-alias-border-l2);
  stroke-width: 1;
}
.dsh-obs-axis {
  fill: var(--dsw-alias-label-caption);
  font-size: 11px;
}
.dsh-obs-chart-empty {
  fill: var(--dsw-alias-label-caption);
  font-size: 12px;
}
.dsh-obs-bar[data-tone="events"] {
  fill: var(--dsw-alias-state-business-primary);
  opacity: 0.75;
}
.dsh-obs-bar[data-tone="errors"] {
  fill: var(--dsw-alias-state-error-primary);
}
.dsh-obs-section[data-tone="attention"] h2 {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
}
.dsh-obs-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-obs-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
}
.dsh-obs-card[data-status="error"] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dsh-obs-card-name {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-obs-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  text-transform: lowercase;
}
.dsh-obs-pill::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption);
}
.dsh-obs-pill[data-status="active"] {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-obs-pill[data-status="active"]::before {
  background: var(--dsw-alias-state-success-primary);
}
.dsh-obs-pill[data-status="error"] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-pill[data-status="error"]::before {
  background: var(--dsw-alias-state-error-primary);
}
.dsh-obs-pill[data-status="not loaded"] {
  color: var(--dsw-alias-brand-primary);
}
.dsh-obs-pill[data-status="not loaded"]::before {
  background: var(--dsw-alias-brand-primary);
}
.dsh-obs-card-metrics {
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-obs-card-metrics strong {
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
}
.dsh-obs-spark {
  display: block;
  width: 100%;
  height: 24px;
  color: var(--dsw-alias-state-business-primary);
}
.dsh-obs-spark rect {
  fill: currentColor;
  opacity: 0.7;
}
.dsh-obs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-obs-chip {
  padding: 1px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh-obs-chip[data-tone="errors"] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-more summary {
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
}
.dsh-obs-more ol {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-guidance {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-obs-guidance li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-obs-guidance-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-obs-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-obs-bars li {
  display: grid;
  grid-template-columns: minmax(90px, 180px) 1fr auto;
  align-items: center;
  gap: 10px;
}
.dsh-obs-bars-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-bars-track {
  height: 8px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
}
.dsh-obs-bars-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-business-primary);
}
.dsh-obs-bars-fill[data-tone="errors"] {
  background: var(--dsw-alias-state-error-primary);
}
.dsh-obs-bars-value {
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-err {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-muted {
  color: var(--dsw-alias-label-caption);
}
.dsh-obs-blind {
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-blind summary {
  cursor: pointer;
  font-weight: 600;
}
.dsh-obs-blind ul {
  margin: 8px 0 0;
  padding-left: 18px;
}
.dsh-obs-error {
  color: var(--dsw-alias-state-error-primary);
}
`
