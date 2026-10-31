import type { SessionEvent } from '@deepseek-ai/dsh-session'

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
    switch (type) {
      case 'tool/call': {
        tool = text(data.name)
        callId = text(data.callId)
        values = argumentValues(
          text(data.arguments),
          tool === undefined ? undefined : fields?.get(tool),
        )
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
    })
    if (type === 'turn/end') currentTurn = undefined
  }
  return records
}
