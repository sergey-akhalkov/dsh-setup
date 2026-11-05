import { type Dirent, readdirSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { listWorkspaceChanges, runOpenSpecJson, type WorkspaceChange } from './change-list.js'

/**
 * Read one change's planning artifacts and the workspace's capability specs.
 *
 * Lists and counts come from the documented CLI; artifact bodies come from
 * files, because no CLI command returns them. Every path is built by joining
 * under the session workspace's own `openspec/` root and checked after
 * resolution, and the item name must first appear in the CLI's list, so a
 * request never contributes a filesystem path. Reads then canonicalize the
 * real path and refuse anything outside the workspace's own OpenSpec root, so a
 * symlink or junction cannot serve a file from elsewhere.
 */

/** Artifact kinds one change already carries; `specs` counts delta spec files. */
export interface ChangePresence {
  readonly proposal: boolean
  readonly design: boolean
  readonly tasks: boolean
  readonly specs: number
}

/** One delta spec of a change, with that file's ISO last-modified time. */
export interface DeltaSpec {
  readonly capability: string
  readonly body: string
  readonly modified: string
}

/** Everything the change view renders for one CLI-reported change. */
export interface WorkspaceChangeDetail {
  readonly name: string
  readonly status: WorkspaceChange['status']
  readonly completedTasks: number
  readonly totalTasks: number
  readonly presence: ChangePresence
  readonly modified: string | null
  readonly artifacts: {
    readonly proposal: string | null
    readonly design: string | null
    readonly tasks: string | null
  }
  readonly specs: DeltaSpec[]
}

/** One row of the workspace's capability inventory. */
export interface CapabilitySummary {
  readonly id: string
  readonly requirementCount: number
}

/** One capability's accepted spec body and file last-modified time. */
export interface CapabilityDetail extends CapabilitySummary {
  readonly body: string
  readonly modified: string
}

/** The requested change or capability is not in the CLI's list for the workspace. */
export class UnreportedItemError extends Error {}

/** The requested change is not in the CLI's list for this workspace. */
export function unreportedChangeMessage(name: string): string {
  return `The OpenSpec change "${name}" is not reported for this workspace.`
}

/** The requested capability is not in the CLI's inventory for this workspace. */
export function unreportedCapabilityMessage(id: string): string {
  return `The OpenSpec capability "${id}" is not reported for this workspace.`
}

/** A request-named item resolves outside the workspace's own OpenSpec root. */
export const OUTSIDE_ROOT_MESSAGE =
  'The requested OpenSpec item resolves outside the workspace OpenSpec root.'

/** A change artifact could not be read. */
export function artifactReadMessage(path: string, cause: string): string {
  return `Could not read the OpenSpec artifact ${path}: ${cause}`
}

/** A capability spec file could not be read. */
export function capabilityReadMessage(path: string, cause: string): string {
  return `Could not read the OpenSpec capability spec ${path}: ${cause}`
}

/** The CLI's `list --specs --json` output is not the documented shape. */
export const CAPABILITIES_MALFORMED_MESSAGE =
  '`openspec list --specs --json` returned output that could not be read.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The workspace's change directory root, resolved once per read. */
function changesRoot(workspace: string): string {
  return resolve(workspace, 'openspec', 'changes')
}

/** The workspace's accepted-capability root, resolved once per read. */
function specsRoot(workspace: string): string {
  return resolve(workspace, 'openspec', 'specs')
}

/** Whether a resolved path is strictly under a directory; case-insensitive on Windows. */
function insidePath(base: string, target: string): boolean {
  const boundary = `${base}${sep}`
  return process.platform === 'win32'
    ? target.toLowerCase().startsWith(boundary.toLowerCase())
    : target.startsWith(boundary)
}

/** Resolve one request-named item under an OpenSpec root, refusing a lexical escape. */
function containedItem(root: string, item: string): string {
  const base = resolve(root)
  const target = resolve(base, item)
  if (!insidePath(base, target)) throw new Error(OUTSIDE_ROOT_MESSAGE)
  return target
}

/** Canonical real path of the workspace's own `openspec/` root. */
function canonicalRoot(workspace: string): string {
  const root = resolve(workspace, 'openspec')
  try {
    return realpathSync.native(root)
  } catch (error) {
    if (isMissing(error)) return root
    throw new Error(`Could not resolve the OpenSpec root ${root}: ${causeOf(error)}`)
  }
}

/** Refuse a canonical path that escaped the canonical OpenSpec root. */
function requireInsideRoot(root: string, actual: string): void {
  if (!insidePath(root, actual)) throw new Error(OUTSIDE_ROOT_MESSAGE)
}

/** Builds one readable artifact failure message. */
type ArtifactMessage = (path: string, cause: string) => string

/** Realpath one artifact path; null when absent, a readable error otherwise. */
function realArtifactPath(path: string, message: ArtifactMessage): string | null {
  try {
    return realpathSync.native(path)
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(message(path, causeOf(error)))
  }
}

/** Contain one existing artifact path under the canonical root; null stays absent. */
function containedArtifact(root: string, path: string, message: ArtifactMessage): string | null {
  const actual = realArtifactPath(path, message)
  if (actual !== null) requireInsideRoot(root, actual)
  return actual
}

/** ISO mtime of a contained artifact; null when it disappeared, readable error otherwise. */
function isoMtime(actual: string, path: string, message: ArtifactMessage): string | null {
  try {
    return new Date(statSync(actual).mtimeMs).toISOString()
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(message(path, causeOf(error)))
  }
}

/** The newest ISO timestamp among the given ones, or null when there are none. */
function newestModified(times: readonly string[]): string | null {
  let newest: string | null = null
  for (const time of times) {
    if (newest === null || Date.parse(time) > Date.parse(newest)) newest = time
  }
  return newest
}

/** One `specs/<capability>/spec.md` file of a change. */
interface DeltaSpecFile {
  readonly capability: string
  readonly file: string
}

/** The delta spec files under one change directory, sorted by capability. */
function deltaSpecFiles(root: string, changeDirectory: string): DeltaSpecFile[] {
  const directory = join(changeDirectory, 'specs')
  let entries: Dirent[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw new Error(
      `Could not read the OpenSpec delta specs directory ${directory}: ${causeOf(error)}`,
    )
  }
  const files: DeltaSpecFile[] = []
  for (const entry of entries) {
    const file = join(directory, entry.name, 'spec.md')
    const actual = realArtifactPath(file, artifactReadMessage)
    if (actual === null) continue
    requireInsideRoot(root, actual)
    let present = false
    try {
      present = statSync(actual).isFile()
    } catch (error) {
      if (isMissing(error)) continue
      throw new Error(artifactReadMessage(file, causeOf(error)))
    }
    if (!present) continue
    files.push({ capability: entry.name, file })
  }
  return files.sort((left, right) => left.capability.localeCompare(right.capability))
}

/** Whether one artifact path canonically exists under the OpenSpec root. */
function artifactPresent(root: string, path: string): boolean {
  return containedArtifact(root, path, artifactReadMessage) !== null
}

/** One read artifact: its body and ISO last-modified time. */
interface ReadArtifact {
  readonly body: string
  readonly modified: string
}

/** Read an optional artifact; a missing artifact is null, other errors are readable. */
async function readOptionalArtifact(root: string, path: string): Promise<ReadArtifact | null> {
  const actual = containedArtifact(root, path, artifactReadMessage)
  if (actual === null) return null
  const modified = isoMtime(actual, path, artifactReadMessage)
  if (modified === null) return null
  try {
    return { body: await readFile(actual, 'utf8'), modified }
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(artifactReadMessage(path, causeOf(error)))
  }
}

/** Read an artifact the directory walk just found; a failure is a real error. */
async function readRequiredArtifact(root: string, path: string): Promise<ReadArtifact> {
  const actual = containedArtifact(root, path, artifactReadMessage)
  const modified = actual === null ? null : isoMtime(actual, path, artifactReadMessage)
  if (actual === null || modified === null) {
    throw new Error(artifactReadMessage(path, 'the file is missing'))
  }
  try {
    return { body: await readFile(actual, 'utf8'), modified }
  } catch (error) {
    throw new Error(artifactReadMessage(path, causeOf(error)))
  }
}

/**
 * The artifacts one CLI-reported change already carries.
 * @param workspace - absolute session working directory.
 * @param name - a change name; the changes route passes CLI rows only.
 */
export function changePresence(workspace: string, name: string): ChangePresence {
  const root = canonicalRoot(workspace)
  const directory = containedItem(changesRoot(workspace), name)
  if (containedArtifact(root, directory, artifactReadMessage) === null) {
    return { proposal: false, design: false, tasks: false, specs: 0 }
  }
  return {
    proposal: artifactPresent(root, join(directory, 'proposal.md')),
    design: artifactPresent(root, join(directory, 'design.md')),
    tasks: artifactPresent(root, join(directory, 'tasks.md')),
    specs: deltaSpecFiles(root, directory).length,
  }
}

/**
 * Read one change's artifact bodies and progress.
 * @param workspace - absolute session working directory.
 * @param name - a change name the CLI reports for this workspace.
 * @throws a readable error when the change is unreported, escapes the root, or an artifact is unreadable.
 */
export async function readWorkspaceChange(
  workspace: string,
  name: string,
): Promise<WorkspaceChangeDetail> {
  const row = (await listWorkspaceChanges(workspace)).find((change) => change.name === name)
  if (row === undefined) throw new UnreportedItemError(unreportedChangeMessage(name))
  const root = canonicalRoot(workspace)
  const directory = containedItem(changesRoot(workspace), name)
  if (containedArtifact(root, directory, artifactReadMessage) === null) {
    throw new Error(artifactReadMessage(directory, 'the change directory is missing'))
  }
  const [proposal, design, tasks] = await Promise.all([
    readOptionalArtifact(root, join(directory, 'proposal.md')),
    readOptionalArtifact(root, join(directory, 'design.md')),
    readOptionalArtifact(root, join(directory, 'tasks.md')),
  ])
  const specs = await Promise.all(
    deltaSpecFiles(root, directory).map(async ({ capability, file }) => ({
      capability,
      ...(await readRequiredArtifact(root, file)),
    })),
  )
  return {
    name: row.name,
    status: row.status,
    completedTasks: row.completedTasks,
    totalTasks: row.totalTasks,
    presence: {
      proposal: proposal !== null,
      design: design !== null,
      tasks: tasks !== null,
      specs: specs.length,
    },
    modified: newestModified([
      ...(proposal === null ? [] : [proposal.modified]),
      ...(design === null ? [] : [design.modified]),
      ...(tasks === null ? [] : [tasks.modified]),
      ...specs.map((spec) => spec.modified),
    ]),
    artifacts: {
      proposal: proposal?.body ?? null,
      design: design?.body ?? null,
      tasks: tasks?.body ?? null,
    },
    specs,
  }
}

/**
 * List the capability specs of the workspace's own OpenSpec root.
 * @param workspace - absolute session working directory.
 * @returns the `{id, requirementCount}` rows `openspec list --specs --json` reports.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function listWorkspaceCapabilities(workspace: string): Promise<CapabilitySummary[]> {
  const parsed = await runOpenSpecJson(workspace, ['list', '--specs', '--json'], 'list --specs')
  if (!Array.isArray(parsed.specs)) throw new Error(CAPABILITIES_MALFORMED_MESSAGE)
  return parsed.specs.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.id.trim() === '' ||
      typeof entry.requirementCount !== 'number' ||
      !Number.isInteger(entry.requirementCount) ||
      entry.requirementCount < 0
    ) {
      throw new Error(CAPABILITIES_MALFORMED_MESSAGE)
    }
    return { id: entry.id, requirementCount: entry.requirementCount }
  })
}

/**
 * Read one capability's accepted spec body.
 * @param workspace - absolute session working directory.
 * @param id - a capability id the CLI reports for this workspace.
 * @throws a readable error when the capability is unreported, escapes the root, or its spec is unreadable.
 */
export async function readWorkspaceCapability(
  workspace: string,
  id: string,
): Promise<CapabilityDetail> {
  const capability = (await listWorkspaceCapabilities(workspace)).find((entry) => entry.id === id)
  if (capability === undefined) throw new UnreportedItemError(unreportedCapabilityMessage(id))
  const root = canonicalRoot(workspace)
  const file = join(containedItem(specsRoot(workspace), id), 'spec.md')
  const actual = containedArtifact(root, file, capabilityReadMessage)
  const modified = actual === null ? null : isoMtime(actual, file, capabilityReadMessage)
  if (actual === null || modified === null) {
    throw new Error(capabilityReadMessage(file, 'the file is missing'))
  }
  try {
    return {
      id: capability.id,
      requirementCount: capability.requirementCount,
      body: await readFile(actual, 'utf8'),
      modified,
    }
  } catch (error) {
    throw new Error(capabilityReadMessage(file, causeOf(error)))
  }
}
