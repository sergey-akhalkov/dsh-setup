import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BANK_METADATA_FILE,
  BANKS_DIR,
  bankFolderName,
  buildBankFiles,
  buildRepositoryIndex,
  INDEX_FILE,
  parseRepositoryIndex,
  type RepositoryIndexEntry,
  sha256Hex,
} from './export-archive.js'
import { ExportError, messageOf } from './export-errors.js'
import type { ArchiveEntries } from './export-zip.js'

/** Single-writer lock file, relative to the export repository. */
export const LOCK_FILE = '.export.lock'
/** Staging directory for a snapshot under construction. */
export const STAGING_DIR = '.export-staging'
/** Journal of an in-flight snapshot swap; a crash leaves it for the next cycle. */
export const PENDING_FILE = '.export-pending.json'
/** A lock older than this is considered abandoned by a crashed Host. */
export const DEFAULT_LOCK_STALE_MS = 15 * 60 * 1000

export interface SnapshotLock {
  readonly owner: string
  /** Remove the lock, but only while this owner still holds it. */
  release(): void
}

export interface LockOptions {
  owner?: string
  staleAfterMs?: number
  now?: () => number
}

interface LockRecord {
  owner: string
  created_at: string
}

function readRecord(path: string): LockRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Partial<LockRecord>
    if (typeof record.owner !== 'string' || typeof record.created_at !== 'string') return undefined
    const created = Date.parse(record.created_at)
    if (!Number.isFinite(created)) return undefined
    return { owner: record.owner, created_at: record.created_at }
  } catch {
    return undefined
  }
}

function isStale(record: LockRecord, now: number, staleAfterMs: number): boolean {
  return now - Date.parse(record.created_at) >= staleAfterMs
}

/**
 * Publish a complete lock file at `target` only if no file is there. The bytes
 * are written to a private candidate first, so a competing reader never sees a
 * half-written lock and misreads it as stale.
 */
function publish(candidate: string, target: string): boolean {
  try {
    linkSync(candidate, target)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return false
    if (code === 'EPERM' || code === 'ENOSYS' || code === 'EXDEV' || code === 'EACCES') {
      // shortcut: filesystems without hard links (FAT, some network shares) fall
      // back to an exclusive create with a tiny publication race; upgrade when
      // the export target lives on one of them.
      try {
        copyFileSync(candidate, target, constants.COPYFILE_EXCL)
        return true
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw copyError
      }
    }
    throw error
  }
}

/**
 * Take the single-writer lock for one export cycle. A live holder means this
 * cycle skips; an abandoned holder is replaced through an elected takeover, so
 * two recovering processors can never displace each other's fresh lock.
 */
export function acquireSnapshotLock(repoDir: string, options: LockOptions = {}): SnapshotLock {
  const now = options.now ?? Date.now
  const owner = options.owner ?? `${hostname()}-${process.pid}-${randomUUID()}`
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_LOCK_STALE_MS
  const lockPath = join(repoDir, LOCK_FILE)
  const takeoverPath = `${lockPath}.takeover`
  mkdirSync(repoDir, { recursive: true })
  const candidate = join(repoDir, `${LOCK_FILE}.${randomUUID()}.new`)
  writeFileSync(candidate, JSON.stringify({ owner, created_at: new Date(now()).toISOString() }))
  const lock = (): SnapshotLock => ({
    owner,
    release: () => {
      const holder = readRecord(lockPath)
      if (holder?.owner !== owner) return
      try {
        rmSync(lockPath, { force: true })
      } catch {
        // A lock that cannot be removed is stale by TTL on the next cycle.
      }
    },
  })

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (publish(candidate, lockPath)) return lock()
      const holder = readRecord(lockPath)
      if (holder === undefined) continue
      if (!isStale(holder, now(), staleAfterMs)) {
        throw new ExportError('lock', `another exporter (${holder.owner}) holds ${lockPath}`)
      }
      if (!publish(candidate, takeoverPath)) {
        const elector = readRecord(takeoverPath)
        if (elector !== undefined && isStale(elector, now(), staleAfterMs)) {
          rmSync(takeoverPath, { force: true })
          continue
        }
        throw new ExportError(
          'lock',
          `another exporter is recovering the stale lock at ${lockPath}`,
        )
      }
      try {
        // Only an unchanged stale holder may be replaced: a fresh lock created
        // after the election means someone else won, and this cycle skips.
        const current = readRecord(lockPath)
        if (
          current === undefined ||
          current.owner !== holder.owner ||
          current.created_at !== holder.created_at
        ) {
          continue
        }
        rmSync(lockPath, { force: true })
        if (publish(candidate, lockPath)) return lock()
        throw new ExportError('lock', `another exporter acquired ${lockPath}`)
      } finally {
        rmSync(takeoverPath, { force: true })
      }
    }
    throw new ExportError('lock', `cannot take the export lock at ${lockPath}`)
  } finally {
    rmSync(candidate, { force: true })
  }
}

