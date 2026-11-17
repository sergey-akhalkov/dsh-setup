import { createHash } from 'node:crypto'
import { type Dirent, existsSync } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { specDigest } from './evidence.js'
import { type GitRunner, repositoryRoot } from './git.js'

/**
 * The frozen task-review snapshot: a disposable worktree built from the exact
 * review input set, its lease, and the stale-snapshot sweep.
 */

export const SNAPSHOT_DIR = '.dsh/workflows/snapshots'
export const SCRATCH_DIR = '.dsh/workflows/scratch'
const SNAPSHOT_LEASE_MS = 5 * 60_000
const SNAPSHOT_REFRESH_MS = 30_000
const SNAPSHOT_SWEEP_MS = 10 * 60_000
const SNAPSHOT_NO_LEASE_GRACE_MS = 10 * 60_000

const ignoredForDigest = (path: string): boolean =>
  path === '.dsh' || path.startsWith('.dsh/') || path === '.tmp' || path.startsWith('.tmp/')

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

/** One immutable review checkout; the digest binds to `tree`. */
export interface ReviewSnapshot {
  /** Content tree the task digest binds to. */
  readonly tree: string
  /** Snapshot commit checked out in the disposable worktree. */
  readonly commit: string
  /** Disposable worktree the reviewer runs in. */
  readonly worktree: string
  /** Frozen change directory inside the worktree. */
  readonly changeDir: string
  /** Change-artifact digest computed from the frozen copy. */
  readonly specDigest: string
}

interface SnapshotLease {
  stopped: boolean
  writes: Promise<void>
  timer?: NodeJS.Timeout
}
const snapshotLeases = new Map<string, SnapshotLease>()
const snapshotSweeps = new Map<string, number>()

/**
 * The stable snapshot directory name for one review unit key: a readable
 * prefix plus a short hash, so two units never share a checkout and the name
 * carries no separator or traversal. An unchanged key keeps the same path
 * across rounds, which is what lets the provider resume its review thread. A
 * key that is already one safe path segment (a run id) keeps its old name, so
 * a snapshot an interrupted upgrade left behind stays discardable.
 */
export function reviewSnapshotName(key: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(key)) return key
  const readable = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/gu, '')
  const hash = createHash('sha256')
    .update(`workflows-review-snapshot-v1\u0000${key}`)
    .digest('hex')
    .slice(0, 12)
  return `review-${readable === '' ? 'unit' : readable}-${hash}`
}

function snapshotKey(cwd: string, name: string): string {
  return `${resolve(cwd, SNAPSHOT_DIR)}\u0000${name}`
}

function snapshotLeasePath(cwd: string, name: string): string {
  return `${resolve(cwd, SNAPSHOT_DIR, name)}.lease`
}

async function readSnapshotLease(path: string): Promise<number | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { expiresAt?: unknown }
    return typeof value.expiresAt === 'number' ? value.expiresAt : undefined
  } catch {
    return undefined
  }
}

async function writeSnapshotLease(cwd: string, name: string): Promise<void> {
  await writeJsonAtomic(snapshotLeasePath(cwd, name), {
    runId: name,
    expiresAt: Date.now() + SNAPSHOT_LEASE_MS,
  })
}

export async function startSnapshotLease(
  cwd: string,
  key: string,
  refreshMs = SNAPSHOT_REFRESH_MS,
): Promise<void> {
  await startSnapshotLeaseByName(cwd, reviewSnapshotName(key), refreshMs)
}

async function startSnapshotLeaseByName(
  cwd: string,
  name: string,
  refreshMs = SNAPSHOT_REFRESH_MS,
): Promise<void> {
  const state: SnapshotLease = { stopped: false, writes: writeSnapshotLease(cwd, name) }
  const timer = setInterval(() => {
    if (state.stopped) return
    state.writes = state.writes.then(() => writeSnapshotLease(cwd, name)).catch(() => undefined)
  }, refreshMs)
  timer.unref()
  state.timer = timer
  snapshotLeases.set(snapshotKey(cwd, name), state)
  await state.writes
}

export async function stopSnapshotLease(cwd: string, key: string): Promise<void> {
  await stopSnapshotLeaseByName(cwd, reviewSnapshotName(key))
}

