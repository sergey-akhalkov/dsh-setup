import { execFile, spawn } from 'node:child_process'
import { type Dirent, readdirSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Read the workspace's OpenSpec changes through the documented CLI, then join
 * the file facts the panel renders onto each CLI row.
 *
 * The CLI is a machine prerequisite: this module never installs, downloads,
 * or fetches it. The call is bounded and the whole process tree is killed on
 * timeout, because the npm-installed `openspec` on Windows is a `cmd.exe` shim
 * that spawns a Node grandchild.
 */

/** The task-derived status `openspec list` reports. */
export type CliChangeStatus = 'no-tasks' | 'complete' | 'in-progress'

/** Status a reader acts on; derived from the CLI counts and the archive flag. */
export type ChangePhase = 'planning' | 'ready-to-apply' | 'applying' | 'complete' | 'archived'

/** Artifact kinds one change already carries; `specs` counts delta spec files. */
export interface ChangePresence {
  readonly proposal: boolean
  readonly design: boolean
  readonly tasks: boolean
  readonly specs: number
}

/** The last commit that touched a workspace path. */
export interface CommitFact {
  readonly short: string
  readonly at: string
  readonly subject: string
}

/** One CLI row, before the file facts are joined. */
export interface WorkspaceChangeRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: CliChangeStatus
  readonly modified: string | null
  readonly archived: boolean
}

/** One change row with the facts the panel renders. */
export interface WorkspaceChange extends WorkspaceChangeRow {
  readonly phase: ChangePhase
  readonly archivedAt: string | null
  readonly summary: string | null
  readonly commit: CommitFact | null
  readonly presence: ChangePresence
}

/** Totals the root header renders before any segment body loads. */
export interface ChangeListCounts {
  readonly active: number
  readonly archived: number
  readonly capabilities: number
}

/** The change-list route response; `changes` stays the active-only legacy list. */
export interface WorkspaceChangeList {
  readonly changes: WorkspaceChange[]
  readonly archived: WorkspaceChange[]
  readonly counts: ChangeListCounts
}

/** One row of the capability inventory. */
export interface CapabilitySummary {
  readonly id: string
  readonly requirementCount: number
}

/** One commit section of a `git log --name-only` read. */
export interface GitLogEntry {
  readonly commit: CommitFact
  readonly paths: readonly string[]
}

/** The injected `git` executor; tests replace it and it never sees a shell. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>

/** Time one `openspec list` call may take before its process tree is killed. */
export const LIST_TIMEOUT_MS = 10_000

/** Time one `git log` call may take before it is killed. */
export const GIT_TIMEOUT_MS = 5_000

/** Largest `git log` output a read accepts. */
export const GIT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024

/** Newest commits a list or detail read inspects. */
export const GIT_LOG_LIMIT = 300

/** Longest change summary a row carries; the client clamps it to two lines. */
export const SUMMARY_MAX_LENGTH = 240

/** No OpenSpec root exists in the session workspace itself. */
export const NO_LOCAL_ROOT_MESSAGE =
  'No workspace-local OpenSpec root was found. Run `openspec init --tools none` in the workspace root first.'

/** The documented CLI prerequisite is missing from PATH. */
export const MISSING_CLI_MESSAGE =
  'The OpenSpec CLI (`openspec`) was not found on PATH. Install it with `npm install -g @fission-ai/openspec`.'

/** The CLI call exceeded its bound. */
export const TIMEOUT_MESSAGE = `\`openspec list\` did not finish within ${String(LIST_TIMEOUT_MS / 1000)} seconds.`

/** The CLI output is not the documented JSON shape. */
export const MALFORMED_MESSAGE = '`openspec list --json` returned output that could not be read.'

/** The CLI's `list --specs --json` output is not the documented shape. */
export const CAPABILITIES_MALFORMED_MESSAGE =
  '`openspec list --specs --json` returned output that could not be read.'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStatus(value: unknown): value is CliChangeStatus {
  return value === 'no-tasks' || value === 'complete' || value === 'in-progress'
}

/** Whether the CLI name resolves through PATH (PATHEXT aware on Windows). */
export function cliOnPath(): boolean {
  const path = process.env.PATH
  if (path === undefined) return false
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((entry) => entry !== '')
      : ['']
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue
    for (const extension of extensions) {
      try {
        if (statSync(join(directory, `openspec${extension}`)).isFile()) return true
      } catch {
        // Try the next candidate.
      }
    }
  }
  return false
}

