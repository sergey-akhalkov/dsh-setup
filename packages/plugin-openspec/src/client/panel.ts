/**
 * OpenSpec panel data: the one canonical address per view, the additive wire
 * shapes the Host routes return, defensive decoders, and the read-only requests
 * the right-sidebar tab makes. No React here; the tab body lives in index.tsx.
 */

import type { RelativeTimeUnit, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** Document-relative Host route for the change list (active rows + archive). */
export const CHANGES_PATH = 'api/plugins/dsh-setup-openspec/changes'

/** Document-relative Host route for one change's artifacts and progress. */
export const CHANGE_PATH = 'api/plugins/dsh-setup-openspec/change'

/** Document-relative Host route for the capability inventory and one spec. */
export const SPECS_PATH = 'api/plugins/dsh-setup-openspec/specs'

/** Tab-type registry identity; also the key the body slot registers under. */
export const OPENSPEC_ID = '@dsh-setup/plugin-openspec/panel'

/** Tab kind the panel claims. */
export const OPENSPEC_KIND = 'openspec'

/** The Start card, the panel list, and the command open this page address. */
export const ROOT_ADDRESS = 'sidebar://openspec'

/** The root's Specs segment as a restorable resource address. */
export const SPECS_ADDRESS = 'dsh-resource://openspec/specs'

/** Composer draft for exploring a change; the user sends it. */
export const EXPLORE_DRAFT = '/openspec-explore '

/** Composer draft for starting a proposal; the user sends it. */
export const PROPOSE_DRAFT = '/openspec-propose '

/** The one draft the change view writes; never submitted by the panel. */
export function applyDraft(name: string): string {
  return `/openspec-apply-change ${name}`
}

/** Artifact kinds already present in a change, beside its progress. */
export interface ChangePresence {
  readonly proposal: boolean
  readonly design: boolean
  readonly tasks: boolean
  readonly specs: number
}

/** Derived change status the redesigned cards render. */
export type Phase = 'planning' | 'ready-to-apply' | 'applying' | 'complete' | 'archived'

/** Legacy CLI status the picker reads; kept for an already-loaded older client. */
export type CliStatus = 'no-tasks' | 'complete' | 'in-progress'

/** Read-only git fact attached to a row or detail when git is available. */
export interface CommitFact {
  readonly short: string
  readonly at: string
  readonly subject: string
  /** The commit's page on the origin remote; absent when the host has none. */
  readonly url?: string
}

/** One row of the change-list route; every post-redesign field is optional. */
export interface ChangeRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: string
  readonly presence: ChangePresence
  readonly phase?: Phase
  readonly archived?: boolean
  readonly archivedAt?: string | null
  readonly summary?: string | null
  /** The whole proposal `Why` section, used by the card's hover/expand view. */
  readonly why?: string | null
  /** Requirement headings across the change's delta spec files. */
  readonly requirementCount?: number
  /** Delta capability ids the row's spec files cover; absent on an older host. */
  readonly deltaCapabilities?: readonly string[]
  readonly modified?: string | null
  readonly commit?: CommitFact | null
}

/** Totals for the root header, carried by the first change-list response. */
export interface WorkspaceCounts {
  readonly active: number
  readonly archived: number
  readonly capabilities: number
}

/** The additive change-list response; older hosts return only `changes`. */
export interface ChangeListResponse {
  readonly changes: readonly ChangeRow[]
  readonly archived: readonly ChangeRow[]
  readonly counts: WorkspaceCounts
}

/** One delta spec body as the legacy change route returns it. */
export interface DeltaSpec {
  readonly capability: string
  readonly body: string
  readonly modified: string
}

/** One structured requirement from the CLI's `show --json` output. */
export interface Requirement {
  readonly name: string
  readonly text: string
  readonly scenarios: readonly RequirementScenario[]
}

/** One scenario: its name and the WHEN/THEN bullet lines verbatim. */
export interface RequirementScenario {
  readonly name: string
  readonly rawText: string
}

