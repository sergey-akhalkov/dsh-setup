import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  Definition,
  DefinitionTrigger,
  DefinitionTriggerKind,
  ObligationEventKind,
  TriggerCommand,
} from './definitions.js'
import { globMatches } from './evaluate.js'

/**
 * The shipped shadow trigger catalog. Triggers are data only: loading,
 * validating, and evaluating them never registers a tool or steers a turn.
 */

/** The event kinds a trigger may observe. Intent classification is not one. */
export const EVENT_KINDS = [
  'agent.turn-start',
  'agent.turn-stop',
  'tool.result',
  'subagent.start',
  'subagent.end',
  'fs.change',
] as const

export type EventKind = (typeof EVENT_KINDS)[number]

/** This change ships every trigger in shadow mode; disabled stays refusable. */
export const TRIGGER_MODES = ['shadow', 'disabled'] as const
export type TriggerMode = (typeof TRIGGER_MODES)[number]

/** De-duplication policies a trigger may declare. */
export const DEDUPE_POLICIES = ['none', 'path+content-hash'] as const
export type DedupePolicy = (typeof DEDUPE_POLICIES)[number]

/** The filter vocabulary; an unknown member is a load failure. */
export interface TriggerFilter {
  readonly path?: string
  readonly tool?: string
  readonly change?: 'created-or-modified'
}

/** One declarative shadow trigger. */
export interface Trigger {
  readonly id: string
  readonly event: EventKind
  readonly filter: TriggerFilter
  readonly mode: TriggerMode
  readonly dedupe: DedupePolicy
}

const FILTER_KEYS = new Set(['path', 'tool', 'change'])

function fail(id: string | undefined, field: string, message: string): never {
  throw new Error(
    `workflow trigger ${id === undefined ? '' : `"${id}" `}field "${field}" ${message}`,
  )
}

function stringField(value: unknown, field: string, id: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(id, field, 'must be a non-empty string')
  }
  return value
}

function filterOf(raw: unknown, id: string | undefined): TriggerFilter {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(id, 'filter', 'must be an object')
  }
  const filter: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!FILTER_KEYS.has(key)) fail(id, `filter.${key}`, 'is not a known filter')
    filter[key] = stringField(value, `filter.${key}`, id)
  }
  if (filter.change !== undefined && filter.change !== 'created-or-modified') {
    fail(id, 'filter.change', 'must be "created-or-modified"')
  }
  return filter
}

/** Validate one catalog value; a failure names the trigger and its field. */
export function validateCatalog(raw: unknown): Trigger[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('workflow trigger catalog must be an object')
  }
  const entries = (raw as { triggers?: unknown }).triggers
  if (!Array.isArray(entries)) fail(undefined, 'triggers', 'must be a list')
  const triggers: Trigger[] = []
  const ids = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(undefined, `triggers[${String(index)}]`, 'must be an object')
    }
    const value = entry as Record<string, unknown>
    const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id : undefined
    if (id === undefined)
      fail(undefined, `triggers[${String(index)}].id`, 'must be a non-empty string')
    if (ids.has(id)) fail(id, 'id', 'is duplicated')
    ids.add(id)
    const event = value.event
    if (!EVENT_KINDS.includes(event as EventKind)) {
      fail(id, 'event', `must be one of: ${EVENT_KINDS.join(', ')}`)
    }
    const mode = value.mode
    if (!TRIGGER_MODES.includes(mode as TriggerMode)) {
      fail(id, 'mode', `must be one of: ${TRIGGER_MODES.join(', ')}`)
    }
    const dedupe = value.dedupe
    if (!DEDUPE_POLICIES.includes(dedupe as DedupePolicy)) {
      fail(id, 'dedupe', `must be one of: ${DEDUPE_POLICIES.join(', ')}`)
    }
    triggers.push({
      id,
      event: event as EventKind,
      filter: filterOf(value.filter, id),
      mode: mode as TriggerMode,
      dedupe: dedupe as DedupePolicy,
    })
  }
  return triggers
}

