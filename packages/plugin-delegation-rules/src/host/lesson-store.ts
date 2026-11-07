import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { FINDING_CLASSES, type FindingClass, hasMachinePath } from '../shared/approval.js'
import { workspaceKeyOf } from './finding-history.js'

/**
 * Local lesson store: one JSONL record per lesson revision under
 * `.dsh/review-learning/<workspaceKey>.jsonl`. The store is untracked scratch,
 * bounded, and deduped by normalized class + title. It is never an instruction:
 * only a direct user answer moves a lesson past `proposed`.
 */
export const DEFAULT_MAX_LESSONS = 200
export const MAX_STORE_BYTES = 1_000_000
const MAX_TITLE_CHARS = 200
const MAX_BODY_CHARS = 2_000
const MAX_SCOPE_ITEMS = 10
const MAX_SOURCE_HASHES = 20
const LESSON_STATUSES: ReadonlySet<string> = new Set([
  'proposed',
  'accepted',
  'rejected',
  'applied',
])
const SECRET_PATTERN =
  /(?:\bsk-[A-Za-z0-9_-]{8,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:token|password|passwd|secret|api[_-]?key|private[_-]?key)\s*[=:]\s*\S+)/iu

export type LessonStatus = 'proposed' | 'accepted' | 'rejected' | 'applied'

export interface LessonScope {
  /** Rule ids, or `*`; an empty list matches any rule. */
  rules: string[]
  /** Change delta capability names; an empty list matches any change. */
  capabilities: string[]
}

export interface LessonSource {
  change?: string
  taskId?: string
  findingHashes?: string[]
}

export interface Lesson {
  v: 1
  /** Revision identity; a duplicate proposal never mutates an accepted record. */
  id: string
  class: FindingClass
  title: string
  body: string
  appliesTo: LessonScope
  status: LessonStatus
  source: LessonSource
  createdAt: number
  decidedAt?: number
  appliedIn?: string
  /** The accepted lesson a proposed revision would replace. */
  supersedes?: string
}

/** A validation problem, the bounded-store refusal, or a held store lock. */
export class LessonStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'capacity' | 'not-found' | 'transition' | 'locked',
  ) {
    super(message)
    this.name = 'LessonStoreError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clip(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

function requireText(value: unknown, at: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LessonStoreError(`${at} must be a non-empty string`, 'validation')
  }
  if (hasMachinePath(value)) {
    throw new LessonStoreError(`${at} must not contain a machine path`, 'validation')
  }
  if (SECRET_PATTERN.test(value)) {
    throw new LessonStoreError(`${at} must not contain a credential`, 'validation')
  }
  return clip(value.trim(), maximum)
}

function stringList(value: unknown, at: string, maximum: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum) {
    throw new LessonStoreError(`${at} must be a list of at most ${maximum} strings`, 'validation')
  }
  return value.map((item) => requireText(item, at, 120))
}

function normalizeScope(value: unknown): LessonScope {
  if (value === undefined) return { rules: [], capabilities: [] }
  if (!isRecord(value)) throw new LessonStoreError('appliesTo must be a mapping', 'validation')
  return {
    rules: stringList(value.rules, 'appliesTo.rules', MAX_SCOPE_ITEMS),
    capabilities: stringList(value.capabilities, 'appliesTo.capabilities', MAX_SCOPE_ITEMS),
  }
}

function normalizeSource(value: unknown): LessonSource {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new LessonStoreError('source must be a mapping', 'validation')
  const source: LessonSource = {}
  if (value.change !== undefined) {
    source.change = requireText(value.change, 'source.change', 120)
  }
  if (value.taskId !== undefined) {
    source.taskId = requireText(value.taskId, 'source.taskId', 32)
  }
  if (value.findingHashes !== undefined) {
    source.findingHashes = stringList(
      value.findingHashes,
      'source.findingHashes',
      MAX_SOURCE_HASHES,
    )
  }
  return source
}

/** Lowercase, whitespace-collapsed, punctuation-trimmed class + title. */
export function lessonDedupeKey(lesson: Pick<Lesson, 'class' | 'title'>): string {
  const title = lesson.title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
  return `${lesson.class}\u0000${title}`
}

/** Absolute path of the workspace's lesson store. */
export function lessonStorePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.dsh', 'review-learning', `${workspaceKeyOf(workspaceRoot)}.jsonl`)
}

