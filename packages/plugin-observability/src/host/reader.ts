import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionEventRecord,
  SessionLogSnapshot,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import { type Range, rangeWindow } from './aggregate.js'
import type { SessionCache } from './cache.js'
import {
  type ArgumentFieldMap,
  extractRecords,
  type SessionMeta,
  type TraceRecord,
} from './records.js'

/** One read's neutral records and the header metadata of the sessions they came from. */
export interface SessionReadResult {
  readonly records: readonly TraceRecord[]
  readonly sessions: readonly SessionMeta[]
}

/** Keep only the header fields the report uses, so no path or preset text travels. */
function sessionMeta(header: SessionHeader): SessionMeta {
  return {
    id: String(header.id),
    ...(header.parentSession === undefined ? {} : { parentSession: String(header.parentSession) }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }),
  }
}

/** The narrow part of `ctx.sessionQuery` the reader drives; tests fake it. */
export interface SessionQueryService {
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  readSession(sessionId: SessionId): Promise<SessionLogSnapshot>
  listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>
  /** Optional batch title lookup; a fake without it still reports failures. */
  readTitleSnapshots?(sessionIds: readonly SessionId[]): Promise<readonly TitleObservation[]>
}

/** The part of one title observation the failure list uses. */
export interface TitleObservation {
  readonly sessionId: SessionId
  readonly status: 'fulfilled' | 'rejected'
  readonly value?: { readonly title?: { readonly title?: string } }
}

/** Resolve titles for the unique failure sessions; every failure mode drops a title only. */
export async function readSessionTitles(
  query: SessionQueryService,
  sessionIds: readonly SessionId[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const unique = [...new Set(sessionIds.map((id) => String(id)))] as SessionId[]
  if (unique.length === 0 || query.readTitleSnapshots === undefined) return titles
  let observations: readonly TitleObservation[]
  try {
    observations = await query.readTitleSnapshots(unique)
  } catch {
    return titles
  }
  for (const observation of observations) {
    if (observation.status !== 'fulfilled') continue
    const title = observation.value?.title?.title
    if (title !== undefined && title !== '') titles.set(String(observation.sessionId), title)
  }
  return titles
}

/** How many sessions the reader opens at once. */
export const READ_CONCURRENCY = 4

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) return
      results[index] = await run(item)
    }
  }
  const width = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: width }, worker))
  return results
}

/** Modification stamp: event count plus newest event time. */
function modificationStamp(events: readonly SessionEventRecord[]): string {
  let newest = 0
  for (const event of events) {
    if (event.time > newest) newest = event.time
  }
  return `${String(events.length)}:${String(newest)}`
}

/**
 * Whether a session was alive during the window. A session whose events fall
 * only on both sides of the window still overlaps it — with a long idle-gap
 * setting an episode can span the whole window with no event inside it.
 */
function overlaps(events: readonly SessionEventRecord[], from: number, to: number): boolean {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const event of events) {
    if (event.time < first) first = event.time
    if (event.time > last) last = event.time
  }
  return first < to && last >= from
}

export interface ReadSessionsOptions {
  readonly query: SessionQueryService
  readonly range: Range
  readonly now: number
  /** Explicit window override; the baseline uses the previous equal window. */
  readonly window?: { readonly from: number; readonly to: number }
  /** Open session; scopes `session` ranges and the workspace of wider ranges. */
  readonly sessionId?: SessionId | undefined
  readonly concurrency?: number
  readonly cache?: SessionCache
  /** Argument fields the configured predicates read; nothing else is kept. */
  readonly argumentFields?: ArgumentFieldMap
}