/** Compare the CLI's reported root with the workspace, canonicalizing both. */
function sameRoot(reported: string, workspace: string): boolean {
  try {
    const left = realpathSync.native(reported)
    const right = realpathSync.native(workspace)
    return process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase()
      : left === right
  } catch {
    return false
  }
}

/** The root path of an `openspec list`/`show` response. */
export function reportedRoot(parsed: Record<string, unknown>): string | null {
  return isRecord(parsed.root) && typeof parsed.root.path === 'string' ? parsed.root.path : null
}

/** The root path of an `openspec status --change` response. */
export function planningRoot(parsed: Record<string, unknown>): string | null {
  return isRecord(parsed.planningHome) && typeof parsed.planningHome.root === 'string'
    ? parsed.planningHome.root
    : null
}

function requireRoot(
  parsed: Record<string, unknown>,
  workspace: string,
  rootOf: (body: Record<string, unknown>) => string | null,
): void {
  const reported = rootOf(parsed)
  if (reported === null || !sameRoot(reported, workspace)) throw new Error(NO_LOCAL_ROOT_MESSAGE)
}

/** Bound on waiting for the Windows tree cleanup before the timeout settles anyway. */
const TREE_KILL_TIMEOUT_MS = 2_000

/** Wait for `taskkill` to finish; resolves whether the tree termination completed. */
function taskkillTree(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), TREE_KILL_TIMEOUT_MS)
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
        clearTimeout(timer)
        resolve(error === null)
      })
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

/** Terminate the whole spawned tree; the Windows shim's Node child outlives a plain kill. */
function killTree(pid: number | undefined): Promise<boolean> {
  if (pid === undefined) return Promise.resolve(false)
  if (process.platform === 'win32') return taskkillTree(pid)
  try {
    process.kill(-pid, 'SIGKILL')
    return Promise.resolve(true)
  } catch {
    // The process group already exited.
    return Promise.resolve(false)
  }
}

/** Whether a non-zero exit still carried the CLI's own "no root" JSON response. */
function nullRootOutput(stdout: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isRecord(parsed) && parsed.root === null
  } catch {
    return false
  }
}

/**
 * Quote one argument for the Windows `cmd.exe /c` command line.
 *
 * cmd re-parses the line it receives, so a CLI-reported name containing `&`,
 * `|`, `<`, `>` or `^` would otherwise run as a separate command. Double
 * quotes make every metacharacter literal; a `"` cannot occur in a Windows
 * file name, and doubling it follows the usual cmd convention anyway.
 */