async function stopSnapshotLeaseByName(cwd: string, name: string): Promise<void> {
  const keyOf = snapshotKey(cwd, name)
  const state = snapshotLeases.get(keyOf)
  if (state === undefined) return
  state.stopped = true
  if (state.timer !== undefined) clearInterval(state.timer)
  snapshotLeases.delete(keyOf)
  await state.writes.catch(() => undefined)
}

/** Remove snapshots no live run owns; ownership is the lease, never age. */
export async function sweepReviewSnapshots(
  cwd: string,
  runGit: GitRunner,
  now = Date.now(),
): Promise<void> {
  const dir = resolve(cwd, SNAPSHOT_DIR)
  if (now - (snapshotSweeps.get(dir) ?? 0) < SNAPSHOT_SWEEP_MS) return
  snapshotSweeps.set(dir, now)
  let entries: Dirent<string>[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      const name = entry.name
      const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, name))
      if (expiresAt !== undefined && expiresAt > now) continue
      if (expiresAt === undefined) {
        try {
          if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS) continue
        } catch {
          continue
        }
      }
      await discardSnapshotByName(cwd, name, runGit)
      continue
    }
    if (entry.name.endsWith('.tmp') && entry.name.includes('.lease.')) {
      const name = entry.name.slice(0, entry.name.indexOf('.lease.'))
      const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, name))
      if (expiresAt !== undefined && expiresAt > now) continue
      try {
        if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS) continue
      } catch {
        continue
      }
      await unlink(path).catch(() => undefined)
      continue
    }
    if (entry.name.endsWith('.lease')) {
      const name = entry.name.slice(0, -'.lease'.length)
      if (existsSync(resolve(dir, name))) continue
      const expiresAt = await readSnapshotLease(path)
      if (expiresAt !== undefined && expiresAt > now) continue
      await unlink(path).catch(() => undefined)
    }
  }
  let scratchEntries: Dirent<string>[] = []
  try {
    scratchEntries = await readdir(resolve(cwd, SCRATCH_DIR), { withFileTypes: true })
  } catch {
    scratchEntries = []
  }
  for (const entry of scratchEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.index')) continue
    const name = entry.name.slice(0, -'.index'.length)
    const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, name))
    if (expiresAt !== undefined && expiresAt > now) continue
    const path = resolve(cwd, SCRATCH_DIR, entry.name)
    try {
      if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS) continue
    } catch {
      continue
    }
    await unlink(path).catch(() => undefined)
  }
  try {
    await runGit(['worktree', 'prune'], cwd)
  } catch {
    // Pruning is best effort.
  }
}

/** Remove one unit's snapshot checkout, its lease, and its scratch index; best effort. */
export async function discardReviewSnapshot(
  cwd: string,
  key: string,
  runGit: GitRunner,
  remove?: (path: string) => Promise<void>,
): Promise<void> {
  await discardSnapshotByName(cwd, reviewSnapshotName(key), runGit, remove)
}

async function discardSnapshotByName(
  cwd: string,
  name: string,
  runGit: GitRunner,
  remove: (path: string) => Promise<void> = (path) => rm(path, { recursive: true, force: true }),
): Promise<void> {
  await stopSnapshotLeaseByName(cwd, name)
  const worktree = resolve(cwd, SNAPSHOT_DIR, name)
  try {
    await runGit(['worktree', 'remove', '--force', worktree], cwd)
  } catch {
    // Not a registered worktree, already gone, or not a Git checkout.
  }
  for (const path of [worktree, resolve(cwd, SCRATCH_DIR, `${name}.index`), `${worktree}.lease`]) {
    await remove(path).catch(() => undefined)
  }
}

/**
 * Build the disposable review snapshot from the exact review input set. The
 * checkout lives at the stable path of `key` (the unit key; a run id also
 * works) and replaces any leftover checkout at that path. Returns undefined
 * when it cannot be built safely; the caller reviews the live worktree with the
 * mutation guard instead and gets the cause through `onUnavailable`.
 */
