/**
 * OpenSpec panel data: the one canonical address per view, the wire shapes the
 * Host routes return, and the read-only requests the right-sidebar tab makes.
 * No React here; the tab body lives in index.tsx.
 */

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

/** One row of the change list route. */
export interface ChangeRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: string
  readonly presence: ChangePresence
}

/** One delta spec inside a change. */
export interface DeltaSpec {
  readonly capability: string
  readonly body: string
  readonly modified: string
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
}

/** One row of the capability inventory. */
export interface CapabilitySummary {
  readonly id: string
  readonly requirementCount: number
}

/** One accepted capability spec. */
export interface CapabilityDetail {
  readonly id: string
  readonly requirementCount: number
  readonly body: string
  readonly modified: string
}

/** Where one address points; exactly four shapes exist. */
export type OpenSpecTarget =
  | { readonly view: 'root'; readonly segment: 'changes' | 'specs' }
  | { readonly view: 'change'; readonly name: string }
  | { readonly view: 'capability'; readonly id: string }

const CHANGE_SEGMENT = 'dsh-resource://openspec/change/'
const CAPABILITY_SEGMENT = 'dsh-resource://openspec/spec/'

/** The one canonical address for a change; artifact selection is tab state. */
export function changeAddress(name: string): string {
  return `${CHANGE_SEGMENT}${encodeURIComponent(name)}`
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

/** Parse exactly the four documented shapes; reject everything else. */
export function openSpecTarget(address: string): OpenSpecTarget | undefined {
  if (address === ROOT_ADDRESS) return { view: 'root', segment: 'changes' }
  if (address === SPECS_ADDRESS) return { view: 'root', segment: 'specs' }
  const name = singleSegment(address, CHANGE_SEGMENT)
  if (name !== undefined) return { view: 'change', name }
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

/**
 * "Updated HH:MM" today and "Updated YYYY-MM-DD HH:MM" otherwise, in local
 * time. A missing or unreadable timestamp renders nothing.
 */
export function updatedLabel(modified: string | null, now: Date = new Date()): string | null {
  if (modified === null) return null
  const date = new Date(modified)
  if (Number.isNaN(date.getTime())) return null
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return `Updated ${time}`
  return `Updated ${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${time}`
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** Unfinished changes first, stable within each group. */
export function sortChanges(rows: readonly ChangeRow[]): ChangeRow[] {
  return [...rows].sort(
    (left, right) => Number(left.status === 'complete') - Number(right.status === 'complete'),
  )
}

/** One artifact segment in a change tab. */
export type ArtifactKind = 'proposal' | 'design' | 'specs' | 'tasks'

/** Segment order in a change tab. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['proposal', 'design', 'specs', 'tasks']

/** Whether the change carries this artifact kind. */
export function hasArtifact(change: ChangeDetail, kind: ArtifactKind): boolean {
  return kind === 'specs' ? change.specs.length > 0 : change.artifacts[kind] !== null
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

/** Read one change's artifact bodies, delta specs, and progress. */
export async function requestChange(sessionId: string, name: string): Promise<ChangeDetail> {
  return request(
    `${CHANGE_PATH}?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`,
    'The OpenSpec change request failed',
    'The OpenSpec change response was not understood.',
    (body) => (isRecord(body.change) ? (body.change as unknown as ChangeDetail) : undefined),
  )
}

/** Read the workspace's capability inventory. */
export async function requestCapabilities(sessionId: string): Promise<CapabilitySummary[]> {
  return request(
    `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}`,
    'The OpenSpec capability list request failed',
    'The OpenSpec capability list response was not understood.',
    (body) =>
      Array.isArray(body.capabilities)
        ? (body.capabilities as unknown as CapabilitySummary[])
        : undefined,
  )
}

/** Read one accepted capability spec. */
export async function requestCapability(sessionId: string, id: string): Promise<CapabilityDetail> {
  return request(
    `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`,
    'The OpenSpec capability request failed',
    'The OpenSpec capability response was not understood.',
    (body) =>
      isRecord(body.capability) ? (body.capability as unknown as CapabilityDetail) : undefined,
  )
}
