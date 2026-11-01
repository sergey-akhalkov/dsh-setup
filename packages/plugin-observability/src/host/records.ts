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
  /**
   * A delegate result's classification, kept as a boolean: false means the
   * result reports reuse or a pending/queued run, so it is not a worker start.
   */
  readonly delegateStarted?: boolean
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
  /** `work_checkpoint` outcome word; the lists and plan text are dropped. */
  readonly checkpointOutcome?: string
  /** Length of the checkpoint's verified list, never its text. */
  readonly checkpointVerifiedCount?: number
  /** Lanes the checkpoint plan declared; the lane text is dropped. */
  readonly checkpointLaneCount?: number
  /** Lanes the plan left `blocked`; the lane text is dropped. */
  readonly checkpointBlockedLaneCount?: number
  /** Whether the plan computes parallel work; the declaration flag is gone. */
  readonly checkpointParallelComputed?: boolean
  /** The bottleneck remedy the checkpoint declared, never its owner or targets. */
  readonly checkpointBottleneckAction?: string
  /** Consecutive same-session checkpoints with this bottleneck owner and blocking set. */
  readonly checkpointBottleneckAge?: number
  /** Whether the declared remedy was matched before the next checkpoint or turn end. */
  readonly checkpointRemedyResolved?: boolean
  /** Completion time of the matched remedy evidence; absent when nothing matched. */
  readonly checkpointRemedyResolvedAt?: number
}

/** The tool that records a work checkpoint. */
const CHECKPOINT_TOOL = 'work_checkpoint'

/**
 * The tools that start a worker. The plugin gate additionally requires the
 * checkpoint id in the arguments; this metric does not, so it stays metadata.
 */
export const WORKER_START_TOOLS: ReadonlySet<string> = new Set([
  'subagent',
  'subagent_fork',
  'spawn_teammate',
  'workflow',
  'delegate',
])

/** Every field the checkpoint producer accepts; a removed or unknown field is malformed. */
const CHECKPOINT_FIELDS: ReadonlySet<string> = new Set([
  'outcome',
  'verified',
  'lanes',
  'bottleneck',
  'next',
])

/** The producer's list bound; a longer list is malformed. */
const MAX_CHECKPOINT_ITEMS = 8

/** The fields the producer accepts on one lane; an unknown nested field is malformed. */
const CHECKPOINT_LANE_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'owner',
  'scope',
  'state',
  'blockedBy',
])

/** The fields the producer accepts on a bottleneck; an unknown nested field is malformed. */
const CHECKPOINT_BOTTLENECK_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'owner',
  'action',
  'blockingLanes',
  'targets',
])

/** One lane of the checkpoint plan; kept in memory only, never in a record. */
interface CheckpointLane {
  readonly id: string
  readonly owner: string
  readonly scope: readonly string[]
  readonly state: 'running' | 'blocked' | 'done'
  readonly blockedBy: readonly string[]
}

/** One bottleneck remedy; the owner, lanes, and targets never reach a record. */
interface CheckpointBottleneck {
  readonly owner: string
  readonly action: 'worker_start' | 'lead_action' | 'user_decision'
  readonly blockingLaneIds: readonly string[]
  readonly targets: readonly string[]
}

/** Only a checkpoint's validated metadata survives extraction. */
interface CheckpointFacts {
  readonly outcome: 'done' | 'continue'
  readonly verified: number
  readonly lanes: readonly CheckpointLane[]
  readonly bottleneck?: CheckpointBottleneck
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

/** A present, bounded string list, trimmed as the producer trims it. */
function checkpointStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CHECKPOINT_ITEMS) return undefined
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return undefined
    items.push(item.trim())
  }
  return items
}

/** Validate the lane plan; an unknown nested field, duplicate id, or bad `blockedBy` is malformed. */
function checkpointLanes(value: unknown): readonly CheckpointLane[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_CHECKPOINT_ITEMS) return undefined
  const lanes: CheckpointLane[] = []
  const ids = new Set<string>()
  for (const item of value) {
    const lane = asRecord(item)
    if (lane === undefined) return undefined
    if (!Object.keys(lane).every((key) => CHECKPOINT_LANE_FIELDS.has(key))) return undefined
    const id = text(lane.id)?.trim()
    const owner = text(lane.owner)?.trim()
    const state = lane.state
    if (id === undefined || id === '') return undefined
    if (owner === undefined || owner === '') return undefined
    if (state !== 'running' && state !== 'blocked' && state !== 'done') return undefined
    const scope = checkpointStringList(lane.scope)
    if (scope === undefined || scope.length === 0) return undefined
    const blockedBy = lane.blockedBy === undefined ? [] : checkpointStringList(lane.blockedBy)
    if (blockedBy === undefined || ids.has(id)) return undefined
    ids.add(id)
    lanes.push({ id, owner, scope, state, blockedBy })
  }
  for (const lane of lanes) {
    for (const id of lane.blockedBy) {
      if (!ids.has(id)) return undefined
    }
  }
  return lanes
}