export async function createReviewSnapshot(
  cwd: string,
  change: { readonly dir: string },
  key: string,
  runGit: GitRunner,
  signal: AbortSignal,
  afterCopy?: () => Promise<void> | void,
  onUnavailable?: (reason: string) => void,
): Promise<ReviewSnapshot | undefined> {
  await sweepReviewSnapshots(cwd, runGit)
  const name = reviewSnapshotName(key)
  const root = await repositoryRoot(cwd, runGit, signal)
  let relChange: string
  try {
    relChange = relative(await realpath(root), await realpath(change.dir))
      .split(sep)
      .join('/')
  } catch {
    onUnavailable?.('the repository or change directory path could not be resolved')
    return undefined
  }
  if (
    relChange === '' ||
    relChange === '.' ||
    relChange === '..' ||
    relChange.startsWith('../') ||
    isAbsolute(relChange)
  ) {
    onUnavailable?.('the change directory is outside the repository')
    return undefined
  }
  try {
    await mkdir(resolve(cwd, '.dsh'), { recursive: true })
    await runGit(['check-ignore', '-q', '--no-index', '.dsh'], cwd, signal)
  } catch {
    onUnavailable?.(
      'the .dsh scratch directory is not Git-ignored; add .dsh/ to .gitignore or .git/info/exclude',
    )
    return undefined
  }
  try {
    if ((await runGit(['ls-files', '-u'], root, signal)).toString('utf8').trim() !== '') {
      onUnavailable?.('the repository index has unmerged entries')
      return undefined
    }
  } catch {
    onUnavailable?.('the repository index could not be read for unmerged entries')
    return undefined
  }

  // A key reused across rounds keeps its path: discard the previous round's
  // leftover (and its lease) so the checkout can be rebuilt in place.
  await discardSnapshotByName(cwd, name, runGit)
  try {
    await runGit(['worktree', 'prune'], cwd)
  } catch {
    // Pruning is best effort.
  }

  const worktree = resolve(cwd, SNAPSHOT_DIR, name)
  const scratch = resolve(cwd, SCRATCH_DIR, `${name}.index`)
  const env = { GIT_INDEX_FILE: scratch }
  try {
    const listed = (
      await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, signal)
    ).toString('utf8')
    const paths: string[] = []
    for (const path of listed.split('\0')) {
      if (path === '' || ignoredForDigest(path)) continue
      if (path === relChange || path.startsWith(`${relChange}/`)) continue
      try {
        await lstat(resolve(root, path))
      } catch {
        // A tracked path deleted from the worktree is what a live review sees.
        continue
      }
      paths.push(path)
    }
    await mkdir(dirname(scratch), { recursive: true })
    await mkdir(dirname(worktree), { recursive: true })
    if (paths.length > 0) {
      await runGit(
        ['update-index', '--add', '-z', '--stdin'],
        root,
        signal,
        env,
        `${paths.join('\0')}\0`,
      )
    }
    const tree = (await runGit(['write-tree'], root, signal, env)).toString('utf8').trim()
    let parent: string | undefined
    try {
      parent = (await runGit(['rev-parse', '--verify', 'HEAD'], root, signal))
        .toString('utf8')
        .trim()
    } catch {
      parent = undefined
    }
    const commit = (
      await runGit(
        [
          '-c',
          'user.name=dsh-workflows',
          '-c',
          'user.email=workflows@localhost',
          'commit-tree',
          tree,
          ...(parent === undefined ? [] : ['-p', parent]),
          '-m',
          'workflows: reviewed snapshot',
        ],
        root,
        signal,
      )
    )
      .toString('utf8')
      .trim()
    await startSnapshotLeaseByName(cwd, name)
    await runGit(['worktree', 'add', '--detach', worktree, commit], root, signal)
    const frozenChange = resolve(worktree, relChange)
    await mkdir(dirname(frozenChange), { recursive: true })
    await cp(change.dir, frozenChange, { recursive: true, force: true, dereference: true })
    if (afterCopy !== undefined) await afterCopy()
    const frozenSpec = await specDigest(frozenChange)
    return { tree, commit, worktree, changeDir: frozenChange, specDigest: frozenSpec }
  } catch {
    await discardSnapshotByName(cwd, name, runGit)
    onUnavailable?.('the snapshot worktree could not be built (git error during snapshot creation)')
    return undefined
  }
}

/**
 * The reviewed input set of a review: every file the reviewer can read, with a
 * stat signature that survives an edit-read-restore (content digests do not).
 * Whole scope covers the git-visible worktree and the change; a task review
 * covers the same set plus the change artifacts its digest also binds.
 */
