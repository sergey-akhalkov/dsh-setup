import type { EventKind, Trigger, TriggerFilter } from './triggers.js'

/**
 * Pure shadow-trigger evaluation. Every observed event is evaluated against
 * every trigger and records one fixed reason; a matched shadow trigger reports
 * `would-fire` and never calls a tool or steers.
 */

export const WHY_NOT_REASONS = [
  'would-fire',
  'event-mismatch',
  'filter-mismatch',
  'dedupe',
  'disabled',
  'not-ready',
  'error',
] as const

export type WhyNotReason = (typeof WHY_NOT_REASONS)[number]

/** One trigger's result for one observed event. */
export interface Evaluation {
  readonly matched: boolean
  readonly reason: WhyNotReason
  /** The rejected path or filter, when a filter mismatch explains it. */
  readonly path?: string
  readonly filter?: string
  /** The contained failure, when an evaluation threw. */
  readonly detail?: string
}

/** The normalized event the evaluator sees. */
export interface ObservedEvent {
  readonly kind: EventKind
  readonly subject: string
  readonly tool?: string
  readonly change?: 'created' | 'modified' | 'deleted'
  readonly hash?: string
}

export interface EvaluationContext {
  /** The catalog loaded and the recorder is ready to evaluate. */
  readonly ready: boolean
  /** Whether this event was already evaluated for this trigger. */
  isDuplicate(key: string): boolean
}

/** One glob segment, where `*` matches any run of non-slash characters. */
export function segmentGlobMatches(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '.')
  return new RegExp(`^${escaped}$`, 'u').test(value)
}

/** Segment glob: `*` within one segment, `**` across zero or more segments. */
export function globMatches(pattern: string, path: string): boolean {
  const patternSegments = pattern.split('/')
  const pathSegments = path.split('/')
  const walk = (patternIndex: number, pathIndex: number): boolean => {
    if (patternIndex === patternSegments.length) return pathIndex === pathSegments.length
    const segment = patternSegments[patternIndex]
    if (segment === '**') {
      for (let index = pathIndex; index <= pathSegments.length; index += 1) {
        if (walk(patternIndex + 1, index)) return true
      }
      return false
    }
    if (pathIndex >= pathSegments.length) return false
    const candidate = pathSegments[pathIndex]
    return (
      candidate !== undefined &&
      segmentGlobMatches(segment ?? '', candidate) &&
      walk(patternIndex + 1, pathIndex + 1)
    )
  }
  return walk(0, 0)
}

/** The de-duplication identity for one trigger/event pair, or undefined. */
export function evaluationKey(trigger: Trigger, event: ObservedEvent): string | undefined {
  if (trigger.dedupe !== 'path+content-hash') return undefined
  return `${event.subject}\u0000${event.hash ?? ''}`
}

function filterMismatch(trigger: Trigger, event: ObservedEvent): Evaluation | undefined {
  const filter: TriggerFilter = trigger.filter
  if (filter.tool !== undefined && filter.tool !== event.tool) {
    return {
      matched: false,
      reason: 'filter-mismatch',
      path: event.subject,
      filter: `tool: ${filter.tool}`,
    }
  }
  if (filter.path !== undefined && !globMatches(filter.path, event.subject)) {
    return {
      matched: false,
      reason: 'filter-mismatch',
      path: event.subject,
      filter: `path: ${filter.path}`,
    }
  }
  if (filter.change !== undefined) {
    if (event.change !== 'created' && event.change !== 'modified') {
      return {
        matched: false,
        reason: 'filter-mismatch',
        path: event.subject,
        filter: `change: ${filter.change}`,
      }
    }
  }
  return undefined
}

/** One stored evaluation row; structurally the journal's record type. */
export interface EvaluatedTrigger {
  readonly id: string
  readonly matched: boolean
  readonly reason: WhyNotReason
  readonly path?: string
  readonly filter?: string
  readonly detail?: string
}

/** The de-duplication window; a distinct change after it fires again. */
export const DEDUPE_WINDOW_MS = 250

/**
 * Evaluate the whole catalog for one event. Keys are added to `seen` with their
 * evaluation time; a second identical event inside the window reports `dedupe`,
 * while the same content observed after the window is a new change.
 */
export function evaluateEvent(
  triggers: readonly Trigger[],
  event: ObservedEvent,
  seen: Map<string, number>,
  ready = true,
  now = Date.now(),
  windowMs = DEDUPE_WINDOW_MS,
): EvaluatedTrigger[] {
  const rows: EvaluatedTrigger[] = []
  const keys: string[] = []
  for (const trigger of triggers) {
    const key = evaluationKey(trigger, event)
    const evaluation = evaluate(trigger, event, {
      ready,
      isDuplicate: (candidate) => {
        const at = seen.get(candidate)
        return at !== undefined && now - at <= windowMs
      },
    })
    rows.push({
      id: trigger.id,
      matched: evaluation.matched,
      reason: evaluation.reason,
      ...(evaluation.path === undefined ? {} : { path: evaluation.path }),
      ...(evaluation.filter === undefined ? {} : { filter: evaluation.filter }),
      ...(evaluation.detail === undefined ? {} : { detail: evaluation.detail }),
    })
    if (key !== undefined) keys.push(key)
  }
  for (const key of keys) seen.set(key, now)
  return rows
}
export function evaluate(
  trigger: Trigger,
  event: ObservedEvent,
  context: EvaluationContext,
): Evaluation {
  try {
    if (trigger.mode === 'disabled') return { matched: false, reason: 'disabled' }
    if (!context.ready) return { matched: false, reason: 'not-ready' }
    if (trigger.event !== event.kind) return { matched: false, reason: 'event-mismatch' }
    const mismatch = filterMismatch(trigger, event)
    if (mismatch !== undefined) return mismatch
    const key = evaluationKey(trigger, event)
    if (key !== undefined && context.isDuplicate(key)) return { matched: false, reason: 'dedupe' }
    return { matched: true, reason: 'would-fire' }
  } catch (error) {
    return {
      matched: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