/** One bank archive on its way into a snapshot. */
export interface BankSnapshotInput {
  bankId: string
  operationId: string
  exportedAt: string
  entries: ArchiveEntries
}

export interface SnapshotOptions {
  includeHistory: boolean
  includeAttachments: boolean
  now?: () => Date
}

export interface SnapshotResult {
  changed: boolean
  contentHash: string
  /** Bank id to its folder inside `banks/`, for the log line and the index. */
  bankFolders: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stable key order and order-insensitive arrays: transport noise must not look like content. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item))
    return items.sort((left, right) => {
      const a = JSON.stringify(left)
      const b = JSON.stringify(right)
      return a < b ? -1 : a > b ? 1 : 0
    })
  }
  if (isRecord(value)) {
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) ordered[key] = canonicalize(value[key])
    return ordered
  }
  return value
}

/**
 * The normalized content hash a cycle compares before writing anything.
 * Volatile fields (`exported_at`) and our own `export.json` are excluded, so
 * re-running an unchanged export produces the same hash.
 */
export function normalizedContentHash(snapshot: ReadonlyMap<string, ArchiveEntries>): string {
  const hash = createHash('sha256')
  for (const folder of [...snapshot.keys()].sort()) {
    const files = snapshot.get(folder)
    if (files === undefined) continue
    for (const path of [...files.keys()].sort()) {
      if (path === BANK_METADATA_FILE) continue
      const bytes = files.get(path)
      if (bytes === undefined) continue
      hash.update(`${folder}/${path}\0`)
      if (path.endsWith('.json')) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
          if (path === 'manifest.json' && isRecord(parsed)) delete parsed.exported_at
          hash.update(JSON.stringify(canonicalize(parsed)))
        } catch {
          hash.update(bytes)
        }
      } else {
        hash.update(bytes)
      }
      hash.update('\n')
    }
  }
  return hash.digest('hex')
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true })
}

function backupDirs(repoDir: string): string[] {
  return readdirSync(repoDir).filter((name) => name.startsWith(`${BANKS_DIR}.old-`))
}

/** The journal is replaced atomically so a crash cannot leave a partial phase. */
function writeJournal(path: string, journal: { backup: string; phase: 'swap' | 'rollback' }): void {
  const temporary = `${path}.${randomUUID()}.new`
  writeFileSync(temporary, JSON.stringify(journal))
  renameSync(temporary, path)
}

/**
 * Finish or undo a snapshot swap interrupted by a crash. A `swap` journal pairs
 * a bank tree already moved into place with the staged index; a `rollback`
 * journal never publishes that index, because the old tree is authoritative.
 */
export function recoverPendingSnapshot(repoDir: string): void {
  const pendingFile = join(repoDir, PENDING_FILE)
  const banksDir = join(repoDir, BANKS_DIR)
  const staging = join(repoDir, STAGING_DIR)
  const indexFile = join(repoDir, INDEX_FILE)
  if (!existsSync(pendingFile)) return

  let backup: string | undefined
  let phase: 'swap' | 'rollback' = 'swap'
  try {
    const parsed: unknown = JSON.parse(readFileSync(pendingFile, 'utf8'))
    if (isRecord(parsed) && typeof parsed.backup === 'string') backup = parsed.backup
    if (isRecord(parsed) && parsed.phase === 'rollback') phase = 'rollback'
  } catch {
    // An unreadable journal is best-effort recovered from the directory names.
  }

  const candidates = [
    ...(backup === undefined ? [] : [backup]),
    ...backupDirs(repoDir).sort().reverse(),
  ]
  const existingBackup = candidates
    .map((name) => join(repoDir, name))
    .find((directory) => existsSync(directory))

  if (phase === 'rollback') {
    // The old tree wins: a surviving backup means the replacement was installed
    // or only partly removed, and it must be discarded before the old tree
    // returns. Without a backup the rollback already completed.
    if (existingBackup !== undefined) {
      removeTree(banksDir)
      renameSync(existingBackup, banksDir)
    }
  } else if (!existsSync(banksDir)) {
    if (existingBackup !== undefined) renameSync(existingBackup, banksDir)
  } else {
    for (const name of candidates) removeTree(join(repoDir, name))
  }

  // A staged bank tree still present means the replacement was never installed:
  // the original tree and its index stay authoritative and the staged index is
  // discarded with it. Only a committed swap adopts that index, and never a
  // transaction that already entered rollback.
  const stagedIndex = join(staging, INDEX_FILE)
  const installed = !existsSync(join(staging, BANKS_DIR)) && existsSync(banksDir)
  if (phase === 'swap' && installed && existsSync(stagedIndex)) renameSync(stagedIndex, indexFile)
  removeTree(staging)
  rmSync(pendingFile, { force: true })
}