function windowsArgument(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Run one bounded `openspec` CLI call and return its stdout. */
function runCli(workspace: string, args: readonly string[], label: string): Promise<string> {
  const windows = process.platform === 'win32'
  const file = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'openspec'
  // Every request-derived name is a quoted token: no shell metacharacter in a
  // CLI-reported name can execute a second command.
  const command = windows
    ? ['/d', '/s', '/c', `openspec ${args.map(windowsArgument).join(' ')}`]
    : [...args]
  return new Promise((resolve, reject) => {
    const child = spawn(file, command, {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(windows ? { windowsHide: true, windowsVerbatimArguments: true } : { detached: true }),
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let childExited = false
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle()
    }
    // shortcut: on Windows taskkill /T needs the cmd.exe shim alive, so a
    // detached descendant that outlives the shim is reported as unconfirmed
    // rather than killed; move to a job object or supervisor if the CLI ever
    // detaches.
    const timer = setTimeout(() => {
      timedOut = true
      const tree = process.platform !== 'win32' || !childExited
      void (tree ? killTree(child.pid) : Promise.resolve(false)).then((killed) => {
        finish(() =>
          reject(
            new Error(
              killed
                ? TIMEOUT_MESSAGE
                : `${TIMEOUT_MESSAGE} Its process tree could not be confirmed terminated.`,
            ),
          ),
        )
      })
    }, LIST_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    // A stale Windows PID may be reused; never taskkill one after its process exited.
    child.on('exit', () => {
      childExited = true
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (timedOut) return
      finish(() =>
        reject(
          new Error(
            error.code === 'ENOENT'
              ? MISSING_CLI_MESSAGE
              : `\`openspec ${label}\` could not run: ${error.message}`,
          ),
        ),
      )
    })
    child.on('close', (code: number | null) => {
      // A surviving descendant keeps the inherited pipes open, so the timeout
      // path owns settlement once it has started the tree kill.
      if (timedOut) return
      finish(() => {
        if (code === 0) resolve(stdout)
        else if (nullRootOutput(stdout)) reject(new Error(NO_LOCAL_ROOT_MESSAGE))
        else {
          reject(
            new Error(
              `\`openspec ${label}\` failed: ${
                stderr.trim() === '' ? `exit code ${String(code)}` : stderr.trim()
              }`,
            ),
          )
        }
      })
    })
  })
}

/**
 * Run one bounded `openspec` JSON call against the workspace's own root and
 * return its parsed body.
 *
 * The workspace must carry a local `openspec/` root and the CLI must resolve
 * through PATH; both are refused before spawning. The reported root is checked
 * against the workspace, so an ancestor or declared store root is refused too.
 * @param workspace - absolute session working directory.
 * @param args - CLI arguments after `openspec`.
 * @param label - the command as it appears in readable failures, e.g. `list`.
 * @param rootOf - extracts the reported root from the response shape.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function runOpenSpecJson(
  workspace: string,
  args: readonly string[],
  label: string,
  rootOf: (body: Record<string, unknown>) => string | null = reportedRoot,
): Promise<Record<string, unknown>> {
  let isDirectory = false
  try {
    isDirectory = statSync(join(workspace, 'openspec')).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) throw new Error(NO_LOCAL_ROOT_MESSAGE)
  if (!cliOnPath()) throw new Error(MISSING_CLI_MESSAGE)

  const output = await runCli(workspace, args, label)
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error(MALFORMED_MESSAGE)
  }
  if (!isRecord(parsed)) throw new Error(MALFORMED_MESSAGE)
  requireRoot(parsed, workspace, rootOf)
  return parsed
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
export function specsRoot(workspace: string): string {
  return resolve(workspace, 'openspec', 'specs')
}

/** Whether a resolved path is strictly under a directory; case-insensitive on Windows. */
export function insidePath(base: string, target: string): boolean {
  const boundary = `${base}${sep}`
  return process.platform === 'win32'
    ? target.toLowerCase().startsWith(boundary.toLowerCase())
    : target.startsWith(boundary)
}

/** Resolve one request-named item under an OpenSpec root, refusing a lexical escape. */
export function containedItem(root: string, item: string): string {
  const base = resolve(root)
  const target = resolve(base, item)
  if (!insidePath(base, target)) throw new Error(OUTSIDE_ROOT_MESSAGE)
  return target
}

/** Canonical real path of the workspace's own `openspec/` root. */
export function canonicalRoot(workspace: string): string {
  const root = resolve(workspace, 'openspec')
  try {
    return realpathSync.native(root)
  } catch (error) {
    if (isMissing(error)) return root
    throw new Error(`Could not resolve the OpenSpec root ${root}: ${causeOf(error)}`)
  }
}

/** Refuse a canonical path that escaped the canonical OpenSpec root. */
export function requireInsideRoot(root: string, actual: string): void {
  if (!insidePath(root, actual)) throw new Error(OUTSIDE_ROOT_MESSAGE)
}

/** Builds one readable artifact failure message. */
type ArtifactMessage = (path: string, cause: string) => string

/** Realpath one artifact path; null when absent, a readable error otherwise. */
export function realArtifactPath(path: string, message: ArtifactMessage): string | null {
  try {
    return realpathSync.native(path)
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(message(path, causeOf(error)))
  }
}

/** Contain one existing artifact path under the canonical root; null stays absent. */
export function containedArtifact(
  root: string,
  path: string,
  message: ArtifactMessage,
): string | null {
  const actual = realArtifactPath(path, message)
  if (actual !== null) requireInsideRoot(root, actual)
  return actual
}

/** Whether one artifact path canonically exists under the OpenSpec root. */
export function artifactPresent(root: string, path: string): boolean {
  return containedArtifact(root, path, artifactReadMessage) !== null
}

/** ISO mtime of a contained artifact; null when it disappeared, readable error otherwise. */
export function isoMtime(actual: string, path: string, message: ArtifactMessage): string | null {
  try {
    return new Date(statSync(actual).mtimeMs).toISOString()
  } catch (error) {
    if (isMissing(error)) return null
    throw new Error(message(path, causeOf(error)))
  }
}

/** The newest ISO timestamp among the given ones, or null when there are none. */
export function newestModified(times: readonly string[]): string | null {
  let newest: string | null = null
  for (const time of times) {
    if (newest === null || Date.parse(time) > Date.parse(newest)) newest = time
  }
  return newest
}

/** One `specs/<capability>/spec.md` file of a change. */
export interface DeltaSpecFile {
  readonly capability: string
  readonly file: string
}

/** The delta spec files under one change directory, sorted by capability. */
export function deltaSpecFiles(root: string, changeDirectory: string): DeltaSpecFile[] {
  const directory = join(changeDirectory, 'specs')
  const files: DeltaSpecFile[] = []
  // OpenSpec discovers nested capabilities (specs/<area>/<id>/spec.md) with the
  // id `area/id`; walk the whole tree so those keep their deltas and provenance.
  const walk = (current: string, prefix: string): void => {
    const actualDirectory = realArtifactPath(current, artifactReadMessage)
    if (actualDirectory === null) return
    requireInsideRoot(root, actualDirectory)
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return
      throw new Error(
        `Could not read the OpenSpec delta specs directory ${current}: ${causeOf(error)}`,
      )
    }
    for (const entry of entries) {
      // A junction/symlink is followed only after the containment check above.
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        walk(join(current, entry.name), prefix === '' ? entry.name : `${prefix}/${entry.name}`)
      }
    }
    if (prefix === '') return
    const file = join(current, 'spec.md')
    const actual = realArtifactPath(file, artifactReadMessage)
    if (actual === null) return
    requireInsideRoot(root, actual)
    let present = false
    try {
      present = statSync(actual).isFile()
    } catch (error) {
      if (isMissing(error)) return
      throw new Error(artifactReadMessage(file, causeOf(error)))
    }
    if (present) files.push({ capability: prefix, file })
  }
  walk(directory, '')
  return files.sort((left, right) => left.capability.localeCompare(right.capability))
}

/** The artifacts one change directory already carries. */
export function presenceAt(workspace: string, directory: string): ChangePresence {
  const root = canonicalRoot(workspace)
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function parseCliRow(entry: unknown): WorkspaceChangeRow {
  if (
    !isRecord(entry) ||
    typeof entry.name !== 'string' ||
    entry.name.trim() === '' ||
    !isNonNegativeInteger(entry.completedTasks) ||
    !isNonNegativeInteger(entry.totalTasks) ||
    !isStatus(entry.status)
  ) {
    throw new Error(MALFORMED_MESSAGE)
  }
  return {
    name: entry.name,
    completedTasks: entry.completedTasks,
    totalTasks: entry.totalTasks,
    status: entry.status,
    modified: typeof entry.lastModified === 'string' ? entry.lastModified : null,
    archived: entry.archived === true,
  }
}

/**
 * List the active and archived change rows `openspec list --all --json` reports.
 * @param workspace - absolute session working directory.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function readWorkspaceChangeRows(workspace: string): Promise<{
  readonly changes: WorkspaceChangeRow[]
  readonly archived: WorkspaceChangeRow[]
}> {
  const parsed = await runOpenSpecJson(workspace, ['list', '--all', '--json'], 'list --all')
  if (!Array.isArray(parsed.changes)) throw new Error(MALFORMED_MESSAGE)
  const rows = parsed.changes.map(parseCliRow)
  return {
    changes: rows.filter((row) => !row.archived),
    archived: rows.filter((row) => row.archived),
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
      !isNonNegativeInteger(entry.requirementCount)
    ) {
      throw new Error(CAPABILITIES_MALFORMED_MESSAGE)
    }
    return { id: entry.id, requirementCount: entry.requirementCount }
  })
}

/** The ISO date prefix of an archived change directory name, or null. */
export function archivedDate(name: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})-/.exec(name)
  return match?.[1] ?? null
}

