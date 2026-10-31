import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Token usage recorded on one assistant message. A record without it carries
 * no usage at all, which lowers the reported coverage instead of guessing.
 */
export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
}

/** The session-level header facts the report needs; no message text is read. */
export interface SessionMeta {
  readonly id: string
  /** The session this one was started from, when recorded. */
  readonly parentSession?: string
  /** Coarse product classification of a child session. */
  readonly origin?: string
  /** Delegation depth; absent means top level. */
  readonly delegationDepth?: number
}

/**
 * One neutral fact extracted from a session event. Aggregation works on these,
 * never on raw events, so assistant streams and message text never enter a
 * bucket or a report.
 */
export interface TraceRecord {
  readonly sessionId: string
  readonly seq: number
  readonly time: number
  readonly eventType: string
  readonly turn?: number
  readonly step?: number
  readonly tool?: string
  readonly sourceKind?: string
  readonly abortPrefix?: string
  readonly command?: string
  /** Only the argument fields a configured predicate reads; raw arguments never survive. */
  readonly argumentValues?: Readonly<Record<string, string>>
  readonly failed?: true
  /** Tool call identity, shared by a call and its result. */
  readonly callId?: string
  /** A failed tool result's recorded error name. */
  readonly errorName?: string
  /** A failed result's code, or the turn failure's stable `LlmFailure.code`. */
  readonly errorCode?: string
  /** `turn/end` reason kind, so a cut is distinguishable from a failure. */
  readonly turnEnd?: string
  /** Assistant message usage; absent when the event recorded none. */
  readonly usage?: TokenUsage
  /** `goal/change` operation; the objective text is never kept. */
  readonly goalOperation?: string
  /** The goal's opaque id, so its lifecycle can be followed without its objective. */
  readonly goalId?: string
  /** The goal's phase after the change. */
  readonly goalPhase?: string
  /** Rounds the goal supervisor started. */
  readonly goalRounds?: number
  /** `work_checkpoint` outcome word; the lists and reason strings are dropped. */
  readonly checkpointOutcome?: string
  /** Length of the checkpoint's verified list, never its text. */
  readonly checkpointVerifiedCount?: number
  /** Length of the checkpoint's remaining list, never its text. */
  readonly checkpointRemainingCount?: number
  /** Whether the checkpoint declared parallel remaining work. */
  readonly checkpointParallel?: boolean
}

/** The tool that records a work checkpoint. */
const CHECKPOINT_TOOL = 'work_checkpoint'

/** Every field the checkpoint producer accepts; anything else makes the call malformed. */
const CHECKPOINT_FIELDS: ReadonlySet<string> = new Set([
  'outcome',
  'verified',
  'remaining',
  'parallel',
  'serialReason',
  'next',
  'speedup',
])

/** The producer's list bound; a longer list is malformed. */
const MAX_CHECKPOINT_ITEMS = 8

/** Only a checkpoint's counts and flags survive extraction. */
interface CheckpointFacts {
  readonly outcome: 'done' | 'continue'
  readonly verified: number
  readonly remaining: number
  readonly parallel: boolean
}

/** A list's length when the producer would accept it, or undefined when malformed. */
function checkpointListLength(value: unknown): number | undefined {
  if (value === undefined) return 0
  if (!Array.isArray(value) || value.length > MAX_CHECKPOINT_ITEMS) return undefined
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return undefined
  }
  return value.length
}

/** One optional text field: present-but-empty is malformed, absent is fine. */
function checkpointTextIsValid(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() !== '')
}

/**
 * Read a checkpoint's counts and flags. A call is valid only as the producer
 * validated it; any malformed field makes the whole call contribute zero, so
 * no partial or unvalidated text ever reaches a record.
 */
