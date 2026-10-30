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
  /** Raw tool-call argument JSON, kept unparsed until a predicate needs a field. */
  readonly arguments?: string
  readonly failed?: true
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

/**
 * Extract the aggregation records a session owns.
 *
 * `start` is the session's durable inheritance boundary: a fork seed copies a
 * parent prefix and owns only what follows it.
 */
export function extractRecords(
  sessionId: string,
  events: readonly SessionEvent[],
  start = 0,
): TraceRecord[] {
  const records: TraceRecord[] = []
  const callById = new Map<string, { tool: string; arguments?: string }>()
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
    let args: string | undefined
    switch (type) {
      case 'tool/call': {
        tool = text(data.name)
        args = text(data.arguments)
        const callId = text(data.callId)
        if (tool !== undefined && callId !== undefined) {
          callById.set(callId, args === undefined ? { tool } : { tool, arguments: args })
        }
        break
      }
      case 'tool/result': {
        const message = asRecord(data.message)
        const source = asRecord(message?.source)
        const callId = text(source?.callId)
        const call = callId === undefined ? undefined : callById.get(callId)
        tool = call?.tool
        // Keep the originating call's arguments with its result, so an
        // argument-scoped signal can own the failure without message text.
        args = call?.arguments
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
        if (reason?.kind === 'error') failed = true
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
      ...(args === undefined ? {} : { arguments: args }),
      ...(failed === undefined ? {} : { failed }),
    })
    if (type === 'turn/end') currentTurn = undefined
  }
  return records
}
