import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { Range } from '../host/aggregate.js'
import type { EpisodeOutcome } from '../host/episodes.js'
import type { HypothesisMetric, HypothesisStatus } from '../host/hypotheses.js'
import type {
  EpisodeReport,
  FailureEntry,
  FailureSeverity,
  FailureTotals,
  Finding,
  HypothesisResult,
  Report,
  ReportRow,
  Scorecard,
  ToolOutcome,
} from '../host/report.js'
import type { Readiness } from '../host/status.js'

type Translate = (key: string) => string

/** The optional Client Workspace navigation the failure actions use. */
interface WorkspaceFacade {
  openSession(sessionId: string): void
  startSession(
    workspaceId?: string,
    options?: { prompt?: string; whenDraftExists?: 'replace' | 'append' | 'keep' },
  ): void
}

/** What the Conversation shell hands to a View entry. */
interface ViewProps {
  readonly sessionId?: string
  /** Focus the registered tool-call inspector on one recorded call. */
  readonly inspectCall?: (callId: string) => void
  /** Select a View and address an opaque focus identity to it. */
  readonly openView?: (view: string, focus: string) => void
}

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
      component: (props: ViewProps) => ReactNode,
    ) => () => void
  }
  locale: {
    register: (namespace: string, locale: string, dictionary: Record<string, string>) => () => void
    bind: (namespace: string) => Translate
  }
  /** Optional service access without declaring a load requirement. */
  reflect?: { get(name: string): unknown }
}

export const inject = ['slots', 'locale']

const NS = 'dsh-setup-observability'

/** Read-only report route served by the Host half. */
export const REPORT_PATH = '/plugins/dsh-setup-observability/report'

/** Focus target of the revealed failure list. */
export const FAILURE_SECTION_ID = 'dsh-obs-failures'

/** Characters one fix-session draft may spend on the failure summary. */
export const MAX_FIX_PROMPT_CHARS = 1200

/** Failures one fix-session draft names before it states the omission. */
export const MAX_FIX_PROMPT_ENTRIES = 10

const RANGE_OPTIONS: readonly Range[] = ['session', 'day', 'week', 'month']

const SEVERITY_ORDER: readonly FailureSeverity[] = ['turn failure', 'turn cut', 'tool failure']

const SEVERITY_KEYS: Record<FailureSeverity, string> = {
  'turn failure': 'severity.turnFailure',
  'turn cut': 'severity.turnCut',
  'tool failure': 'severity.toolFailure',
}

/** The four sections of the view, in tab order. */
export const SUB_VIEWS = ['overview', 'plugins', 'tasks', 'hypotheses'] as const

/** One section of the view; the Conversation view stays the only top-level tab. */
export type SubView = (typeof SUB_VIEWS)[number]

/** Episodes the Tasks table renders; the report is capped at the same bound. */
export const EPISODE_TABLE_LIMIT = 200

// shortcut: the report carries no configured minEpisodes; 10 matches the shipped default,
// upgrade once the report exposes the configured minimum.
export const MIN_EPISODES = 10

/** A short-lived client cache: switching tabs shows the last report at once. */
const REPORT_CACHE_MS = 30_000
const reportCache = new Map<string, { at: number; report: Report }>()

const SUB_VIEW_KEYS: Record<SubView, string> = {
  overview: 'tab.overview',
  plugins: 'tab.plugins',
  tasks: 'tab.tasks',
  hypotheses: 'tab.hypotheses',
}

const OUTCOME_KEYS: Record<EpisodeOutcome, string> = {
  completed: 'outcome.completed',
  failed: 'outcome.failed',
  cut: 'outcome.cut',
  blocked: 'outcome.blocked',
  other: 'outcome.other',
  open: 'outcome.open',
}

type ScorecardStatus = 'not applicable' | 'insufficient' | 'error' | 'silent' | 'active'

const SCORECARD_STATUS_KEYS: Record<ScorecardStatus, string> = {
  'not applicable': 'scorecard.notApplicable',
  insufficient: 'scorecard.insufficient',
  error: 'scorecard.error',
  silent: 'scorecard.silent',
  active: 'scorecard.active',
}

const METRIC_KEYS: Record<HypothesisMetric, string> = {
  'verified-completion-rate': 'hypothesis.metric.verifiedCompletionRate',
  'tokens-per-episode': 'hypothesis.metric.tokensPerEpisode',
  'context-tokens-per-step': 'hypothesis.metric.contextTokensPerStep',
  'active-minutes-per-episode': 'hypothesis.metric.activeMinutesPerEpisode',
  'steps-per-human-message': 'hypothesis.metric.stepsPerHumanMessage',
  'human-messages-per-completed-goal': 'hypothesis.metric.humanMessagesPerCompletedGoal',
  'delegate-rate': 'hypothesis.metric.delegateRate',
  'checkpoint-coverage': 'hypothesis.metric.checkpointCoverage',
  'failure-rate': 'hypothesis.metric.failureRate',
}

const HYPOTHESIS_STATUS_KEYS: Record<HypothesisStatus, string> = {
  collecting: 'hypothesis.status.collecting',
  supported: 'hypothesis.status.supported',
  refuted: 'hypothesis.status.refuted',
  inconclusive: 'hypothesis.status.inconclusive',
}

const READINESS_KEYS: Record<Readiness, string> = {
  mounted: 'readiness.mounted',
  'not mounted': 'readiness.notMounted',
  'readiness unknown': 'readiness.unknown',
}

export const EN: Record<string, string> = {
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
  'health.notMounted': 'A declared prompt contribution is not mounted',
  'health.notMountedCount': 'not mounted',
  'health.active': 'active',
  'health.silent': 'silent',
  'health.guidance': 'guidance-only',
  'health.failure': 'failure',
  'health.failures': 'failures',
  'kpi.turns': 'Turns',
  'kpi.steps': 'Steps',
  'kpi.toolCalls': 'Tool calls',
  'kpi.failures': 'Failures',
  'kpi.turn': 'turn',
  'kpi.toolCall': 'tool call',
  'kpi.session': 'session',
  'chart.events': 'events',
  'chart.errors': 'errors',
  'legend.events': 'Events',
  'legend.errors': 'Errors',
  'timeline.title': 'Session timeline',
  'timeline.empty': 'No activity in this session.',
  'timeline.laneSteps': 'Steps',
  'timeline.laneTools': 'Tools',
  'timeline.laneHuman': 'Human',
  'timeline.laneErrors': 'Errors',
  'timeline.turn': 'Turn',
  'timeline.step': 'step',
  'timeline.call': 'call',
  'timeline.error': 'error',
  'timeline.humanMessage': 'human message',
  'timeline.minute': 'm',
  'timeline.second': 's',
  'series.title': 'Activity in the range',
  'series.empty': 'No activity in this range.',
  'tokens.title': 'Token mix',
  'tokens.cacheRead': 'Cache read',
  'tokens.input': 'Input',
  'tokens.output': 'Output',
  'tokens.empty': 'No tokens recorded in this scope.',
  'section.attention': 'Needs attention',
  'section.active': 'Active',
  'section.silent': 'Silent',
  'section.guidance': 'Guidance only',
  'section.absence': 'No traces in this period; absence is not evidence of a fault.',
  'card.lastActivity': 'last activity',
  'card.never': 'no traces',
  'card.recent': 'Recent traces',
  'card.tools': 'Tools',
  'card.errors': 'errors',
  'card.showFailures': 'View failures',
  'failure.title': 'Failures',
  'failure.entry': 'entry',
  'failure.entries': 'entries',
  'failure.bound': 'Showing the newest',
  'failure.of': 'of',
  'failure.copy': 'Copy list',
  'failure.fix': 'Fix in a new session',
  'failure.open': 'Open',
  'failure.none': 'No failures in this range.',
  'failure.filtered': 'Filtered to',
  'failure.clear': 'Clear filter',
  'severity.turnFailure': 'turn failure',
  'severity.turnCut': 'turn cut',
  'severity.toolFailure': 'tool failure',
  'entry.recovered': 'recovered',
  'readiness.mounted': 'mounted',
  'readiness.notMounted': 'not mounted',
  'readiness.unknown': 'readiness unknown',
  'fix.head': 'Investigate and fix these failures recorded by the Observability view.',
  'fix.instructions':
    'Read the events of each session with the session tools, find the root cause of every failure, and fix it. Add a test that would have caught it. Do not simply retry the failed call.',
  'fix.omitted': 'older failures are omitted from this draft.',
  'fix.truncated': '[draft truncated to fit the size bound]',
  'fix.event': 'event',
  'tools.title': 'Tool calls',
  'tools.empty': 'No tool calls in this range.',
  'tools.share': 'failed',
  'signals.title': 'Injected messages and aborts',
  'status.guidance': 'guidance only',
  'status.active': 'active',
  'status.error': 'error',
  'status.silent': 'silent',
  'status.not loaded': 'not loaded',
  'tab.label': 'Sections',
  'tab.overview': 'Overview',
  'tab.plugins': 'Plugins',
  'tab.tasks': 'Tasks',
  'tab.hypotheses': 'Hypotheses',
  'findings.title': 'Attention findings',
  'verdict.title': 'Data sufficiency',
  'verdict.insufficient': 'Insufficient data',
  'verdict.partial': 'Partial coverage',
  'verdict.sufficient': 'Sufficient for the observed window',
  'verdict.episodes': 'episodes',
  'verdict.of': 'of',
  'verdict.coverage': 'usage coverage',
  'tiles.title': 'Outcomes',
  'tile.quality': 'Quality',
  'tile.cost': 'Cost',
  'tile.speed': 'Speed',
  'tile.autonomy': 'Autonomy',
  'tile.n': 'n',
  'tile.p50': 'p50',
  'tile.p90': 'p90',
  'tile.verified': 'verified',
  'tile.failed': 'failed',
  'tile.cutoff': 'cutoff',
  'tile.cacheHit': 'cache hit',
  'tile.contextPerStep': 'context / step',
  'baseline.title': 'Compared with',
  'baseline.previousWindow': 'previous equal window',
  'baseline.previousSession': 'previous completed session',
  'baseline.none': 'No baseline data for the previous window.',
  'baseline.n': 'episodes',
  'baseline.current': 'current',
  'baseline.previous': 'baseline',
  'baseline.delta': 'delta',
  'baseline.association': 'association, not proof',
  'baseline.verified': 'verified completions',
  'baseline.failure': 'failure rate',
  'baseline.tokens': 'tokens per episode',
  'baseline.active': 'active minutes',
  'baseline.steps': 'steps per human message',
  'tile.humanMessages': 'human messages',
  'tile.completed': 'completed',
  'cutoff.through': 'through cutoff',
  'cutoff.full': 'full episode',
  'unit.minutes': 'min',
  'unit.tokens': 'tokens',
  'unit.steps': 'steps',
  'dq.title': 'Data quality',
  'dq.steps': 'steps with usage',
  'dq.messages': 'messages with usage',
  'dq.episodes': 'episodes',
  'dq.children': 'linked children',
  'dq.unlinked': 'unlinked children',
  'dq.goals': 'goal events',
  'dq.checkpoints': 'checkpoints',
  'dq.unmapped': 'unmapped closers',
  'dq.comparison': 'comparison sample',
  'dq.partial': 'Partial coverage; the metrics above are lower bounds.',
  'scorecards.title': 'Plugin scorecards',
  'scorecards.empty': 'No signal rows are configured.',
  'scorecard.notApplicable': 'not applicable',
  'scorecard.insufficient': 'insufficient data',
  'scorecard.error': 'error',
  'scorecard.silent': 'silent',
  'scorecard.active': 'active',
  'scorecard.goal': 'Goal',
  'scorecard.noGoal': 'No goal declared',
  'scorecard.activation': 'Activation',
  'scorecard.of': 'of',
  'scorecard.eligible': 'eligible',
  'scorecard.firedOutside': 'fired outside eligibility; excluded from activation and cohorts',
  'scorecard.primary': 'Verified completion',
  'scorecard.errorRate': 'error rate',
  'scorecard.primaryNone': 'No completed episodes to compare',
  'scorecard.delta': 'delta',
  'scorecard.unavailable': 'No completed comparison sample',
  'scorecard.matching': 'Matched by tool-call bin and local week',
  'scorecard.relaxed': 'a size bin was compared across weeks',
  'scorecard.points': 'points',
  'scorecard.n': 'n',
  'scorecard.insufficientNote':
    'Below the comparison minimum; no improvement or regression is claimed.',
  'scorecard.noEligibility': 'Eligibility is not declared; every episode is eligible.',
  'scorecard.rowDetail': 'View plugin row',
  'bar.treated': 'treated episodes',
  'bar.control': 'control episodes',
  'tasks.title': 'Tasks',
  'tasks.outcome': 'Outcome',
  'tasks.allOutcomes': 'All outcomes',
  'tasks.plugin': 'Plugin',
  'tasks.allPlugins': 'All plugins',
  'tasks.episodeSpan': 'Episode',
  'tasks.empty': 'No episodes in this range.',
  'tasks.capped': 'Showing the newest',
  'tasks.columnDate': 'Date and title',
  'tasks.columnStepsPerHuman': 'Steps per human message',
  'tasks.columnSteps': 'Steps',
  'tasks.columnTokens': 'Tokens (through cutoff)',
  'tasks.columnActive': 'Active time',
  'tasks.columnOutcome': 'Outcome',
  'tasks.columnVerified': 'Verified',
  'tasks.columnSubagents': 'Subagents',
  'tasks.columnGoal': 'Goal',
  'tasks.columnFailures': 'Failures',
  'tasks.verifiedYes': 'yes',
  'tasks.verifiedNo': 'no',
  'tasks.detail': 'Episode detail',
  'tasks.close': 'Close',
  'tasks.span': 'Span',
  'tasks.tokenPerStep': 'Tokens per step',
  'tasks.throughCutoff': 'Window cost',
  'tasks.fullEpisode': 'Full episode cost',
  'tasks.subagents': 'Subagents',
  'tasks.delegateCalls': 'Delegate calls',
  'tasks.parallelWidth': 'Parallel width',
  'tasks.parentWait': 'Parent wait',
  'tasks.goalsRow': 'Goals',
  'tasks.checkpoints': 'Checkpoints',
  'tasks.checkpointTotal': 'total',
  'tasks.checkpointCloses': 'closes',
  'tasks.checkpointVerified': 'verified',
  'tasks.noChildren': 'No child sessions.',
  'tasks.created': 'created',
  'tasks.completed': 'completed',
  'tasks.rounds': 'rounds',
  'tasks.phase': 'phase',
  'outcome.completed': 'completed',
  'outcome.failed': 'failed',
  'outcome.cut': 'cut',
  'outcome.blocked': 'blocked',
  'outcome.other': 'other',
  'outcome.open': 'open',
  'hypothesis.title': 'Hypotheses',
  'hypothesis.empty': 'No hypotheses are configured.',
  'hypothesis.loading': 'Reading the comparison windows…',
  'hypothesis.copy': 'Copy summary',
  'hypothesis.baseline': 'Baseline',
  'hypothesis.current': 'Current',
  'hypothesis.threshold': 'Threshold',
  'hypothesis.samples': 'Samples',
  'hypothesis.window': 'Window',
  'hypothesis.guardrail': 'Guardrail',
  'hypothesis.regressed': 'guardrail regressed',
  'hypothesis.regressedBlock': 'Guardrail regressed; support is blocked.',
  'hypothesis.collecting': 'Collecting more samples',
  'hypothesis.noBaseline': 'no baseline',
  'hypothesis.association': 'association, not proof',
  'hypothesis.status.collecting': 'collecting',
  'hypothesis.status.supported': 'supported in the observed window',
  'hypothesis.status.refuted': 'refuted in the observed window',
  'hypothesis.status.inconclusive': 'inconclusive in the observed window',
  'hypothesis.metric.verifiedCompletionRate': 'Verified completion rate',
  'hypothesis.metric.tokensPerEpisode': 'Tokens per episode',
  'hypothesis.metric.contextTokensPerStep': 'Context tokens per step',
  'hypothesis.metric.activeMinutesPerEpisode': 'Active minutes per episode',
  'hypothesis.metric.stepsPerHumanMessage': 'Steps per human message',
  'hypothesis.metric.humanMessagesPerCompletedGoal': 'Human messages per completed goal',
  'hypothesis.metric.delegateRate': 'Delegate rate',
  'hypothesis.metric.checkpointCoverage': 'Checkpoint coverage',
  'hypothesis.metric.failureRate': 'Failure rate',
  'state.loading': 'Reading session logs…',
  'state.empty': 'No sessions recorded activity in this range.',
  'state.error': 'The report could not be loaded.',
  'detail.turn': 'turn',
  'detail.step': 'step',
  'detail.failed': 'error',
  'blind.title': 'What this view cannot see',
  'time.minute': 'm ago',
  'time.hour': 'h ago',
  'time.day': 'd ago',
  'time.now': 'just now',
}

