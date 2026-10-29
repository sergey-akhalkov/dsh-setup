import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ExportError, messageOf } from './export-errors.js'

/** Fixed identity: the export repository must not borrow the user's Git identity. */
export const EXPORT_GIT_IDENTITY = Object.freeze({
  name: 'Hindsight Export',
  email: 'hindsight-export@localhost',
})

/** Ignored scratch and journal paths, written only when the file is absent. */
export const EXPORT_GITIGNORE = [
  '# Written by the Hindsight exporter; never commit its scratch state.',
  '.export.lock',
  '.export.lock.*',
  '.export-staging/',
  '.export-pending.json',
  'banks.old-*',
  '',
].join('\n')

/** No prompt may ever block an export cycle. */
const HEADLESS_GIT_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  SSH_ASKPASS_REQUIRE: 'never',
}

export interface GitRunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  allowFailure?: boolean
}

export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

function runGit(args: string[], options: GitRunOptions): Promise<GitRunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const env: NodeJS.ProcessEnv = { ...process.env, ...HEADLESS_GIT_ENV, ...options.env }
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new ExportError('git', `git ${args[0] ?? ''} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new ExportError('git', `cannot run git: ${messageOf(error)}`, { cause: error }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const result = { code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }
      if (result.code !== 0 && options.allowFailure !== true) {
        const detail = result.stderr === '' ? result.stdout : result.stderr
        reject(new ExportError('git', `git ${args.join(' ')} failed: ${detail}`))
        return
      }
      resolve(result)
    })
  })
}

/** Diagnostics for one command, for callers that expect a failure. */
export async function gitOutput(args: string[], options: GitRunOptions): Promise<GitRunResult> {
  return runGit(args, options)
}

export interface GitBootstrapOptions {
  dir: string
  /** Private remote; its absence keeps the repository local. */
  remote?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export interface GitBootstrapResult {
  /** `clone`, `init`, or `existing`. */
  created: 'clone' | 'init' | 'existing'
}

async function originUrl(options: GitRunOptions): Promise<string | undefined> {
  const result = await runGit(['remote', 'get-url', 'origin'], { ...options, allowFailure: true })
  return result.code === 0 && result.stdout !== '' ? result.stdout : undefined
}

/**
 * Prepare the export repository: clone the private remote when it is missing,
 * otherwise initialize a local one, and keep `origin` in sync with the
 * machine-local configuration.
 */
export async function bootstrapRepository(
  options: GitBootstrapOptions,
): Promise<GitBootstrapResult> {
  const { dir, remote } = options
  const run: GitRunOptions = { cwd: dir, timeoutMs: options.timeoutMs, env: options.env }
  let created: GitBootstrapResult['created'] = 'existing'

  if (!existsSync(join(dir, '.git'))) {
    if (remote !== undefined) {
      if (existsSync(dir) && readdirSync(dir).length > 0) {
        throw new ExportError(
          'git',
          `export directory ${dir} exists without a repository; move it aside or configure another directory`,
        )
      }
      mkdirSync(dir, { recursive: true })
      await runGit(['clone', remote, dir], {
        cwd: dirname(dir),
        timeoutMs: options.timeoutMs,
        env: options.env,
      })
      created = 'clone'
    } else {
      mkdirSync(dir, { recursive: true })
      await runGit(['init', '-b', 'main'], run)
      created = 'init'
    }
  }

  const ignoreFile = join(dir, '.gitignore')
  if (!existsSync(ignoreFile)) writeFileSync(ignoreFile, EXPORT_GITIGNORE)

  const current = await originUrl(run)
  if (remote !== undefined && current !== remote) {
    if (current === undefined) await runGit(['remote', 'add', 'origin', remote], run)
    else await runGit(['remote', 'set-url', 'origin', remote], run)
  }
  return { created }
}

export interface CommitOptions {
  message: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

/** Commit everything the snapshot wrote; a clean tree creates no commit. */
export async function commitSnapshot(
  dir: string,
  options: CommitOptions,
): Promise<{ committed: boolean }> {
  // GIT_AUTHOR_*/GIT_COMMITTER_* outrank both `-c user.*` and the inherited
  // environment, so the fixed identity is applied here as the last word.
  const run: GitRunOptions = {
    cwd: dir,
    timeoutMs: options.timeoutMs,
    env: {
      ...options.env,
      GIT_AUTHOR_NAME: EXPORT_GIT_IDENTITY.name,
      GIT_AUTHOR_EMAIL: EXPORT_GIT_IDENTITY.email,
      GIT_COMMITTER_NAME: EXPORT_GIT_IDENTITY.name,
      GIT_COMMITTER_EMAIL: EXPORT_GIT_IDENTITY.email,
    },
  }
  await runGit(['add', '--all'], run)
  const status = await runGit(['status', '--porcelain'], run)
  if (status.stdout === '') return { committed: false }
  await runGit(
    ['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '--message', options.message],
    run,
  )
  return { committed: true }
}

/** The branch the repository is on; a detached or unborn HEAD reports `main`. */
export async function currentBranch(dir: string): Promise<string> {
  const result = await runGit(['symbolic-ref', '--short', 'HEAD'], {
    cwd: dir,
    allowFailure: true,
  })
  return result.code === 0 && result.stdout !== '' ? result.stdout : 'main'
}

/** Whether the repository already has a commit to push. */
export async function hasCommits(dir: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: dir, allowFailure: true })
  return result.code === 0
}