function parseLesson(value: unknown): Lesson | undefined {
  if (!isRecord(value) || value.v !== 1) return undefined
  if (typeof value.id !== 'string' || !/^lesson-[a-z0-9-]+$/u.test(value.id)) return undefined
  if (!FINDING_CLASSES.includes(value.class as FindingClass)) return undefined
  if (typeof value.title !== 'string' || value.title === '') return undefined
  if (typeof value.body !== 'string' || value.body === '') return undefined
  if (typeof value.status !== 'string' || !LESSON_STATUSES.has(value.status)) return undefined
  if (!isRecord(value.appliesTo) || !isRecord(value.source)) return undefined
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return undefined
  if (value.decidedAt !== undefined && typeof value.decidedAt !== 'number') return undefined
  if (value.appliedIn !== undefined && typeof value.appliedIn !== 'string') return undefined
  if (value.supersedes !== undefined && typeof value.supersedes !== 'string') return undefined
  const rules = value.appliesTo.rules
  const capabilities = value.appliesTo.capabilities
  if (
    !Array.isArray(rules) ||
    !rules.every((item) => typeof item === 'string') ||
    !Array.isArray(capabilities) ||
    !capabilities.every((item) => typeof item === 'string')
  ) {
    return undefined
  }
  const source: LessonSource = {}
  if (value.source.change !== undefined) {
    if (typeof value.source.change !== 'string') return undefined
    source.change = value.source.change
  }
  if (value.source.taskId !== undefined) {
    if (typeof value.source.taskId !== 'string') return undefined
    source.taskId = value.source.taskId
  }
  if (value.source.findingHashes !== undefined) {
    if (
      !Array.isArray(value.source.findingHashes) ||
      !value.source.findingHashes.every((item) => typeof item === 'string')
    ) {
      return undefined
    }
    source.findingHashes = value.source.findingHashes
  }
  return {
    v: 1,
    id: value.id,
    class: value.class as FindingClass,
    title: value.title,
    body: value.body,
    appliesTo: { rules, capabilities },
    status: value.status as LessonStatus,
    source,
    createdAt: value.createdAt,
    ...(value.decidedAt === undefined ? {} : { decidedAt: value.decidedAt }),
    ...(value.appliedIn === undefined ? {} : { appliedIn: value.appliedIn }),
    ...(value.supersedes === undefined ? {} : { supersedes: value.supersedes }),
  }
}

export interface LessonStoreRead {
  lessons: Lesson[]
  /** Malformed non-empty lines, counted; never fatal. */
  skipped: number
}

/** Read every lesson revision; a missing file is empty. */
export async function readLessons(workspaceRoot: string): Promise<LessonStoreRead> {
  let raw: string
  try {
    raw = await readFile(lessonStorePath(workspaceRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lessons: [], skipped: 0 }
    throw error
  }
  const lessons: Lesson[] = []
  let skipped = 0
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    const lesson = parseLesson(parsed)
    if (lesson === undefined) skipped += 1
    else lessons.push(lesson)
  }
  return { lessons, skipped }
}

/** Serialize same-process writers per file so a prune never races an append. */
const storeWrites = new Map<string, Promise<unknown>>()
const STORE_LOCK_TIMEOUT_MS = 2_000