/** The operation a delta spec applies to its capability spec. */
export type DeltaOperation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'

/** One capability delta inside a change. */
export interface Delta {
  readonly capability: string
  readonly operation: DeltaOperation
  readonly requirements: readonly Requirement[]
  readonly rename?: { readonly from: string; readonly to: string }
}

/** One archived change that produced an accepted capability. */
export interface HistoryEntry {
  readonly name: string
  readonly date: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly commit: CommitFact | null
}

/** One task file the checklist parses, workspace-relative POSIX path. */
export interface TaskFile {
  readonly path: string
  readonly body: string
}

/** One change's artifact bodies, delta specs, and progress. */
export interface ChangeDetail {
  readonly name: string
  readonly status: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly artifacts: {
    readonly proposal: string | null
    readonly design: string | null
    readonly tasks: string | null
  }
  readonly specs: readonly DeltaSpec[]
  readonly modified: string | null
  readonly presence?: ChangePresence
  readonly phase?: Phase
  readonly archived?: boolean
  readonly archivedAt?: string | null
  readonly summary?: string | null
  readonly commit?: CommitFact | null
  readonly deltas?: readonly Delta[]
  readonly taskFiles?: readonly TaskFile[]
}

/** One row of the capability inventory. */
export interface CapabilitySummary {
  readonly id: string
  readonly requirementCount: number
  readonly purpose?: string
  readonly modified?: string | null
  readonly lastChange?: HistoryEntry | null
  readonly commit?: CommitFact | null
}

/** One accepted capability spec. */
export interface CapabilityDetail {
  readonly id: string
  readonly requirementCount: number
  readonly body: string
  readonly modified: string
  readonly purpose?: string
  readonly requirements?: readonly Requirement[]
  readonly history?: readonly HistoryEntry[]
  readonly commit?: CommitFact | null
}

/** Where one address points; exactly four shapes exist. */
export type OpenSpecTarget =
  | { readonly view: 'root'; readonly segment: 'changes' | 'specs' }
  | {
      readonly view: 'change'
      readonly name: string
      readonly archived?: true
      readonly artifact?: ArtifactKind
    }
  | { readonly view: 'capability'; readonly id: string }

const CHANGE_SEGMENT = 'dsh-resource://openspec/change/'
const ARCHIVED_CHANGE_SEGMENT = 'dsh-resource://openspec/archive-change/'
const CAPABILITY_SEGMENT = 'dsh-resource://openspec/spec/'

/** The one canonical address for an active change; artifact selection is tab state. */
export function changeAddress(name: string, artifact?: ArtifactKind): string {
  return `${CHANGE_SEGMENT}${encodeURIComponent(name)}${artifact === undefined ? '' : `/${artifact}`}`
}

/** The one canonical address for an archived change; never the active address. */
export function archivedChangeAddress(name: string, artifact?: ArtifactKind): string {
  return `${ARCHIVED_CHANGE_SEGMENT}${encodeURIComponent(name)}${artifact === undefined ? '' : `/${artifact}`}`
}

function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value)
}

/** A change address's name plus its optional artifact selection. */
function changeSegment(
  address: string,
  prefix: string,
): { name: string; artifact?: ArtifactKind } | undefined {
  if (!address.startsWith(prefix)) return undefined
  const rest = address.slice(prefix.length)
  if (rest === '' || rest.includes('?') || rest.includes('#')) return undefined
  const parts = rest.split('/')
  if (parts.length > 2) return undefined
  let name: string
  try {
    name = decodeURIComponent(parts[0] ?? '')
  } catch {
    return undefined
  }
  if (name === '') return undefined
  const encodedArtifact = parts[1]
  if (encodedArtifact === undefined) return { name }
  let artifact: string
  try {
    artifact = decodeURIComponent(encodedArtifact)
  } catch {
    return undefined
  }
  if (!isArtifactKind(artifact)) return undefined
  return { name, artifact }
}

/** The one canonical address for a capability. */
export function capabilityAddress(id: string): string {
  return `${CAPABILITY_SEGMENT}${encodeURIComponent(id)}`
}