/** Extract one session's own records, serving an unchanged session from memory. */
async function readOne(
  query: SessionQueryService,
  id: SessionId,
  stamp: string,
  cache: SessionCache | undefined,
  fields: ArgumentFieldMap | undefined,
  listed?: SessionMeta,
): Promise<{ records: TraceRecord[]; meta?: SessionMeta }> {
  const cached = cache?.get(String(id), stamp)
  if (cached !== undefined) {
    return cached.meta === undefined
      ? { records: [...cached.records] }
      : { records: [...cached.records], meta: cached.meta }
  }
  const snapshot = await query.readSession(id)
  const records = extractRecords(id, snapshot.events, Number(snapshot.inheritedEventCount), fields)
  const meta = listed ?? sessionMeta(snapshot.session)
  cache?.set(String(id), stamp, records, meta)
  return { records, meta }
}

/** Add every descendant of the seed sessions through the parent links. */
function addDescendants(records: readonly SessionRecord[], ids: Set<SessionId>): void {
  for (let changed = true; changed; ) {
    changed = false
    for (const record of records) {
      const parent = record.header.parentSession
      if (parent !== undefined && ids.has(parent) && !ids.has(record.header.id)) {
        ids.add(record.header.id)
        changed = true
      }
    }
  }
}

/** Add every ancestor a selected session records, so its episode can be rebuilt. */
function addAncestors(byId: ReadonlyMap<SessionId, SessionRecord>, ids: Set<SessionId>): void {
  for (let changed = true; changed; ) {
    changed = false
    for (const id of [...ids]) {
      const parent = byId.get(id)?.header.parentSession
      if (parent === undefined || ids.has(parent) || !byId.has(parent)) continue
      ids.add(parent)
      changed = true
    }
  }
}

/** Nearest cwd on the ancestor chain, if any ancestor records one. */
function ancestorCwd(
  byId: ReadonlyMap<SessionId, SessionRecord>,
  start: SessionId,
): string | undefined {
  const seen = new Set<SessionId>()
  let cursor = byId.get(start)
  while (cursor !== undefined && !seen.has(cursor.header.id)) {
    seen.add(cursor.header.id)
    if (cursor.header.cwd !== undefined) return cursor.header.cwd
    const parent = cursor.header.parentSession
    cursor = parent === undefined ? undefined : byId.get(parent)
  }
  return undefined
}

/** Current session, its ancestors, and every descendant: the fallback scope without a cwd. */
function lineageIds(
  records: readonly SessionRecord[],
  byId: ReadonlyMap<SessionId, SessionRecord>,
  start: SessionId,
): Set<SessionId> {
  const ids = new Set<SessionId>([start])
  let cursor = byId.get(start)
  while (cursor?.header.parentSession !== undefined) {
    const parent = cursor.header.parentSession
    if (ids.has(parent)) break
    ids.add(parent)
    cursor = byId.get(parent)
  }
  addDescendants(records, ids)
  return ids
}

/** The workspace records a session's range covers: same cwd (or lineage), descendants included. */
function scopeRecords(
  records: readonly SessionRecord[],
  byId: ReadonlyMap<SessionId, SessionRecord>,
  current: SessionRecord,
): SessionRecord[] {
  let ids: Set<SessionId>
  const cwd =
    current.header.cwd === undefined ? ancestorCwd(byId, current.header.id) : current.header.cwd
  if (cwd === undefined) {
    // A session with no cwd anywhere on its chain falls back to its lineage, so
    // unrelated workspaces are not pulled in.
    ids = lineageIds(records, byId, current.header.id)
  } else {
    ids = new Set(
      records.filter((record) => record.header.cwd === cwd).map((record) => record.header.id),
    )
    addDescendants(records, ids)
    for (const id of lineageIds(records, byId, current.header.id)) ids.add(id)
  }
  return records.filter((record) => ids.has(record.header.id))
}

/** Read one session set with a modification stamp per session. */
async function readSessionSet(
  query: SessionQueryService,
  ids: Iterable<SessionId>,
  byId: ReadonlyMap<SessionId, SessionRecord>,
  limit: number,
  cache: SessionCache | undefined,
  fields: ArgumentFieldMap | undefined,
): Promise<SessionReadResult> {
  const read = await mapLimit([...ids], limit, async (id) => {
    const events = await query.listEvents(id)
    const record = byId.get(id)
    return readOne(
      query,
      id,
      modificationStamp(events),
      cache,
      fields,
      record === undefined ? undefined : sessionMeta(record.header),
    )
  })
  return {
    records: read.flatMap((entry) => entry.records),
    sessions: read.flatMap((entry) => (entry.meta === undefined ? [] : [entry.meta])),
  }
}