/** Remove the lock only while it still carries this writer's owner token. */
async function removeOwnedLock(lock: string, owner: string): Promise<void> {
  try {
    const current = await readFile(join(lock, 'owner'), 'utf8')
    if (current !== owner) return
  } catch {
    return
  }
  await rm(lock, { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Cross-process lock for the read-prune-rename sequence: an atomic directory
 * create with an owner token. A crashed writer leaves the lock behind; the
 * bounded wait then fails with the lock path and a manual next action rather
 * than risking a takeover race that could lose a lesson.
 */
async function withStoreProcessLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`
  await mkdir(dirname(path), { recursive: true })
  const owner = randomUUID()
  const deadline = Date.now() + STORE_LOCK_TIMEOUT_MS
  for (;;) {
    try {
      await mkdir(lock)
      try {
        await writeFile(join(lock, 'owner'), owner, 'utf8')
      } catch (error) {
        await rm(lock, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) {
        throw new LessonStoreError(
          `lesson store is locked by another writer (${lock.replaceAll('\\', '/')}); if no other host is writing, remove that lock and retry`,
          'locked',
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  try {
    return await work()
  } finally {
    await removeOwnedLock(lock, owner)
  }
}

function serialized<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = storeWrites.get(path) ?? Promise.resolve()
  // A failed writer must not cancel the writes queued behind it.
  const next = previous.catch(() => undefined).then(() => withStoreProcessLock(path, work))
  storeWrites.set(path, next)
  return next.finally(() => {
    if (storeWrites.get(path) === next) storeWrites.delete(path)
  })
}

async function writeLessons(path: string, lessons: readonly Lesson[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const body = lessons.map((lesson) => JSON.stringify(lesson)).join('\n')
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, lessons.length === 0 ? '' : `${body}\n`, 'utf8')
  await rename(temporary, path)
}

function storeBytes(lessons: readonly Lesson[]): number {
  let total = 0
  for (const lesson of lessons) total += Buffer.byteLength(JSON.stringify(lesson), 'utf8') + 1
  return total
}

/** Evict the oldest non-applied lesson until the store fits; the written record is never a victim. */
function enforceCapacity(lessons: Lesson[], maxLessons: number, protectedId: string): Lesson[] {
  const next = [...lessons]
  while (next.length > maxLessons || storeBytes(next) > MAX_STORE_BYTES) {
    const victim = next
      .filter((lesson) => lesson.status !== 'applied' && lesson.id !== protectedId)
      .sort((left, right) => left.createdAt - right.createdAt)[0]
    if (victim === undefined) {
      throw new LessonStoreError(
        `lesson store is at capacity (${next.length} lessons, ${storeBytes(next)} bytes) and no non-applied lesson can be evicted; reject or apply a lesson elsewhere, or raise reviewLearning.maxLessons`,
        'capacity',
      )
    }
    next.splice(next.indexOf(victim), 1)
  }
  return next
}

export interface ProposeLessonInput {
  class: unknown
  title: unknown
  body: unknown
  appliesTo?: unknown
  source?: unknown
  /** Current time from the caller's clock seam. */
  now: number
  maxLessons?: number
}

export interface ProposeLessonResult {
  lesson: Lesson
  /** `created`, `updated`, or `revision`. */
  kind: 'created' | 'updated' | 'revision'
  replaced?: Lesson
}

/**
 * Store a proposed lesson. The same normalized class + title updates a proposed
 * record; a duplicate of an accepted or applied lesson creates a new proposed
 * revision with a `supersedes` link and never changes the accepted content.
 */
export async function proposeLesson(
  workspaceRoot: string,
  input: ProposeLessonInput,
): Promise<ProposeLessonResult> {
  const lessonClass = input.class as FindingClass
  if (typeof input.class !== 'string' || !FINDING_CLASSES.includes(lessonClass)) {
    throw new LessonStoreError(
      `lesson class must be one of the fixed vocabulary: ${FINDING_CLASSES.join(', ')}`,
      'validation',
    )
  }
  const title = requireText(input.title, 'lesson.title', MAX_TITLE_CHARS)
  const body = requireText(input.body, 'lesson.body', MAX_BODY_CHARS)
  const appliesTo = normalizeScope(input.appliesTo)
  const source = normalizeSource(input.source)
  const key = lessonDedupeKey({ class: lessonClass, title })
  const path = lessonStorePath(workspaceRoot)
  const maxLessons = input.maxLessons ?? DEFAULT_MAX_LESSONS

  return serialized(path, async () => {
    const { lessons } = await readLessons(workspaceRoot)
    const matches = lessons.filter((lesson) => lessonDedupeKey(lesson) === key)
    // Prefer an existing proposed revision so repeated proposals keep updating
    // one record instead of appending a new revision beside the accepted one.
    const existing =
      matches
        .filter((lesson) => lesson.status === 'proposed')
        .sort((left, right) => right.createdAt - left.createdAt)[0] ??
      matches.find((lesson) => lesson.status === 'accepted' || lesson.status === 'applied') ??
      matches[0]
    const record: Lesson = {
      v: 1,
      id: `lesson-${randomUUID().slice(0, 16)}`,
      class: lessonClass,
      title,
      body,
      appliesTo,
      status: 'proposed',
      source,
      createdAt: input.now,
    }
    if (existing !== undefined && existing.status === 'proposed') {
      const updated: Lesson = {
        ...existing,
        class: lessonClass,
        title,
        body,
        appliesTo,
        source,
        createdAt: input.now,
      }
      const next = enforceCapacity(
        lessons.map((lesson) => (lesson.id === existing.id ? updated : lesson)),
        maxLessons,
        updated.id,
      )
      await writeLessons(path, next)
      return { lesson: updated, kind: 'updated' as const, replaced: existing }
    }
    if (
      existing !== undefined &&
      (existing.status === 'accepted' || existing.status === 'applied')
    ) {
      const revision: Lesson = { ...record, supersedes: existing.id }
      const next = enforceCapacity([...lessons, revision], maxLessons, revision.id)
      await writeLessons(path, next)
      return { lesson: revision, kind: 'revision' as const }
    }
    const replaced = existing
    const next = enforceCapacity(
      existing === undefined
        ? [...lessons, record]
        : lessons.map((lesson) => (lesson.id === existing.id ? record : lesson)),
      maxLessons,
      record.id,
    )
    await writeLessons(path, next)
    return {
      lesson: record,
      kind: 'created' as const,
      ...(replaced === undefined ? {} : { replaced }),
    }
  })
}

async function findLesson(
  workspaceRoot: string,
  id: string,
): Promise<{ lessons: Lesson[]; lesson: Lesson }> {
  const { lessons } = await readLessons(workspaceRoot)
  const lesson = lessons.find((entry) => entry.id === id)
  if (lesson === undefined) {
    throw new LessonStoreError(
      `lesson "${id}" was not found; use list to see the current ids`,
      'not-found',
    )
  }
  return { lessons, lesson }
}

/** Apply a direct user decision; the caller supplies the answer, never the model. */
export async function decideLesson(
  workspaceRoot: string,
  id: string,
  decision: 'accepted' | 'rejected',
  now: number,
  maxLessons = DEFAULT_MAX_LESSONS,
): Promise<Lesson> {
  const path = lessonStorePath(workspaceRoot)
  return serialized(path, async () => {
    const { lessons, lesson } = await findLesson(workspaceRoot, id)
    if (lesson.status !== 'proposed') {
      throw new LessonStoreError(
        `lesson "${id}" is ${lesson.status}; only a proposed lesson can be accepted or rejected`,
        'transition',
      )
    }
    const next: Lesson = { ...lesson, status: decision, decidedAt: now }
    await writeLessons(
      path,
      enforceCapacity(
        lessons.map((entry) => (entry.id === id ? next : entry)),
        maxLessons,
        id,
      ),
    )
    return next
  })
}

/** Mark an accepted lesson applied against a named target. */
export async function applyLesson(
  workspaceRoot: string,
  id: string,
  target: string,
  now: number,
  maxLessons = DEFAULT_MAX_LESSONS,
): Promise<Lesson> {
  const appliedIn = requireText(target, 'lesson target', 300)
  const path = lessonStorePath(workspaceRoot)
  return serialized(path, async () => {
    const { lessons, lesson } = await findLesson(workspaceRoot, id)
    if (lesson.status !== 'accepted') {
      throw new LessonStoreError(
        `lesson "${id}" is ${lesson.status}; only an accepted lesson can be applied`,
        'transition',
      )
    }
    const next: Lesson = { ...lesson, status: 'applied', appliedIn, decidedAt: now }
    await writeLessons(
      path,
      enforceCapacity(
        lessons.map((entry) => (entry.id === id ? next : entry)),
        maxLessons,
        id,
      ),
    )
    return next
  })
}

/** Accepted and applied lessons only; proposed and rejected are never injected. */
export function injectableLessons(lessons: readonly Lesson[]): Lesson[] {
  return lessons.filter((lesson) => lesson.status === 'accepted' || lesson.status === 'applied')
}

/** Delta capability directory names a change declares under `specs/`. */
export async function changeCapabilities(changeDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(changeDir, 'specs'), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Lessons whose rule and capability scope matches this review; proposed/rejected never match. */
export function matchingLessons(
  lessons: readonly Lesson[],
  rule: string,
  capabilities: readonly string[],
): Lesson[] {
  return injectableLessons(lessons).filter((lesson) => {
    const rules = lesson.appliesTo.rules
    const scoped = lesson.appliesTo.capabilities
    const ruleMatches = rules.length === 0 || rules.includes('*') || rules.includes(rule)
    const capabilityMatches =
      scoped.length === 0 || scoped.some((capability) => capabilities.includes(capability))
    return ruleMatches && capabilityMatches
  })
}