/** The decoded remainder of a one-segment resource address, or undefined. */
function singleSegment(address: string, prefix: string): string | undefined {
  if (!address.startsWith(prefix)) return undefined
  const rest = address.slice(prefix.length)
  if (rest === '' || rest.includes('/') || rest.includes('?') || rest.includes('#'))
    return undefined
  try {
    const value = decodeURIComponent(rest)
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/** Parse exactly the documented shapes; reject everything else. */
export function openSpecTarget(address: string): OpenSpecTarget | undefined {
  if (address === ROOT_ADDRESS) return { view: 'root', segment: 'changes' }
  if (address === SPECS_ADDRESS) return { view: 'root', segment: 'specs' }
  const archived = changeSegment(address, ARCHIVED_CHANGE_SEGMENT)
  if (archived !== undefined) {
    return {
      view: 'change',
      name: archived.name,
      archived: true,
      ...(archived.artifact === undefined ? {} : { artifact: archived.artifact }),
    }
  }
  const change = changeSegment(address, CHANGE_SEGMENT)
  if (change !== undefined) return { view: 'change', ...change }
  const id = singleSegment(address, CAPABILITY_SEGMENT)
  if (id !== undefined) return { view: 'capability', id }
  return undefined
}

/** Whether the panel claims an address. */
export function canOpenOpenSpec(address: string): boolean {
  return openSpecTarget(address) !== undefined
}

/** Tab chip text: the change or capability name, or the root's name. */
export function openSpecTitle(address: string): string {
  const target = openSpecTarget(address)
  if (target?.view === 'change') return target.name
  if (target?.view === 'capability') return target.id
  return 'OpenSpec'
}

/**
 * Address of one workspace file in the shipped `file` resource provider.
 *
 * Assumption: the provider grammar is `dsh-resource://file/session/<id>/<path>`
 * with the session id and the workspace-relative path (forward slashes) taken
 * verbatim. The panel only observes these addresses; it never opens them.
 */
export function fileAddress(sessionId: string, path: string): string {
  return `dsh-resource://file/session/${sessionId}/${path}`
}

/** The three fixed artifacts every change view observes. */
export type ChangeArtifactFile = 'proposal' | 'design' | 'tasks'

/** Workspace-relative path of one change artifact. */
export function changeArtifactPath(name: string, kind: ChangeArtifactFile): string {
  return `openspec/changes/${name}/${kind}.md`
}

/** Workspace-relative path of one delta spec. */
export function deltaSpecPath(name: string, capability: string): string {
  return `openspec/changes/${name}/specs/${capability}/spec.md`
}

/** Workspace-relative path of one accepted capability spec. */
export function capabilitySpecPath(id: string): string {
  return `openspec/specs/${id}/spec.md`
}

/** Every file a change view observes: its artifacts plus each loaded delta. */
export function changeWatchPaths(name: string, capabilities: readonly string[]): string[] {
  return [
    changeArtifactPath(name, 'proposal'),
    changeArtifactPath(name, 'design'),
    changeArtifactPath(name, 'tasks'),
    ...capabilities.map((capability) => deltaSpecPath(name, capability)),
  ]
}

/** Every file address the Changes segment observes for its active rows. */
export function changeListWatchAddresses(sessionId: string, rows: readonly ChangeRow[]): string[] {
  return rows
    .filter((row) => row.archived !== true)
    .flatMap((row) =>
      changeWatchPaths(row.name, row.deltaCapabilities ?? []).map((path) =>
        fileAddress(sessionId, path),
      ),
    )
}

/** Derived status of one row; an explicit host `phase` wins. */
export function derivePhase(row: {
  readonly status?: string
  readonly completedTasks?: number
  readonly totalTasks?: number
  readonly archived?: boolean
}): Phase {
  if (row.archived === true) return 'archived'
  if (row.status === 'no-tasks') return 'planning'
  if (row.status === 'complete') return 'complete'
  const total = row.totalTasks ?? 0
  if (total <= 0) return 'planning'
  const done = Math.min(Math.max(row.completedTasks ?? 0, 0), total)
  if (done >= total) return 'complete'
  if (done === 0) return 'ready-to-apply'
  return 'applying'
}

/** The phase a row renders: the host's field when present, otherwise derived. */
export function phaseOf(row: ChangeRow | ChangeDetail): Phase {
  return row.phase ?? derivePhase(row)
}

/** The semantic tag tone for one phase; the same status always gets the same tone. */
export function phaseTone(phase: Phase): TagTone {
  if (phase === 'planning') return 'warning'
  if (phase === 'complete') return 'success'
  if (phase === 'archived') return 'quiet'
  return 'info'
}

/** The state dot paired with a phase tag. */
export function phaseDot(phase: Phase): 'done' | 'warning' | 'ongoing' | 'idle' {
  if (phase === 'planning') return 'warning'
  if (phase === 'complete') return 'done'
  if (phase === 'archived') return 'idle'
  return 'ongoing'
}

/** Relative-time wording of a last-modified fact, e.g. `2h ago`. */
export function relativeLabel(
  modified: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (modified === null || modified === undefined) return null
  const at = new Date(modified).getTime()
  if (Number.isNaN(at)) return null
  const { unit, n } = primitives.relativeTime(at, now.getTime())
  if (unit === 'now') return 'just now'
  const suffix: Record<Exclude<RelativeTimeUnit, 'now'>, string> = {
    minutes: 'm',
    hours: 'h',
    days: 'd',
    months: 'mo',
    years: 'y',
  }
  return `${String(n)}${suffix[unit]} ago`
}

/** The `YYYY-MM-DD` date of an ISO timestamp or archive-date prefix, or null. */
export function isoDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  if (direct?.[1] !== undefined) return direct[1]
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** Trim a summary; an absent or blank value renders nothing. */
export function summaryText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Case-insensitive in-memory search across the given values; blank matches all. */
export function matchesQuery(
  query: string,
  ...values: readonly (string | null | undefined)[]
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
}

/** Unfinished changes first, stable within each group. */
export function sortChanges(rows: readonly ChangeRow[]): ChangeRow[] {
  return [...rows].sort(
    (left, right) => Number(left.status === 'complete') - Number(right.status === 'complete'),
  )
}

/** Archived changes newest first by archive date, stable for missing dates. */
export function sortArchived(rows: readonly ChangeRow[]): ChangeRow[] {
  return [...rows].sort((left, right) =>
    (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''),
  )
}

/** History newest first by archive date, stable for missing dates. */
export function sortHistory(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((left, right) => right.date.localeCompare(left.date))
}

/** One parsed task line: its checkbox state and verbatim description. */
export interface TaskLine {
  readonly done: boolean
  readonly description: string
}

/**
 * The pinned OpenSpec CLI's exact task-line grammar, ported verbatim from
 * `@fission-ai/openspec@1.15.0` `dist/utils/task-progress.js`: any CommonMark
 * list marker, optional leading whitespace, a one-token checkbox whose marker
 * may be blank (`[]`, `[~]`, `[ x ]`), only `x`/`X` counts done, and a
 * single-token label followed by `(` or `[` is a link bullet, not a task.
 */
export const TASK_LINE_PATTERN =
  /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/

/** Parse every task line in document order. */
export function parseTaskLines(content: string): TaskLine[] {
  const tasks: TaskLine[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = TASK_LINE_PATTERN.exec(line)
    if (match === null) continue
    tasks.push({
      done: (match[1] ?? '').toLowerCase() === 'x',
      description: (match[2] ?? '').trim(),
    })
  }
  return tasks
}

/** Tasks grouped by the file's `##` headings. */
export interface TaskGroup {
  readonly title: string
  readonly tasks: readonly TaskLine[]
}

/** Split a tasks file into its `##` sections; lines before one form an untitled group. */
export function parseTaskGroups(content: string): TaskGroup[] {
  const groups: Array<{ title: string; tasks: TaskLine[] }> = []
  let current: { title: string; tasks: TaskLine[] } | undefined
  const open = (title: string): { title: string; tasks: TaskLine[] } => {
    const group = { title, tasks: [] }
    groups.push(group)
    return group
  }
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading !== null) {
      current = open((heading[1] ?? '').trim())
      continue
    }
    const match = TASK_LINE_PATTERN.exec(line)
    if (match === null) continue
    if (current === undefined) current = open('')
    current.tasks.push({
      done: (match[1] ?? '').toLowerCase() === 'x',
      description: (match[2] ?? '').trim(),
    })
  }
  return groups
}