function checkpointFacts(raw: string | undefined): CheckpointFacts | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const source = asRecord(parsed)
  if (source === undefined) return undefined
  if (!Object.keys(source).every((key) => CHECKPOINT_FIELDS.has(key))) return undefined
  const outcome = source.outcome
  if (outcome !== 'done' && outcome !== 'continue') return undefined
  if (source.parallel !== undefined && typeof source.parallel !== 'boolean') return undefined
  if (typeof source.next !== 'string' || source.next.trim() === '') return undefined
  if (!checkpointTextIsValid(source.serialReason) || !checkpointTextIsValid(source.speedup)) {
    return undefined
  }
  const parallel = source.parallel === true
  if (outcome === 'continue' && !parallel && source.serialReason == null) return undefined
  const verified = checkpointListLength(source.verified)
  const remaining = checkpointListLength(source.remaining)
  if (verified === undefined || remaining === undefined) return undefined
  return { outcome, verified, remaining, parallel }
}

/**
 * The configured argument fields of a checkpoint, read from validated facts.
 * Raw checkpoint arguments are never copied, so malformed text cannot leak.
 */
function checkpointArgumentValues(
  facts: CheckpointFacts | undefined,
  fields: ReadonlySet<string> | undefined,
): Record<string, string> | undefined {
  if (facts === undefined || fields === undefined) return undefined
  const values: Record<string, string> = {}
  if (fields.has('outcome')) values.outcome = facts.outcome
  if (fields.has('parallel')) values.parallel = String(facts.parallel)
  return Object.keys(values).length === 0 ? undefined : values
}