/** URL of one report request. */
export function reportUrl(range: Range, sessionId?: string, includeHypotheses = false): string {
  const session =
    sessionId === undefined || sessionId === '' ? '' : `&session=${encodeURIComponent(sessionId)}`
  const hypotheses = includeHypotheses ? '&hypotheses=1' : ''
  return `${REPORT_PATH}?range=${range}${session}${hypotheses}`
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

/** The one pluralization helper the dashboard uses for every count. */
export function counted(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`
}

/** The measured width, or the deterministic fallback when nothing measured the container. */
export function chartWidth(entryWidth: number | undefined, fallback: number): number {
  return entryWidth !== undefined && Number.isFinite(entryWidth) && entryWidth > 0
    ? entryWidth
    : fallback
}

/** A chart's container width, with a deterministic fallback for tests and first paint. */
export function useChartWidth(fallback = 640): {
  ref: (node: SVGSVGElement | null) => void
  width: number
} {
  const [node, setNode] = useState<SVGSVGElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    if (node === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      setWidth(chartWidth(entries[0]?.contentRect.width, fallback))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, fallback])
  return { ref: setNode, width }
}

/** Map a time to an x coordinate inside the width, clamped to its bounds. */
export function timeScale(from: number, to: number, width: number): (time: number) => number {
  if (from === to || width <= 0) return () => 0
  return (time: number) => Math.max(0, Math.min(width, ((time - from) / (to - from)) * width))
}

/** One category's slot, bar width, and centering offset; bars never exceed maxBarWidth. */
export function categoryBand(
  count: number,
  width: number,
  maxBarWidth: number,
): { band: number; bar: number; offset: number } {
  if (count <= 0 || width <= 0) return { band: 0, bar: 0, offset: 0 }
  const band = width / count
  const bar = Math.min(maxBarWidth, band * 0.62)
  return { band, bar, offset: (band - bar) / 2 }
}

/** A session is named by title when known, otherwise by a short id. */
function sessionName(failure: FailureEntry): string {
  return failure.sessionTitle ?? failure.sessionId.slice(0, 8)
}

/** The metadata one failure entry shows; never message text or a raw reason. */
export function failureFacts(failure: FailureEntry, t: Translate): string[] {
  const facts = [formatTime(failure.time), t(SEVERITY_KEYS[failure.severity])]
  facts.push(sessionName(failure))
  if (failure.turn !== undefined) facts.push(`${t('detail.turn')} ${String(failure.turn)}`)
  if (failure.step !== undefined) facts.push(`${t('detail.step')} ${String(failure.step)}`)
  if (failure.tool !== undefined) facts.push(failure.tool)
  const identity = [failure.errorName, failure.errorCode]
    .filter((value): value is string => value !== undefined)
    .join('/')
  if (identity !== '') facts.push(identity)
  if (failure.recovered) facts.push(t('entry.recovered'))
  return facts
}

/** Copy output of the failure list: the same metadata, one entry per line. */
export function failureCopyText(failures: readonly FailureEntry[], t: Translate): string {
  return failures.map((failure) => failureFacts(failure, t).join(' · ')).join('\n')
}

/** Characters one prompt entry may spend on its descriptive fields. */
export const MAX_FIX_ENTRY_CHARS = 300

/**
 * One prompt entry. The event sequence and session come first, so truncating a
 * long tool name or error identity never removes the event locator.
 */
function fixEntry(failure: FailureEntry, t: Translate): string {
  const locator = `${t('fix.event')} ${String(failure.seq)} · session ${failure.sessionId}`
  const text = `- ${locator} · ${failureFacts(failure, t).join(' · ')}`
  if (text.length <= MAX_FIX_ENTRY_CHARS) return text
  return `${text.slice(0, MAX_FIX_ENTRY_CHARS - 1)}…`
}

/**
 * A self-contained draft for a new session. Bounded in entries and characters;
 * the omitted tail and the closing instructions always survive, and oversized
 * fields are cut inside an entry rather than from the end of the draft. It is a
 * draft: nothing is submitted.
 */
export function failureFixPrompt(failures: readonly FailureEntry[], t: Translate): string {
  const assemble = (shown: readonly FailureEntry[]): string => {
    const lines = [t('fix.head')]
    for (const failure of shown) lines.push(fixEntry(failure, t))
    if (failures.length > shown.length) {
      lines.push(`- ${String(failures.length - shown.length)} ${t('fix.omitted')}`)
    }
    lines.push(t('fix.instructions'))
    return lines.join('\n')
  }
  let shown = failures.slice(0, MAX_FIX_PROMPT_ENTRIES)
  let text = assemble(shown)
  while (text.length > MAX_FIX_PROMPT_CHARS && shown.length > 1) {
    shown = shown.slice(0, -1)
    text = assemble(shown)
  }
  if (text.length <= MAX_FIX_PROMPT_CHARS) return text
  const boundary = MAX_FIX_PROMPT_CHARS - t('fix.truncated').length - 1
  return `${text.slice(0, Math.max(0, boundary))}…${t('fix.truncated')}`
}

/** Clipboard write that does nothing when the browser exposes no clipboard. */
function copyText(text: string): void {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard === undefined) return
  void clipboard.writeText(text).catch(() => {})
}

/** Move focus to the revealed failure section, when a document exists. */
function focusFailures(): void {
  if (typeof document === 'undefined') return
  document.getElementById(FAILURE_SECTION_ID)?.focus()
}

/** Read the optional Workspace service without making it a load requirement. */
function optionalWorkspace(ctx: ClientContext): WorkspaceFacade | undefined {
  try {
    return (ctx.reflect?.get('uiWorkspace') as WorkspaceFacade | undefined) ?? undefined
  } catch {
    return undefined
  }
}

function byAttention(left: ReportRow, right: ReportRow): number {
  const rank = (row: ReportRow): number => {
    if (row.status === 'error' && row.unrecoveredErrors > 0) return 0
    if (row.status === 'not loaded') return 1
    if (row.readiness === 'not mounted') return 2
    if (row.status === 'active' || row.status === 'error') return 3
    return 4
  }
  return (
    rank(left) - rank(right) || right.traces - left.traces || left.label.localeCompare(right.label)
  )
}

/** The four big numbers of the window, computed once by the Host. */
export function KpiStrip({
  report,
  t,
  failuresOpen,
  onRevealFailures,
}: {
  report: Report
  t: Translate
  failuresOpen?: boolean
  onRevealFailures?: () => void
}): ReactNode {
  const cards: ReadonlyArray<{ key: string; value: number; tone?: 'error' }> = [
    { key: 'turns', value: report.totals.turns },
    { key: 'steps', value: report.totals.steps },
    { key: 'toolCalls', value: report.totals.toolCalls },
    {
      key: 'failures',
      value: report.failureTotals.total,
      ...(report.failureTotals.total > 0 ? { tone: 'error' as const } : {}),
    },
  ]
  return (
    <section className="dsh-obs-kpis">
      {cards.map((card) => {
        const content = (
          <>
            <span className="dsh-obs-kpi-label">{t(`kpi.${card.key}`)}</span>
            <span className="dsh-obs-kpi-value">{card.value}</span>
          </>
        )
        return card.key === 'failures' && onRevealFailures !== undefined ? (
          <button
            key={card.key}
            type="button"
            className="dsh-obs-kpi"
            data-kpi={card.key}
            data-tone={card.tone}
            aria-expanded={failuresOpen === true}
            aria-controls={FAILURE_SECTION_ID}
            onClick={onRevealFailures}
          >
            {content}
          </button>
        ) : (
          <div key={card.key} className="dsh-obs-kpi" data-kpi={card.key} data-tone={card.tone}>
            {content}
          </div>
        )
      })}
    </section>
  )
}

/** One-line verdict: a union of explicit conditions, never a count or silence. */
export function HealthBanner({ report, t }: { report: Report; t: Translate }): ReactNode {
  const plugins = report.rows.filter((row) => row.group === 'plugin')
  const notLoaded = plugins.filter((row) => row.status === 'not loaded')
  const notMounted = plugins.filter((row) => row.readiness === 'not mounted')
  const active = plugins.filter((row) => row.status === 'active' || row.status === 'error').length
  const silent = plugins.filter((row) => row.status === 'silent').length
  const guidance = plugins.filter((row) => row.kind === 'guidance').length
  const unrecovered = report.failureTotals.toolFailures - report.failureTotals.recovered
  const failed = report.failureTotals.turnFailures + report.failureTotals.turnCuts + unrecovered
  const attention = failed > 0 || notLoaded.length > 0 || notMounted.length > 0
  const headline =
    failed > 0
      ? t('health.attention')
      : notLoaded.length > 0
        ? t('health.missing')
        : notMounted.length > 0
          ? t('health.notMounted')
          : t('health.ok')
  const summary = `${String(active)} ${t('health.active')} · ${String(silent)} ${t('health.silent')} · ${String(guidance)} ${t('health.guidance')}`
  return (
    <section className="dsh-obs-health" data-tone={attention ? 'attention' : 'ok'}>
      <span className="dsh-obs-health-dot" aria-hidden="true" />
      <div className="dsh-obs-health-text">
        <strong>{headline}</strong>
        <span>{summary}</span>
        {report.failureTotals.total > 0 ? (
          <span className="dsh-obs-err">
            {counted(report.failureTotals.total, t('health.failure'), t('health.failures'))}
          </span>
        ) : null}
        {notMounted.length > 0 ? (
          <span className="dsh-obs-err">
            {`${String(notMounted.length)} ${t('health.notMountedCount')}`}
          </span>
        ) : null}
      </div>
    </section>
  )
}

/** One span of activity inside a turn. */
export interface TimelineSpan {
  readonly from: number
  readonly to: number
}

/** One turn as the session timeline receives it. */
export interface TimelineTurn {
  readonly turn: number
  readonly start: number
  readonly end: number
  readonly steps: readonly TimelineSpan[]
  readonly tools: readonly TimelineSpan[]
  readonly human: readonly number[]
  readonly errors: readonly number[]
  /** Recorded step starts, including a step that has not ended yet. */
  readonly stepsCount?: number
  /** Recorded tool calls, including a call whose result has not arrived. */
  readonly callsCount?: number
  /** Overrides the compact row's "Turn n" label for an episode-wide lane set. */
  readonly rowLabel?: string
}

/** Compact wall clock for the time axis and chart tooltips. */
function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Turn length as minutes and seconds, never as a raw millisecond count. */
function formatDuration(ms: number, t: Translate): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes === 0
    ? `${String(seconds)}${t('timeline.second')}`
    : `${String(minutes)}${t('timeline.minute')} ${String(seconds)}${t('timeline.second')}`
}

/**
 * Session activity against time: steps, tools, human messages, and errors on
 * four lanes, then one compact row per turn. Bars carry time and counts only.
 */
export function SessionTimeline({
  from,
  to,
  turns,
  width,
  t,
}: {
  from: number
  to: number
  turns: readonly TimelineTurn[]
  width?: number
  t: Translate
}): ReactNode {
  const measured = useChartWidth()
  const chartWidthPx = width ?? measured.width
  const height = 96
  const pad = { left: 46, right: 8, top: 4, bottom: 18 }
  const plotWidth = Math.max(0, chartWidthPx - pad.left - pad.right)
  const laneHeight = (height - pad.top - pad.bottom) / 4
  const scale = timeScale(from, to, plotWidth)
  const at = (time: number): number => pad.left + scale(time)
  const laneY = (index: number): number => pad.top + laneHeight * (index + 0.5)
  const visible = (span: TimelineSpan): boolean => span.to >= from && span.from <= to
  const barLength = (span: TimelineSpan): number => Math.max(1, at(span.to) - at(span.from))
  const timeVisible = (time: number): boolean => time >= from && time <= to
  const laneLabels = [
    t('timeline.laneSteps'),
    t('timeline.laneTools'),
    t('timeline.laneHuman'),
    t('timeline.laneErrors'),
  ]
  const ticks = [...new Set([from, from + (to - from) / 2, to])]
  const activity = turns.some(
    (turn) =>
      turn.steps.length > 0 ||
      turn.tools.length > 0 ||
      turn.human.length > 0 ||
      turn.errors.length > 0 ||
      (turn.stepsCount ?? 0) > 0 ||
      (turn.callsCount ?? 0) > 0,
  )
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('timeline.title')}</h2>
      </header>
      <svg
        ref={width === undefined ? measured.ref : undefined}
        className="dsh-obs-timeline-chart"
        viewBox={`0 0 ${String(chartWidthPx)} ${String(height)}`}
        role="img"
        aria-label={t('timeline.title')}
      >
        {laneLabels.map((label, index) => (
          <text
            key={`lane-${String(index)}`}
            className="dsh-obs-tl-label"
            x={2}
            y={laneY(index) + 4}
          >
            {label}
          </text>
        ))}
        {turns.flatMap((turn, turnIndex) => [
          ...turn.steps.filter(visible).map((span, index) => (
            <rect
              key={`${String(turnIndex)}:step:${String(index)}`}
              className="dsh-obs-tl-bar"
              data-tone="steps"
              x={at(span.from)}
              y={laneY(0) - 3}
              width={barLength(span)}
              height={6}
            >
              <title>{`${clock(span.from)}–${clock(span.to)} · ${counted(1, t('timeline.step'))}`}</title>
            </rect>
          )),
          ...turn.tools.filter(visible).map((span, index) => (
            <rect
              key={`${String(turnIndex)}:tool:${String(index)}`}
              className="dsh-obs-tl-bar"
              data-tone="tools"
              x={at(span.from)}
              y={laneY(1) - 3}
              width={barLength(span)}
              height={6}
            >
              <title>{`${clock(span.from)}–${clock(span.to)} · ${counted(1, t('timeline.call'))}`}</title>
            </rect>
          )),
          ...turn.human.filter(timeVisible).map((time, index) => (
            <line
              key={`${String(turnIndex)}:human:${String(index)}`}
              className="dsh-obs-tl-tick"
              data-tone="human"
              x1={at(time)}
              x2={at(time)}
              y1={laneY(2) - 5}
              y2={laneY(2) + 5}
            >
              <title>{`${clock(time)} · ${counted(1, t('timeline.humanMessage'))}`}</title>
            </line>
          )),
          ...turn.errors.filter(timeVisible).map((time, index) => (
            <line
              key={`${String(turnIndex)}:error:${String(index)}`}
              className="dsh-obs-tl-tick"
              data-tone="errors"
              x1={at(time)}
              x2={at(time)}
              y1={laneY(3) - 5}
              y2={laneY(3) + 5}
            >
              <title>{`${clock(time)} · ${counted(1, t('timeline.error'))}`}</title>
            </line>
          )),
        ])}
        {ticks.map((time, index) => (
          <text
            key={`axis-${String(time)}`}
            className="dsh-obs-axis"
            x={at(time)}
            y={height - 5}
            textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
          >
            {clock(time)}
          </text>
        ))}
        {activity ? null : (
          <text
            className="dsh-obs-chart-empty"
            x={pad.left + plotWidth / 2}
            y={laneY(1.5)}
            textAnchor="middle"
          >
            {t('timeline.empty')}
          </text>
        )}
      </svg>
      <ol className="dsh-obs-turn-rows">
        {turns.map((turn, index) => (
          <li
            key={`${String(turn.turn)}:${String(index)}`}
            className="dsh-obs-turn-row"
            data-turn={turn.turn}
          >
            <span>{turn.rowLabel ?? `${t('timeline.turn')} ${String(turn.turn)}`}</span>
            <span>{formatDuration(turn.end - turn.start, t)}</span>
            <span>{counted(turn.stepsCount ?? turn.steps.length, t('timeline.step'))}</span>
            <span>{counted(turn.callsCount ?? turn.tools.length, t('timeline.call'))}</span>
            <span {...(turn.errors.length > 0 ? { 'data-tone': 'error' } : {})}>
              {counted(turn.errors.length, t('timeline.error'))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Event and error counts per range bucket, at most 24 px per bar. */
export function RangeSeries({
  labels,
  counts,
  errors,
  t,
}: {
  labels: readonly string[]
  counts: readonly number[]
  errors: readonly number[]
  t: Translate
}): ReactNode {
  const { ref: measureRef, width } = useChartWidth()
  const height = 140
  const pad = { left: 28, right: 10, top: 10, bottom: 22 }
  const plotWidth = Math.max(0, width - pad.left - pad.right)
  const plotHeight = height - pad.top - pad.bottom
  const baseline = pad.top + plotHeight
  const values = counts.map((count) => Math.max(0, count))
  const max = Math.max(1, ...values)
  const { band, bar, offset } = categoryBand(values.length, plotWidth, 24)
  const labelIndexes = [
    ...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1]),
  ].filter((index) => index >= 0 && index < labels.length)
  const empty = values.length === 0 || values.every((value) => value === 0)
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('series.title')}</h2>
        <div className="dsh-obs-legend">
          <span className="dsh-obs-legend-item">
            <i className="dsh-obs-swatch" data-tone="events" aria-hidden="true" />
            {t('legend.events')}
          </span>
          <span className="dsh-obs-legend-item">
            <i className="dsh-obs-swatch" data-tone="errors" aria-hidden="true" />
            {t('legend.errors')}
          </span>
        </div>
      </header>
      <svg
        ref={measureRef}
        className="dsh-obs-series-chart"
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={t('series.title')}
      >
        {values.map((count, index) => {
          const failed = Math.min(count, Math.max(0, errors[index] ?? 0))
          const totalHeight = (count / max) * plotHeight
          const errorHeight = (failed / max) * plotHeight
          const label = labels[index] ?? String(index + 1)
          const x = pad.left + index * band + offset
          return (
            <g key={`${label}:${String(index)}`}>
              <title>{`${label}: ${String(count)} ${t('chart.events')} · ${String(failed)} ${t('chart.errors')}`}</title>
              {count > failed ? (
                <rect
                  className="dsh-obs-bar"
                  data-tone="events"
                  x={x}
                  y={baseline - totalHeight + errorHeight}
                  width={bar}
                  height={totalHeight - errorHeight}
                />
              ) : null}
              {errorHeight > 0 ? (
                <rect
                  className="dsh-obs-bar"
                  data-tone="errors"
                  x={x}
                  y={baseline - totalHeight}
                  width={bar}
                  height={errorHeight}
                />
              ) : null}
            </g>
          )
        })}
        {labelIndexes.map((index) => (
          <text
            key={`label-${String(index)}`}
            className="dsh-obs-axis"
            x={pad.left + index * band + band / 2}
            y={height - 6}
            textAnchor={index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle'}
          >
            {labels[index] ?? ''}
          </text>
        ))}
        {empty ? (
          <text
            className="dsh-obs-chart-empty"
            x={pad.left + plotWidth / 2}
            y={pad.top + plotHeight / 2}
            textAnchor="middle"
          >
            {t('series.empty')}
          </text>
        ) : null}
      </svg>
    </section>
  )
}

/** One stacked inline SVG bar for the cache-read, input, and output token mix. */
export function TokenMix({
  cacheRead,
  input,
  output,
  t,
}: {
  cacheRead: number
  input: number
  output: number
  t: Translate
}): ReactNode {
  const parts = [
    { key: 'cacheRead', label: t('tokens.cacheRead'), value: Math.max(0, cacheRead) },
    { key: 'input', label: t('tokens.input'), value: Math.max(0, input) },
    { key: 'output', label: t('tokens.output'), value: Math.max(0, output) },
  ]
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  const share = (value: number): number => (total === 0 ? 0 : (value * 100) / total)
  let filled = 0
  const segments = parts.map((part) => {
    const before = filled
    filled += share(part.value)
    return { ...part, x: before, width: share(part.value) }
  })
  const caption = parts
    .map((part) => `${part.label} ${String(Math.round(share(part.value)))}%`)
    .join(' · ')
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('tokens.title')}</h2>
      </header>
      <div className="dsh-obs-token-track">
        <svg
          className="dsh-obs-token-bar"
          height={10}
          role="img"
          aria-label={`${t('tokens.title')}: ${caption}`}
        >
          {segments.map((segment) =>
            segment.width > 0 ? (
              <rect
                key={segment.key}
                data-tone={segment.key}
                x={`${String(segment.x)}%`}
                y={0}
                width={`${String(segment.width)}%`}
                height={10}
              />
            ) : null,
          )}
        </svg>
      </div>
      <p className="dsh-obs-token-caption">
        {parts.map((part, index) => (
          <span key={part.key} className="dsh-obs-token-key">
            {index > 0 ? ' · ' : ''}
            <i className="dsh-obs-swatch" data-tone={part.key} aria-hidden="true" />
            {`${part.label} ${String(Math.round(share(part.value)))}%`}
          </span>
        ))}
      </p>
      {total === 0 ? <p className="dsh-obs-muted">{t('tokens.empty')}</p> : null}
    </section>
  )
}

const EPISODE_OUTCOMES: readonly EpisodeOutcome[] = [
  'completed',
  'failed',
  'cut',
  'blocked',
  'other',
  'open',
]

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${String(Math.round(value * 100))}%`
}

function minutesText(value: number, t: Translate): string {
  return `${value.toFixed(1)} ${t('unit.minutes')}`
}

/** The section tabs: one Conversation view, four selectable bodies. */
export function SubViewTabs({
  view,
  t,
  onView,
}: {
  view: SubView
  t: Translate
  onView: (view: SubView) => void
}): ReactNode {
  const index = SUB_VIEWS.indexOf(view)
  const select = (next: number): void => {
    const option = SUB_VIEWS[(next + SUB_VIEWS.length) % SUB_VIEWS.length]
    if (option === undefined) return
    onView(option)
    // Roving focus: the newly selected tab keeps the arrow-key session alive.
    if (typeof document !== 'undefined') document.getElementById(`dsh-obs-tab-${option}`)?.focus()
  }
  return (
    <div className="dsh-obs-tabs" role="tablist" aria-label={t('tab.label')}>
      {SUB_VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          id={`dsh-obs-tab-${option}`}
          className="dsh-obs-tab"
          aria-selected={option === view}
          aria-controls={`dsh-obs-panel-${option}`}
          tabIndex={option === view ? 0 : -1}
          onClick={() => onView(option)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault()
              select(index + 1)
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault()
              select(index - 1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              select(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              select(SUB_VIEWS.length - 1)
            }
          }}
        >
          {t(SUB_VIEW_KEYS[option])}
        </button>
      ))}
    </div>
  )
}