/** The root's three segments, in display order. */
export type RootSegment = 'changes' | 'specs' | 'archive'

/** Segment order in the root view. */
export const ROOT_SEGMENTS: readonly RootSegment[] = ['changes', 'specs', 'archive']

/** Storage the remembered segment needs; `sessionStorage` satisfies it. */
export interface SegmentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Namespaced, session-scoped key of the remembered root segment. */
export function segmentStorageKey(sessionId: string): string {
  return `dsh-setup-openspec-panel.root-segment.${sessionId}`
}

/** Whether a stored value is a known segment. */
export function isRootSegment(value: unknown): value is RootSegment {
  return value === 'changes' || value === 'specs' || value === 'archive'
}

/** Read the remembered segment; an absent, unknown, or unreadable value is undefined. */
export function readSegment(
  storage: SegmentStorage | undefined,
  sessionId: string,
): RootSegment | undefined {
  if (storage === undefined) return undefined
  try {
    const value = storage.getItem(segmentStorageKey(sessionId))
    return isRootSegment(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Remember a segment for this session; storage failures are silent. */
export function writeSegment(
  storage: SegmentStorage | undefined,
  sessionId: string,
  segment: RootSegment,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(segmentStorageKey(sessionId), segment)
  } catch {
    // Private modes and blocked storage forget the segment; the address wins.
  }
}

/** The segment a root body mounts on: explicit Specs wins, else remembered, else Changes. */
export function initialRootSegment(
  explicit: 'changes' | 'specs',
  stored: RootSegment | undefined,
): RootSegment {
  return explicit === 'specs' ? 'specs' : (stored ?? 'changes')
}

/** The browser's sessionStorage, or undefined when the host blocks it. */
export function defaultSegmentStorage(): SegmentStorage | undefined {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? undefined : globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/** One artifact segment in a change tab. */
export type ArtifactKind = 'proposal' | 'design' | 'specs' | 'tasks'

/** Segment order in a change tab. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['proposal', 'design', 'specs', 'tasks']

/** Whether the change carries this artifact kind. */
export function hasArtifact(change: ChangeDetail, kind: ArtifactKind): boolean {
  if (kind === 'specs') return (change.deltas?.length ?? 0) > 0 || change.specs.length > 0
  // Archived changes may carry only nested tasks/**/*.md files.
  if (kind === 'tasks')
    return change.artifacts.tasks !== null || (change.taskFiles?.length ?? 0) > 0
  return change.artifacts[kind] !== null
}

/** Distinct capabilities a delta list touches, in order. */
export function deltaCapabilities(deltas: readonly Delta[]): string[] {
  return [...new Set(deltas.map((delta) => delta.capability))]
}

/** The first artifact the change carries; proposal when it carries none. */
export function initialArtifact(change: ChangeDetail): ArtifactKind {
  return ARTIFACT_KINDS.find((kind) => hasArtifact(change, kind)) ?? 'proposal'
}

/** A read that has not settled, failed with its cause, or succeeded. */
export type ReadState<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error'; readonly message: string }
  | { readonly phase: 'ready'; readonly value: T }

/** The initial state every panel read starts in. */
export const LOADING = { phase: 'loading' } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function decodePresence(value: unknown): ChangePresence {
  if (!isRecord(value)) return { proposal: false, design: false, tasks: false, specs: 0 }
  return {
    proposal: value.proposal === true,
    design: value.design === true,
    tasks: value.tasks === true,
    specs: integer(value.specs) ?? 0,
  }
}

/** A commit's page is kept only as a plain web link; anything else is dropped. */
const COMMIT_PAGE = /^https?:\/\/[^\s"'<>]+$/

function decodeCommit(value: unknown): CommitFact | null {
  if (!isRecord(value) || typeof value.short !== 'string' || value.short.trim() === '') return null
  const url = typeof value.url === 'string' && COMMIT_PAGE.test(value.url) ? value.url : undefined
  return {
    short: value.short,
    at: typeof value.at === 'string' ? value.at : '',
    subject: typeof value.subject === 'string' ? value.subject : '',
    ...(url === undefined ? {} : { url }),
  }
}

function decodePhase(value: unknown): Phase | undefined {
  return value === 'planning' ||
    value === 'ready-to-apply' ||
    value === 'applying' ||
    value === 'complete' ||
    value === 'archived'
    ? value
    : undefined
}

/** Additive delta capability ids; a malformed value falls back to the fixed artifacts. */
function decodeDeltaCapabilities(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

function decodeChangeRow(value: unknown): ChangeRow | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim() === '')
    return undefined
  const completedTasks = integer(value.completedTasks) ?? 0
  const totalTasks = integer(value.totalTasks) ?? 0
  const phase = decodePhase(value.phase)
  const deltaCapabilities = decodeDeltaCapabilities(value.deltaCapabilities)
  return {
    name: value.name,
    completedTasks,
    totalTasks,
    status: typeof value.status === 'string' ? value.status : 'no-tasks',
    presence: decodePresence(value.presence),
    ...(phase === undefined ? {} : { phase }),
    ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
    ...(value.archivedAt === undefined ? {} : { archivedAt: stringOrNull(value.archivedAt) }),
    ...(value.summary === undefined ? {} : { summary: summaryText(value.summary) }),
    ...(value.why === undefined ? {} : { why: summaryText(value.why) }),
    ...(value.requirementCount === undefined
      ? {}
      : { requirementCount: integer(value.requirementCount) ?? 0 }),
    ...(deltaCapabilities === undefined ? {} : { deltaCapabilities }),
    ...(value.modified === undefined ? {} : { modified: stringOrNull(value.modified) }),
    ...(value.commit === undefined ? {} : { commit: decodeCommit(value.commit) }),
  }
}

function decodeChangeRows(value: unknown): ChangeRow[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: ChangeRow[] = []
  for (const entry of value) {
    const row = decodeChangeRow(entry)
    if (row === undefined) return undefined
    rows.push(row)
  }
  return rows
}

function decodeCounts(
  value: unknown,
  changes: readonly ChangeRow[],
  archived: readonly ChangeRow[],
): WorkspaceCounts {
  const record = isRecord(value) ? value : undefined
  return {
    active: integer(record?.active) ?? changes.length,
    archived: integer(record?.archived) ?? archived.length,
    capabilities: integer(record?.capabilities) ?? 0,
  }
}

function decodeChangeList(body: Record<string, unknown>): ChangeListResponse | undefined {
  const changes = decodeChangeRows(body.changes)
  if (changes === undefined) return undefined
  const archived = body.archived === undefined ? [] : decodeChangeRows(body.archived)
  if (archived === undefined) return undefined
  return { changes, archived, counts: decodeCounts(body.counts, changes, archived) }
}

function decodeRequirementScenario(value: unknown): RequirementScenario | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined
  return { name: value.name, rawText: typeof value.rawText === 'string' ? value.rawText : '' }
}

function decodeRequirement(value: unknown): Requirement | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined
  const scenarios: RequirementScenario[] = []
  if (Array.isArray(value.scenarios)) {
    for (const entry of value.scenarios) {
      const scenario = decodeRequirementScenario(entry)
      if (scenario !== undefined) scenarios.push(scenario)
    }
  }
  return { name: value.name, text: typeof value.text === 'string' ? value.text : '', scenarios }
}

function decodeRequirements(value: unknown): Requirement[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const requirements: Requirement[] = []
  for (const entry of value) {
    const requirement = decodeRequirement(entry)
    if (requirement === undefined) return undefined
    requirements.push(requirement)
  }
  return requirements
}

function decodeOperation(value: unknown): DeltaOperation | undefined {
  return value === 'ADDED' || value === 'MODIFIED' || value === 'REMOVED' || value === 'RENAMED'
    ? value
    : undefined
}

function decodeRename(value: unknown): { from: string; to: string } | undefined {
  if (!isRecord(value) || typeof value.from !== 'string' || typeof value.to !== 'string')
    return undefined
  return { from: value.from, to: value.to }
}

function decodeDelta(value: unknown): Delta | undefined {
  if (!isRecord(value) || typeof value.capability !== 'string') return undefined
  const operation = decodeOperation(value.operation)
  if (operation === undefined) return undefined
  const requirements = decodeRequirements(value.requirements)
  if (requirements === undefined) return undefined
  const rename = decodeRename(value.rename)
  return {
    capability: value.capability,
    operation,
    requirements,
    ...(rename === undefined ? {} : { rename }),
  }
}

function decodeDeltas(value: unknown): Delta[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const deltas: Delta[] = []
  for (const entry of value) {
    const delta = decodeDelta(entry)
    if (delta === undefined) return undefined
    deltas.push(delta)
  }
  return deltas
}

function decodeDeltaSpecs(value: unknown): DeltaSpec[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const specs: DeltaSpec[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.capability !== 'string') return undefined
    specs.push({
      capability: entry.capability,
      body: typeof entry.body === 'string' ? entry.body : '',
      modified: typeof entry.modified === 'string' ? entry.modified : '',
    })
  }
  return specs
}

