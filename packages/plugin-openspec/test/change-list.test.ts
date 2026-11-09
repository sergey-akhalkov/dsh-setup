import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cliOnPath,
  commitFor,
  commitWebBase,
  GIT_MAX_OUTPUT_BYTES,
  GIT_TIMEOUT_MS,
  LIST_TIMEOUT_MS,
  listWorkspaceChanges,
  MALFORMED_MESSAGE,
  MISSING_CLI_MESSAGE,
  NO_LOCAL_ROOT_MESSAGE,
  proposalWhy,
  readGitLog,
  TIMEOUT_MESSAGE,
} from '../src/host/change-list.ts'
import { CHANGES_ROUTE, registerChangeRoute } from '../src/host/index.ts'

const { spawnMock, execFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileMock: vi.fn(),
}))
vi.mock('node:child_process', () => ({ spawn: spawnMock, execFile: execFileMock }))

class FakeStream extends EventEmitter {
  setEncoding(): void {}
}

class FakeChild extends EventEmitter {
  readonly pid = 4242
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
}

const temporary: string[] = []

/** The real PATH before each test replaces it with a fake `openspec` directory. */
const ORIGINAL_PATH = process.env.PATH

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

function workspace(withRoot: boolean): string {
  const directory = temporaryDirectory('openspec-workspace-')
  if (withRoot) mkdirSync(join(directory, 'openspec'))
  return directory
}

/** A PATH that resolves the CLI under either platform branch. */
function cliPath(): string {
  const directory = temporaryDirectory('openspec-bin-')
  writeFileSync(join(directory, 'openspec'), '')
  // Match the stubbed PATHEXT casing so discovery works on case-sensitive filesystems.
  writeFileSync(join(directory, 'openspec.CMD'), '')
  return directory
}

interface CliRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: 'no-tasks' | 'complete' | 'in-progress'
  readonly archived?: boolean
  readonly lastModified?: string | null
}

function listOutput(root: string, rows: readonly CliRow[]): string {
  return JSON.stringify({
    changes: rows.map((entry) => ({
      name: entry.name,
      completedTasks: entry.completedTasks,
      totalTasks: entry.totalTasks,
      status: entry.status,
      lastModified: entry.lastModified ?? '2026-11-05T00:00:00.000Z',
      archived: entry.archived ?? false,
    })),
    root: { path: root, source: 'nearest' },
  })
}

function specsOutput(
  root: string,
  specs: readonly { id: string; requirementCount: number }[],
): string {
  return JSON.stringify({ specs, root: { path: root, source: 'nearest' } })
}