/** Read and validate one catalog file. */
export function readCatalog(file: string): Trigger[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `workflow trigger catalog ${file} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return validateCatalog(raw)
}

/**
 * The shipped catalog path. It resolves from both layouts: `src/host` during a
 * source test (two levels to the package root) and `lib` after compilation (one
 * level), so the built plugin never points outside itself.
 */
export function catalogPath(): string {
  const candidates = [
    fileURLToPath(new URL('../../assets/triggers/catalog.json', import.meta.url)),
    fileURLToPath(new URL('../assets/triggers/catalog.json', import.meta.url)),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    throw new Error(`workflow trigger catalog was not found at ${candidates.join(' or ')}`)
  }
  return found
}

/** Load the shipped catalog from this package's assets. */
export function loadCatalog(): Trigger[] {
  return readCatalog(catalogPath())
}

/**
 * Obligation triggers evaluate a definition's single declarative trigger. The
 * reason vocabulary extends the shadow catalog's with the run outcomes; the
 * two vocabularies share a journal table but not the same typed union.
 */
export const OBLIGATION_REASONS = [
  'would-fire',
  'run-created',
  'run-suppressed',
  'not-applicable',
  'event-mismatch',
  'filter-mismatch',
  'dedupe',
  'disabled',
  'not-ready',
  'error',
] as const

export type ObligationReason = (typeof OBLIGATION_REASONS)[number]

/** The shell tool names a `tool: shell` filter accepts. */
const SHELL_TOOL_NAMES = new Set(['shell', 'pwsh', 'bash', 'terminal_send'])

/** One normalized event an obligation trigger may observe. */
export interface DefinitionEvent {
  readonly kind: ObligationEventKind
  readonly subject: string
  readonly workspace?: string
  readonly session?: string
  readonly turn?: number
  readonly tool?: string
  readonly command?: TriggerCommand
  /** The parsed change name for `openspec new change` and archive events. */
  readonly name?: string
  readonly path?: string
  readonly verdict?: string
  readonly hash?: string
  readonly callId?: string
  readonly classifier?: string
}

/** One definition trigger's stored evaluation row. */
export interface DefinitionEvaluation {
  readonly definition: string
  readonly trigger: DefinitionTriggerKind
  readonly matched: boolean
  readonly reason: ObligationReason
  readonly path?: string
  readonly filter?: string
  readonly detail?: string
  /** The created run id for a run-created outcome. */
  readonly runId?: string
}

export interface DefinitionEvaluationContext {
  /** The engine is enabled; `false` stops evaluation with `disabled`. */
  readonly enabled?: boolean
  /** The catalog and engine are ready; `false` records `not-ready`. */
  readonly ready?: boolean
  /** The resolved applicability of a trigger that declares one. */
  readonly applicability?: boolean
  readonly isDuplicate: (key: string) => boolean
}

function toolMatches(filter: string, event: DefinitionEvent): boolean {
  if (filter === 'shell') return event.tool !== undefined && SHELL_TOOL_NAMES.has(event.tool)
  return filter === event.tool
}

function filterMismatch(
  trigger: DefinitionTrigger,
  event: DefinitionEvent,
): { readonly path?: string; readonly filter: string } | undefined {
  const match = trigger.match
  if (
    match.workspace !== undefined &&
    !globMatches(
      match.workspace.replaceAll('\\', '/'),
      (event.workspace ?? '').replaceAll('\\', '/'),
    )
  ) {
    return { path: event.workspace, filter: `workspace: ${match.workspace}` }
  }
  if (match.session !== undefined && match.session !== event.session) {
    return { path: event.session, filter: `session: ${match.session}` }
  }
  if (match.tool !== undefined && !toolMatches(match.tool, event)) {
    return { path: event.tool, filter: `tool: ${match.tool}` }
  }
  if (match.command !== undefined && match.command !== event.command) {
    return { path: event.command, filter: `command: ${match.command}` }
  }
  if (match.path !== undefined && !globMatches(match.path, event.path ?? event.subject)) {
    return { path: event.path ?? event.subject, filter: `path: ${match.path}` }
  }
  if (match.subject !== undefined && match.subject !== event.subject) {
    return { path: event.subject, filter: `subject: ${match.subject}` }
  }
  if (match.verdict !== undefined && match.verdict !== event.verdict) {
    return { path: event.verdict, filter: `verdict: ${match.verdict}` }
  }
  if (match.classifier !== undefined && match.classifier !== event.classifier) {
    return { path: event.classifier, filter: `classifier: ${match.classifier}` }
  }
  return undefined
}

/**
 * The de-duplication identity for one definition trigger and event. It always
 * includes the definition, the trigger policy, and the session; the subject is
 * the turn, the path and content hash, the call id, or the parsed name.
 */
export function obligationDedupeKey(
  definition: string,
  trigger: DefinitionTrigger,
  event: DefinitionEvent,
): string | undefined {
  const session = event.session ?? ''
  switch (trigger.dedupe) {
    case 'none':
      return undefined
    case 'turn':
      return `${definition}\u0000turn\u0000${session}\u0000${String(event.turn ?? -1)}`
    case 'path+content-hash':
      if (event.path === undefined) return undefined
      return `${definition}\u0000path\u0000${session}\u0000${event.path}\u0000${event.hash ?? 'deleted'}`
    case 'callId':
      if (event.callId === undefined) return undefined
      return `${definition}\u0000call\u0000${session}\u0000${event.callId}`
    case 'name':
      if (event.name === undefined) return undefined
      return `${definition}\u0000name\u0000${session}\u0000${event.name}`
  }
}

/** Evaluate one definition's trigger against one event. Pure and contained. */
export function evaluateDefinitionTrigger(
  definition: Definition,
  event: DefinitionEvent,
  context: DefinitionEvaluationContext,
): DefinitionEvaluation {
  const trigger = definition.trigger
  const base = { definition: definition.id, trigger: trigger.kind }
  try {
    if (context.enabled === false) return { ...base, matched: false, reason: 'disabled' }
    if (context.ready === false) return { ...base, matched: false, reason: 'not-ready' }
    if (trigger.applicability !== undefined) {
      if (context.applicability === undefined)
        return { ...base, matched: false, reason: 'not-ready' }
      if (!context.applicability) return { ...base, matched: false, reason: 'not-applicable' }
    }
    if (trigger.kind !== event.kind) return { ...base, matched: false, reason: 'event-mismatch' }
    const mismatch = filterMismatch(trigger, event)
    if (mismatch !== undefined) {
      return {
        ...base,
        matched: false,
        reason: 'filter-mismatch',
        ...(mismatch.path === undefined ? {} : { path: mismatch.path }),
        filter: mismatch.filter,
      }
    }
    const key = obligationDedupeKey(definition.id, trigger, event)
    if (key !== undefined && trigger.repeat !== true && context.isDuplicate(key)) {
      return { ...base, matched: false, reason: 'dedupe' }
    }
    return { ...base, matched: true, reason: 'would-fire' }
  } catch (error) {
    return {
      ...base,
      matched: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export interface StartRunOutcome {
  readonly ok: boolean
  readonly reason?: string
  readonly runId?: string
}

export interface DefinitionRouterContext extends DefinitionEvaluationContext {
  readonly resolveApplicability?: (
    definition: Definition,
    event: DefinitionEvent,
  ) => boolean | undefined
  readonly markKey?: (key: string) => void
  readonly startRun?: (definition: Definition, event: DefinitionEvent) => StartRunOutcome
}

/**
 * Evaluate every loaded definition for one event. A shadow match records
 * `would-fire` and starts nothing; an active match asks the run starter and
 * records `run-created`, or `run-suppressed` with the bounded cause.
 */
export function evaluateDefinitions(
  definitions: readonly Definition[],
  event: DefinitionEvent,
  context: DefinitionRouterContext,
): DefinitionEvaluation[] {
  const rows: DefinitionEvaluation[] = []
  for (const definition of definitions) {
    const applicability = context.resolveApplicability?.(definition, event)
    const row = evaluateDefinitionTrigger(definition, event, {
      ...(context.enabled === undefined ? {} : { enabled: context.enabled }),
      ...(context.ready === undefined ? {} : { ready: context.ready }),
      ...(applicability === undefined ? {} : { applicability }),
      isDuplicate: context.isDuplicate,
    })
    if (!row.matched) {
      rows.push(row)
      continue
    }
    const key = obligationDedupeKey(definition.id, definition.trigger, event)
    if (definition.trigger.mode === 'shadow') {
      if (key !== undefined) context.markKey?.(key)
      rows.push({ ...row, reason: 'would-fire' })
      continue
    }
    const outcome = context.startRun?.(definition, event)
    if (outcome === undefined) {
      rows.push({
        ...row,
        reason: 'run-suppressed',
        detail: 'no run starter is registered for the trigger',
      })
      continue
    }
    if (outcome.ok) {
      // A suppressed start must not consume the dedupe key, or a later retry
      // would be reported as a duplicate without ever creating a run.
      if (key !== undefined) context.markKey?.(key)
      rows.push({
        ...row,
        reason: 'run-created',
        ...(outcome.runId === undefined ? {} : { runId: outcome.runId }),
      })
    } else {
      rows.push({
        ...row,
        reason: 'run-suppressed',
        detail: outcome.reason ?? 'the run was not started',
      })
    }
  }
  return rows
}

/** The bounded result a classifier returns; it is data, never a command. */
export interface IntentClassification {
  readonly intent: string
  readonly confidence: number
  readonly reason: string
  readonly classifier: string
}

export interface IntentEvaluationContext extends DefinitionEvaluationContext {
  /** The engine opt-in; without it every active intent stays shadow. */
  readonly allowIntent: boolean
  /** The definition was installed through the user-confirmed host path. */
  readonly confirmed: boolean
  readonly session?: string
  readonly turn?: number
  readonly markKey?: (key: string) => void
  readonly startRun?: (
    definition: Definition,
    classification: IntentClassification,
  ) => StartRunOutcome
}

/** The classification fields a recorded intent evaluation must name. */
export function classificationDetail(classification: IntentClassification): string {
  return [
    `classifier=${classification.classifier}`,
    `confidence=${classification.confidence.toFixed(2)}`,
    `reason=${classification.reason.slice(0, 160)}`,
    `intent=${classification.intent}`,
  ].join('; ')
}

/** Bounded deterministic classifications the optional intent trigger accepts. */
const INTENT_RULES: ReadonlyArray<{
  readonly intent: string
  readonly confidence: number
  readonly reason: string
  readonly pattern: RegExp
}> = [
  {
    intent: 'new-change',
    confidence: 0.72,
    reason: 'the message asks to create or start a change',
    pattern: /\b(?:new|create|start|add)\b[^.\n]{0,40}\b(?:change|spec|feature)\b/iu,
  },
]

/** Classify one bounded user message; a text without a known intent is no signal. */
export function classifyIntent(text: string): IntentClassification | undefined {
  const bounded = text.slice(0, 2000)
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(bounded)) {
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        reason: rule.reason,
        classifier: 'heuristic-v1',
      }
    }
  }
  return undefined
}

/** The dedupe identity an intent trigger declares for one classification. */
export function intentDedupeKey(
  definition: Definition,
  classification: IntentClassification,
  context: { readonly session?: string; readonly turn?: number },
): string | undefined {
  switch (definition.trigger.dedupe) {
    case 'none':
      return undefined
    case 'turn':
      return `${definition.id}\u0000intent\u0000${context.session ?? ''}\u0000${String(context.turn ?? -1)}\u0000${classification.intent}`
    default:
      return undefined
  }
}

function detailWith(detail: string | undefined, extra: string): string {
  return detail === undefined || detail === '' ? extra : `${detail}; ${extra}`
}

/** Evaluate one intent definition against one classification. */
export function evaluateIntentDefinition(
  definition: Definition,
  classification: IntentClassification,
  context: IntentEvaluationContext,
): DefinitionEvaluation {
  const base = { definition: definition.id, trigger: definition.trigger.kind }
  try {
    if (context.enabled === false) return { ...base, matched: false, reason: 'disabled' }
    if (context.ready === false) return { ...base, matched: false, reason: 'not-ready' }
    if (definition.trigger.kind !== 'intent') {
      return { ...base, matched: false, reason: 'event-mismatch' }
    }
    const match = definition.trigger.match
    const detail = classificationDetail(classification)
    if (match.classifier !== undefined && match.classifier !== classification.classifier) {
      return {
        ...base,
        matched: false,
        reason: 'filter-mismatch',
        filter: `classifier: ${match.classifier}`,
        detail,
      }
    }
    if (match.intent !== undefined && match.intent !== classification.intent) {
      return {
        ...base,
        matched: false,
        reason: 'filter-mismatch',
        filter: `intent: ${match.intent}`,
        detail,
      }
    }
    if (match.subject !== undefined && match.subject !== classification.intent) {
      return {
        ...base,
        matched: false,
        reason: 'filter-mismatch',
        filter: `subject: ${match.subject}`,
        detail,
      }
    }
    const key = intentDedupeKey(definition, classification, context)
    if (key !== undefined && definition.trigger.repeat !== true && context.isDuplicate(key)) {
      return { ...base, matched: false, reason: 'dedupe', detail }
    }
    return { ...base, matched: true, reason: 'would-fire', detail }
  } catch (error) {
    return {
      ...base,
      matched: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Evaluate every intent definition. A shadow classification records the
 * classifier, confidence, and reason and starts nothing; an active run needs
 * both `allowIntent` and a user-confirmed definition.
 */
export function evaluateIntents(
  definitions: readonly Definition[],
  classification: IntentClassification,
  context: IntentEvaluationContext,
): DefinitionEvaluation[] {
  const rows: DefinitionEvaluation[] = []
  for (const definition of definitions) {
    if (definition.trigger.kind !== 'intent') continue
    const row = evaluateIntentDefinition(definition, classification, context)
    if (!row.matched) {
      rows.push(row)
      continue
    }
    const key = intentDedupeKey(definition, classification, context)
    if (definition.trigger.mode !== 'active') {
      if (key !== undefined) context.markKey?.(key)
      rows.push({ ...row, reason: 'would-fire' })
      continue
    }
    if (!context.allowIntent) {
      rows.push({
        ...row,
        reason: 'would-fire',
        detail: detailWith(row.detail, 'active intent stays shadow because allowIntent is false'),
      })
      continue
    }
    if (!context.confirmed) {
      rows.push({
        ...row,
        reason: 'would-fire',
        detail: detailWith(
          row.detail,
          'active intent refused until the definition is installed and user-confirmed',
        ),
      })
      continue
    }
    const outcome = context.startRun?.(definition, classification)
    if (outcome === undefined) {
      rows.push({
        ...row,
        reason: 'run-suppressed',
        detail: detailWith(row.detail, 'no run starter is registered for the intent trigger'),
      })
    } else if (outcome.ok) {
      // Consume the identity only after the run exists, so a refused or
      // temporarily suppressed start can be retried.
      if (key !== undefined) context.markKey?.(key)
      rows.push({
        ...row,
        reason: 'run-created',
        ...(outcome.runId === undefined ? {} : { runId: outcome.runId }),
      })
    } else {
      rows.push({
        ...row,
        reason: 'run-suppressed',
        detail: detailWith(row.detail, outcome.reason ?? 'the run was not started'),
      })
    }
  }
  return rows
}

/**
 * The installed goal-continuity checkpoint applicability decision, replicated
 * locally (the cross-package predicate is not exported): a turn needs the
 * resolved tool-call minimum, must not end in a question, and, when required,
 * must carry a write or a worker start.
 */
export interface CheckpointApplicabilityInput {
  readonly toolCalls: number
  readonly lastTool?: string
  readonly written: number
  readonly workers: number
  readonly minToolCalls?: number
  readonly requireWrite?: boolean
}

export function checkpointRequired(input: CheckpointApplicabilityInput): boolean {
  const minToolCalls = input.minToolCalls ?? 4
  if (input.toolCalls < minToolCalls) return false
  if (input.lastTool === 'ask_user_question') return false
  if ((input.requireWrite ?? true) && input.written === 0 && input.workers === 0) return false
  return true
}