/** Validate the bottleneck; absent is undefined and malformed is null. */
function checkpointBottleneck(value: unknown): CheckpointBottleneck | null | undefined {
  if (value === undefined) return undefined
  const source = asRecord(value)
  if (source === undefined) return null
  if (!Object.keys(source).every((key) => CHECKPOINT_BOTTLENECK_FIELDS.has(key))) return null
  const id = text(source.id)?.trim()
  const owner = text(source.owner)?.trim()
  const action = source.action
  if (id === undefined || id === '') return null
  if (owner === undefined || owner === '') return null
  if (action !== 'worker_start' && action !== 'lead_action' && action !== 'user_decision') {
    return null
  }
  const blockingLaneIds =
    source.blockingLanes === undefined ? [] : checkpointStringList(source.blockingLanes)
  const targets = source.targets === undefined ? [] : checkpointStringList(source.targets)
  if (blockingLaneIds === undefined || targets === undefined) return null
  if (action === 'lead_action' && targets.length === 0) return null
  return { owner, action, blockingLaneIds, targets }
}

/**
 * Read a checkpoint's validated plan. A call is valid only as the producer
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
  if (typeof source.next !== 'string' || source.next.trim() === '') return undefined
  const verified = checkpointListLength(source.verified)
  if (verified === undefined) return undefined
  const lanes = checkpointLanes(source.lanes)
  if (lanes === undefined) return undefined
  const bottleneck = checkpointBottleneck(source.bottleneck)
  if (bottleneck === null) return undefined
  // A `continue` checkpoint carries a non-empty lane plan and a bottleneck; a
  // `done` close may omit both. The producer accepts any bounded `blockingLanes`
  // string list, so an entry that names no lane is not malformed here.
  if (outcome === 'continue' && (lanes.length === 0 || bottleneck === undefined)) {
    return undefined
  }
  return { outcome, verified, lanes, ...(bottleneck === undefined ? {} : { bottleneck }) }
}

/** The virtual root of the relative path space; no real path can contain it. */
const RELATIVE_PATH_ROOT = '\u0000'

/** Virtual ancestors above the working directory, so any parent depth stays comparable. */
const RELATIVE_PATH_BASE: readonly string[] = Object.freeze([
  ...Array.from({ length: 16 }, () => 'p'),
  'cwd',
])

/**
 * Normalize a path-like scope the way the checkpoint producer does: separators
 * unified, dot segments resolved, case folded, and a relative path resolved from
 * a fixed ancestor chain so `../..` still contains `src`.
 */
function normalizedPath(value: string): string {
  const unified = value.trim().replace(/\\/g, '/')
  const rooted = unified.startsWith('/') || /^[A-Za-z]:(\/|$)/u.test(unified)
  const parts: string[] = rooted ? [] : [...RELATIVE_PATH_BASE]
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // An unmatched parent stays visible, so '../a' never collapses onto 'a'.
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!rooted) parts.push('..')
      continue
    }
    parts.push(part)
  }
  const joined = parts.join('/').toLowerCase()
  return rooted ? `/${joined}` : `${RELATIVE_PATH_ROOT}${joined}`
}

/** Whether one normalized path equals another or lies beneath it by path component. */
function pathIsWithin(path: string, root: string): boolean {
  if (path === root) return true
  if (root === '/') return path.startsWith('/')
  return path.startsWith(`${root}/`)
}

/** Whether two scopes overlap; a `resource:` scope is compared exactly. */
function scopesOverlap(left: string, right: string): boolean {
  const a = left.trim()
  const b = right.trim()
  if (a.startsWith('resource:') || b.startsWith('resource:')) return a === b
  const normalizedLeft = normalizedPath(a)
  const normalizedRight = normalizedPath(b)
  return (
    pathIsWithin(normalizedLeft, normalizedRight) || pathIsWithin(normalizedRight, normalizedLeft)
  )
}

function laneScopesOverlap(left: CheckpointLane, right: CheckpointLane): boolean {
  return left.scope.some((a) => right.scope.some((b) => scopesOverlap(a, b)))
}

/** A lane is runnable when it runs and every lane it waits on is done. */
function laneIsRunnable(lane: CheckpointLane, byId: ReadonlyMap<string, CheckpointLane>): boolean {
  return lane.state === 'running' && lane.blockedBy.every((id) => byId.get(id)?.state === 'done')
}