/** The status a reader acts on. Archived wins over every task-derived state. */
export function changePhase(change: {
  readonly archived: boolean
  readonly completedTasks: number
  readonly totalTasks: number
}): ChangePhase {
  if (change.archived) return 'archived'
  if (change.totalTasks === 0) return 'planning'
  if (change.completedTasks >= change.totalTasks) return 'complete'
  if (change.completedTasks === 0) return 'ready-to-apply'
  return 'applying'
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The first paragraph after a heading, stopping at the next heading of any level. */
function paragraphAfter(text: string, heading: RegExp): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => heading.test(line.trim()))
  if (start === -1) return null
  const paragraph: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^#{1,6}\s/.test(line)) break
    if (line.trim() === '') {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line)
  }
  const joined = collapse(paragraph.join(' '))
  return joined === '' ? null : joined
}

/** The first non-heading paragraph of a document. */
function firstParagraph(text: string): string | null {
  const paragraph: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      if (paragraph.length > 0) break
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line)
  }
  const joined = collapse(paragraph.join(' '))
  return joined === '' ? null : joined
}

/**
 * The one-line change summary: the first paragraph of the proposal's `Why`,
 * falling back to the document's first paragraph. Capped by the header budget.
 * @param proposal - the proposal Markdown, or null when the change carries none.
 */
