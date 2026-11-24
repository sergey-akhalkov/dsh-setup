import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPlan,
  archivedChanges,
  type Command,
  type CommandResult,
  describePlan,
  main,
  parseFixes,
  planFromChanges,
} from '../close-issues.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-close-issues-'))
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return root
}

function ok(stdout: string): CommandResult {
  return { status: 0, stdout, stderr: '' }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`)
  }
  return result.stdout
}

async function gitRepo(): Promise<string> {
  const root = await tempRoot()
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'fixture@example.com'])
  git(root, ['config', 'user.name', 'fixture'])
  await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])
  return root
}

async function commitArchive(root: string, directory: string, proposal: string): Promise<void> {
  const dir = join(root, 'openspec', 'changes', 'archive', directory)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'proposal.md'), proposal, 'utf8')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', directory])
}

interface FakeIssue {
  state: string
  labels: Array<{ name: string }>
  comments: Array<{ body: string }>
  url: string
}

describe('close-issues planner', () => {
  it('parses only a standalone Fixes line, never a Refs line, a bullet, an indent or prose', () => {
    const text = [
      '# Proposal',
      '',
      'Fixes #9',
      '- Fixes #12',
      '    Fixes #34',
      'Refs #11',
      'This Fixes #4 in prose, and Fixes #9 again.',
      'Fixes #9',
    ].join('\n')
    expect(parseFixes(text)).toEqual([9])
  })

  it('reads its window and proposal text at the tag, not at HEAD or the worktree', async () => {
    const root = await gitRepo()
    await commitArchive(root, '2026-11-01-old', '# Proposal\n\nFixes #9\n')
    git(root, ['tag', 'v1.0.0'])
    await commitArchive(root, '2026-11-20-mid', '# Proposal\n\nFixes #9\nFixes #12\n')
    await commitArchive(root, '2026-11-21-reference-only', '# Proposal\n\nRefs #11\n')
    git(root, ['tag', 'v2.0.0'])
    await commitArchive(root, '2026-11-24-later', '# Proposal\n\nFixes #20\n')
    // A newer checkout with a hand-edited proposal must not change the tagged plan.
    await writeFile(
      join(root, 'openspec/changes/archive/2026-11-20-mid/proposal.md'),
      '# Proposal\n\nFixes #30\n',
      'utf8',
    )

    expect(archivedChanges(root, 'v1.0.0', 'v2.0.0').map((change) => change.name)).toEqual([
      'mid',
      'reference-only',
    ])
    expect(archivedChanges(root, 'v2.0.0', 'HEAD').map((change) => change.name)).toEqual(['later'])
    const plan = planFromChanges(archivedChanges(root, 'v1.0.0', 'v2.0.0'))
    expect(plan.map((entry) => entry.issue)).toEqual([9, 12])
    expect(plan[0]?.change).toBe('mid')

    // The CLI replaying the older release plans only what that release fixed.
    const lines: string[] = []
    const code = main(['--from', 'v1.0.0', '--version', 'v2.0.0'], {
      root,
      out: (line) => lines.push(line),
    })
    expect(code).toBe(0)
    expect(lines).toEqual(['#9 mid', '#12 mid'])

    // Without --from the default previous tag comes from the requested tag, not from HEAD.
    const defaultLines: string[] = []
    expect(main(['--version', 'v2.0.0'], { root, out: (line) => defaultLines.push(line) })).toBe(0)
    expect(defaultLines).toEqual(['#9 mid', '#12 mid'])
  })

  it('plans the fixture window with the earliest change winning and a Refs-only change ignored', () => {
    const plan = planFromChanges([
      {
        name: 'newer',
        date: '2026-11-24',
        changePath: 'openspec/changes/archive/2026-11-24-newer',
        fixes: [9, 12],
      },
      {
        name: 'reference-only',
        date: '2026-11-24',
        changePath: 'openspec/changes/archive/2026-11-24-reference-only',
        fixes: [],
      },
      {
        name: 'older',
        date: '2026-11-20',
        changePath: 'openspec/changes/archive/2026-11-20-older',
        fixes: [9],
      },
    ])
    expect(plan).toEqual([
      {
        issue: 9,
        change: 'older',
        date: '2026-11-20',
        changePath: 'openspec/changes/archive/2026-11-20-older',
        alsoNamedBy: ['newer'],
      },
      {
        issue: 12,
        change: 'newer',
        date: '2026-11-24',
        changePath: 'openspec/changes/archive/2026-11-24-newer',
        alsoNamedBy: [],
      },
    ])
    expect(describePlan(plan)).toEqual(['#9 older (also named by newer)', '#12 newer'])
  })

  it('previews an active change without running a command', async () => {
    const root = await tempRoot()
    const changeDir = join(root, 'openspec', 'changes', 'demo')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n\nFixes #1\n', 'utf8')
    const lines: string[] = []
    const command: Command = () => {
      throw new Error('the preview must not run a command')
    }
    const code = main(['--change', 'demo'], { root, command, out: (line) => lines.push(line) })
    expect(code).toBe(0)
    expect(lines).toEqual(['#1 demo'])
  })

  it('exits 2 when --apply has no usable gh and exits 1 on a usage error', () => {
    const lines: string[] = []
    const code = main(['--apply', '--version', 'v1.0.0', '--from', 'v0.9.0'], {
      command: () => ({ status: 1, stdout: '', stderr: 'gh: not found' }),
      out: (line) => lines.push(line),
    })
    expect(code).toBe(2)
    expect(lines).toEqual([])
    expect(main(['--bogus'])).toBe(1)
  })
})

describe('close-issues apply', () => {
  it('comments once then closes, and a rerun posts nothing; a labelled or closed issue stays', () => {
    const plan = planFromChanges([
      {
        name: 'demo',
        date: '2026-11-24',
        changePath: 'openspec/changes/archive/2026-11-24-demo',
        fixes: [7, 8, 9, 10],
      },
    ])
    const issues: Record<number, FakeIssue> = {
      7: {
        state: 'OPEN',
        labels: [],
        comments: [{ body: '<!-- dsh-setup:closed-by=v1.0.0 -->' }],
        url: 'https://github.com/o/r/issues/7',
      },
      8: { state: 'OPEN', labels: [], comments: [], url: 'https://github.com/o/r/issues/8' },
      9: {
        state: 'OPEN',
        labels: [{ name: 'wontfix' }],
        comments: [],
        url: 'https://github.com/o/r/issues/9',
      },
      10: {
        state: 'CLOSED',
        labels: [],
        comments: [],
        url: 'https://github.com/o/r/issues/10',
      },
    }
    const calls: string[][] = []
    const command: Command = (name, args) => {
      calls.push([name, ...args])
      const issue = args[1] === 'view' ? issues[Number(args[2])] : undefined
      if (issue !== undefined) return ok(JSON.stringify(issue))
      const target = issues[Number(args[2])]
      if (args[1] === 'comment' && target !== undefined) {
        target.comments.push({ body: String(args[4]) })
      }
      if (args[1] === 'close' && target !== undefined) target.state = 'CLOSED'
      return ok('')
    }
    const lines: string[] = []
    const out = (line: string): void => {
      lines.push(line)
    }
    const comments = () => calls.filter((call) => call[2] === 'comment')
    const closes = () => calls.filter((call) => call[2] === 'close')

    applyPlan(plan, 'v1.0.0', command, out)

    expect(comments().map((call) => call[3])).toEqual(['8'])
    expect(closes().map((call) => call[3])).toEqual(['7', '8'])
    expect(closes().every((call) => call[5] === 'completed')).toBe(true)
    expect(lines).toEqual([
      '#7: closed as completed',
      '#8: commented',
      '#8: closed as completed',
      '#9: skipped, labelled wontfix',
      '#10: skipped, already closed',
    ])
    const body = comments()[0]?.[5] ?? ''
    expect(body).toContain('v1.0.0')
    expect(body).toContain('https://github.com/o/r/releases/tag/v1.0.0')
    expect(body).toContain('openspec/changes/archive/2026-11-24-demo')

    applyPlan(plan, 'v1.0.0', command, out)

    expect(comments()).toHaveLength(1)
    expect(closes()).toHaveLength(2)
    expect(issues[9]?.state).toBe('OPEN')
  })
})