/**
 * Read every session a range covers and return the neutral records it owns
 * together with the header metadata of the sessions they came from.
 *
 * A `session` range reads the open session and every descendant it started,
 * because a subagent's work belongs to that session's episodes. Wider ranges
 * read every session in the same workspace whose events fall in the window. A
 * fork seed's copied prefix is skipped at `inheritedEventCount`, so a parent's
 * events count once.
 */
export async function readSessions(options: ReadSessionsOptions): Promise<SessionReadResult> {
  const { query, range, now, sessionId, cache, argumentFields } = options
  const limit = options.concurrency ?? READ_CONCURRENCY
  const window = options.window ?? rangeWindow(range, now, 0)

  if (range === 'session') {
    if (sessionId === undefined) return { records: [], sessions: [] }
    const listed = await query.listSessions()
    const byId = new Map(listed.map((record) => [record.header.id, record]))
    const ids = new Set<SessionId>([sessionId])
    addDescendants(listed, ids)
    return readSessionSet(query, ids, byId, limit, cache, argumentFields)
  }

  const records = await query.listSessions()
  const byId = new Map(records.map((record) => [record.header.id, record]))
  const current = sessionId === undefined ? undefined : byId.get(sessionId)
  if (sessionId !== undefined && current === undefined) {
    // The open session is not in the corpus: do not guess a wider scope.
    return { records: [], sessions: [] }
  }
  const workspace = current === undefined ? records : scopeRecords(records, byId, current)

  const listed = await mapLimit(workspace, limit, async (record) => {
    const events = await query.listEvents(record.header.id)
    return { record, events, stamp: modificationStamp(events) }
  })
  const selected = listed.filter((entry) => overlaps(entry.events, window.from, window.to))
  // A child can overlap the window while its parent does not; read the parent
  // chain too, or the human message that started the episode is unavailable.
  const selectedIds = new Set(selected.map((entry) => entry.record.header.id))
  addAncestors(byId, selectedIds)
  for (const entry of selected) selectedIds.delete(entry.record.header.id)
  const listedById = new Map(listed.map((entry) => [entry.record.header.id, entry]))
  const fromWorkspace = [...selectedIds].flatMap((id) => {
    const entry = listedById.get(id)
    return entry === undefined ? [] : [entry]
  })
  const outside = [...selectedIds]
    .filter((id) => !listedById.has(id))
    .flatMap((id) => {
      const record = byId.get(id)
      return record === undefined ? [] : [record]
    })
  const outsideListed = await mapLimit(outside, limit, async (record) => {
    const events = await query.listEvents(record.header.id)
    return { record, events, stamp: modificationStamp(events) }
  })
  const extraListed = [...fromWorkspace, ...outsideListed]

  const read = await mapLimit([...selected, ...extraListed], limit, async (entry) =>
    readOne(
      query,
      entry.record.header.id,
      entry.stamp,
      cache,
      argumentFields,
      sessionMeta(entry.record.header),
    ),
  )
  return {
    records: read.flatMap((entry) => entry.records),
    sessions: read.flatMap((entry) => (entry.meta === undefined ? [] : [entry.meta])),
  }
}

/** The previous window or session a report compares against. */
export interface BaselineRead extends SessionReadResult {
  readonly kind: 'previous equal window' | 'previous completed session'
  readonly from: number
  readonly to: number
}

/** A baseline read starts from the current report window's first instant. */
export interface BaselineOptions extends ReadSessionsOptions {
  /** The current window's start; the previous equal window ends there. */
  readonly windowFrom: number
  /** The current window's end, so the baseline covers the same duration. */
  readonly windowTo: number
}

/**
 * Whether the corpus has activity inside the bounds, counting an interval that
 * crosses them even without an event of its own inside.
 */