export interface InputSignature {
  /** Walk root, used to render changed paths as evidence. */
  readonly root: string
  /** Absolute path -> stat signature. */
  readonly entries: ReadonlyMap<string, string>
}

/** Change-root entries that are engine output, not reviewed input. */
const CHANGE_INPUT_EXCLUDES: ReadonlySet<string> = new Set(['.openspec.yaml', 'reviews'])

async function inputStat(path: string): Promise<string> {
  try {
    const info = await stat(path, { bigint: true })
    return `${info.size}:${info.mtimeNs}:${info.ctimeNs}`
  } catch {
    // A deleted tracked file is a changed input, not an unreadable workspace.
    return '[missing]'
  }
}

async function inputSignature(
  root: string,
  excludes: ReadonlySet<string> = new Set(),
): Promise<InputSignature> {
  const entries = new Map<string, string>()
  async function walk(directory: string, prefix: string): Promise<void> {
    let dirents: Dirent<string>[]
    try {
      dirents = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      throw new Error(
        `could not read reviewed inputs under ${prefix === '' ? '.' : prefix}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    for (const entry of dirents) {
      // Exclusions are change-root entries: a nested `reviews/` is an artifact.
      if (prefix === '' && excludes.has(entry.name)) continue
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, name)
        continue
      }
      if (!entry.isFile()) continue
      entries.set(absolute, await inputStat(absolute))
    }
  }
  await walk(root, '')
  return { root, entries }
}

/** The git-visible worktree file set the worktree digest covers, with stats. */
async function gitInputSignature(
  root: string,
  runGit: GitRunner,
  signal?: AbortSignal,
): Promise<InputSignature> {
  let raw: Buffer
  try {
    raw = await runGit(
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      root,
      signal,
    )
  } catch (error) {
    throw new Error(
      `could not list the reviewed worktree inputs: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const entries = new Map<string, string>()
  for (const path of raw.toString('utf8').split('\0')) {
    if (path === '' || ignoredForDigest(path)) continue
    entries.set(resolve(root, path), await inputStat(resolve(root, path)))
  }
  return { root, entries }
}

/** Every file the reviewer can read for one review, before it is prepared. */
export async function reviewedInputs(
  cwd: string,
  changeDir: string,
  runGit: GitRunner,
  signal?: AbortSignal,
): Promise<InputSignature> {
  const root = await repositoryRoot(cwd, runGit, signal)
  const signature = await gitInputSignature(root, runGit, signal)
  const entries = new Map(signature.entries)
  // The portable approval directory is engine output, not reviewed input: a
  // record another review writes during this run must not discard the verdict.
  let approvals = resolve(changeDir, 'reviews')
  try {
    approvals = resolve(root, relative(await realpath(root), await realpath(changeDir)), 'reviews')
  } catch {
    // Fall back to the session's lexical form when the paths cannot be resolved.
  }
  for (const path of [...entries.keys()]) {
    if (path === approvals || path.startsWith(`${approvals}${sep}`)) entries.delete(path)
  }
  // A task digest also hashes the change artifacts, so they are guarded
  // regardless of git; whole scope reads the change and the worktree both.
  // Resolve a linked checkout so changed paths stay relative to the root.
  const resolvedChange = await realpath(changeDir).catch(() => changeDir)
  const change = await inputSignature(resolvedChange, CHANGE_INPUT_EXCLUDES)
  for (const [path, value] of change.entries) entries.set(path, value)
  return { root, entries }
}

/** Paths whose reviewed input changed (added, removed, or stat mutation). */
export function changedInputPaths(signature: InputSignature, current: InputSignature): string[] {
  const changed = new Set<string>()
  for (const [path, value] of signature.entries) {
    if (current.entries.get(path) !== value) changed.add(toRelative(signature.root, path))
  }
  for (const path of current.entries.keys()) {
    if (!signature.entries.has(path)) changed.add(toRelative(signature.root, path))
  }
  return [...changed].sort()
}

function toRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/** Stable hash of the source input set a queued review re-checks before start. */
export function signatureHash(signature: InputSignature): string {
  const hash = createHash('sha256')
  hash.update('queue-signature-v1')
  hash.update('\0')
  for (const [path, value] of [...signature.entries].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(`${path}\u0000${value}`)
    hash.update('\0')
  }
  return hash.digest('hex')
}
