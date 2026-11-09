import { createHash, randomBytes } from 'node:crypto'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import {
  type Definition,
  loadShippedDefinitions,
  readDefinitionFile,
  resolveOwnership,
  validateDefinition,
  workspaceDefinitionsDirectory,
} from './definitions.js'
import { isInside } from './fs-change.js'
import type { HostAuth } from './host-auth.js'

/**
 * The host approval store. A local definition or override is active only when
 * its content hash matches a record signed by the host key; a model-written
 * file, an unsigned approval, or a file changed after approval is refused.
 */

export const APPROVALS_FILE = 'approved.json'
export const APPROVAL_VERSION = 1

/** Domain separation for a definition approval signature. */
const APPROVAL_DOMAIN = 'workflows/definition-approval/v1'

/** One persisted approval. */
export interface StoredApproval {
  readonly hash: string
  readonly signature: string
}

/** The approved.json shape. */
export interface ApprovalStore {
  readonly v: typeof APPROVAL_VERSION
  readonly approvals: Readonly<Record<string, StoredApproval>>
}

/** The approval store path for one workspace. */
export function approvalsPath(workspace: string): string {
  return join(workspace, '.dsh', 'workflows', APPROVALS_FILE)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Write a file atomically: temp in the same directory, then rename. */
export async function writeAtomic(file: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, bytes)
  try {
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** The signature a host install records for one id and content hash. */
function approvalSignature(auth: HostAuth, id: string, hash: string): string {
  return auth.sign(APPROVAL_DOMAIN, { v: APPROVAL_VERSION, id, hash })
}

/** Verify one approval record against its id and hash. */
export function verifyApproval(
  auth: HostAuth | undefined,
  id: string,
  hash: string,
  record: StoredApproval | undefined,
): boolean {
  if (auth === undefined || record === undefined || record.hash !== hash) return false
  return auth.verify(APPROVAL_DOMAIN, { v: APPROVAL_VERSION, id, hash }, record.signature)
}

export interface ApprovalRead {
  readonly approvals: ReadonlyMap<string, StoredApproval>
  readonly error?: string
}

/**
 * Read the approval store. A missing file is an empty store; an unreadable or
 * malformed one reports an error and approves nothing.
 */
export async function readApprovals(workspace: string): Promise<ApprovalRead> {
  let raw: string
  try {
    raw = await readFile(approvalsPath(workspace), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { approvals: new Map() }
    }
    return {
      approvals: new Map(),
      error: `the approval store is unreadable: ${errorMessage(error)}`,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      approvals: new Map(),
      error: `the approval store is not valid JSON: ${errorMessage(error)}`,
    }
  }
  if (!isRecord(parsed) || parsed.v !== APPROVAL_VERSION || !isRecord(parsed.approvals)) {
    return { approvals: new Map(), error: 'the approval store has an unknown shape' }
  }
  const approvals = new Map<string, StoredApproval>()
  for (const [id, entry] of Object.entries(parsed.approvals)) {
    if (
      !isRecord(entry) ||
      typeof entry.hash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(entry.hash) ||
      typeof entry.signature !== 'string'
    ) {
      continue
    }
    approvals.set(id, { hash: entry.hash, signature: entry.signature })
  }
  return { approvals }
}

/** Persist the whole store atomically; only valid approvals are kept. */
async function writeApprovals(
  workspace: string,
  approvals: ReadonlyMap<string, StoredApproval>,
): Promise<void> {
  const record: Record<string, StoredApproval> = {}
  for (const id of [...approvals.keys()].sort()) {
    const entry = approvals.get(id)
    if (entry !== undefined) record[id] = entry
  }
  const store: ApprovalStore = { v: APPROVAL_VERSION, approvals: record }
  await writeAtomic(approvalsPath(workspace), `${JSON.stringify(store, null, 2)}\n`)
}

export interface InstallResult {
  readonly definition: Definition
  readonly file: string
  readonly hash: string
}

export interface InstallOptions {
  /** Test seam: the approval-store writer; production writes the real store. */
  readonly writeApprovals?: (
    workspace: string,
    approvals: ReadonlyMap<string, StoredApproval>,
  ) => Promise<void>
  /** Test seam: the replacement/restore primitive; production renames. */
  readonly rename?: typeof rename
  /** Test seam: the cleanup primitive; production unlinks. */
  readonly unlink?: typeof unlink
}

/** Workspace-scoped install transaction queue: approvals are one shared file. */
const INSTALL_QUEUES = new Map<string, Promise<unknown>>()

function serializeInstall<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = INSTALL_QUEUES.get(key) ?? Promise.resolve()
  const next = previous.then(run, run)
  INSTALL_QUEUES.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

/**
 * Validate a definition file, copy it atomically into the workspace definitions
 * directory, and record its content hash and host signature. The caller asks
 * the user first; this function is the host-only install path and the one the
 * editor save uses. Installs of one workspace are serialized because they share
 * the approval file.
 */
export function installDefinition(
  workspace: string,
  sourcePath: string,
  auth: HostAuth,
  options: InstallOptions = {},
): Promise<InstallResult> {
  return serializeInstall(workspace, () => installOnce(workspace, sourcePath, auth, options))
}

async function installOnce(
  workspace: string,
  sourcePath: string,
  auth: HostAuth,
  options: InstallOptions,
): Promise<InstallResult> {
  const move = options.rename ?? rename
  const remove = options.unlink ?? unlink
  const root = await realpath(workspace)
  const source = await realpath(isAbsolute(sourcePath) ? sourcePath : join(root, sourcePath)).catch(
    () => undefined,
  )
  if (source === undefined) {
    throw new Error(`the definition file "${sourcePath}" does not exist`)
  }
  if (!isInside(root, source)) {
    throw new Error(`the definition file "${sourcePath}" is outside the workspace`)
  }
  const info = await stat(source)
  if (!info.isFile()) throw new Error(`the definition path "${sourcePath}" is not a file`)
  const bytes = await readFile(source)
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`the definition file "${sourcePath}" is not valid JSON: ${errorMessage(error)}`)
  }
  const definition = validateDefinition(raw, relative(root, source).replaceAll('\\', '/'))
  const existing = await readApprovals(workspace)
  if (existing.error !== undefined) {
    throw new Error(`${existing.error}; fix or remove ${APPROVALS_FILE} before installing`)
  }
  const directory = await ensureDefinitionsDirectory(workspace)
  const target = join(directory, `${definition.id}.json`)
  if (!isInside(directory, target) || dirname(target) !== directory) {
    throw new Error(`definition "${definition.id}" resolves outside the definitions directory`)
  }
  // Keep the previous definition under a backup name (a rename, not a rewrite)
  // so a failed approval write can restore it even when the disk is full.
  const backup = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.bak`
  let hadPrevious = false
  try {
    await move(target, backup)
    hadPrevious = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const restore = async (): Promise<void> => {
    if (!hadPrevious) {
      await remove(target).catch(() => undefined)
      return
    }
    try {
      await move(backup, target)
    } catch (error) {
      throw new Error(
        `the previous definition could not be restored after a failed install (${errorMessage(error)}); its bytes are preserved at "${backup}"`,
      )
    }
  }
  try {
    await writeAtomic(target, bytes)
    // A concurrent swap for a link must not be blessed: the written file itself
    // has to resolve to the exact expected name inside the definitions directory.
    const written = await realpath(target).catch(() => undefined)
    if (
      written === undefined ||
      dirname(written) !== directory ||
      (await lstat(target)).isSymbolicLink()
    ) {
      throw new Error(
        `definition "${definition.id}" was replaced while installing; the approval was not recorded`,
      )
    }
    // Sign the exact validated source bytes. Never re-read the writable
    // destination: a write between the copy and the re-read must not be blessed.
    const hash = sha256(bytes)
    const record: StoredApproval = {
      hash,
      signature: approvalSignature(auth, definition.id, hash),
    }
    const approvals = new Map(existing.approvals)
    approvals.set(definition.id, record)
    try {
      await (options.writeApprovals ?? writeApprovals)(workspace, approvals)
    } catch (error) {
      throw new Error(
        `the approval store could not be written (${errorMessage(error)}); the definition was not installed`,
      )
    }
    if (hadPrevious) await remove(backup).catch(() => undefined)
    return { definition, file: target, hash }
  } catch (error) {
    if (hadPrevious || (await lstat(target).catch(() => undefined)) !== undefined) {
      await restore()
    }
    throw error
  }
}

/**
 * Refuse any linked ancestor between the canonical workspace root and the
 * target components. A `.dsh` or `.dsh/workflows` junction can otherwise point
 * the install at the shipped assets while every final-path check still passes.
 */
async function unlinkedAncestors(root: string, segments: readonly string[]): Promise<boolean> {
  for (let index = 1; index <= segments.length; index += 1) {
    const candidate = join(root, ...segments.slice(0, index))
    const info = await lstat(candidate).catch(() => undefined)
    if (info === undefined) return true
    if (info.isSymbolicLink()) return false
  }
  return true
}

const DEFINITION_SEGMENTS = ['.dsh', 'workflows', 'definitions'] as const

/**
 * The definitions directory, proven to stay inside the workspace. A symlinked
 * directory that points elsewhere is refused instead of followed.
 */
async function ensureDefinitionsDirectory(workspace: string): Promise<string> {
  const root = await realpath(workspace)
  if (!(await unlinkedAncestors(root, DEFINITION_SEGMENTS.slice(0, 2)))) {
    throw new Error('a workflow directory ancestor is a link; the definitions directory is refused')
  }
  const directory = workspaceDefinitionsDirectory(workspace)
  await mkdir(directory, { recursive: true })
  if (!(await unlinkedAncestors(root, DEFINITION_SEGMENTS))) {
    throw new Error(
      'the workspace definitions directory is a link; remove it and use a real directory',
    )
  }
  const real = await realpath(directory)
  if (!isInside(root, real)) {
    throw new Error('the workspace definitions directory escapes the workspace; remove the link')
  }
  return real
}

export interface ApprovedDefinitions {
  readonly definitions: readonly Definition[]
  /** One bounded line per refused local file; never file content. */
  readonly errors: readonly string[]
}

/**
 * Every load path ends here: an active intent needs a user-confirmed definition,
 * and an installed-legacy profile refuses every illegal ownership combination.
 * The fallback paths (a linked directory, an unreadable directory) must not
 * bypass these rules, so they call this too.
 */
function applyLoadRules(
  definitions: readonly Definition[],
  userConfirmed: ReadonlySet<string>,
  installedLegacy: ReadonlySet<string> | undefined,
  errors: string[],
): ApprovedDefinitions {
  const confirmed: Definition[] = []
  for (const definition of definitions) {
    if (
      definition.trigger.kind === 'intent' &&
      definition.trigger.mode === 'active' &&
      !userConfirmed.has(definition.id)
    ) {
      errors.push(
        `definition "${definition.id}": an active intent trigger requires a user-confirmed definition; run /workflows install <path> and confirm`,
      )
      continue
    }
    confirmed.push(definition)
  }
  if (installedLegacy === undefined) return { definitions: confirmed, errors }
  const kept: Definition[] = []
  for (const definition of confirmed) {
    const resolution = resolveOwnership(definition, installedLegacy)
    if (resolution.issues.length === 0) kept.push(definition)
    else errors.push(...resolution.issues)
  }
  return { definitions: kept, errors }
}

/**
 * Load the shipped definitions plus the approved local ones. A local file is
 * considered only when its id has a valid host approval for its exact content
 * hash; an approved local id overrides the shipped definition. The drafts
 * directory is never read.
 */
export async function loadApprovedDefinitions(
  workspace: string,
  options: {
    /** Absent when no local definition exists; shipped definitions need no key. */
    readonly auth?: HostAuth
    readonly shipped?: readonly Definition[]
    /** The legacy sources the profile installs; absent skips ownership checks. */
    readonly installedLegacy?: ReadonlySet<string>
  },
): Promise<ApprovedDefinitions> {
  const shipped = options.shipped ?? loadShippedDefinitions()
  const errors: string[] = []
  const store = await readApprovals(workspace)
  if (store.error !== undefined) errors.push(store.error)
  const local = new Map<string, Definition>()
  const directory = workspaceDefinitionsDirectory(workspace)
  const root = await realpath(workspace).catch(() => undefined)
  if (root !== undefined && !(await unlinkedAncestors(root, DEFINITION_SEGMENTS))) {
    return applyLoadRules(shipped, new Set(), options.installedLegacy, [
      ...errors,
      'a workflow directory ancestor is a link; the workspace definitions are refused',
    ])
  }
  const directoryInfo = await lstat(directory).catch(() => undefined)
  if (directoryInfo?.isSymbolicLink() === true) {
    return applyLoadRules(shipped, new Set(), options.installedLegacy, [
      ...errors,
      'the workspace definitions directory is a link and is refused; use a real directory',
    ])
  }
  const realDirectory = await realpath(directory).catch(() => undefined)
  if (realDirectory !== undefined && (root === undefined || !isInside(root, realDirectory))) {
    return applyLoadRules(shipped, new Set(), options.installedLegacy, [
      ...errors,
      'the workspace definitions directory escapes the workspace and is refused',
    ])
  }
  let names: string[]
  try {
    names = (await readdir(realDirectory ?? directory))
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = []
    else {
      errors.push(`the definitions directory is unreadable: ${errorMessage(error)}`)
      names = []
    }
  }
  for (const name of names) {
    const file = join(realDirectory ?? directory, name)
    const fileInfo = await lstat(file).catch(() => undefined)
    if (fileInfo?.isSymbolicLink() === true) {
      errors.push(`definition file "${name}" is a link and is refused`)
      continue
    }
    let bytes: Buffer
    try {
      bytes = await readFile(file)
    } catch (error) {
      errors.push(`definition file "${name}" is unreadable: ${errorMessage(error)}`)
      continue
    }
    let rawId: unknown
    try {
      const raw: unknown = JSON.parse(bytes.toString('utf8'))
      rawId = isRecord(raw) ? raw.id : undefined
    } catch {
      errors.push(`definition file "${name}" is not valid JSON and is refused`)
      continue
    }
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      errors.push(`definition file "${name}" has no id and is refused`)
      continue
    }
    const id: string = rawId
    const approval = store.approvals.get(id)
    const hash = sha256(bytes)
    if (!verifyApproval(options.auth, id, hash, approval)) {
      errors.push(
        `definition "${id}" is not approved by the host (${name}); run /workflows install <path> and confirm, or remove the file`,
      )
      continue
    }
    if (local.has(id)) {
      errors.push(`definition "${id}" is declared by more than one local file; the first is used`)
      continue
    }
    try {
      local.set(id, validateDefinition(JSON.parse(bytes.toString('utf8')), name))
    } catch (error) {
      errors.push(`approved definition "${id}" is invalid: ${errorMessage(error)}`)
    }
  }
  const definitions = shipped.map((definition) => local.get(definition.id) ?? definition)
  for (const [id, definition] of local) {
    if (!shipped.some((entry) => entry.id === id)) definitions.push(definition)
  }
  return applyLoadRules(definitions, new Set(local.keys()), options.installedLegacy, errors)
}

/** Read one local installed definition regardless of approval; test/debug seam. */
export async function readLocalDefinition(workspace: string, id: string): Promise<Definition> {
  return readDefinitionFile(join(workspaceDefinitionsDirectory(workspace), `${id}.json`))
}