function hasActivity(records: readonly TraceRecord[], from: number, to: number): boolean {
  const ends = new Map<string, number>()
  for (const record of records) {
    const session = String(record.sessionId)
    if (record.eventType === 'step/end') {
      ends.set(`${session}:step:${String(record.turn)}:${String(record.step)}`, record.time)
    }
    if (record.eventType === 'tool/result') {
      ends.set(`${session}:call:${record.callId ?? ''}`, record.time)
    }
  }
  for (const record of records) {
    const session = String(record.sessionId)
    if (record.time >= from && record.time < to) return true
    const end =
      record.eventType === 'step/start'
        ? ends.get(`${session}:step:${String(record.turn)}:${String(record.step)}`)
        : record.eventType === 'tool/call'
          ? ends.get(`${session}:call:${record.callId ?? ''}`)
          : undefined
    if (end !== undefined && record.time < to && end >= from) return true
  }
  return false
}

/**
 * Read the comparison corpus. Day, week, and month read the previous equal
 * window through the same session query; the session range reads the previous
 * completed session in the same workspace, or none. Nothing is written and the
 * per-session cache is reused.
 */
export async function readBaseline(options: BaselineOptions): Promise<BaselineRead | undefined> {
  const { query, range, sessionId, cache, argumentFields, windowFrom, windowTo } = options
  const limit = options.concurrency ?? READ_CONCURRENCY
  if (range !== 'session') {
    // The previous equal window: same duration, ending where the current begins.
    const length = Math.max(1, windowTo - windowFrom)
    const previousWindow = { from: windowFrom - length, to: windowFrom }
    const previous = await readSessions({
      query,
      range,
      now: windowFrom - 1,
      window: previousWindow,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(cache === undefined ? {} : { cache }),
      ...(argumentFields === undefined ? {} : { argumentFields }),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
    if (!hasActivity(previous.records, previousWindow.from, previousWindow.to)) return undefined
    return {
      kind: 'previous equal window',
      from: previousWindow.from,
      to: previousWindow.to,
      ...previous,
    }
  }
  if (sessionId === undefined) return undefined
  const records = await query.listSessions()
  const byId = new Map(records.map((record) => [record.header.id, record]))
  const current = byId.get(sessionId)
  if (current === undefined) return undefined
  const scope = scopeRecords(records, byId, current)
  const lineage = lineageIds(records, byId, current.header.id)
  const currentEvents = await query.listEvents(sessionId)
  const currentStart = currentEvents.reduce(
    (earliest, value) => Math.min(earliest, value.time),
    Number.POSITIVE_INFINITY,
  )
  const candidates = scope.filter(
    (record) => record.header.id !== sessionId && !lineage.has(record.header.id),
  )
  const probed = await mapLimit(candidates, limit, async (record) => {
    const events = await query.listEvents(record.header.id)
    const last = events.reduce(
      (latest, value) => Math.max(latest, value.time),
      Number.NEGATIVE_INFINITY,
    )
    // Completed means the latest turn lifecycle is an end, not a later start.
    const turnEvents = events
      .filter((value) => value.type === 'turn/start' || value.type === 'turn/end')
      .sort((left, right) => left.time - right.time || left.seq - right.seq)
    const latestTurn = turnEvents[turnEvents.length - 1]
    return {
      record,
      last,
      completed: latestTurn?.type === 'turn/end',
    }
  })
  const previous = probed
    .filter((entry) => entry.completed && entry.last < currentStart)
    .sort((left, right) => right.last - left.last)[0]
  if (previous === undefined) return undefined
  const ids = new Set<SessionId>([previous.record.header.id])
  addDescendants(records, ids)
  const read = await readSessionSet(query, ids, byId, limit, cache, argumentFields)
  const times = read.records.map((entry) => entry.time)
  if (times.length === 0) return undefined
  return {
    kind: 'previous completed session',
    from: times.reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY),
    to: times.reduce((latest, value) => Math.max(latest, value), Number.NEGATIVE_INFINITY) + 1,
    ...read,
  }
}
