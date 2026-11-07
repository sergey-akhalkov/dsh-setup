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

/**
 * Validate a definition file, copy it atomically into the workspace definitions
 * directory, and record its content hash and host signature. The caller asks
 * the user first; this function is the host-only install path.
 */
export async function installDefinition(
  workspace: string,
  sourcePath: string,
  auth: HostAuth,
): Promise<InstallResult> {
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
  await writeAtomic(target, bytes)
  // A concurrent swap for a link must not be blessed: the written file itself
  // has to resolve to the exact expected name inside the definitions directory.
  const written = await realpath(target).catch(() => undefined)
  if (
    written === undefined ||
    dirname(written) !== directory ||
    (await lstat(target)).isSymbolicLink()
  ) {
    await unlink(target).catch(() => undefined)
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
  await writeApprovals(workspace, approvals)
  return { definition, file: target, hash }
}

/**
 * The definitions directory, proven to stay inside the workspace. A symlinked
 * directory that points elsewhere is refused instead of followed.
 */
async function ensureDefinitionsDirectory(workspace: string): Promise<string> {
  const root = await realpath(workspace)
  const directory = workspaceDefinitionsDirectory(workspace)
  await mkdir(directory, { recursive: true })
  // A junction or symlink can point the writable definitions directory at the
  // shipped assets or the drafts directory; only a real directory is accepted.
  const info = await lstat(directory)
  if (info.isSymbolicLink()) {
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
  const directoryInfo = await lstat(directory).catch(() => undefined)
  if (directoryInfo?.isSymbolicLink() === true) {
    return {
      definitions: shipped,
      errors: [
        ...errors,
        'the workspace definitions directory is a link and is refused; use a real directory',
      ],
    }
  }
  const realDirectory = await realpath(directory).catch(() => undefined)
  if (realDirectory !== undefined && (root === undefined || !isInside(root, realDirectory))) {
    return {
      definitions: shipped,
      errors: [
        ...errors,
        'the workspace definitions directory escapes the workspace and is refused',
      ],
    }
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
  // An active intent trigger needs a definition the user installed and
  // confirmed; a shipped or merely unapproved definition stays refused.
  const userConfirmed = new Set(local.keys())
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
  if (options.installedLegacy === undefined) return { definitions: confirmed, errors }
  const kept: Definition[] = []
  for (const definition of confirmed) {
    const resolution = resolveOwnership(definition, options.installedLegacy)
    if (resolution.issues.length === 0) kept.push(definition)
    else errors.push(...resolution.issues)
  }
  return { definitions: kept, errors }
}

/** Read one local installed definition regardless of approval; test/debug seam. */
export async function readLocalDefinition(workspace: string, id: string): Promise<Definition> {
  return readDefinitionFile(join(workspaceDefinitionsDirectory(workspace), `${id}.json`))
}