function decodeArtifacts(value: unknown): ChangeDetail['artifacts'] | undefined {
  if (!isRecord(value)) return undefined
  const field = (key: 'proposal' | 'design' | 'tasks'): string | null | undefined => {
    const raw = value[key]
    if (raw === undefined || raw === null) return null
    return typeof raw === 'string' ? raw : undefined
  }
  const proposal = field('proposal')
  const design = field('design')
  const tasks = field('tasks')
  if (proposal === undefined || design === undefined || tasks === undefined) return undefined
  return { proposal, design, tasks }
}

function decodeTaskFiles(value: unknown): TaskFile[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const files: TaskFile[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.body !== 'string')
      return undefined
    files.push({ path: entry.path, body: entry.body })
  }
  return files
}

function decodeChangeDetail(value: unknown): ChangeDetail | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined
  const artifacts = decodeArtifacts(value.artifacts)
  const specs = decodeDeltaSpecs(value.specs)
  const deltas = decodeDeltas(value.deltas)
  const taskFiles = decodeTaskFiles(value.taskFiles)
  if (
    artifacts === undefined ||
    specs === undefined ||
    deltas === undefined ||
    taskFiles === undefined
  )
    return undefined
  const phase = decodePhase(value.phase)
  return {
    name: value.name,
    status: typeof value.status === 'string' ? value.status : 'no-tasks',
    completedTasks: integer(value.completedTasks) ?? 0,
    totalTasks: integer(value.totalTasks) ?? 0,
    artifacts,
    specs,
    modified: stringOrNull(value.modified),
    deltas,
    ...(taskFiles.length === 0 ? {} : { taskFiles }),
    ...(value.presence === undefined ? {} : { presence: decodePresence(value.presence) }),
    ...(phase === undefined ? {} : { phase }),
    ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
    ...(value.archivedAt === undefined ? {} : { archivedAt: stringOrNull(value.archivedAt) }),
    ...(value.summary === undefined ? {} : { summary: summaryText(value.summary) }),
    ...(value.commit === undefined ? {} : { commit: decodeCommit(value.commit) }),
  }
}

