import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * The bounded git seam shared by the trigger condition's worktree digest and
 * the review snapshot. The shell is never used: arguments are fixed and no
 * user text is interpolated. Ported from the delegation runtime; the copy is
 * dropped with that plugin in Release B.
 */

/** One fixed-argument git invocation; output is raw bytes so diffs stay lossless. */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  /** Extra environment, merged over `process.env`; used for `GIT_INDEX_FILE`. */
  env?: Record<string, string>,
  /** Bytes written to the child's stdin and closed; used for `--stdin` path lists. */
  stdin?: string | Buffer,
) => Promise<Buffer>

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/** The production runner: spawn git with the fixed argument list. */
export function defaultGit(
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  env?: Record<string, string>,
  stdin?: string | Buffer,
): Promise<Buffer> {
  return new Promise<Buffer>((done, failed) => {
    const child = spawn('git', [...args], {
      cwd,
      signal,
      windowsHide: true,
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    })
    const chunks: Buffer[] = []
    let stderr = ''
    let stdinFailure: Error | undefined
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      failed(new GitError(`git ${args[0] ?? 'command'} failed: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code === 0) {
        if (stdinFailure === undefined) {
          done(Buffer.concat(chunks))
          return
        }
        failed(
          new GitError(
            `git ${args[0] ?? 'command'} could not receive stdin: ${stdinFailure.message}`,
          ),
        )
        return
      }
      const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      failed(
        new GitError(
          `git ${args[0] ?? 'command'} failed (exit ${code ?? 'unknown'})${detail ? `: ${detail}` : ''}`,
        ),
      )
    })
    child.stdin.on('error', (error: Error) => {
      stdinFailure = error
    })
    child.stdin.end(stdin)
  })
}

/** Path entries and diff bytes, ignoring the engine's own state and scratch. */
export function ignoredForDigest(path: string): boolean {
  return path === '.dsh' || path.startsWith('.dsh/') || path === '.tmp' || path.startsWith('.tmp/')
}

interface StatusEntry {
  readonly code: string
  readonly path: string
}

function parseStatus(raw: Buffer): StatusEntry[] {
  const entries: StatusEntry[] = []
  const tokens = raw.toString('utf8').split('\0')
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (token.length < 4) continue
    const code = token.slice(0, 2)
    const path = token.slice(3)
    entries.push({ code, path })
    if (code.startsWith('R') || code.startsWith('C')) index += 1
  }
  return entries
}

function hashParts(parts: ReadonlyArray<string | Buffer>): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function repositoryRoot(
  cwd: string,
  runGit: GitRunner,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const raw = (await runGit(['rev-parse', '--show-toplevel'], cwd, signal))
      .toString('utf8')
      .trim()
    return raw === '' ? cwd : resolve(raw)
  } catch {
    return cwd
  }
}

/** Files that count as implementation work rather than documentation/plan state. */
function isImplementationPath(path: string): boolean {
  if (ignoredForDigest(path)) return false
  if (path === 'docs' || path.startsWith('docs/')) return false
  if (path === 'openspec' || path.startsWith('openspec/')) return false
  if (path === 'market' || path.startsWith('market/')) return false
  return !/\.(?:md|mdx)$/iu.test(path)
}

/**
 * The implementation-state fingerprint: every dirty implementation file's
 * status code and content. Unlike a write observation it sees a shell edit, so
 * a turn-start/close comparison cannot miss one. Undefined when git cannot read
 * the tree; the caller then falls back to the write observations.
 */
export async function implementationFingerprint(
  cwd: string,
  runGit: GitRunner,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const root = await repositoryRoot(cwd, runGit, signal)
  let status: Buffer
  try {
    status = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, signal)
  } catch {
    return undefined
  }
  const entries = parseStatus(status).filter((entry) => isImplementationPath(entry.path))
  const parts: Array<string | Buffer> = ['implementation-v1']
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    parts.push(`${entry.code} ${entry.path}`)
    try {
      parts.push(await readFile(resolve(root, entry.path)))
    } catch {
      parts.push('[deleted]')
    }
  }
  return hashParts(parts)
}

/**
 * The worktree content digest: tracked diffs plus untracked files, ignoring the
 * engine's own `.dsh` and `.tmp` state. Undefined when git cannot read the tree.
 */
export async function worktreeDigest(
  cwd: string,
  runGit: GitRunner,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const root = await repositoryRoot(cwd, runGit, signal)
  let status: Buffer
  try {
    status = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, signal)
  } catch {
    return undefined
  }
  const entries = parseStatus(status)
  const visible = entries.filter((entry) => !ignoredForDigest(entry.path))
  const parts: Array<string | Buffer> = ['worktree-v1']
  for (const entry of visible.sort((left, right) => left.path.localeCompare(right.path))) {
    parts.push(`${entry.code} ${entry.path}`)
    if (entry.code === '??') {
      try {
        parts.push(await readFile(resolve(root, entry.path)))
      } catch {
        parts.push('[unreadable]')
      }
    }
  }
  try {
    // Include the committed tree identity: a clean checkout's status is empty,
    // so two different revisions would otherwise hash identically.
    parts.push(await runGit(['rev-parse', 'HEAD'], cwd, signal))
  } catch {
    // An unborn HEAD has no committed tree; the working status still identifies it.
  }
  try {
    parts.push(await runGit(['diff', '--binary', 'HEAD'], cwd, signal))
  } catch {
    return undefined
  }
  return hashParts(parts)
}