/**
 * The data-sufficiency verdict. Thin data, missing usage, or an unknown
 * comparison never reads sufficient, and the view never says healthy here.
 */
export function sufficiency(report: Report): 'insufficient' | 'partial' | 'sufficient' {
  const data = report.dataQuality
  if (report.quality.episodes < report.minEpisodes) return 'insufficient'
  // A declared-eligible plugin that matched no episode is not sufficient.
  const silent = report.rows.filter((row) => row.group === 'plugin' && row.status === 'silent')
  const emptyEligibility = silent.some((row) => {
    const card = report.scorecards.find((entry) => entry.rowId === row.id)
    return card !== undefined && card.eligibilityDeclared && card.eligible === 0
  })
  if (emptyEligibility) return 'insufficient'
  if (data.steps === 0 || data.messages === 0) return 'partial'
  if (data.stepsWithUsage < data.steps || data.messagesWithUsage < data.messages) return 'partial'
  if (data.unlinkedChildren > 0 || data.unmappedClosers > 0) return 'partial'
  return 'sufficient'
}

/** The verdict banner: a word first, colour second. */
export function DataSufficiency({ report, t }: { report: Report; t: Translate }): ReactNode {
  const status = sufficiency(report)
  const data = report.dataQuality
  return (
    <section
      className="dsh-obs-health"
      data-tone={status === 'sufficient' ? 'ok' : 'attention'}
      data-sufficiency={status}
      aria-label={t('verdict.title')}
    >
      <span className="dsh-obs-health-dot" aria-hidden="true" />
      <div className="dsh-obs-health-text">
        <strong>{t(`verdict.${status}`)}</strong>
        <span>
          {`${String(report.quality.episodes)} ${t('verdict.episodes')} ${t('verdict.of')} ${String(report.minEpisodes)}`}
        </span>
        <span>{`${String(Math.round(data.usageCoverage * 100))}% ${t('verdict.coverage')}`}</span>
        <span>
          {counted(report.failureTotals.total, t('health.failure'), t('health.failures'))}
        </span>
      </div>
    </section>
  )
}