function decodeHistoryEntry(value: unknown): HistoryEntry | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.date !== 'string')
    return undefined
  return {
    name: value.name,
    date: value.date,
    completedTasks: integer(value.completedTasks) ?? 0,
    totalTasks: integer(value.totalTasks) ?? 0,
    commit: decodeCommit(value.commit),
  }
}

function decodeHistory(value: unknown): HistoryEntry[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const history: HistoryEntry[] = []
  for (const entry of value) {
    const decoded = decodeHistoryEntry(entry)
    if (decoded === undefined) return undefined
    history.push(decoded)
  }
  return history
}

function decodeCapabilityRows(value: unknown): CapabilitySummary[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: CapabilitySummary[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string') return undefined
    const lastChange = decodeHistoryEntry(entry.lastChange)
    rows.push({
      id: entry.id,
      requirementCount: integer(entry.requirementCount) ?? 0,
      ...(entry.purpose === undefined ? {} : { purpose: summaryText(entry.purpose) ?? undefined }),
      ...(entry.modified === undefined ? {} : { modified: stringOrNull(entry.modified) }),
      ...(entry.lastChange === undefined || entry.lastChange === null ? {} : { lastChange }),
      ...(entry.commit === undefined ? {} : { commit: decodeCommit(entry.commit) }),
    })
  }
  return rows
}