export function proposalSummary(proposal: string | null): string | null {
  if (proposal === null) return null
  const summary = paragraphAfter(proposal, /^##\s+Why\s*$/i) ?? firstParagraph(proposal)
  if (summary === null) return null
  return summary.length > SUMMARY_MAX_LENGTH
    ? `${summary.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`
    : summary
}

/** The first paragraph of a spec's `## Purpose` section, if it has one. */
export function purposeSection(body: string): string | null {
  return paragraphAfter(body, /^##\s+Purpose\s*$/i)
}

/** One archived change that carried a delta spec for a capability. */
export interface ArchiveProducer {
  readonly name: string
  readonly date: string | null
}

/** Newest first: dated directories, then undated ones by name. */
function compareProducers(left: ArchiveProducer, right: ArchiveProducer): number {
  if (left.date !== null && right.date !== null && left.date !== right.date) {
    return right.date.localeCompare(left.date)
  }
  if (left.date === null && right.date !== null) return 1
  if (left.date !== null && right.date === null) return -1
  return right.name.localeCompare(left.name)
}

/**
 * Scan `openspec/changes/archive/*` for the capabilities each archived change
 * touched, newest producer first. Existence only; bodies stay with the detail read.
 * @param workspace - absolute session working directory.
 */
export function scanArchiveProducers(workspace: string): Map<string, ArchiveProducer[]> {
  const root = canonicalRoot(workspace)
  const archive = containedItem(changesRoot(workspace), 'archive')
  let entries: Dirent[]
  try {
    entries = readdirSync(archive, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return new Map()
    throw new Error(`Could not read the OpenSpec archive directory ${archive}: ${causeOf(error)}`)
  }
  const producers = new Map<string, ArchiveProducer[]>()
  for (const entry of entries) {
    const directory = join(archive, entry.name)
    const actual = containedArtifact(root, directory, artifactReadMessage)
    if (actual === null) continue
    let isDirectory = false
    try {
      isDirectory = statSync(actual).isDirectory()
    } catch (error) {
      if (isMissing(error)) continue
      throw new Error(artifactReadMessage(directory, causeOf(error)))
    }
    if (!isDirectory) continue
    for (const spec of deltaSpecFiles(root, directory)) {
      const list = producers.get(spec.capability) ?? []
      list.push({ name: entry.name, date: archivedDate(entry.name) })
      producers.set(spec.capability, list)
    }
  }
  for (const list of producers.values()) list.sort(compareProducers)
  return producers
}

/**
 * Run one bounded `git log` over workspace-relative paths and return its commit
 * sections newest first, or null on every failure (no git, no repository, a
 * timeout, malformed output, or an unsafe path).
 *
 * `execFile` means no shell; the limit, timeout, and output cap are fixed; the
 * paths follow `--` so a request name can never become an option.
 * @param workspace - absolute session working directory.
 * @param paths - workspace-relative paths to inspect; none may leave the workspace.
 * @param runner - the executor; tests inject one.
 */
export async function readGitLog(
  workspace: string,
  paths: readonly string[],
  runner: GitRunner = defaultGitRunner,
): Promise<GitLogEntry[] | null> {
  const safe: string[] = []
  for (const path of paths) {
    const normalized = workspaceRelative(workspace, path)
    if (normalized === null) return null
    safe.push(normalized)
  }
  if (safe.length === 0) return null
  let output: string
  try {
    output = await runner(
      [
        'log',
        '-n',
        String(GIT_LOG_LIMIT),
        '--name-only',
        // The workspace may sit below the repository root; without --relative
        // git prints repository-relative names and no row would match.
        '--relative',
        '--pretty=format:%x00%h%x09%aI%x09%s',
        '--',
        ...safe,
      ],
      workspace,
    )
  } catch {
    return null
  }
  return parseGitLog(output)
}

/** One workspace-relative path normalized to forward slashes, or null when unsafe. */
function workspaceRelative(workspace: string, path: string): string | null {
  if (isAbsolute(path)) return null
  const base = resolve(workspace)
  const relativePath = relative(base, resolve(base, path))
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return relativePath.split(sep).join('/')
}

/** Parse `git log --name-only` output; null when it is not the fixed format. */
function parseGitLog(output: string): GitLogEntry[] | null {
  if (output.replaceAll('\0', '').trim() === '') return []
  const entries: Array<{ commit: CommitFact; paths: string[] }> = []
  // Each commit record starts with the NUL the format prints. The explicit
  // delimiter also frames a merge commit that lists no files, which git emits
  // immediately before the next header with no blank line between them.
  for (const chunk of output.split('\0')) {
    const block = chunk.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '')
    if (block === '') continue
    const [headerLine = '', ...pathLines] = block.split(/\r?\n/)
    const header = /^([0-9a-f]{7,40})\t([^\t]+)\t(.*)$/.exec(headerLine)
    if (header === null) return null
    const at = header[2] ?? ''
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(at)) {
      return null
    }
    const paths = pathLines.filter((path) => path !== '')
    if (paths.some((path) => path.includes('\t'))) return null
    entries.push({
      commit: { short: header[1] ?? '', at, subject: header[3] ?? '' },
      paths: paths.map((path) => path.split('\\').join('/')),
    })
  }
  return entries
}

/** The newest commit that touched a file or any path under a directory. */
export function commitFor(
  entries: readonly GitLogEntry[] | null,
  target: string,
): CommitFact | null {
  if (entries === null) return null
  const normalized = target.split('\\').join('/').replace(/\/+$/, '')
  for (const entry of entries) {
    if (entry.paths.some((path) => path === normalized || path.startsWith(`${normalized}/`))) {
      return entry.commit
    }
  }
  return null
}

/** A CLI-reported item name that needs no shell quoting at all. */
const SAFE_CLI_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/**
 * Refuse a CLI-reported item name that a Windows `cmd.exe` could re-parse as a
 * command. Quoting alone does not stop `%VAR%` expansion, so a name carrying
 * `%`, a quote, or any other punctuation outside OpenSpec's slug grammar is
 * refused before it reaches the CLI. Nested capability ids keep their `/`.
 * @throws the readable refusal for the name.
 */
export function requireSafeCliName(name: string, kind: string): void {
  if (!SAFE_CLI_NAME.test(name)) {
    throw new Error(
      `The OpenSpec ${kind} "${name}" contains characters that cannot be passed to the CLI safely.`,
    )
  }
}

/** The real `git` executor: fixed arguments, no shell, bounded time and output. */
function defaultGitRunner(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (error !== null) reject(error)
        else resolve(stdout)
      },
    )
  })
}