/** Two runnable lanes with different owners and disjoint scopes compute parallel work. */
function planComputesParallel(lanes: readonly CheckpointLane[]): boolean {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  const runnable = lanes.filter((lane) => laneIsRunnable(lane, byId))
  for (let left = 0; left < runnable.length; left += 1) {
    for (let right = left + 1; right < runnable.length; right += 1) {
      const a = runnable[left]
      const b = runnable[right]
      if (a === undefined || b === undefined) continue
      if (a.owner !== b.owner && !laneScopesOverlap(a, b)) return true
    }
  }
  return false
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
  return Object.keys(values).length === 0 ? undefined : values
}

/** One call's identity across a session, so a call and its result join. */
function callKey(sessionId: string, callId: string): string {
  return `${sessionId}\u0000${callId}`
}

/** A write destination, read only to match a bottleneck target and never kept. */
function filePathOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  return text(asRecord(parsed)?.file_path)
}

/** Whether a write destination equals a declared target or lies beneath it by component. */
function matchesTargets(filePath: string, targets: readonly string[]): boolean {
  const normalized = normalizedPath(filePath)
  return targets.some((target) => pathIsWithin(normalized, normalizedPath(target)))
}

/** The text blocks of a tool result message; read only to classify a delegate result. */
function toolResultText(message: Record<string, unknown> | undefined): string {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record?.type !== 'text') continue
    const value = text(record.text)
    if (value !== undefined) parts.push(value)
  }
  return parts.join('\n')
}

/** Whether a delegate result reports a started run rather than a cached, pending, or queued one. */
function delegateStarted(resultText: string): boolean {
  if (
    resultText
      .trimEnd()
      .endsWith('(no gate record: this answer does not satisfy a strict review rule)')
  ) {
    return true
  }
  const first = resultText.split(/\r?\n/u)[0] ?? ''
  if (/^rule "[^"]+" review (?:already pending|queued)$/u.test(first)) return false
  // Only the engine's own cached-record envelope is reuse, exactly as the gate classifies it.
  return !/^rule "[^"]+" (?:PASS|FINDINGS|ERROR) \(reused record /u.test(first)
}

/**
 * The completion time of the bottleneck's remedy in the window between the
 * checkpoint and the next one, or undefined when nothing matched. Only a
 * recorded successful result is evidence; the plugin gate's exact tagged-id
 * rule is not part of this metric.
 */