function decodeCapabilityDetail(value: unknown): CapabilityDetail | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const requirements = decodeRequirements(value.requirements)
  const history = decodeHistory(value.history)
  if (requirements === undefined || history === undefined) return undefined
  const capability: CapabilityDetail = {
    id: value.id,
    requirementCount: integer(value.requirementCount) ?? 0,
    body: typeof value.body === 'string' ? value.body : '',
    modified: typeof value.modified === 'string' ? value.modified : '',
    requirements,
    history,
  }
  return {
    ...capability,
    ...(value.purpose === undefined ? {} : { purpose: summaryText(value.purpose) ?? undefined }),
    ...(value.commit === undefined ? {} : { commit: decodeCommit(value.commit) }),
  }
}

/**
 * One panel read. The Host returns `{ error }` for every failure, exactly like
 * the picker's change-list route, so the message reaches the panel unchanged.
 */
async function request<T>(
  path: string,
  failure: string,
  notUnderstood: string,
  decode: (body: Record<string, unknown>) => T | undefined,
): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
    throw new Error(
      typeof body?.error === 'string' ? body.error : `${failure} (${String(response.status)}).`,
    )
  }
  const body: unknown = await response.json()
  const value = isRecord(body) ? decode(body) : undefined
  if (value === undefined) throw new Error(notUnderstood)
  return value
}