/** Collect one fresh child per `spawn` call, so concurrent calls stay separate. */
function spawnQueue(): FakeChild[] {
  const children: FakeChild[] = []
  spawnMock.mockImplementation(() => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
  return children
}

function complete(
  child: FakeChild | undefined,
  code: number | null,
  stdout = '',
  stderr = '',
): void {
  if (child === undefined) throw new Error('the CLI was not spawned')
  if (stdout !== '') child.stdout.emit('data', stdout)
  if (stderr !== '') child.stderr.emit('data', stderr)
  child.emit('close', code)
}

/** Answer the two reads a change-list call spawns, in spawn order. */
function answerList(children: readonly FakeChild[], list: string, specs: string): void {
  complete(children[0], 0, list)
  complete(children[1], 0, specs)
}

interface ChangeFixture {
  readonly proposal?: string
  readonly design?: string
  readonly tasks?: string
  readonly specs?: Readonly<Record<string, string>>
}

/** Write one active or archived change under the workspace's own OpenSpec root. */
function writeChange(
  directory: string,
  name: string,
  fixture: ChangeFixture,
  archived = false,
): string {
  const changeDirectory = join(
    directory,
    'openspec',
    'changes',
    ...(archived ? ['archive'] : []),
    name,
  )
  mkdirSync(changeDirectory, { recursive: true })
  for (const artifact of ['proposal', 'design', 'tasks'] as const) {
    const body = fixture[artifact]
    if (body !== undefined) writeFileSync(join(changeDirectory, `${artifact}.md`), body)
  }
  for (const [capability, body] of Object.entries(fixture.specs ?? {})) {
    mkdirSync(join(changeDirectory, 'specs', capability), { recursive: true })
    writeFileSync(join(changeDirectory, 'specs', capability, 'spec.md'), body)
  }
  return changeDirectory
}

function gitOutput(commits: readonly { short: string; paths: readonly string[] }[]): string {
  return commits
    .map(
      (commit) =>
        `\0${commit.short}\t2026-11-01T10:00:00+03:00\tcommit ${commit.short}\n${commit.paths.join('\n')}\n`,
    )
    .join('')
}

/** Force one platform branch for a test and restore it even when the test throws. */
async function withPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PATH', cliPath())
  vi.stubEnv('PATHEXT', '.CMD')
  // Git is optional: every unconfigured read behaves like a non-repository.
  execFileMock.mockImplementation(
    (_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
      callback(new Error('not a git repository'))
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('openspec change list', () => {
  it('lists active and archived rows with phase, presence, summary and commit facts', async () => {
    const cwd = workspace(true)
    writeChange(cwd, 'add-auth', {
      proposal: '# Proposal\n\n## Why\n\nAdds authentication for\noperators.\n\n## What\n\n- x\n',
      design: '# Design\n',
      tasks: '- [x] one\n- [ ] two\n- [ ] three\n',
      specs: {
        alpha: '# Delta\n\n### Requirement: One\n\nText.\n\n### Requirement: Two\n\nText.\n',
      },
    })
    writeChange(
      cwd,
      '2026-10-27-old-work',
      { proposal: '# Proposal\n\n## Why\n\nOld work.\n', specs: { alpha: '# Old\n' } },
      true,
    )
    const git = gitOutput([
      {
        short: 'abc1234',
        paths: ['openspec/changes/add-auth/tasks.md', 'openspec/specs/alpha/spec.md'],
      },
      {
        short: 'def5678',
        paths: ['openspec/changes/archive/2026-10-27-old-work/proposal.md'],
      },
    ])
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: null, stdout: string) => void,
      ) => {
        callback(null, git)
      },
    )
    const children = spawnQueue()
    const pending = listWorkspaceChanges(cwd)
    answerList(
      children,
      listOutput(cwd, [
        { name: 'add-auth', completedTasks: 1, totalTasks: 3, status: 'in-progress' },
        {
          name: '2026-10-27-old-work',
          completedTasks: 4,
          totalTasks: 4,
          status: 'complete',
          archived: true,
        },
      ]),
      specsOutput(cwd, [
        { id: 'alpha', requirementCount: 3 },
        { id: 'beta', requirementCount: 1 },
      ]),
    )
    const list = await pending
    expect(list.counts).toEqual({ active: 1, archived: 1, capabilities: 2 })
    expect(list.changes).toEqual([
      {
        name: 'add-auth',
        completedTasks: 1,
        totalTasks: 3,
        status: 'in-progress',
        modified: '2026-11-05T00:00:00.000Z',
        archived: false,
        phase: 'applying',
        archivedAt: null,
        summary: 'Adds authentication for operators.',
        why: 'Adds authentication for operators.',
        requirementCount: 2,
        deltaCapabilities: ['alpha'],
        commit: {
          short: 'abc1234',
          at: '2026-11-01T10:00:00+03:00',
          subject: 'commit abc1234',
        },
        presence: { proposal: true, design: true, tasks: true, specs: 1 },
      },
    ])
    expect(list.archived[0]).toMatchObject({
      name: '2026-10-27-old-work',
      phase: 'archived',
      archived: true,
      archivedAt: '2026-10-27',
      summary: 'Old work.',
      why: 'Old work.',
      requirementCount: 0,
      presence: { proposal: true, design: false, tasks: false, specs: 1 },
      commit: { short: 'def5678' },
    })
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
    expect(spawnMock.mock.calls.map((call) => call[1])).toEqual(
      process.platform === 'win32'
        ? [
            ['/d', '/s', '/c', 'openspec "list" "--all" "--json"'],
            ['/d', '/s', '/c', 'openspec "list" "--specs" "--json"'],
          ]
        : [
            ['list', '--all', '--json'],
            ['list', '--specs', '--json'],
          ],
    )
    if (process.platform === 'win32') {
      expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ windowsVerbatimArguments: true })
    }
  })

  it('reports each row delta capability ids, including a nested id and none', async () => {
    const cwd = workspace(true)
    writeChange(cwd, 'multi', {
      specs: {
        'identity/auth': '# Nested\n',
        billing: '# Billing\n',
      },
    })
    writeChange(cwd, 'none', {})
    writeChange(cwd, '2026-10-27-old-work', { specs: { legacy: '# Old\n' } }, true)
    const children = spawnQueue()
    const pending = listWorkspaceChanges(cwd)
    answerList(
      children,
      listOutput(cwd, [
        { name: 'multi', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
        { name: 'none', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
        {
          name: '2026-10-27-old-work',
          completedTasks: 1,
          totalTasks: 1,
          status: 'complete',
          archived: true,
        },
      ]),
      specsOutput(cwd, []),
    )
    const list = await pending
    expect(list.changes.map((row) => row.deltaCapabilities)).toEqual([
      ['billing', 'identity/auth'],
      [],
    ])
    expect(list.archived[0]?.deltaCapabilities).toEqual(['legacy'])
    // The rest of the row keeps its documented shape.
    expect(list.changes[0]).toMatchObject({
      name: 'multi',
      phase: 'planning',
      requirementCount: 0,
      presence: { proposal: false, design: false, tasks: false, specs: 2 },
    })
  })

  it('keeps the whole Why section for the card tooltip', () => {
    expect(
      proposalWhy(
        '# Proposal\n\n## Why\n\nFirst paragraph.\n\nSecond paragraph.\n\n## What\n\n- x\n',
      ),
    ).toBe('First paragraph. Second paragraph.')
    expect(proposalWhy('# Proposal\n\nNo Why heading here.')).toBeNull()
    expect(proposalWhy('# Proposal\n\n## Why\n\n' + 'x'.repeat(3000))).toHaveLength(2000)
  })

  it('derives each phase from the counts and the archive flag', async () => {
    const cwd = workspace(true)
    writeChange(cwd, 'planning', { proposal: '# Why\n\nNot written.\n' })
    writeChange(cwd, 'ready', { tasks: '- [ ] one\n' })
    writeChange(cwd, 'applying', { tasks: '- [x] one\n- [ ] two\n' })
    writeChange(cwd, 'done', { tasks: '- [x] one\n' })
    writeChange(cwd, '2026-01-02-old', { tasks: '- [x] one\n' }, true)
    const children = spawnQueue()
    const pending = listWorkspaceChanges(cwd)
    answerList(
      children,
      listOutput(cwd, [
        { name: 'planning', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
        { name: 'ready', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
        { name: 'applying', completedTasks: 1, totalTasks: 2, status: 'in-progress' },
        { name: 'done', completedTasks: 1, totalTasks: 1, status: 'complete' },
        {
          name: '2026-01-02-old',
          completedTasks: 1,
          totalTasks: 1,
          status: 'complete',
          archived: true,
        },
      ]),
      specsOutput(cwd, []),
    )
    const list = await pending
    expect(list.changes.map((row) => row.phase)).toEqual([
      'planning',
      'ready-to-apply',
      'applying',
      'complete',
    ])
    expect(list.archived[0]?.phase).toBe('archived')
    expect(list.counts).toEqual({ active: 4, archived: 1, capabilities: 0 })
  })

  it('keeps the active changes array free of archived rows', async () => {
    const cwd = workspace(true)
    const children = spawnQueue()
    const pending = listWorkspaceChanges(cwd)
    answerList(
      children,
      listOutput(cwd, [
        { name: 'open-work', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
        {
          name: '2026-01-02-closed',
          completedTasks: 1,
          totalTasks: 1,
          status: 'complete',
          archived: true,
        },
      ]),
      specsOutput(cwd, []),
    )
    const list = await pending
    expect(list.changes.map((row) => row.name)).toEqual(['open-work'])
    expect(list.changes.every((row) => !row.archived)).toBe(true)
    expect(list.archived.map((row) => row.name)).toEqual(['2026-01-02-closed'])
  })

  it('reports a missing proposal summary as null', async () => {
    const cwd = workspace(true)
    writeChange(cwd, 'no-proposal', { tasks: '- [ ] one\n' })
    writeChange(cwd, 'no-why', { proposal: '# Proposal\n\nOnly prose here.\n' })
    const children = spawnQueue()
    const pending = listWorkspaceChanges(cwd)
    answerList(
      children,
      listOutput(cwd, [
        { name: 'no-proposal', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
        { name: 'no-why', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
      ]),
      specsOutput(cwd, []),
    )
    const list = await pending
    expect(list.changes.map((row) => row.summary)).toEqual([null, 'Only prose here.'])
  })

  it('refuses a workspace without its own root before running the CLI', async () => {
    await expect(listWorkspaceChanges(workspace(false))).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses an ancestor root reported by the CLI', async () => {
    const cwd = workspace(true)
    const ancestor = temporaryDirectory('openspec-ancestor-')
    const children = spawnQueue()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    answerList(children, listOutput(ancestor, []), specsOutput(ancestor, []))
    await rejection
  })

  it('refuses a null root', async () => {
    const cwd = workspace(true)
    const children = spawnQueue()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    complete(children[0], 0, JSON.stringify({ changes: [], root: null }))
    complete(children[1], 0, JSON.stringify({ specs: [], root: null }))
    await rejection
  })

  it('maps a missing CLI to the prerequisite error', async () => {
    vi.stubEnv('PATH', temporaryDirectory('openspec-empty-bin-'))
    expect(cliOnPath()).toBe(false)
    await expect(listWorkspaceChanges(workspace(true))).rejects.toThrow(MISSING_CLI_MESSAGE)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('maps a non-zero exit to its stderr', async () => {
    const cwd = workspace(true)
    const children = spawnQueue()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(
      '`openspec list --all` failed: not a valid workspace',
    )
    complete(children[0], 1, '', 'not a valid workspace')
    complete(children[1], 1, '', 'not a valid workspace')
    await rejection
  })

  it('maps a non-zero exit that carries a null root to the no-root error', async () => {
    const cwd = workspace(true)
    const children = spawnQueue()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    complete(children[0], 1, JSON.stringify({ changes: [], root: null }))
    complete(children[1], 1, JSON.stringify({ specs: [], root: null }))
    await rejection
  })

  it('maps malformed JSON and malformed changes to the readable error', async () => {
    const cwd = workspace(true)
    const first = spawnQueue()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(MALFORMED_MESSAGE)
    complete(first[0], 0, 'not json')
    complete(first[1], 0, specsOutput(cwd, []))
    await rejection

    const second = spawnQueue()
    const secondRejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(MALFORMED_MESSAGE)
    complete(
      second[0],
      0,
      listOutput(cwd, [{ name: 'x', completedTasks: 1, totalTasks: 2, status: 'in-progress' }]),
    )
    complete(second[1], 0, 'not json')
    await secondRejection
  })

  it('times out and awaits the whole process tree kill', async () => {
    vi.useFakeTimers()
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: (error: null) => void) => {
        callback(null)
      },
    )
    const cwd = workspace(true)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const children = spawnQueue()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
    await rejection
    expect(children).toHaveLength(2)
    if (process.platform === 'win32') {
      expect(execFileMock).toHaveBeenCalledWith(
        'taskkill',
        expect.arrayContaining(['/T', '/F']),
        { windowsHide: true },
        expect.any(Function),
      )
    } else {
      expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    }
    kill.mockRestore()
  })

  it('detaches the POSIX call and kills its process group', async () => {
    vi.useFakeTimers()
    await withPlatform('linux', async () => {
      const cwd = workspace(true)
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
      spawnQueue()
      const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(TIMEOUT_MESSAGE)
      await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
      await rejection
      expect(spawnMock.mock.calls.at(-1)?.[2]).toMatchObject({ detached: true })
      expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
      kill.mockRestore()
    })
  })
})

describe('git provenance', () => {
  it('maps a repository remote to a commit page without its credentials', () => {
    expect(commitWebBase('https://github.com/o/r.git')).toBe('https://github.com/o/r')
    expect(commitWebBase('https://user:token@github.com/o/r.git')).toBe('https://github.com/o/r')
    expect(commitWebBase('git@github.com:o/r.git')).toBe('https://github.com/o/r')
    expect(commitWebBase('ssh://git@git.example.com:2222/o/r.git')).toBe(
      'https://git.example.com/o/r',
    )
    expect(commitWebBase('git.example.com:o/r')).toBe('https://git.example.com/o/r')
    expect(commitWebBase('https://gitlab.com/group/sub/r')).toBe('https://gitlab.com/group/sub/r')
    expect(commitWebBase('git.example.com\\repo')).toBeNull()
    expect(commitWebBase('/srv/git/r.git')).toBeNull()
    expect(commitWebBase('not a remote')).toBeNull()
  })

  it('adds the origin commit page to every read commit', async () => {
    const cwd = workspace(true)
    const runner = vi.fn(async (args: readonly string[]) =>
      args[0] === 'remote'
        ? 'git@github.com:o/r.git\n'
        : '\0abc1234\t2026-11-01T10:00:00+03:00\tfeat\nopenspec/changes/a/tasks.md\n',
    )
    const entries = await readGitLog(cwd, ['openspec/changes'], runner)
    expect(entries?.[0]?.commit.url).toBe('https://github.com/o/r/commit/abc1234')
    expect(runner).toHaveBeenLastCalledWith(['remote', 'get-url', 'origin'], cwd)
  })

  it('keeps commits when the origin remote cannot be read', async () => {
    const cwd = workspace(true)
    const entries = await readGitLog(cwd, ['openspec/changes'], async (args) => {
      if (args[0] === 'remote') throw new Error('no origin remote')
      return '\0abc1234\t2026-11-01T10:00:00+03:00\tfeat\nopenspec/changes/a/tasks.md\n'
    })
    expect(entries?.[0]?.commit).not.toHaveProperty('url')
  })

  it('reads one batched log and maps a file or directory path to its newest commit', async () => {
    const cwd = workspace(true)
    const runner = vi.fn(async () =>
      [
        '\x00abc1234\t2026-11-01T10:00:00+03:00\tfeat: newer',
        'openspec/changes/add-auth/tasks.md',
        '',
        '\x00def5678\t2026-10-01T09:00:00+03:00\tdocs: older',
        'openspec/specs/alpha/spec.md',
        '',
      ].join('\n'),
    )
    const entries = await readGitLog(cwd, ['openspec/changes', 'openspec/specs'], runner)
    expect(runner).toHaveBeenCalledWith(
      [
        'log',
        '-n',
        '300',
        '--name-only',
        '--relative',
        '--pretty=format:%x00%h%x09%aI%x09%s',
        '--',
        'openspec/changes',
        'openspec/specs',
      ],
      cwd,
    )
    expect(commitFor(entries, 'openspec/changes/add-auth')).toMatchObject({ short: 'abc1234' })
    expect(commitFor(entries, 'openspec/specs/alpha')).toMatchObject({ short: 'def5678' })
    expect(commitFor(entries, 'openspec/changes/other')).toBeNull()
  })

  it('resolves null for no repository, ENOENT and a timeout', async () => {
    const cwd = workspace(true)
    await expect(
      readGitLog(cwd, ['openspec'], async () => {
        throw Object.assign(new Error('not a repository'), { code: 128 })
      }),
    ).resolves.toBeNull()
    await expect(
      readGitLog(cwd, ['openspec'], async () => {
        throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      }),
    ).resolves.toBeNull()
    await expect(
      readGitLog(cwd, ['openspec'], async () => {
        throw new Error('timed out')
      }),
    ).resolves.toBeNull()
    await expect(readGitLog(cwd, ['openspec'], async () => 'not a log')).resolves.toBeNull()
  })

  it('refuses a path outside the workspace without running git', async () => {
    const cwd = workspace(true)
    const runner = vi.fn(async () => '')
    await expect(readGitLog(cwd, ['../outside'], runner)).resolves.toBeNull()
    await expect(readGitLog(cwd, [join(cwd, '..', 'outside')], runner)).resolves.toBeNull()
    expect(runner).not.toHaveBeenCalled()
  })

  it('rejects malformed headers and path lines instead of inventing provenance', async () => {
    const cwd = workspace(true)
    const badDate = await readGitLog(
      cwd,
      ['openspec'],
      async () => '\0abc1234\tnot-a-date\tsubject\nopenspec/changes/x/tasks.md\n',
    )
    expect(badDate).toBeNull()
    const badPath = await readGitLog(
      cwd,
      ['openspec'],
      async () =>
        '\0abc1234\t2026-11-01T10:00:00+03:00\tsubject\nopenspec/changes/x\tinjected.md\n',
    )
    expect(badPath).toBeNull()
    const badSection = await readGitLog(cwd, ['openspec'], async () =>
      [
        '\0abc1234\t2026-11-01T10:00:00+03:00\tfirst',
        'openspec/changes/a/f.md',
        '',
        '\0malformed header with spaces',
        'openspec/changes/x/tasks.md',
        '',
      ].join('\n'),
    )
    expect(badSection).toBeNull()
    const yearOnly = await readGitLog(
      cwd,
      ['openspec'],
      async () => '\0abc1234\t2026\tfirst\nopenspec/changes/a/f.md\n',
    )
    expect(yearOnly).toBeNull()
  })

  it('keeps an empty-subject commit separate from the previous one', async () => {
    const cwd = workspace(true)
    const entries = await readGitLog(cwd, ['openspec/changes'], async () =>
      [
        '\0abc1234\t2026-11-01T10:00:00+03:00\tfirst',
        'openspec/changes/a/f.md',
        '\0def5678\t2026-10-01T09:00:00+03:00\t',
        'openspec/changes/b/f.md',
        '',
      ].join('\n'),
    )
    expect(commitFor(entries, 'openspec/changes/a')).toMatchObject({ short: 'abc1234' })
    expect(commitFor(entries, 'openspec/changes/b')).toMatchObject({ short: 'def5678' })
  })

  it('frames a merge commit with no file rows before the next header', async () => {
    const cwd = workspace(true)
    const entries = await readGitLog(cwd, ['openspec/changes'], async () =>
      [
        '\0e3ff66e\t2026-11-02T10:00:00+03:00\tMerge branch main',
        '\x0052b5aff\t2026-11-01T10:00:00+03:00\tsecond',
        'openspec/changes/a/f.md',
        '',
      ].join('\n'),
    )
    expect(entries?.map((entry) => entry.commit.short)).toEqual(['e3ff66e', '52b5aff'])
    expect(commitFor(entries, 'openspec/changes/a')).toMatchObject({ short: '52b5aff' })
  })

  it('maps commits from a workspace nested inside a repository', async () => {
    vi.stubEnv('PATH', ORIGINAL_PATH ?? '')
    const repo = temporaryDirectory('openspec-git-')
    const real = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    real.execFileSync('git', ['init', '-q'], { cwd: repo })
    const nested = join(repo, 'packages', 'pkg')
    mkdirSync(join(nested, 'openspec', 'specs', 'alpha'), { recursive: true })
    writeFileSync(join(nested, 'openspec', 'specs', 'alpha', 'spec.md'), '# A\n')
    real.execFileSync('git', ['add', '-A'], { cwd: repo })
    real.execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'add'],
      { cwd: repo },
    )
    const runner = async (args: readonly string[], cwd: string): Promise<string> =>
      real.execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        // The origin remote is absent here; keep git's complaint out of the test log.
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    const entries = await readGitLog(nested, ['openspec/specs/alpha'], runner)
    expect(commitFor(entries, 'openspec/specs/alpha')).not.toBeNull()
  })

  it('runs the real executor with fixed arguments and bounded options', async () => {
    const cwd = workspace(true)
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: null, stdout: string) => void,
      ) => {
        callback(
          null,
          '\0abc1234\t2026-11-01T10:00:00+03:00\tfeat: work\nopenspec/changes/x/f.md\n',
        )
      },
    )
    const entries = await readGitLog(cwd, ['openspec/changes'])
    expect(entries).toHaveLength(1)
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['log', '-n', '300', '--name-only', '--relative']),
      {
        cwd,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        encoding: 'utf8',
      },
      expect.any(Function),
    )
  })
})

interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  fetch(request: Request): Promise<Response>
}

interface RouteHarness {
  readonly route: FetchRoute
}

/** A desktop shell host has `connection.fetch` but no `webServer` service. */
function routeHarness(workspaces: ReadonlyMap<string, string>): RouteHarness {
  let route: FetchRoute | undefined
  const services: Record<string, unknown> = {
    connection: {
      fetch: {
        register(value: FetchRoute) {
          if (value.path === CHANGES_ROUTE) route = value
          return () => {}
        },
      },
    },
    agents: {
      get(id: string) {
        const directory = workspaces.get(id)
        return directory === undefined ? undefined : { session: { directory } }
      },
    },
    workingDirectory: {
      get(session: { directory: string }) {
        return session.directory
      },
    },
    webServer: {
      register() {
        throw new Error('the change list route must not depend on webServer')
      },
    },
  }
  const ctx = {
    get(name: string) {
      return services[name]
    },
  }
  registerChangeRoute(ctx as never)
  if (route === undefined) throw new Error('route not registered')
  return { route }
}

describe('change list route', () => {
  it('registers an /api fetch route on the desktop shell carrier', () => {
    const harness = routeHarness(new Map())
    expect(harness.route).toMatchObject({
      path: CHANGES_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
    })
  })

  it('returns the active rows plus the additive archived list and counts', async () => {
    const cwd = workspace(true)
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nActive work.\n' })
    writeChange(cwd, '2026-10-27-old', { proposal: '# Why\n\nOld work.\n' }, true)
    const harness = routeHarness(new Map([['s1', cwd]]))
    const children = spawnQueue()
    const pending = harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=s1`, { method: 'GET' }),
    )
    answerList(
      children,
      listOutput(cwd, [
        { name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
        {
          name: '2026-10-27-old',
          completedTasks: 1,
          totalTasks: 1,
          status: 'complete',
          archived: true,
        },
      ]),
      specsOutput(cwd, [{ id: 'alpha', requirementCount: 2 }]),
    )
    const response = await pending
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      changes: { name: string }[]
      archived: { name: string }[]
      counts: { active: number; archived: number; capabilities: number }
    }
    expect(body.changes.map((row) => row.name)).toEqual(['add-auth'])
    expect(body.archived.map((row) => row.name)).toEqual(['2026-10-27-old'])
    expect(body.counts).toEqual({ active: 1, archived: 1, capabilities: 1 })
  })

  it('scopes each session to its own workspace', async () => {
    const first = workspace(true)
    const second = workspace(true)
    const harness = routeHarness(
      new Map([
        ['s1', first],
        ['s2', second],
      ]),
    )
    const one = spawnQueue()
    const firstPending = harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=s1`, { method: 'GET' }),
    )
    answerList(one, listOutput(first, []), specsOutput(first, []))
    expect((await firstPending).status).toBe(200)

    const two = spawnQueue()
    const secondPending = harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=s2`, { method: 'GET' }),
    )
    answerList(two, listOutput(second, []), specsOutput(second, []))
    expect((await secondPending).status).toBe(200)
    expect(spawnMock.mock.calls.map((call) => call[2])).toMatchObject([
      { cwd: first },
      { cwd: first },
      { cwd: second },
      { cwd: second },
    ])
  })

  it('rejects an unknown session without running the CLI', async () => {
    const harness = routeHarness(new Map())
    const pending = harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=missing`, { method: 'GET' }),
    )
    const response = await pending
    expect(response.status).toBe(400)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('requires a session id', async () => {
    const harness = routeHarness(new Map())
    const response = await harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}`, { method: 'GET' }),
    )
    expect(response.status).toBe(400)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('reports the no-root error when the workspace has no local root', async () => {
    const child = workspace(false)
    const harness = routeHarness(new Map([['s1', child]]))
    const response = await harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=s1`, { method: 'GET' }),
    )
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: NO_LOCAL_ROOT_MESSAGE })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('ignores request text other than the session id', async () => {
    const cwd = workspace(true)
    const harness = routeHarness(new Map([['s1', cwd]]))
    const children = spawnQueue()
    const pending = harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=s1&path=/etc`),
    )
    answerList(children, listOutput(cwd, []), specsOutput(cwd, []))
    const response = await pending
    expect(response.status).toBe(200)
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
  })

  it('registers nothing on a host without the connection fetch registry', () => {
    const ctx = {
      get() {
        return undefined
      },
    }
    expect(() => registerChangeRoute(ctx as never)).not.toThrow()
  })
})
