import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// shortcut: the stub ships a .cmd shim only; add a POSIX `gh` shim when a non-Windows CI runs this.
const onWindows = process.platform === 'win32'

const fixtureDir = fileURLToPath(new URL('fixtures/gh-stub', import.meta.url))
const writePathIssues = join(fixtureDir, 'scenarios', 'write-path', 'issues.json')
const scratch = mkdtempSync(join(tmpdir(), 'gh-stub-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

interface Invocation {
  args: string[]
  exit: number
}

interface RunOptions {
  log: string
  state?: string
  issues?: string
  exit?: string
}

function gh(command: string, options: RunOptions): { status: number | null; stdout: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The stub directory first: `gh` must resolve to the shim, never the real binary.
    PATH: `${fixtureDir}${delimiter}${process.env.PATH ?? ''}`,
    GH_STUB_LOG: join(scratch, options.log),
  }
  if (options.state !== undefined) env.GH_STUB_STATE = join(scratch, options.state)
  if (options.issues !== undefined) env.GH_STUB_ISSUES = options.issues
  if (options.exit !== undefined) env.GH_STUB_EXIT = options.exit
  const result = spawnSync(`gh ${command}`, { shell: true, encoding: 'utf8', env })
  return { status: result.status, stdout: String(result.stdout ?? '') }
}

function invocations(log: string): Invocation[] {
  return readFileSync(join(scratch, log), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Invocation)
}

describe.skipIf(!onWindows)('gh stub fixture', () => {
  it('wins over the real binary on PATH and serves the auth payload', () => {
    const result = gh('auth status', { log: 'auth.log' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Logged in to github.com')
    // Only the stub writes this log, so the invocation proves which binary ran.
    expect(invocations('auth.log')).toEqual([{ args: ['auth', 'status'], exit: 0 }])
  })

  it('serves the issue list and a single issue view', () => {
    const list = gh('issue list --state open --json number,title', { log: 'list.log' })
    expect(list.status).toBe(0)
    const numbers = (JSON.parse(list.stdout) as { number: number }[]).map((issue) => issue.number)
    expect(numbers).toEqual([1, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21])

    const view = gh('issue view 17 --json number,comments', { log: 'view.log' })
    expect((JSON.parse(view.stdout) as { number: number }).number).toBe(17)
  })

  it('mirrors the real list contract: honors --limit and rejects --paginate', () => {
    const limited = gh('issue list --state open --limit 2 --json number', { log: 'limit.log' })
    expect(limited.status).toBe(0)
    expect((JSON.parse(limited.stdout) as unknown[]).length).toBe(2)

    const refused = gh('issue list --state open --paginate --limit 100', { log: 'refuse.log' })
    expect(refused.status).toBe(1)
    expect(invocations('refuse.log')).toEqual([
      { args: ['issue', 'list', '--state', 'open', '--paginate', '--limit', '100'], exit: 1 },
    ])
  })

  it('records an issue-comment invocation with its body and honors a configured exit code', () => {
    const comment = gh('issue comment 16 --body duplicate-of-17', { log: 'write.log' })
    expect(comment.status).toBe(0)
    expect(invocations('write.log')).toEqual([
      { args: ['issue', 'comment', '16', '--body', 'duplicate-of-17'], exit: 0 },
    ])

    const failing = gh('auth status', { log: 'fail.log', exit: '1' })
    expect(failing.status).toBe(1)
    expect(invocations('fail.log')).toEqual([{ args: ['auth', 'status'], exit: 1 }])
  })

  it('persists a posted comment so a rerun reads its marker back', () => {
    const options: RunOptions = {
      log: 'idempotent.log',
      state: 'state.json',
      issues: writePathIssues,
    }
    gh('issue comment 16 --body dsh-setup-marker-probe', options)
    const view = gh('issue view 16 --json number,comments', options)
    const bodies = (JSON.parse(view.stdout) as { comments: { body: string }[] }).comments.map(
      (comment) => comment.body,
    )
    expect(bodies).toContain('dsh-setup-marker-probe')
  })
})