interface Tile {
  readonly key: string
  readonly label: string
  readonly n: number
  readonly values: ReadonlyArray<{ readonly label: string; readonly value: string }>
  readonly note?: string
}

/** Quality, cost, speed, and autonomy with their sample size and p50/p90. */
export function OutcomeTiles({ report, t }: { report: Report; t: Translate }): ReactNode {
  const quality = report.quality
  const cost = report.cost
  const speed = report.speed
  const autonomy = report.autonomy
  const tiles: readonly Tile[] = [
    {
      key: 'quality',
      label: t('tile.quality'),
      n: quality.episodes,
      values: [
        { label: t('tile.verified'), value: percent(quality.verifiedShare) },
        { label: t('tile.failed'), value: percent(quality.failureRate) },
        { label: t('tile.completed'), value: String(quality.completed) },
        {
          label: t('tile.p50'),
          value:
            quality.stepsToCompletion.n === 0
              ? '—'
              : `${String(Math.round(quality.stepsToCompletion.p50))} ${t('unit.steps')}`,
        },
        {
          label: t('tile.p90'),
          value:
            quality.stepsToCompletion.n === 0
              ? '—'
              : `${String(Math.round(quality.stepsToCompletion.p90))} ${t('unit.steps')}`,
        },
      ],
      note: `${t('tile.n')} ${String(quality.stepsToCompletion.n)} ${t('tile.completed')}`,
    },
    {
      key: 'cost',
      label: t('tile.cost'),
      n: cost.tokensPerEpisode.n,
      values: [
        { label: t('tile.p50'), value: String(Math.round(cost.tokensPerEpisode.p50)) },
        { label: t('tile.p90'), value: String(Math.round(cost.tokensPerEpisode.p90)) },
        { label: t('tile.cacheHit'), value: percent(cost.cacheHitRatio) },
        { label: t('tile.contextPerStep'), value: String(Math.round(cost.contextPerStep)) },
      ],
      note: `${t('tile.cutoff')}: ${t(cost.cutoffLabel === 'through cutoff' ? 'cutoff.through' : 'cutoff.full')}`,
    },
    {
      key: 'speed',
      label: t('tile.speed'),
      n: speed.n,
      values: [
        { label: t('tile.p50'), value: minutesText(speed.activeMinutes.p50, t) },
        { label: t('tile.p90'), value: minutesText(speed.activeMinutes.p90, t) },
      ],
    },
    {
      key: 'autonomy',
      label: t('tile.autonomy'),
      n: autonomy.episodes,
      values: [
        {
          label: t('tile.p50'),
          value: `${autonomy.stepsPerHumanMessage.p50.toFixed(1)} ${t('unit.steps')}`,
        },
        {
          label: t('tile.p90'),
          value: `${autonomy.stepsPerHumanMessage.p90.toFixed(1)} ${t('unit.steps')}`,
        },
      ],
      note: `${String(autonomy.humanMessages)} ${t('tile.humanMessages')}`,
    },
  ]
  return (
    <section className="dsh-obs-section" aria-label={t('tiles.title')}>
      <h2>{t('tiles.title')}</h2>
      <div className="dsh-obs-tiles">
        {tiles.map((tile) => (
          <article key={tile.key} className="dsh-obs-tile" data-tile={tile.key}>
            <header className="dsh-obs-tile-head">
              <span>{tile.label}</span>
              <span className="dsh-obs-muted">{`${t('tile.n')} ${String(tile.n)}`}</span>
            </header>
            <dl>
              {tile.values.map((value) => (
                <div key={value.label}>
                  <dt>{value.label}</dt>
                  <dd>{value.value}</dd>
                </div>
              ))}
            </dl>
            {tile.note === undefined ? null : (
              <p className="dsh-obs-muted dsh-obs-tile-note">{tile.note}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

/** The previous window or session beside the current outcome metrics. */
export function BaselineStrip({ report, t }: { report: Report; t: Translate }): ReactNode {
  const baseline = report.baseline
  const format = (
    value: number | undefined,
    kind: 'percent' | 'number' | 'minutes' | 'decimal',
  ): string => {
    if (value === undefined) return '—'
    if (kind === 'percent') return percent(value)
    if (kind === 'minutes') return minutesText(value, t)
    if (kind === 'decimal') return value.toFixed(1)
    return String(Math.round(value))
  }
  if (baseline === undefined) {
    return (
      <section className="dsh-obs-panel" aria-label={t('baseline.title')} data-baseline="none">
        <header className="dsh-obs-panel-head">
          <h2>{t('baseline.title')}</h2>
        </header>
        <p className="dsh-obs-muted">{t('baseline.none')}</p>
      </section>
    )
  }
  const rows = [
    {
      key: 'verified',
      label: t('baseline.verified'),
      current: report.quality.verifiedShare,
      previous: baseline.quality.verifiedShare,
      kind: 'percent' as const,
    },
    {
      key: 'failure',
      label: t('baseline.failure'),
      current: report.quality.failureRate,
      previous: baseline.quality.failureRate,
      kind: 'percent' as const,
    },
    {
      key: 'tokens',
      label: t('baseline.tokens'),
      current: report.cost.tokensPerEpisode.p50,
      previous: baseline.cost.tokensPerEpisode.p50,
      kind: 'number' as const,
    },
    {
      key: 'active',
      label: t('baseline.active'),
      current: report.speed.activeMinutes.p50,
      previous: baseline.speed.activeMinutes.p50,
      kind: 'minutes' as const,
    },
    {
      key: 'steps',
      label: t('baseline.steps'),
      current: report.autonomy.stepsPerHumanMessage.p50,
      previous: baseline.autonomy.stepsPerHumanMessage.p50,
      kind: 'decimal' as const,
    },
  ]
  const insufficient =
    report.quality.episodes < report.minEpisodes || baseline.episodes < report.minEpisodes
  const deltaText = (row: (typeof rows)[number]): string | undefined => {
    if (row.current === undefined || row.previous === undefined) return undefined
    const diff = row.current - row.previous
    const sign = diff >= 0 ? '+' : '−'
    const value =
      row.kind === 'percent'
        ? `${sign}${String(Math.round(Math.abs(diff) * 100))} ${t('scorecard.points')}`
        : row.kind === 'number'
          ? `${sign}${String(Math.round(Math.abs(diff)))}`
          : row.kind === 'minutes'
            ? `${sign}${Math.abs(diff).toFixed(1)} ${t('unit.minutes')}`
            : `${sign}${Math.abs(diff).toFixed(1)}`
    return `${t('baseline.delta')} ${value}`
  }
  return (
    <section
      className="dsh-obs-panel"
      aria-label={t('baseline.title')}
      data-baseline={baseline.kind}
      data-insufficient={insufficient ? 'true' : undefined}
    >
      <header className="dsh-obs-panel-head">
        <h2>{t('baseline.title')}</h2>
        <span className="dsh-obs-muted">
          {t(
            baseline.kind === 'previous equal window'
              ? 'baseline.previousWindow'
              : 'baseline.previousSession',
          )}
        </span>
      </header>
      <p className="dsh-obs-muted">
        {`${t('baseline.n')} ${String(report.quality.episodes)} ${t('baseline.current')} · ${String(baseline.episodes)} ${t('baseline.previous')}`}
      </p>
      <dl className="dsh-obs-compare">
        {rows.map((row) => {
          const delta = deltaText(row)
          return (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>
                {`${format(row.current, row.kind)} ${t('baseline.current')} · ${format(row.previous, row.kind)} ${t('baseline.previous')}${delta === undefined ? '' : ` · ${delta}`}`}
              </dd>
            </div>
          )
        })}
      </dl>
      {insufficient ? <p className="dsh-obs-muted">{t('scorecard.insufficientNote')}</p> : null}
      <p className="dsh-obs-muted">{t('baseline.association')}</p>
    </section>
  )
}

/** The session range draws against time; wider ranges draw their time buckets. */
export function ActivityPanel({ report, t }: { report: Report; t: Translate }): ReactNode {
  if (report.range === 'session' && report.timeline !== undefined) {
    const timeline = report.timeline
    return (
      <SessionTimeline
        from={timeline.from}
        to={timeline.to}
        turns={timeline.turns.map((turn) => ({
          turn: turn.turn,
          start: turn.start,
          end: turn.end,
          steps: turn.steps,
          tools: turn.tools,
          human: turn.human,
          errors: turn.errors,
          stepsCount: turn.stepsCount,
          callsCount: turn.callsCount,
        }))}
        t={t}
      />
    )
  }
  return (
    <RangeSeries
      labels={report.bucketLabels}
      counts={report.activity}
      errors={report.errorSeries}
      t={t}
    />
  )
}

/** The coverage behind every metric, stated rather than hidden. */
export function DataQualityStrip({ report, t }: { report: Report; t: Translate }): ReactNode {
  const data = report.dataQuality
  const facts: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: t('dq.steps'), value: `${String(data.stepsWithUsage)}/${String(data.steps)}` },
    {
      label: t('dq.messages'),
      value: `${String(data.messagesWithUsage)}/${String(data.messages)}`,
    },
    { label: t('dq.episodes'), value: String(data.episodes) },
    { label: t('dq.children'), value: String(data.linkedChildren) },
    { label: t('dq.unlinked'), value: String(data.unlinkedChildren) },
    { label: t('dq.goals'), value: String(data.goalEvents) },
    { label: t('dq.checkpoints'), value: String(data.checkpoints) },
    { label: t('dq.unmapped'), value: String(data.unmappedClosers) },
    { label: t('dq.comparison'), value: String(data.comparisonSample) },
  ]
  const partial =
    data.stepsWithUsage < data.steps ||
    data.messagesWithUsage < data.messages ||
    data.unlinkedChildren > 0 ||
    data.unmappedClosers > 0
  return (
    <section className="dsh-obs-panel" aria-label={t('dq.title')}>
      <header className="dsh-obs-panel-head">
        <h2>{t('dq.title')}</h2>
      </header>
      <ul className="dsh-obs-dq">
        {facts.map((fact) => (
          <li key={fact.label}>
            <span>{fact.label}</span>
            <span>{fact.value}</span>
          </li>
        ))}
      </ul>
      {partial ? <p className="dsh-obs-muted">{t('dq.partial')}</p> : null}
    </section>
  )
}

/** The scorecard's one-word state; a zero eligible set is not applicable, not silent. */
export function scorecardStatus(card: Scorecard): ScorecardStatus {
  if (card.eligible === 0) return 'not applicable'
  if (card.fired === 0) return 'silent'
  if ((card.errorRate ?? 0) > 0) return 'error'
  if (card.insufficient) return 'insufficient'
  return 'active'
}

/** A two-bar treated/control comparison; the scorecard has no time series. */
function ScoreBars({
  treated,
  control,
  t,
}: {
  treated: number | undefined
  control: number | undefined
  t: Translate
}): ReactNode {
  // An undefined share is unavailable, never a zero-percent result.
  if (treated === undefined || control === undefined) {
    return <p className="dsh-obs-muted">{t('scorecard.unavailable')}</p>
  }
  const values = [control, treated]
  const labels = [t('bar.control'), t('bar.treated')]
  const max = Math.max(1, ...values)
  return (
    <svg
      className="dsh-obs-spark"
      viewBox="0 0 120 24"
      role="img"
      aria-label={t('scorecard.primary')}
    >
      {values.map((value, index) => (
        <g key={labels[index] ?? String(index)}>
          <title>{`${labels[index] ?? ''}: ${percent(value)}`}</title>
          <rect
            x={index * 60 + 8}
            y={24 - (value / max) * 22}
            width={44}
            height={(value / max) * 22}
          />
        </g>
      ))}
    </svg>
  )
}

/** One plugin scorecard: goal, state, activation, comparison, samples, association. */
export function ScorecardCard({
  card,
  t,
  onOpenRow,
}: {
  card: Scorecard
  t: Translate
  onOpenRow?: (rowId: string) => void
}): ReactNode {
  const status = scorecardStatus(card)
  const treated = card.treated.verifiedShare
  const control = card.control.verifiedShare
  const delta = treated === undefined || control === undefined ? undefined : treated - control
  const activation = card.activation === undefined ? '—' : percent(card.activation)
  return (
    <article className="dsh-obs-card" data-card={card.rowId} data-status={status}>
      <header className="dsh-obs-card-head">
        <span className="dsh-obs-card-name">{card.label}</span>
        <span className="dsh-obs-pill" data-status={status}>
          {t(SCORECARD_STATUS_KEYS[status])}
        </span>
      </header>
      <p className="dsh-obs-score-goal">{`${t('scorecard.goal')}: ${card.goal ?? t('scorecard.noGoal')}`}</p>
      <div className="dsh-obs-card-metrics">
        <span>{`${t('scorecard.activation')} ${activation}`}</span>
        <span>
          {`${String(card.fired)} ${t('scorecard.of')} ${String(card.eligible)} ${t('scorecard.eligible')}`}
        </span>
        {card.errorRate === undefined ? null : (
          <span className="dsh-obs-err">
            {`${t('scorecard.errorRate')} ${percent(card.errorRate)}`}
          </span>
        )}
      </div>
      {card.firedOutside > 0 ? (
        <p className="dsh-obs-err">
          {`${String(card.firedOutside)} ${t('scorecard.firedOutside')}`}
        </p>
      ) : null}
      <div className="dsh-obs-card-metrics">
        <span>{t('scorecard.primary')}</span>
        <span>
          {treated === undefined
            ? t('scorecard.primaryNone')
            : `${percent(treated)} ${t('scorecard.of')} ${percent(control)}`}
        </span>
        {delta === undefined ? null : (
          <span>{`${t('scorecard.delta')} ${delta >= 0 ? '+' : '−'}${String(Math.round(Math.abs(delta) * 100))} ${t('scorecard.points')}`}</span>
        )}
      </div>
      <ScoreBars treated={treated} control={control} t={t} />
      <p className="dsh-obs-muted">
        {`${t('scorecard.n')} ${String(card.treated.n)} ${t('scorecard.treated')} · ${String(card.control.n)} ${t('scorecard.control')}`}
      </p>
      <p className="dsh-obs-muted">
        {`${t('scorecard.matching')}${card.weekRelaxed ? ` · ${t('scorecard.relaxed')}` : ''}`}
      </p>
      {card.insufficient ? (
        <p className="dsh-obs-muted">{t('scorecard.insufficientNote')}</p>
      ) : null}
      {card.eligibilityDeclared ? null : (
        <p className="dsh-obs-muted">{t('scorecard.noEligibility')}</p>
      )}
      <p className="dsh-obs-muted">{card.association}</p>
      {onOpenRow === undefined ? null : (
        <button type="button" className="dsh-obs-link" onClick={() => onOpenRow(card.rowId)}>
          {t('scorecard.rowDetail')}
        </button>
      )}
    </article>
  )
}

/** Every configured signal row's scorecard. */
export function ScorecardList({
  scorecards,
  t,
  onOpenRow,
}: {
  scorecards: readonly Scorecard[]
  t: Translate
  onOpenRow?: (rowId: string) => void
}): ReactNode {
  if (scorecards.length === 0) {
    return (
      <section className="dsh-obs-section">
        <h2>{t('scorecards.title')}</h2>
        <p className="dsh-obs-muted">{t('scorecards.empty')}</p>
      </section>
    )
  }
  return (
    <section className="dsh-obs-section" aria-label={t('scorecards.title')}>
      <h2>{t('scorecards.title')}</h2>
      <div className="dsh-obs-grid">
        {scorecards.map((card) => (
          <ScorecardCard key={card.rowId} card={card} t={t} onOpenRow={onOpenRow} />
        ))}
      </div>
    </section>
  )
}

/** The columns the Tasks table sorts by. */
export type TaskSortKey =
  | 'start'
  | 'stepsPerHuman'
  | 'steps'
  | 'tokens'
  | 'active'
  | 'outcome'
  | 'verified'
  | 'subagents'
  | 'goal'
  | 'failures'

/** The current Tasks table order. */
export interface TaskSort {
  readonly key: TaskSortKey
  readonly direction: 1 | -1
}

const TASK_COLUMNS: ReadonlyArray<{ readonly key: TaskSortKey; readonly label: string }> = [
  { key: 'start', label: 'tasks.columnDate' },
  { key: 'stepsPerHuman', label: 'tasks.columnStepsPerHuman' },
  { key: 'steps', label: 'tasks.columnSteps' },
  { key: 'tokens', label: 'tasks.columnTokens' },
  { key: 'active', label: 'tasks.columnActive' },
  { key: 'outcome', label: 'tasks.columnOutcome' },
  { key: 'verified', label: 'tasks.columnVerified' },
  { key: 'subagents', label: 'tasks.columnSubagents' },
  { key: 'goal', label: 'tasks.columnGoal' },
  { key: 'failures', label: 'tasks.columnFailures' },
]

function stepsPerHuman(episode: EpisodeReport): number {
  return episode.humanMessages === 0 ? 0 : episode.steps / episode.humanMessages
}

function taskSortValue(episode: EpisodeReport, key: TaskSortKey): number | string {
  switch (key) {
    case 'stepsPerHuman':
      return stepsPerHuman(episode)
    case 'steps':
      return episode.steps
    case 'tokens':
      return episode.throughCutoffUsage.total
    case 'active':
      return episode.activeMs
    case 'outcome':
      return episode.outcome
    case 'verified':
      return episode.verified ? 1 : 0
    case 'subagents':
      return episode.children.length
    case 'goal':
      return episode.goals.created
    case 'failures':
      return episode.failures
    default:
      return episode.start
  }
}

/** Sort, filter, and cap the episode list; the table never renders more than its bound. */
export function visibleEpisodes(
  episodes: readonly EpisodeReport[],
  outcome: EpisodeOutcome | 'all',
  plugin: string | 'all',
  sort: TaskSort,
): EpisodeReport[] {
  const filtered = episodes
    .filter((episode) => outcome === 'all' || episode.outcome === outcome)
    .filter((episode) => plugin === 'all' || episode.firedRows.includes(plugin))
  filtered.sort((left, right) => {
    const a = taskSortValue(left, sort.key)
    const b = taskSortValue(right, sort.key)
    const order =
      typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b)
    return order * sort.direction || left.start - right.start
  })
  return filtered.slice(0, EPISODE_TABLE_LIMIT)
}

/** One episode's metadata, its whole cost labelled, and its own lane timeline. */
export function EpisodeDetail({
  episode,
  t,
  onClose,
}: {
  episode: EpisodeReport
  t: Translate
  onClose: () => void
}): ReactNode {
  const lane = episode.timeline
  const turns: readonly TimelineTurn[] = [
    {
      turn: 1,
      start: lane.from,
      end: lane.to,
      steps: lane.steps,
      tools: lane.tools,
      human: lane.human,
      errors: lane.errors,
      stepsCount: lane.stepsCount,
      callsCount: lane.callsCount,
      rowLabel: t('tasks.episodeSpan'),
    },
  ]
  const perStep =
    episode.steps === 0 ? 0 : Math.round(episode.usage.total / Math.max(1, episode.steps))
  return (
    <section
      className="dsh-obs-panel"
      aria-label={t('tasks.detail')}
      data-episode-detail={episode.id}
    >
      <header className="dsh-obs-panel-head">
        <h2>{`${t('tasks.detail')} · ${episode.sessionTitle ?? shortSessionId(episode.sessionId)}`}</h2>
        <button type="button" className="dsh-obs-link" onClick={onClose}>
          {t('tasks.close')}
        </button>
      </header>
      <p className="dsh-obs-muted">
        {`${formatTime(episode.start)} – ${formatTime(episode.end)} · ${formatDuration(episode.durationMs, t)}`}
      </p>
      <dl className="dsh-obs-facts">
        <div>
          <dt>{t('tasks.span')}</dt>
          <dd>{formatDuration(episode.durationMs, t)}</dd>
        </div>
        <div>
          <dt>{t('tasks.tokenPerStep')}</dt>
          <dd>{String(perStep)}</dd>
        </div>
        <div>
          <dt>{`${t('tasks.throughCutoff')} (${t('cutoff.through')})`}</dt>
          <dd>{String(episode.throughCutoffUsage.total)}</dd>
        </div>
        <div>
          <dt>{`${t('tasks.fullEpisode')} (${t('cutoff.full')})`}</dt>
          <dd>{String(episode.fullUsage.total)}</dd>
        </div>
        <div>
          <dt>{t('tasks.delegateCalls')}</dt>
          <dd>{String(episode.delegateCalls)}</dd>
        </div>
        <div>
          <dt>{t('tasks.parallelWidth')}</dt>
          <dd>{String(episode.parallelWidth)}</dd>
        </div>
        <div>
          <dt>{t('tasks.parentWait')}</dt>
          <dd>{formatDuration(episode.parentWaitMs, t)}</dd>
        </div>
        <div>
          <dt>{t('tasks.goalsRow')}</dt>
          <dd>
            {`${String(episode.goals.created)} ${t('tasks.created')} · ${String(episode.goals.completed)} ${t('tasks.completed')} · ${String(episode.goals.rounds)} ${t('tasks.rounds')}${episode.goals.phase === undefined ? '' : ` · ${episode.goals.phase}`}`}
          </dd>
        </div>
        <div>
          <dt>{t('tasks.checkpoints')}</dt>
          <dd>
            {`${String(episode.checkpoints.total)} ${t('tasks.checkpointTotal')} · ${String(episode.checkpoints.closes)} ${t('tasks.checkpointCloses')} · ${String(episode.checkpoints.verified)} ${t('tasks.checkpointVerified')}`}
          </dd>
        </div>
      </dl>
      <h3>{t('tasks.subagents')}</h3>
      {episode.children.length === 0 ? (
        <p className="dsh-obs-muted">{t('tasks.noChildren')}</p>
      ) : (
        <ul className="dsh-obs-dq">
          {episode.children.map((child) => (
            <li key={child.sessionId}>
              <span>
                {`${child.sessionTitle ?? shortSessionId(child.sessionId)} · ${t(OUTCOME_KEYS[child.outcome])}${child.verified ? ` · ${t('tasks.verifiedYes')}` : ''}`}
              </span>
              <span>
                {`${String(child.toolCalls)} ${t('kpi.toolCall')} · ${String(child.usage.total)} ${t('unit.tokens')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SessionTimeline from={lane.from} to={lane.to} turns={turns} t={t} />
    </section>
  )
}

/** The Tasks tab: a sortable episode table, its filters, and one selected detail. */
export function TasksView({
  report,
  t,
  sort,
  outcome,
  plugin,
  selectedId,
  onSort,
  onOutcome,
  onPlugin,
  onSelect,
}: {
  report: Report
  t: Translate
  sort: TaskSort
  outcome: EpisodeOutcome | 'all'
  plugin: string | 'all'
  selectedId?: string
  onSort: (key: TaskSortKey) => void
  onOutcome: (outcome: EpisodeOutcome | 'all') => void
  onPlugin: (rowId: string | 'all') => void
  onSelect: (id: string | undefined) => void
}): ReactNode {
  const rows = visibleEpisodes(report.episodes, outcome, plugin, sort)
  const selected =
    selectedId === undefined
      ? undefined
      : report.episodes.find((episode) => episode.id === selectedId)
  return (
    <>
      <section className="dsh-obs-panel" aria-label={t('tasks.title')}>
        <header className="dsh-obs-panel-head">
          <h2>{t('tasks.title')}</h2>
          {report.episodes.length > EPISODE_TABLE_LIMIT ||
          report.episodeCount > EPISODE_TABLE_LIMIT ? (
            <span className="dsh-obs-muted">
              {`${t('tasks.capped')} ${String(rows.length)} ${t('failure.of')} ${String(report.episodeCount)}`}
            </span>
          ) : (
            <span className="dsh-obs-muted">
              {`${String(rows.length)} ${t('failure.of')} ${String(report.episodeCount)}`}
            </span>
          )}
        </header>
        <div className="dsh-obs-task-controls">
          <label>
            {t('tasks.outcome')}
            <select
              value={outcome}
              onChange={(event) => onOutcome(event.currentTarget.value as EpisodeOutcome | 'all')}
            >
              <option value="all">{t('tasks.allOutcomes')}</option>
              {EPISODE_OUTCOMES.map((option) => (
                <option key={option} value={option}>
                  {t(OUTCOME_KEYS[option])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('tasks.plugin')}
            <select value={plugin} onChange={(event) => onPlugin(event.currentTarget.value)}>
              <option value="all">{t('tasks.allPlugins')}</option>
              {report.scorecards.map((card) => (
                <option key={card.rowId} value={card.rowId}>
                  {card.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="dsh-obs-muted">{t('tasks.empty')}</p>
        ) : (
          <div className="dsh-obs-table-wrap">
            <table className="dsh-obs-table">
              <thead>
                <tr>
                  {TASK_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={
                        sort.key === column.key
                          ? sort.direction === 1
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button type="button" onClick={() => onSort(column.key)}>
                        {t(column.label)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((episode) => (
                  <tr
                    key={episode.id}
                    data-episode={episode.id}
                    data-outcome={episode.outcome}
                    data-selected={selectedId === episode.id ? 'true' : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className="dsh-obs-link"
                        onClick={() => onSelect(episode.id)}
                      >
                        {`${new Date(episode.start).toLocaleDateString()} · ${episode.sessionTitle ?? shortSessionId(episode.sessionId)}`}
                      </button>
                    </td>
                    <td>{stepsPerHuman(episode).toFixed(1)}</td>
                    <td>{String(episode.steps)}</td>
                    <td>{String(episode.throughCutoffUsage.total)}</td>
                    <td>{minutesText(episode.activeMs / 60_000, t)}</td>
                    <td>{t(OUTCOME_KEYS[episode.outcome])}</td>
                    <td>{episode.verified ? t('tasks.verifiedYes') : t('tasks.verifiedNo')}</td>
                    <td>{String(episode.children.length)}</td>
                    <td>
                      {episode.goals.created === 0
                        ? '—'
                        : `${String(episode.goals.created)} · ${episode.goals.phase ?? t('tasks.phase')}`}
                    </td>
                    <td>{String(episode.failures)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected === undefined ? null : (
        <EpisodeDetail episode={selected} t={t} onClose={() => onSelect(undefined)} />
      )}
    </>
  )
}

function metricText(metric: HypothesisMetric, value: number | undefined, t: Translate): string {
  if (value === undefined) return '—'
  switch (metric) {
    case 'verified-completion-rate':
    case 'delegate-rate':
    case 'checkpoint-coverage':
    case 'failure-rate':
      return `${String(Math.round(value * 100))}%`
    case 'active-minutes-per-episode':
      return minutesText(value, t)
    case 'tokens-per-episode':
    case 'context-tokens-per-step':
      return String(Math.round(value))
    default:
      return value.toFixed(1)
  }
}

/** Copy output of the Hypotheses tab: one metadata line per hypothesis. */
export function hypothesisCopyText(results: readonly HypothesisResult[], t: Translate): string {
  return results
    .map((result) => {
      const parts = [
        t(METRIC_KEYS[result.metric]),
        t(HYPOTHESIS_STATUS_KEYS[result.status]),
        `${t('hypothesis.baseline')} ${metricText(result.metric, result.baseline, t)}`,
        `${t('hypothesis.current')} ${metricText(result.metric, result.current, t)}`,
        `${t('hypothesis.threshold')} ${metricText(result.metric, result.threshold, t)}`,
        `${t('hypothesis.samples')} ${String(result.samples)}/${String(result.minSamples)}`,
        `${t('hypothesis.window')} ${t(`range.${result.window}`)}`,
      ]
      if (result.guardrail !== undefined) {
        parts.push(
          `${t('hypothesis.guardrail')} ${t(METRIC_KEYS[result.guardrail.metric])}${result.guardrail.regressed ? ` · ${t('hypothesis.regressed')}` : ''}`,
        )
      }
      parts.push(t('hypothesis.association'))
      return parts.join(' · ')
    })
    .join('\n')
}

/** One hypothesis result as a card; nothing here executes its text. */
function HypothesisCard({ result, t }: { result: HypothesisResult; t: Translate }): ReactNode {
  const guardrail = result.guardrail
  return (
    <article className="dsh-obs-hypo" data-status={result.status} data-hypothesis={result.index}>
      <header className="dsh-obs-card-head">
        <span className="dsh-obs-card-name">
          {result.description ?? t(METRIC_KEYS[result.metric])}
        </span>
        <span className="dsh-obs-pill" data-status={result.status}>
          {t(HYPOTHESIS_STATUS_KEYS[result.status])}
        </span>
      </header>
      {result.description === undefined ? null : (
        <p className="dsh-obs-muted">{t(METRIC_KEYS[result.metric])}</p>
      )}
      <dl className="dsh-obs-facts">
        <div>
          <dt>{t('hypothesis.baseline')}</dt>
          <dd>
            {result.baseline === undefined
              ? t('hypothesis.noBaseline')
              : metricText(result.metric, result.baseline, t)}
          </dd>
        </div>
        <div>
          <dt>{t('hypothesis.current')}</dt>
          <dd>{metricText(result.metric, result.current, t)}</dd>
        </div>
        <div>
          <dt>{t('hypothesis.threshold')}</dt>
          <dd>{metricText(result.metric, result.threshold, t)}</dd>
        </div>
        <div>
          <dt>{t('hypothesis.samples')}</dt>
          <dd>{`${String(result.samples)}/${String(result.minSamples)}`}</dd>
        </div>
        {result.baselineSamples === undefined ? null : (
          <div>
            <dt>{`${t('hypothesis.samples')} (${t('baseline.previous')})`}</dt>
            <dd>{`${String(result.baselineSamples)}/${String(result.minSamples)}`}</dd>
          </div>
        )}
        <div>
          <dt>{t('hypothesis.window')}</dt>
          <dd>{t(`range.${result.window}`)}</dd>
        </div>
        {guardrail === undefined ? null : (
          <div>
            <dt>{t('hypothesis.guardrail')}</dt>
            <dd>
              {`${t(METRIC_KEYS[guardrail.metric])} ${metricText(guardrail.metric, guardrail.current, t)}${guardrail.regressed ? ` · ${t('hypothesis.regressed')}` : ''}`}
            </dd>
          </div>
        )}
      </dl>
      {result.status === 'collecting' ? (
        <p className="dsh-obs-muted">
          {`${t('hypothesis.collecting')} · ${String(result.samples)} ${t('verdict.of')} ${String(result.minSamples)}`}
        </p>
      ) : null}
      {guardrail?.regressed === true ? (
        <p className="dsh-obs-err">{t('hypothesis.regressedBlock')}</p>
      ) : null}
      <p className="dsh-obs-muted">{t('hypothesis.association')}</p>
    </article>
  )
}

/** The Hypotheses tab: declarative results with their samples and window. */
export function HypothesesView({ report, t }: { report: Report; t: Translate }): ReactNode {
  const results = report.hypotheses
  if (results.length === 0) {
    return (
      <section className="dsh-obs-panel" aria-label={t('hypothesis.title')}>
        <header className="dsh-obs-panel-head">
          <h2>{t('hypothesis.title')}</h2>
        </header>
        <p className="dsh-obs-muted">{t('hypothesis.empty')}</p>
      </section>
    )
  }
  return (
    <section className="dsh-obs-section" aria-label={t('hypothesis.title')}>
      <header className="dsh-obs-panel-head">
        <h2>{t('hypothesis.title')}</h2>
        <button
          type="button"
          className="dsh-obs-link"
          onClick={() => copyText(hypothesisCopyText(results, t))}
        >
          {t('hypothesis.copy')}
        </button>
      </header>
      <div className="dsh-obs-hypo-list">
        {results.map((result) => (
          <HypothesisCard key={result.index} result={result} t={t} />
        ))}
      </div>
    </section>
  )
}

/** Attention findings: what happened and the next action. Never a health claim. */
export function FindingsStrip({
  findings,
  t,
}: {
  findings: readonly Finding[]
  t: Translate
}): ReactNode {
  if (findings.length === 0) return null
  return (
    <section className="dsh-obs-findings" aria-label={t('findings.title')}>
      <h2>{t('findings.title')}</h2>
      <ul>
        {findings.map((finding) => (
          <li key={finding.id} data-finding={finding.id}>
            <strong>{finding.title}</strong>
            <span>{finding.evidence}</span>
            <span className="dsh-obs-muted">{finding.nextAction}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The Overview: verdict, findings, outcome tiles, charts, scorecards, and failure access. */
export function OverviewView({
  report,
  t,
  failuresOpen,
  failureFilter,
  onToggleFailures,
  onRevealFailures,
  onClearFilter,
  onOpenFailure,
  canOpenFailure,
  onFix,
  onOpenRow,
}: {
  report: Report
  t: Translate
  failuresOpen: boolean
  failureFilter?: string
  onToggleFailures: (open: boolean) => void
  onRevealFailures: () => void
  onClearFilter: () => void
  onOpenFailure?: (failure: FailureEntry) => void
  canOpenFailure?: (failure: FailureEntry) => boolean
  onFix?: () => void
  onOpenRow?: (rowId: string) => void
}): ReactNode {
  const silent = report.rows.filter((row) => row.group === 'plugin' && row.status === 'silent')
  const silentIds = new Set(silent.map((row) => row.id))
  return (
    <>
      <DataSufficiency report={report} t={t} />
      <FindingsStrip findings={report.findings} t={t} />
      <KpiStrip
        report={report}
        t={t}
        failuresOpen={failuresOpen}
        onRevealFailures={report.failureTotals.total === 0 ? undefined : onRevealFailures}
      />
      <div className="dsh-obs-columns">
        <OutcomeTiles report={report} t={t} />
        <BaselineStrip report={report} t={t} />
        <TokenMix
          cacheRead={report.cost.cacheRead}
          input={report.cost.input}
          output={report.cost.output}
          t={t}
        />
        <ActivityPanel report={report} t={t} />
        <DataQualityStrip report={report} t={t} />
        <ScorecardList
          scorecards={report.scorecards.filter((card) => !silentIds.has(card.rowId))}
          t={t}
          onOpenRow={onOpenRow}
        />
        <SilentRows rows={silent} report={report} t={t} />
        <ToolsPanel outcomes={report.toolOutcomes} t={t} />
        <SignalsPanel rows={report.rows} t={t} />
      </div>
      <FailureList
        failures={report.failures}
        totals={report.failureTotals}
        t={t}
        open={failuresOpen}
        onToggle={onToggleFailures}
        {...(onOpenFailure === undefined ? {} : { onOpen: onOpenFailure })}
        {...(canOpenFailure === undefined ? {} : { canOpen: canOpenFailure })}
        {...(onFix === undefined ? {} : { onFix })}
        {...(failureFilter === undefined ? {} : { filterTool: failureFilter })}
        onClearFilter={onClearFilter}
      />
    </>
  )
}

/** One status pill: the word is always visible, colour is secondary. */
export function StatusPill({ row, t }: { row: ReportRow; t: Translate }): ReactNode {
  if (row.kind === 'guidance') {
    const readiness = row.readiness
    return (
      <span className="dsh-obs-pill" data-status="guidance" data-readiness={readiness}>
        {readiness === undefined ? t('status.guidance') : t(READINESS_KEYS[readiness])}
      </span>
    )
  }
  const status = row.status ?? 'silent'
  return (
    <span className="dsh-obs-pill" data-status={status}>
      {t(`status.${status}`)}
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
  onShowFailures,
  focused,
}: {
  row: ReportRow
  t: Translate
  now: number
  onShowFailures?: (tool?: string) => void
  focused?: boolean
}): ReactNode {
  const silent = row.status === 'silent' || row.status === 'not loaded'
  const lastFailure = row.lastFailure
  return (
    <article
      className="dsh-obs-card"
      data-status={row.status}
      data-focus={focused === true ? 'true' : undefined}
    >
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
      {lastFailure === undefined ? null : (
        <p className="dsh-obs-card-failure">
          <span className="dsh-obs-muted">
            {[lastFailure.tool, lastFailure.errorName, lastFailure.errorCode]
              .filter((value): value is string => value !== undefined)
              .join(' · ')}
          </span>
          {onShowFailures === undefined ? null : (
            <button
              type="button"
              className="dsh-obs-link"
              onClick={() => onShowFailures(lastFailure.tool)}
            >
              {t('card.showFailures')}
            </button>
          )}
        </p>
      )}
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
  onShowFailures,
  focusRow,
}: {
  title: string
  rows: readonly ReportRow[]
  t: Translate
  now: number
  tone?: 'attention'
  onShowFailures?: (tool?: string) => void
  focusRow?: string
}): ReactNode {
  if (rows.length === 0) return null
  return (
    <section className="dsh-obs-section" data-tone={tone}>
      <h2>{`${title} (${String(rows.length)})`}</h2>
      <div className="dsh-obs-grid">
        {rows.map((row) => (
          <PluginCard
            key={row.id}
            row={row}
            t={t}
            now={now}
            {...(onShowFailures === undefined ? {} : { onShowFailures })}
            {...(focusRow === undefined ? {} : { focused: focusRow === row.id })}
          />
        ))}
      </div>
    </section>
  )
}

/** Silent rows stay compact and state their trigger and the window denominators. */
function SilentRows({
  rows,
  report,
  t,
}: {
  rows: readonly ReportRow[]
  report: Report
  t: Translate
}): ReactNode {
  if (rows.length === 0) return null
  const byRow = new Map(report.scorecards.map((card) => [card.rowId, card]))
  return (
    <section className="dsh-obs-section">
      <h2>{`${t('section.silent')} (${String(rows.length)})`}</h2>
      <p className="dsh-obs-muted">{t('section.absence')}</p>
      <ul className="dsh-obs-silent">
        {rows.map((row) => {
          const card = byRow.get(row.id)
          return (
            <li key={row.id} data-status="silent">
              <span className="dsh-obs-silent-name">{row.label}</span>
              <span className="dsh-obs-pill" data-status="silent">
                {t('status.silent')}
              </span>
              <span className="dsh-obs-muted">{row.trigger ?? t('card.never')}</span>
              <span className="dsh-obs-muted">
                {card === undefined || !card.eligibilityDeclared
                  ? t('scorecard.noEligibility')
                  : `${String(card.fired)} ${t('scorecard.of')} ${String(card.eligible)} ${t('scorecard.eligible')}`}
              </span>
              <span className="dsh-obs-muted">
                {`0 ${t('failure.of')} ${counted(report.totals.turns, t('kpi.turn'))} · 0 ${t('failure.of')} ${counted(report.totals.toolCalls, t('kpi.toolCall'))} · 0 ${t('failure.of')} ${counted(report.totals.sessions, t('kpi.session'))}`}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Plugin health cards grouped by attention, with guidance kept compact. */
export function PluginBoard({
  report,
  t,
  now,
  onShowFailures,
  focusRow,
}: {
  report: Report
  t: Translate
  now: number
  onShowFailures?: (tool?: string) => void
  focusRow?: string
}): ReactNode {
  const plugins = report.rows.filter((row) => row.group === 'plugin').sort(byAttention)
  const needsAttention = (row: ReportRow): boolean =>
    row.status === 'not loaded' || (row.status === 'error' && row.unrecoveredErrors > 0)
  const attention = plugins.filter(needsAttention)
  const active = plugins.filter(
    (row) => row.status === 'active' || (row.status === 'error' && !needsAttention(row)),
  )
  const silent = plugins.filter((row) => row.status === 'silent')
  const guidance = plugins.filter((row) => row.kind === 'guidance')
  const guidanceNeedsAttention = guidance.some((row) => row.readiness === 'not mounted')
  return (
    <>
      <PluginSection
        title={t('section.attention')}
        rows={attention}
        t={t}
        now={now}
        tone="attention"
        {...(onShowFailures === undefined ? {} : { onShowFailures })}
        {...(focusRow === undefined ? {} : { focusRow })}
      />
      <PluginSection
        title={t('section.active')}
        rows={active}
        t={t}
        now={now}
        {...(onShowFailures === undefined ? {} : { onShowFailures })}
        {...(focusRow === undefined ? {} : { focusRow })}
      />
      <SilentRows rows={silent} report={report} t={t} />
      {guidance.length > 0 ? (
        <section
          className="dsh-obs-section"
          {...(guidanceNeedsAttention ? { 'data-tone': 'attention' } : {})}
        >
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

/** Tool call distribution; the failing share is drawn over the call population. */
export function ToolsPanel({
  outcomes,
  t,
}: {
  outcomes: readonly ToolOutcome[]
  t: Translate
}): ReactNode {
  const max = Math.max(1, ...outcomes.map((outcome) => outcome.calls))
  return (
    <section className="dsh-obs-panel">
      <header className="dsh-obs-panel-head">
        <h2>{t('tools.title')}</h2>
      </header>
      {outcomes.length === 0 ? (
        <p className="dsh-obs-muted">{t('tools.empty')}</p>
      ) : (
        <ul className="dsh-obs-bars">
          {outcomes.map((outcome) => {
            const percent =
              outcome.calls === 0 ? 0 : Math.round((outcome.failed / outcome.calls) * 100)
            return (
              <li key={outcome.tool}>
                <span className="dsh-obs-bars-label">{outcome.tool}</span>
                <span className="dsh-obs-bars-track">
                  <span
                    className="dsh-obs-bars-fill"
                    style={{ width: `${String((outcome.calls / max) * 100)}%` }}
                  >
                    {outcome.failed > 0 ? (
                      <span
                        className="dsh-obs-bars-fail"
                        style={{ width: `${String(percent)}%` }}
                        title={`${String(outcome.failed)} ${t('tools.share')}`}
                      />
                    ) : null}
                  </span>
                </span>
                <span className="dsh-obs-bars-value">
                  {`${String(outcome.failed)} ${t('failure.of')} ${String(outcome.calls)} · ${String(percent)}%`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** One bounded section listing every failure in the window, grouped by severity. */
export function FailureList({
  failures,
  totals,
  t,
  open,
  onToggle,
  onOpen,
  canOpen,
  onFix,
  filterTool,
  onClearFilter,
}: {
  failures: readonly FailureEntry[]
  totals: FailureTotals
  t: Translate
  open: boolean
  /** Report a native summary toggle so the KPI control stays in sync. */
  onToggle?: (open: boolean) => void
  onOpen?: (failure: FailureEntry) => void
  /** Whether one entry has an action in the current client; metadata-only entries have none. */
  canOpen?: (failure: FailureEntry) => boolean
  onFix?: () => void
  filterTool?: string
  onClearFilter?: () => void
}): ReactNode {
  if (totals.total === 0) return null
  const visible =
    filterTool === undefined ? failures : failures.filter((failure) => failure.tool === filterTool)
  return (
    <section
      id={FAILURE_SECTION_ID}
      tabIndex={-1}
      className="dsh-obs-panel dsh-obs-failures"
      aria-label={t('failure.title')}
    >
      <details
        open={open}
        onToggle={
          onToggle === undefined ? undefined : (event) => onToggle(event.currentTarget.open)
        }
      >
        <summary>
          {`${t('failure.title')} (${counted(totals.total, t('failure.entry'), t('failure.entries'))})`}
        </summary>
        <div className="dsh-obs-failure-bar">
          {totals.total > failures.length ? (
            <span className="dsh-obs-muted">
              {`${t('failure.bound')} ${String(failures.length)} ${t('failure.of')} ${String(totals.total)}`}
            </span>
          ) : null}
          {filterTool === undefined ? null : (
            <span className="dsh-obs-muted">
              {`${t('failure.filtered')} ${filterTool}`}
              {onClearFilter === undefined ? null : (
                <button type="button" className="dsh-obs-link" onClick={onClearFilter}>
                  {t('failure.clear')}
                </button>
              )}
            </span>
          )}
          <button
            type="button"
            className="dsh-obs-link"
            onClick={() => copyText(failureCopyText(visible, t))}
          >
            {t('failure.copy')}
          </button>
          {onFix === undefined ? null : (
            <button type="button" onClick={onFix}>
              {t('failure.fix')}
            </button>
          )}
        </div>
        {visible.length === 0 ? (
          <p className="dsh-obs-muted">{t('failure.none')}</p>
        ) : (
          SEVERITY_ORDER.map((severity) => {
            const entries = visible.filter((failure) => failure.severity === severity)
            if (entries.length === 0) return null
            return (
              <div key={severity} className="dsh-obs-failure-group" data-severity={severity}>
                <h3>{`${t(SEVERITY_KEYS[severity])} (${String(entries.length)})`}</h3>
                <ol>
                  {entries.map((failure) => (
                    <li
                      key={`${failure.sessionId}:${String(failure.seq)}`}
                      {...(failure.recovered ? { 'data-recovered': 'true' } : {})}
                    >
                      <span>{failureFacts(failure, t).join(' · ')}</span>
                      {onOpen === undefined ||
                      (canOpen !== undefined && !canOpen(failure)) ? null : (
                        <button
                          type="button"
                          className="dsh-obs-link"
                          onClick={() => onOpen(failure)}
                        >
                          {t('failure.open')}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )
          })
        )}
      </details>
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
  sessionId,
  workspace,
  inspectCall,
  openView,
  onSubView,
  hypothesesLoading = false,
}: {
  range: Range
  report: Report | null
  error: string | null
  t: Translate
  onRange: (range: Range) => void
  now: number
  sessionId?: string
  workspace?: WorkspaceFacade
  inspectCall?: (callId: string) => void
  openView?: (view: string, focus: string) => void
  /** Tells the view that the Hypotheses tab was opened; the report is refetched. */
  onSubView?: (view: SubView) => void
  hypothesesLoading?: boolean
}): ReactNode {
  const [view, setViewState] = useState<SubView>('overview')
  const setView = (next: SubView): void => {
    setViewState(next)
    onSubView?.(next)
  }
  const [failuresOpen, setFailuresOpen] = useState(false)
  const [failureFilter, setFailureFilter] = useState<string | undefined>(undefined)
  const [rowFocus, setRowFocus] = useState<string | undefined>(undefined)
  const [tasksSort, setTasksSort] = useState<TaskSort>({ key: 'start', direction: -1 })
  const [tasksOutcome, setTasksOutcome] = useState<EpisodeOutcome | 'all'>('all')
  const [tasksPlugin, setTasksPlugin] = useState<string | 'all'>('all')
  const [tasksSelected, setTasksSelected] = useState<string | undefined>(undefined)
  const plugins = report?.rows.filter((row) => row.group === 'plugin').length ?? 0
  const revealFailures = (tool?: string): void => {
    setFailureFilter(tool)
    setFailuresOpen(true)
    if (view === 'overview') {
      focusFailures()
      return
    }
    // The failure section mounts after the view switch; focus it on the next task.
    setView('overview')
    setTimeout(focusFailures, 0)
  }
  const sortTasks = (key: TaskSortKey): void => {
    setTasksSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 1 ? -1 : 1 }
        : { key, direction: key === 'start' ? -1 : 1 },
    )
  }
  const openRow = (rowId: string): void => {
    setRowFocus(rowId)
    setView('plugins')
  }
  const canOpenLocal =
    sessionId !== undefined && (inspectCall !== undefined || openView !== undefined)
  const canOpenRemote = workspace !== undefined
  const openFailure = (failure: FailureEntry): void => {
    if (failure.sessionId === sessionId) {
      if (failure.callId === undefined) return
      if (inspectCall !== undefined) inspectCall(failure.callId)
      else openView?.('trajectory', failure.callId)
      return
    }
    workspace?.openSession(failure.sessionId)
  }
  const canOpenFailure = (failure: FailureEntry): boolean =>
    failure.sessionId === sessionId
      ? failure.callId !== undefined && (inspectCall !== undefined || openView !== undefined)
      : workspace !== undefined
  const visibleFailures =
    report === null || failureFilter === undefined
      ? (report?.failures ?? [])
      : report.failures.filter((failure) => failure.tool === failureFilter)
  const fixSession =
    report === null || workspace === undefined
      ? undefined
      : (): void => {
          workspace.startSession(undefined, {
            prompt: failureFixPrompt(visibleFailures, t),
            whenDraftExists: 'append',
          })
        }
  const canOpenAny = canOpenLocal || canOpenRemote
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
          <SubViewTabs view={view} t={t} onView={setView} />
          <div
            className="dsh-obs-tabpanel"
            role="tabpanel"
            id={`dsh-obs-panel-${view}`}
            aria-labelledby={`dsh-obs-tab-${view}`}
          >
            {view === 'overview' ? (
              <OverviewView
                report={report}
                t={t}
                failuresOpen={failuresOpen}
                {...(failureFilter === undefined ? {} : { failureFilter })}
                onToggleFailures={setFailuresOpen}
                onRevealFailures={() => revealFailures()}
                onClearFilter={() => setFailureFilter(undefined)}
                {...(canOpenAny ? { onOpenFailure: openFailure, canOpenFailure } : {})}
                {...(fixSession === undefined ? {} : { onFix: fixSession })}
                onOpenRow={openRow}
              />
            ) : null}
            {view === 'plugins' ? (
              <>
                <HealthBanner report={report} t={t} />
                <PluginBoard
                  report={report}
                  t={t}
                  now={now}
                  onShowFailures={revealFailures}
                  {...(rowFocus === undefined ? {} : { focusRow: rowFocus })}
                />
              </>
            ) : null}
            {view === 'tasks' ? (
              <TasksView
                report={report}
                t={t}
                sort={tasksSort}
                outcome={tasksOutcome}
                plugin={tasksPlugin}
                {...(tasksSelected === undefined ? {} : { selectedId: tasksSelected })}
                onSort={sortTasks}
                onOutcome={setTasksOutcome}
                onPlugin={setTasksPlugin}
                onSelect={setTasksSelected}
              />
            ) : null}
            {view === 'hypotheses' ? (
              hypothesesLoading ? (
                <p className="dsh-obs-loading">{t('hypothesis.loading')}</p>
              ) : (
                <HypothesesView report={report} t={t} />
              )
            ) : null}
          </div>
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
  workspace,
  inspectCall,
  openView,
}: {
  t: Translate
  sessionId?: string
  workspace?: WorkspaceFacade
  inspectCall?: (callId: string) => void
  openView?: (view: string, focus: string) => void
}): ReactNode {
  const [range, setRange] = useState<Range>('session')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // The Hypotheses tab needs the declared comparison windows; everything else
  // must not pay for that corpus read.
  const [needsHypotheses, setNeedsHypotheses] = useState(false)
  const [hypothesesLoading, setHypothesesLoading] = useState(false)
  useEffect(() => {
    let active = true
    const key = `${range}|${sessionId ?? ''}|${needsHypotheses ? 'h' : 'v'}`
    const cached = reportCache.get(key)
    // Show the last report for this range at once while the fresh one loads.
    if (cached !== undefined && Date.now() - cached.at < REPORT_CACHE_MS) setReport(cached.report)
    else setReport(null)
    setError(null)
    setNow(Date.now())
    if (needsHypotheses) setHypothesesLoading(true)
    fetch(reportUrl(range, sessionId, needsHypotheses), {
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
        reportCache.set(key, { at: Date.now(), report: value })
        if (active) {
          setReport(value)
          setHypothesesLoading(false)
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setHypothesesLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [range, sessionId, needsHypotheses])
  return (
    <ObservabilityPanel
      range={range}
      report={report}
      error={error}
      t={t}
      onRange={setRange}
      now={now}
      {...(sessionId === undefined ? {} : { sessionId })}
      {...(workspace === undefined ? {} : { workspace })}
      {...(inspectCall === undefined ? {} : { inspectCall })}
      {...(openView === undefined ? {} : { openView })}
      hypothesesLoading={hypothesesLoading}
      onSubView={(view) => {
        if (view === 'hypotheses') setNeedsHypotheses(true)
      }}
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
        (props) => {
          const workspace = optionalWorkspace(ctx)
          return (
            <ObservabilityView
              t={t}
              {...(props.sessionId === undefined ? {} : { sessionId: props.sessionId })}
              {...(props.inspectCall === undefined ? {} : { inspectCall: props.inspectCall })}
              {...(props.openView === undefined ? {} : { openView: props.openView })}
              {...(workspace === undefined ? {} : { workspace })}
            />
          )
        },
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
.dsh-obs-findings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-left: 4px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm);
}
.dsh-obs-findings h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.dsh-obs-findings ul {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  color: var(--dsw-alias-label-secondary);
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
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
button.dsh-obs-kpi {
  cursor: pointer;
}
button.dsh-obs-kpi:hover {
  border-color: var(--dsw-alias-state-business-primary);
}
button.dsh-obs-kpi:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
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
.dsh-obs-card-failure {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  flex-wrap: wrap;
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
.dsh-obs-pill[data-status="error"],
.dsh-obs-pill[data-readiness="not mounted"] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-pill[data-status="error"]::before,
.dsh-obs-pill[data-readiness="not mounted"]::before {
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
.dsh-obs-silent {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-obs-silent li {
  display: grid;
  grid-template-columns: minmax(120px, 200px) auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-obs-silent-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-obs-failures summary {
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.dsh-obs-failures summary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-obs-failures:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-obs-failure-bar {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  margin: 8px 0;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-failure-group h3 {
  margin: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-failure-group ol {
  margin: 0;
  padding-left: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-failure-group li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 2px 0;
}
.dsh-obs-failure-group li[data-recovered="true"] {
  opacity: 0.75;
}
.dsh-obs-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-business-primary);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
.dsh-obs-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
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
.dsh-obs-bars-fail {
  display: block;
  height: 100%;
  min-width: 1px;
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
.dsh-obs-timeline-chart {
  display: block;
  width: 100%;
  height: 96px;
}
.dsh-obs-tl-label {
  fill: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh-obs-tl-bar[data-tone="steps"] {
  fill: var(--dsw-alias-state-business-primary);
  opacity: 0.75;
}
.dsh-obs-tl-bar[data-tone="tools"] {
  fill: var(--dsw-alias-brand-primary);
  opacity: 0.75;
}
.dsh-obs-tl-tick {
  stroke-width: 2;
}
.dsh-obs-tl-tick[data-tone="human"] {
  stroke: var(--dsw-alias-state-success-primary);
}
.dsh-obs-tl-tick[data-tone="errors"] {
  stroke: var(--dsw-alias-state-error-primary);
}
.dsh-obs-turn-rows {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 18px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dsh-obs-turn-row {
  display: inline-flex;
  gap: 6px;
}
.dsh-obs-turn-row > span + span::before {
  content: "·";
  margin-right: 6px;
  color: var(--dsw-alias-label-caption);
}
.dsh-obs-turn-row [data-tone="error"] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-series-chart {
  display: block;
  width: 100%;
  height: 140px;
}
.dsh-obs-token-track {
  border-radius: 999px;
  overflow: hidden;
  background: var(--dsw-alias-border-l2);
}
.dsh-obs-token-bar {
  display: block;
  width: 100%;
}
.dsh-obs-token-bar rect[data-tone="cacheRead"] {
  fill: var(--dsw-alias-state-business-primary);
}
.dsh-obs-token-bar rect[data-tone="input"] {
  fill: var(--dsw-alias-brand-primary);
}
.dsh-obs-token-bar rect[data-tone="output"] {
  fill: var(--dsw-alias-state-success-primary);
}
.dsh-obs-swatch[data-tone="cacheRead"] {
  background: var(--dsw-alias-state-business-primary);
}
.dsh-obs-swatch[data-tone="input"] {
  background: var(--dsw-alias-brand-primary);
}
.dsh-obs-swatch[data-tone="output"] {
  background: var(--dsw-alias-state-success-primary);
}
.dsh-obs-token-caption {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-obs-token-key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dsh-obs-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-obs-tab {
  padding: 6px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
.dsh-obs-tab[aria-selected="true"] {
  border-bottom-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
}
.dsh-obs-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-obs-tabpanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dsh-obs-columns {
  columns: 1;
  column-gap: 16px;
}
@media (min-width: 901px) {
  .dsh-obs-columns {
    columns: 2;
  }
}
.dsh-obs-columns > * {
  break-inside: avoid;
  margin: 0 0 16px;
}
.dsh-obs-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.dsh-obs-tile {
  padding: 10px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  min-width: 0;
}
.dsh-obs-tile-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-tile dl {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 8px 0 0;
}
.dsh-obs-tile dl div {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.dsh-obs-tile dt {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
}
.dsh-obs-tile dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.dsh-obs-tile-note {
  margin: 6px 0 0;
}
.dsh-obs-dq {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-obs-dq li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-obs-task-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-task-controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dsh-obs-task-controls select {
  padding: 2px 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
}
.dsh-obs-table-wrap {
  overflow-x: auto;
}
.dsh-obs-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.dsh-obs-table th {
  padding: 4px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.dsh-obs-table th button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dsh-obs-table th button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-obs-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  vertical-align: top;
}
.dsh-obs-table tr[data-selected="true"] td {
  border-bottom-color: var(--dsw-alias-state-business-primary);
}
.dsh-obs-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 16px;
  margin: 8px 0 0;
}
.dsh-obs-facts div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dsh-obs-facts dt {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
}
.dsh-obs-facts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.dsh-obs-panel h3 {
  margin: 12px 0 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
}
.dsh-obs-score-goal {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}
.dsh-obs-hypo-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.dsh-obs-hypo {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
}
.dsh-obs-hypo[data-status="supported"] {
  border-color: var(--dsw-alias-state-success-primary);
}
.dsh-obs-hypo[data-status="refuted"] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-obs-card[data-focus="true"] {
  border-color: var(--dsw-alias-state-business-primary);
}
`