/** The five usage fields, with a missing field counting as zero, never an estimate. */
function tokenUsage(value: unknown): TokenUsage | undefined {
  const usage = asRecord(value)
  if (usage === undefined) return undefined
  return {
    input: number(usage.inputTokens) ?? 0,
    output: number(usage.outputTokens) ?? 0,
    cacheRead: number(usage.cacheReadTokens) ?? 0,
    cacheWrite: number(usage.cacheWriteTokens) ?? 0,
    total: number(usage.totalTokens) ?? 0,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The argument fields the configured predicates read, per tool. */
export type ArgumentFieldMap = ReadonlyMap<string, ReadonlySet<string>>

/** Keep only the configured argument fields, as strings, so no raw arguments survive. */
function argumentValues(
  raw: string | undefined,
  fields: ReadonlySet<string> | undefined,
): Record<string, string> | undefined {
  if (raw === undefined || fields === undefined || fields.size === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const source = asRecord(parsed)
  if (source === undefined) return undefined
  const values: Record<string, string> = {}
  for (const field of fields) {
    const value = source[field]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[field] = String(value)
    }
  }
  return Object.keys(values).length === 0 ? undefined : values
}

/**
 * Extract the aggregation records a session owns.
 *
 * `start` is the session's durable inheritance boundary: a fork seed copies a
 * parent prefix and owns only what follows it. `fields` names the argument
 * fields a configured predicate reads; anything else in the arguments is dropped.
 */
export function extractRecords(
  sessionId: string,
  events: readonly SessionEvent[],
  start = 0,
  fields?: ArgumentFieldMap,
): TraceRecord[] {
  const records: TraceRecord[] = []
  const callById = new Map<string, { tool: string; values?: Record<string, string> }>()
  let currentTurn: number | undefined
  for (const event of events.slice(start)) {
    const data = asRecord(event.data) ?? {}
    const type: string = event.type
    const explicitTurn = number(data.turn)
    if (type === 'turn/start') currentTurn = explicitTurn
    const turn = explicitTurn ?? currentTurn
    let failed: true | undefined
    let abortPrefix: string | undefined
    let tool: string | undefined
    let sourceKind: string | undefined
    let command: string | undefined
    let values: Record<string, string> | undefined
    let callId: string | undefined
    let errorName: string | undefined
    let errorCode: string | undefined
    let turnEnd: string | undefined
    let usage: TokenUsage | undefined
    let goalOperation: string | undefined
    let goalId: string | undefined
    let goalPhase: string | undefined
    let goalRounds: number | undefined
    let checkpointOutcome: string | undefined
    let checkpointVerifiedCount: number | undefined
    let checkpointRemainingCount: number | undefined
    let checkpointParallel: boolean | undefined
    switch (type) {
      case 'tool/call': {
        tool = text(data.name)
        callId = text(data.callId)
        if (tool === CHECKPOINT_TOOL) {
          const facts = checkpointFacts(text(data.arguments))
          checkpointOutcome = facts?.outcome
          checkpointVerifiedCount = facts?.verified ?? 0
          checkpointRemainingCount = facts?.remaining ?? 0
          checkpointParallel = facts?.parallel
          values = checkpointArgumentValues(facts, fields?.get(tool))
        } else {
          values = argumentValues(
            text(data.arguments),
            tool === undefined ? undefined : fields?.get(tool),
          )
        }
        if (tool !== undefined && callId !== undefined) {
          callById.set(callId, values === undefined ? { tool } : { tool, values })
        }
        break
      }
      case 'tool/result': {
        const message = asRecord(data.message)
        const source = asRecord(message?.source)
        callId = text(source?.callId) ?? text(message?.toolCallId)
        const call = callId === undefined ? undefined : callById.get(callId)
        tool = call?.tool
        // The result owns the call's configured argument fields, so an
        // argument-scoped signal can own the failure without message text.
        values = call?.values
        // Only the failure identity is kept; the raw reason is user-facing text.
        const error = asRecord(data.error)
        errorName = text(error?.name)
        errorCode = text(error?.code)
        if (message?.isError === true || data.error !== undefined) failed = true
        break
      }
      case 'user/message': {
        // The event data is the UserMessage itself: source sits at data.source.
        sourceKind = text(asRecord(data.source)?.kind)
        break
      }
      case 'command/run': {
        command = text(data.name)
        break
      }
      case 'assistant/message': {
        usage = tokenUsage(data.usage)
        break
      }
      case 'goal/change': {
        goalOperation = text(data.operation)
        goalId = text(asRecord(data.goal)?.id)
        goalPhase = text(asRecord(data.goal)?.phase)
        goalRounds = number(data.roundsStarted)
        break
      }
      case 'turn/end': {
        const reason = asRecord(data.reason)
        turnEnd = text(reason?.kind)
        if (reason?.kind === 'error') {
          failed = true
          errorCode = text(asRecord(reason.error)?.code)
        }
        if (reason?.kind === 'aborted') {
          const cause = asRecord(reason.reason)
          abortPrefix = cause?.kind === 'hook' ? text(cause.reason) : undefined
        }
        break
      }
      default:
        break
    }
    records.push({
      sessionId,
      seq: event.seq,
      time: event.time,
      eventType: event.type,
      ...(turn === undefined ? {} : { turn }),
      ...(number(data.step) === undefined ? {} : { step: number(data.step) }),
      ...(tool === undefined ? {} : { tool }),
      ...(sourceKind === undefined ? {} : { sourceKind }),
      ...(abortPrefix === undefined ? {} : { abortPrefix }),
      ...(command === undefined ? {} : { command }),
      ...(values === undefined ? {} : { argumentValues: values }),
      ...(failed === undefined ? {} : { failed }),
      ...(callId === undefined ? {} : { callId }),
      ...(errorName === undefined ? {} : { errorName }),
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(turnEnd === undefined ? {} : { turnEnd }),
      ...(usage === undefined ? {} : { usage }),
      ...(goalOperation === undefined ? {} : { goalOperation }),
      ...(goalId === undefined ? {} : { goalId }),
      ...(goalPhase === undefined ? {} : { goalPhase }),
      ...(goalRounds === undefined ? {} : { goalRounds }),
      ...(checkpointOutcome === undefined ? {} : { checkpointOutcome }),
      ...(checkpointVerifiedCount === undefined ? {} : { checkpointVerifiedCount }),
      ...(checkpointRemainingCount === undefined ? {} : { checkpointRemainingCount }),
      ...(checkpointParallel === undefined ? {} : { checkpointParallel }),
    })
    if (type === 'turn/end') currentTurn = undefined
  }
  return records
}