/**
 * List the workspace's changes with the file facts the panel renders.
 *
 * `changes` stays the active-only legacy list the apply picker reads; archived
 * rows travel only in `archived`, and `counts` makes the root header complete
 * before the Specs segment has ever loaded.
 * @param workspace - absolute session working directory.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function listWorkspaceChanges(workspace: string): Promise<WorkspaceChangeList> {
  const [rows, capabilities] = await Promise.all([
    readWorkspaceChangeRows(workspace),
    listWorkspaceCapabilities(workspace),
  ])
  const git = await readGitLog(workspace, ['openspec/specs', 'openspec/changes'])
  const root = canonicalRoot(workspace)
  const enrich = async (row: WorkspaceChangeRow, archived: boolean): Promise<WorkspaceChange> => {
    const path = archived ? `openspec/changes/archive/${row.name}` : `openspec/changes/${row.name}`
    const directory = resolve(workspace, path)
    const presence = presenceAt(workspace, directory)
    return {
      ...row,
      archived,
      phase: changePhase({ ...row, archived }),
      archivedAt: archived ? archivedDate(row.name) : null,
      summary: presence.proposal ? await proposalSummaryAt(root, directory) : null,
      commit: commitFor(git, path),
      presence,
    }
  }
  const [changes, archived] = await Promise.all([
    Promise.all(rows.changes.map((row) => enrich(row, false))),
    Promise.all(rows.archived.map((row) => enrich(row, true))),
  ])
  return {
    changes,
    archived,
    counts: {
      active: changes.length,
      archived: archived.length,
      capabilities: capabilities.length,
    },
  }
}

/** Read one proposal's summary, treating any read failure as no summary. */
async function proposalSummaryAt(root: string, directory: string): Promise<string | null> {
  const actual = containedArtifact(root, join(directory, 'proposal.md'), artifactReadMessage)
  if (actual === null) return null
  try {
    return proposalSummary(await readFile(actual, 'utf8'))
  } catch {
    return null
  }
}