/**
 * Write a complete snapshot into the repository, replacing the previous one
 * only when the normalized content changed. The tree is staged, journaled, and
 * swapped in, so a crash leaves either the old tree or the new one recoverable.
 */
export function writeSnapshot(
  repoDir: string,
  banks: BankSnapshotInput[],
  options: SnapshotOptions,
): SnapshotResult {
  const now = options.now ?? (() => new Date())
  recoverPendingSnapshot(repoDir)
  const banksDir = join(repoDir, BANKS_DIR)
  const staging = join(repoDir, STAGING_DIR)
  const indexFile = join(repoDir, INDEX_FILE)
  const pendingFile = join(repoDir, PENDING_FILE)
  const previous = existsSync(indexFile) ? parseRepositoryIndex(readFileSync(indexFile)) : undefined

  const byFolder = new Map<string, Map<string, Uint8Array>>()
  const bankFolders: Record<string, string> = {}
  const indexEntries: RepositoryIndexEntry[] = []
  for (const bank of banks) {
    const { files, metadata } = buildBankFiles({ ...bank, scope: options })
    const folder = bankFolderName(bank.bankId)
    bankFolders[bank.bankId] = folder
    byFolder.set(folder, files)
    indexEntries.push({
      bank_id: bank.bankId,
      folder,
      exported_at: bank.exportedAt,
      operation_id: bank.operationId,
      documents: metadata.counts.documents,
      facts: metadata.counts.facts,
      metadata_sha256: sha256Hex(files.get(BANK_METADATA_FILE) ?? new Uint8Array()),
    })
  }

  const contentHash = normalizedContentHash(byFolder)
  if (previous?.content_hash === contentHash && existsSync(banksDir)) {
    removeTree(staging)
    return { changed: false, contentHash, bankFolders }
  }

  removeTree(staging)
  try {
    mkdirSync(join(staging, BANKS_DIR), { recursive: true })
    for (const [folder, files] of byFolder) {
      for (const [path, bytes] of files) {
        const target = join(staging, BANKS_DIR, folder, path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, bytes)
      }
    }
    writeFileSync(
      join(staging, INDEX_FILE),
      buildRepositoryIndex(now().toISOString(), contentHash, indexEntries),
    )
  } catch (error) {
    removeTree(staging)
    throw new ExportError('archive', `cannot stage the export snapshot: ${messageOf(error)}`, {
      cause: error,
    })
  }

  const backupName = `${BANKS_DIR}.old-${randomUUID()}`
  const backupDir = join(repoDir, backupName)
  writeJournal(pendingFile, { backup: backupName, phase: 'swap' })
  let installed = false
  try {
    if (existsSync(banksDir)) renameSync(banksDir, backupDir)
    renameSync(join(staging, BANKS_DIR), banksDir)
    installed = true
    renameSync(join(staging, INDEX_FILE), indexFile)
  } catch (error) {
    // Enter rollback in the journal first, then drop the staged index before
    // restoring the old tree: an interrupted rollback must never publish an
    // index for content that was not installed.
    try {
      writeJournal(pendingFile, { backup: backupName, phase: 'rollback' })
      rmSync(join(staging, INDEX_FILE), { force: true })
      if (installed) removeTree(banksDir)
      if (existsSync(backupDir) && !existsSync(banksDir)) renameSync(backupDir, banksDir)
      removeTree(staging)
      rmSync(pendingFile, { force: true })
    } catch {
      // recoverPendingSnapshot finishes this on the next cycle.
    }
    throw new ExportError('archive', `cannot replace the export snapshot: ${messageOf(error)}`, {
      cause: error,
    })
  }
  removeTree(backupDir)
  removeTree(staging)
  rmSync(pendingFile, { force: true })
  return { changed: true, contentHash, bankFolders }
}