/** Read the workspace's active changes, archived changes, and header totals. */
export async function requestChangeList(sessionId: string): Promise<ChangeListResponse> {
  return request(
    `${CHANGES_PATH}?session=${encodeURIComponent(sessionId)}`,
    'The OpenSpec change list request failed',
    'The OpenSpec change list response was not understood.',
    decodeChangeList,
  )
}

/**
 * Read one change's artifact bodies, delta specs, and progress.
 * @param archived - resolve the name against the archive family only.
 */
export async function requestChange(
  sessionId: string,
  name: string,
  archived = false,
): Promise<ChangeDetail> {
  return request(
    `${CHANGE_PATH}?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}${
      archived ? '&archived=1' : ''
    }`,
    'The OpenSpec change request failed',
    'The OpenSpec change response was not understood.',
    (body) => decodeChangeDetail(body.change),
  )
}

/** Read the workspace's capability inventory. */
export async function requestCapabilities(sessionId: string): Promise<CapabilitySummary[]> {
  return request(
    `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}`,
    'The OpenSpec capability list request failed',
    'The OpenSpec capability list response was not understood.',
    (body) => decodeCapabilityRows(body.capabilities),
  )
}

/** Read one accepted capability spec. */
export async function requestCapability(sessionId: string, id: string): Promise<CapabilityDetail> {
  return request(
    `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`,
    'The OpenSpec capability request failed',
    'The OpenSpec capability response was not understood.',
    (body) => decodeCapabilityDetail(body.capability),
  )
}
