import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