function remedyMatches(
  records: readonly TraceRecord[],
  start: number,
  end: number,
  bottleneck: CheckpointBottleneck,
  filePaths: ReadonlyMap<string, string>,
): number | undefined {
  const results = new Map<string, number>()
  const failed = new Set<string>()
  const notStarted = new Set<string>()
  let earliest: number | undefined
  const note = (time: number): void => {
    if (earliest === undefined || time < earliest) earliest = time
  }
  for (let index = start + 1; index < end; index += 1) {
    const record = records[index]
    if (record === undefined || record.eventType !== 'tool/result') continue
    if (record.callId === undefined) continue
    const key = callKey(record.sessionId, record.callId)
    results.set(key, record.time)
    if (record.failed === true) failed.add(key)
    if (record.delegateStarted === false) notStarted.add(key)
  }
  for (let index = start + 1; index < end; index += 1) {
    const record = records[index]
    if (record === undefined || record.eventType !== 'tool/call' || record.tool === undefined) {
      continue
    }
    if (record.callId === undefined) continue
    const key = callKey(record.sessionId, record.callId)
    const completedAt = results.get(key)
    if (completedAt === undefined || failed.has(key)) continue
    if (bottleneck.action === 'user_decision' && record.tool === 'ask_user_question') {
      note(completedAt)
      continue
    }
    if (bottleneck.action === 'worker_start' && WORKER_START_TOOLS.has(record.tool)) {
      if (record.tool === 'delegate' && notStarted.has(key)) continue
      note(completedAt)
      continue
    }
    if (
      bottleneck.action === 'lead_action' &&
      (record.tool === 'edit' || record.tool === 'write')
    ) {
      const filePath = filePaths.get(key)
      if (filePath !== undefined && matchesTargets(filePath, bottleneck.targets)) note(completedAt)
    }
  }
  return earliest
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
  const checkpointFactsByIndex = new Map<number, CheckpointFacts>()
  const lastBottleneck = new Map<
    string,
    { owner: string; blocking: string; states: ReadonlyMap<string, string>; age: number }
  >()
  // The write destination is read for remedy matching only; it never reaches a record.
  const filePaths = new Map<string, string>()
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
    let delegateStartedValue: boolean | undefined
    let turnEnd: string | undefined
    let usage: TokenUsage | undefined
    let goalOperation: string | undefined
    let goalId: string | undefined
    let goalPhase: string | undefined
    let goalRounds: number | undefined
    let checkpointOutcome: string | undefined
    let checkpointVerifiedCount: number | undefined
    let checkpointLaneCount: number | undefined
    let checkpointBlockedLaneCount: number | undefined
    let checkpointParallelComputed: boolean | undefined
    let checkpointBottleneckAction: string | undefined
    let checkpointBottleneckAge: number | undefined
    switch (type) {
      case 'tool/call': {
        tool = text(data.name)
        callId = text(data.callId)
        if (tool === CHECKPOINT_TOOL) {
          const facts = checkpointFacts(text(data.arguments))
          checkpointOutcome = facts?.outcome
          checkpointVerifiedCount = facts?.verified
          if (facts !== undefined) {
            checkpointFactsByIndex.set(records.length, facts)
            checkpointLaneCount = facts.lanes.length
            checkpointBlockedLaneCount = facts.lanes.filter(
              (lane) => lane.state === 'blocked',
            ).length
            checkpointParallelComputed = planComputesParallel(facts.lanes)
            checkpointBottleneckAction = facts.bottleneck?.action
            if (facts.bottleneck === undefined) {
              lastBottleneck.delete(sessionId)
            } else {
              const blockingIds = [...new Set(facts.bottleneck.blockingLaneIds)].sort()
              const blocking = blockingIds.join('\u0000')
              // The producer resets the age when a blocking lane changes state.
              const states = new Map(facts.lanes.map((lane) => [lane.id, lane.state]))
              const previous = lastBottleneck.get(sessionId)
              const unchanged =
                previous !== undefined &&
                previous.owner === facts.bottleneck.owner &&
                previous.blocking === blocking &&
                blockingIds.every((id) => previous.states.get(id) === states.get(id))
              const age = previous !== undefined && unchanged ? previous.age + 1 : 1
              checkpointBottleneckAge = age
              lastBottleneck.set(sessionId, {
                owner: facts.bottleneck.owner,
                blocking,
                states,
                age,
              })
            }
          }
          values = checkpointArgumentValues(facts, fields?.get(tool))
        } else {
          values = argumentValues(
            text(data.arguments),
            tool === undefined ? undefined : fields?.get(tool),
          )
          if ((tool === 'edit' || tool === 'write') && callId !== undefined) {
            const filePath = filePathOf(text(data.arguments))
            if (filePath !== undefined) filePaths.set(callKey(sessionId, callId), filePath)
          }
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
        if (tool === 'delegate') delegateStartedValue = delegateStarted(toolResultText(message))
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
      ...(delegateStartedValue === undefined ? {} : { delegateStarted: delegateStartedValue }),
      ...(turnEnd === undefined ? {} : { turnEnd }),
      ...(usage === undefined ? {} : { usage }),
      ...(goalOperation === undefined ? {} : { goalOperation }),
      ...(goalId === undefined ? {} : { goalId }),
      ...(goalPhase === undefined ? {} : { goalPhase }),
      ...(goalRounds === undefined ? {} : { goalRounds }),
      ...(checkpointOutcome === undefined ? {} : { checkpointOutcome }),
      ...(checkpointVerifiedCount === undefined ? {} : { checkpointVerifiedCount }),
      ...(checkpointLaneCount === undefined ? {} : { checkpointLaneCount }),
      ...(checkpointBlockedLaneCount === undefined ? {} : { checkpointBlockedLaneCount }),
      ...(checkpointParallelComputed === undefined ? {} : { checkpointParallelComputed }),
      ...(checkpointBottleneckAction === undefined ? {} : { checkpointBottleneckAction }),
      ...(checkpointBottleneckAge === undefined ? {} : { checkpointBottleneckAge }),
    })
    if (type === 'turn/end') currentTurn = undefined
  }
  // The remedy window ends at the earlier of the next checkpoint and this
  // checkpoint's turn end; an absent bottleneck needs no remedy.
  const indices = [...checkpointFactsByIndex.keys()].sort((left, right) => left - right)
  for (let position = 0; position < indices.length; position += 1) {
    const index = indices[position]
    if (index === undefined) continue
    const facts = checkpointFactsByIndex.get(index)
    const checkpoint = records[index]
    if (facts?.outcome !== 'continue' || facts.bottleneck === undefined) continue
    if (checkpoint === undefined) continue
    const next = indices[position + 1]
    let turnEnd: number | undefined
    for (let cursor = index + 1; cursor < records.length; cursor += 1) {
      const record = records[cursor]
      if (record === undefined || record.eventType !== 'turn/end') continue
      if (checkpoint.turn !== undefined && record.turn !== checkpoint.turn) continue
      turnEnd = cursor
      break
    }
    const end = Math.min(next ?? records.length, turnEnd ?? records.length)
    const resolvedAt = remedyMatches(records, index, end, facts.bottleneck, filePaths)
    records[index] = {
      ...checkpoint,
      checkpointRemedyResolved: resolvedAt !== undefined,
      ...(resolvedAt === undefined ? {} : { checkpointRemedyResolvedAt: resolvedAt }),
    }
  }
  return records
}
