import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listWorkspaceCapabilityRows,
  parseArchivedDeltas,
  REQUIREMENTS_MALFORMED_MESSAGE,
  readWorkspaceCapability,
  readWorkspaceChange,
  unreportedArchivedChangeMessage,
  unreportedCapabilityMessage,
  unreportedChangeMessage,
} from '../src/host/change-detail.ts'
import {
  artifactReadMessage,
  CAPABILITIES_MALFORMED_MESSAGE,
  listWorkspaceCapabilities,
  NO_LOCAL_ROOT_MESSAGE,
  OUTSIDE_ROOT_MESSAGE,
} from '../src/host/change-list.ts'
import {
  CHANGE_DETAIL_ROUTE,
  CHANGES_ROUTE,
  registerChangeRoute,
  SPECS_ROUTE,
} from '../src/host/index.ts'

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

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

function workspace(withRoot = true): string {
  const directory = temporaryDirectory('openspec-workspace-')
  if (withRoot) mkdirSync(join(directory, 'openspec'))
  return directory
}

/** A PATH that resolves the CLI under either platform branch. */
function cliPath(): string {
  const directory = temporaryDirectory('openspec-bin-')
  writeFileSync(join(directory, 'openspec'), '')
  writeFileSync(join(directory, 'openspec.CMD'), '')
  return directory
}

interface CliRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: 'no-tasks' | 'complete' | 'in-progress'
  readonly archived?: boolean
}

function listOutput(root: string, rows: readonly CliRow[]): string {
  return JSON.stringify({
    changes: rows.map((entry) => ({
      name: entry.name,
      completedTasks: entry.completedTasks,
      totalTasks: entry.totalTasks,
      status: entry.status,
      lastModified: '2026-11-05T00:00:00.000Z',
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

function changeShowOutput(root: string, deltas: readonly unknown[]): string {
  return JSON.stringify({
    id: 'change',
    deltas,
    root: { path: root, source: 'nearest' },
  })
}

function specShowOutput(
  root: string,
  id: string,
  overview: string,
  requirements: readonly unknown[],
): string {
  return JSON.stringify({
    id,
    overview,
    requirementCount: requirements.length,
    requirements,
    root: { path: root, source: 'nearest' },
  })
}

function statusOutput(root: string, name: string, taskPaths: readonly string[]): string {
  return JSON.stringify({
    changeName: name,
    planningHome: { root },
    artifactPaths: {
      tasks: { resolvedOutputPath: taskPaths[0] ?? '', existingOutputPaths: taskPaths },
    },
  })
}

interface RequirementFixture {
  readonly name: string
  readonly text: string
  readonly scenarios?: readonly { name: string; rawText: string }[]
}

function requirement(fixture: RequirementFixture): Record<string, unknown> {
  return {
    name: fixture.name,
    text: fixture.text,
    scenarios: fixture.scenarios ?? [],
  }
}

/** The CLI answer recorded per command, sorted by the first two words. */
type CliAnswer = { stdout: string; code?: number; stderr?: string } | undefined

/** Answer every spawned CLI call from a handler; runs after the spawn call returns. */
function autoCli(handler: (args: readonly string[]) => CliAnswer): void {
  spawnMock.mockImplementation((_file: string, args: readonly string[]) => {
    const child = new FakeChild()
    queueMicrotask(() => {
      const answer = handler(args)
      if (answer === undefined) {
        complete(child, 1, '', `unexpected openspec call: ${args.join(' ')}`)
        return
      }
      complete(child, answer.code ?? 0, answer.stdout, answer.stderr ?? '')
    })
    return child
  })
}

/** The CLI arguments after the `openspec` token, on either platform branch. */
function commandOf(args: readonly string[]): string[] {
  if (args[0] === '/d') {
    const line = args[3] ?? ''
    const tokens = [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? '')
    return tokens.slice(1)
  }
  return [...args]
}

function complete(child: FakeChild, code: number | null, stdout = '', stderr = ''): void {
  if (stdout !== '') child.stdout.emit('data', stdout)
  if (stderr !== '') child.stderr.emit('data', stderr)
  child.emit('close', code)
}

interface ChangeFixture {
  readonly proposal?: string
  readonly design?: string
  readonly tasks?: string
  readonly specs?: Readonly<Record<string, string>>
  readonly nestedTasks?: Readonly<Record<string, string>>
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
  for (const [path, body] of Object.entries(fixture.nestedTasks ?? {})) {
    const file = join(changeDirectory, 'tasks', path)
    mkdirSync(join(changeDirectory, 'tasks'), { recursive: true })
    writeFileSync(file, body)
  }
  return changeDirectory
}

/** Write one accepted capability spec under the workspace's own OpenSpec root. */
function writeSpec(directory: string, id: string, body: string): string {
  const capabilityDirectory = join(directory, 'openspec', 'specs', id)
  mkdirSync(capabilityDirectory, { recursive: true })
  const file = join(capabilityDirectory, 'spec.md')
  writeFileSync(file, body)
  return file
}

/** Link one directory portably; a Windows junction needs no admin privilege. */
function directoryLink(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Deterministic mtimes for the last-modified assertions. */
const AT_10 = '2026-11-05T10:00:00.000Z'
const AT_11 = '2026-11-05T11:00:00.000Z'
const AT_12 = '2026-11-05T12:00:00.000Z'
const AT_13 = '2026-11-05T13:00:00.000Z'
const AT_14 = '2026-11-05T14:00:00.000Z'

/** Stamp one existing fixture file with a deterministic mtime. */
function setModified(path: string, iso: string): void {
  const time = new Date(iso)
  utimesSync(path, time, time)
}

function gitOutput(commits: readonly { short: string; paths: readonly string[] }[]): string {
  return commits
    .map(
      (commit) =>
        `${commit.short}\t2026-11-01T10:00:00+03:00\tcommit ${commit.short}\n${commit.paths.join('\n')}\n`,
    )
    .join('\n')
}

function serveGit(output: string): void {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: null, stdout: string) => void,
    ) => {
      callback(null, output)
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PATH', cliPath())
  vi.stubEnv('PATHEXT', '.CMD')
  execFileMock.mockImplementation(
    (_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
      callback(new Error('not a git repository'))
    },
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('active change detail', () => {
  it('reads every artifact, structured deltas, task files and progress', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      proposal: '# Proposal\n\n## Why\n\nAdds authentication for operators.\n',
      design: '# Design\n',
      tasks: '- [x] one\n- [ ] two\n',
      specs: { zeta: '# Zeta\n', alpha: '# Alpha\n' },
    })
    setModified(join(directory, 'proposal.md'), AT_10)
    setModified(join(directory, 'design.md'), AT_11)
    setModified(join(directory, 'tasks.md'), AT_12)
    setModified(join(directory, 'specs', 'alpha', 'spec.md'), AT_13)
    setModified(join(directory, 'specs', 'zeta', 'spec.md'), AT_14)
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--all') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 1, totalTasks: 2, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'show') {
        expect(command).toEqual(['show', 'add-auth', '--json', '--type', 'change'])
        return {
          stdout: changeShowOutput(cwd, [
            {
              spec: 'alpha',
              operation: 'ADDED',
              description: 'Add requirement',
              requirements: [
                requirement({
                  name: 'One',
                  text: 'The system SHALL do one thing.',
                  scenarios: [{ name: 'Works', rawText: '- **WHEN** x\n- **THEN** y' }],
                }),
              ],
            },
            {
              spec: 'zeta',
              operation: 'MODIFIED',
              description: 'Modify requirement',
              requirements: [requirement({ name: 'Two', text: 'The system MUST do two.' })],
            },
          ]),
        }
      }
      if (command[0] === 'status') {
        return { stdout: statusOutput(cwd, 'add-auth', [join(directory, 'tasks.md')]) }
      }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, 'add-auth')
    expect(change).toMatchObject({
      name: 'add-auth',
      status: 'in-progress',
      phase: 'applying',
      completedTasks: 1,
      totalTasks: 2,
      archived: false,
      archivedAt: null,
      summary: 'Adds authentication for operators.',
      modified: AT_14,
      presence: { proposal: true, design: true, tasks: true, specs: 2 },
      artifacts: { proposal: '# Proposal\n\n## Why\n\nAdds authentication for operators.\n' },
    })
    expect(change.specs.map((spec) => spec.capability)).toEqual(['alpha', 'zeta'])
    expect(change.deltas).toEqual([
      {
        capability: 'alpha',
        operation: 'ADDED',
        requirements: [
          {
            name: 'One',
            text: 'The system SHALL do one thing.',
            scenarios: [{ name: 'Works', rawText: '- **WHEN** x\n- **THEN** y' }],
          },
        ],
      },
      {
        capability: 'zeta',
        operation: 'MODIFIED',
        requirements: [{ name: 'Two', text: 'The system MUST do two.', scenarios: [] }],
      },
    ])
    expect(change.taskFiles).toEqual([
      { path: 'openspec/changes/add-auth/tasks.md', body: '- [x] one\n- [ ] two\n' },
    ])
    expect(change.commit).toBeNull()
  })

  it('groups consecutive CLI requirements for one capability and operation', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      proposal: '# Why\n\nGrouped.\n',
      tasks: '- [ ] one\n',
    })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'show') {
        return {
          stdout: changeShowOutput(cwd, [
            {
              spec: 'alpha',
              operation: 'ADDED',
              requirements: [requirement({ name: 'One', text: 'A' })],
            },
            {
              spec: 'alpha',
              operation: 'ADDED',
              requirements: [requirement({ name: 'Two', text: 'B' })],
            },
            {
              spec: 'alpha',
              operation: 'RENAMED',
              description: 'Rename',
              rename: { from: 'Old', to: 'New' },
            },
          ]),
        }
      }
      if (command[0] === 'status') {
        return { stdout: statusOutput(cwd, 'add-auth', [join(directory, 'tasks.md')]) }
      }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, 'add-auth')
    expect(change.deltas).toEqual([
      {
        capability: 'alpha',
        operation: 'ADDED',
        requirements: [
          { name: 'One', text: 'A', scenarios: [] },
          { name: 'Two', text: 'B', scenarios: [] },
        ],
      },
      {
        capability: 'alpha',
        operation: 'RENAMED',
        requirements: [],
        rename: { from: 'Old', to: 'New' },
      },
    ])
  })

  it('reads a nested task file the status command reports', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      tasks: '- [ ] one\n',
      nestedTasks: { '1.md': '- [x] nested\n' },
    })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 2, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'show') return { stdout: changeShowOutput(cwd, []) }
      if (command[0] === 'status') {
        return {
          stdout: statusOutput(cwd, 'add-auth', [
            join(directory, 'tasks.md'),
            join(directory, 'tasks', '1.md'),
          ]),
        }
      }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, 'add-auth')
    expect(change.taskFiles.map((file) => file.path)).toEqual([
      'openspec/changes/add-auth/tasks.md',
      'openspec/changes/add-auth/tasks/1.md',
    ])
  })

  it('opens a change without a proposal and skips the structured-delta read', async () => {
    const cwd = workspace()
    writeChange(cwd, 'scaffold', { tasks: '- [ ] one\n' })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'scaffold', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'status') return { stdout: statusOutput(cwd, 'scaffold', []) }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, 'scaffold')
    expect(change.deltas).toEqual([])
    expect(change.artifacts.proposal).toBeNull()
    const showCalls = spawnMock.mock.calls.filter((call) => commandOf(call[1]).at(0) === 'show')
    expect(showCalls).toEqual([])
  })

  it('accepts a description-only CLI delta from the proposal fallback', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nProse only.\n', tasks: '- [ ] one\n' })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'show') {
        return {
          stdout: changeShowOutput(cwd, [
            { spec: 'alpha', operation: 'ADDED', description: 'Add a feature' },
          ]),
        }
      }
      if (command[0] === 'status') return { stdout: statusOutput(cwd, 'add-auth', []) }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, 'add-auth')
    expect(change.deltas).toEqual([{ capability: 'alpha', operation: 'ADDED', requirements: [] }])
  })

  it('passes the explicit --type change so a name shared with a capability is unambiguous', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'same', '# Same\n\n## Purpose\n\nCapability.\n')
    writeChange(cwd, 'same', { proposal: '# Why\n\nSame name.\n', tasks: '- [ ] one\n' })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'same', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'show') return { stdout: changeShowOutput(cwd, []) }
      if (command[0] === 'status') return { stdout: statusOutput(cwd, 'same', []) }
      return undefined
    })
    await readWorkspaceChange(cwd, 'same')
    const showCall = spawnMock.mock.calls.find((call) => commandOf(call[1]).at(0) === 'show')
    expect(showCall).toBeDefined()
    expect(commandOf(showCall?.[1] as string[])).toEqual([
      'show',
      'same',
      '--json',
      '--type',
      'change',
    ])
  })

  it('refuses an active name that only the archived list reports', async () => {
    const cwd = workspace()
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-27-add-auth',
              completedTasks: 1,
              totalTasks: 1,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, '2026-10-27-add-auth')).rejects.toThrow(
      unreportedChangeMessage('2026-10-27-add-auth'),
    )
  })

  it('refuses a traversal-shaped name even when the CLI reports it', async () => {
    const cwd = workspace()
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: '../add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
          ]),
        }
      }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, '../add-auth')).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses a change directory that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    writeFileSync(join(outside, 'proposal.md'), '# Outside\n')
    mkdirSync(join(cwd, 'openspec', 'changes'), { recursive: true })
    directoryLink(outside, join(cwd, 'openspec', 'changes', 'add-auth'))
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
          ]),
        }
      }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, 'add-auth')).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses a delta spec that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    writeFileSync(join(outside, 'spec.md'), '# Outside\n')
    const changeDirectory = writeChange(cwd, 'add-auth', { proposal: '# Why\n' })
    mkdirSync(join(changeDirectory, 'specs'), { recursive: true })
    directoryLink(outside, join(changeDirectory, 'specs', 'alpha'))
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
          ]),
        }
      }
      if (command[0] === 'show') return { stdout: changeShowOutput(cwd, []) }
      if (command[0] === 'status') return { stdout: statusOutput(cwd, 'add-auth', []) }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, 'add-auth')).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('reports an unreadable artifact with its path and cause', async () => {
    const cwd = workspace()
    const directory = join(cwd, 'openspec', 'changes', 'add-auth')
    mkdirSync(join(directory, 'proposal.md'), { recursive: true })
    writeFileSync(join(directory, 'tasks.md'), '- [ ] one\n')
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
          ]),
        }
      }
      return undefined
    })
    const error = await readWorkspaceChange(cwd, 'add-auth').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain(artifactReadMessage(join(directory, 'proposal.md'), 'EISDIR'))
    expect(message).toContain('proposal.md')
  })

  it('resolves a same-named pair by the archived flag only', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', {
      proposal: '# Why\n\nActive work.\n',
      specs: { alpha: '## ADDED Requirements\n\n### Requirement: Active\n\nActive text.\n' },
    })
    writeChange(
      cwd,
      'add-auth',
      {
        proposal: '# Why\n\nArchived work.\n',
        specs: { alpha: '## ADDED Requirements\n\n### Requirement: Archived\n\nArchived text.\n' },
      },
      true,
    )
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
            {
              name: 'add-auth',
              completedTasks: 4,
              totalTasks: 4,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      if (command[0] === 'show') {
        return {
          stdout: changeShowOutput(cwd, [
            {
              spec: 'alpha',
              operation: 'ADDED',
              requirements: [requirement({ name: 'Active', text: 'Active text.' })],
            },
          ]),
        }
      }
      if (command[0] === 'status') return { stdout: statusOutput(cwd, 'add-auth', []) }
      return undefined
    })
    const active = await readWorkspaceChange(cwd, 'add-auth')
    expect(active.archived).toBe(false)
    expect(active.summary).toBe('Active work.')
    expect(active.deltas[0]?.requirements[0]?.name).toBe('Active')
    const archived = await readWorkspaceChange(cwd, 'add-auth', true)
    expect(archived.archived).toBe(true)
    expect(archived.summary).toBe('Archived work.')
    expect(archived.deltas[0]?.requirements[0]?.name).toBe('Archived')
  })
})

describe('archived change detail', () => {
  it('reads an archived change with parsed deltas, its date and nested task files', async () => {
    const cwd = workspace()
    const directory = writeChange(
      cwd,
      '2026-10-27-add-admin',
      {
        proposal: '# Proposal\n\n## Why\n\nAdds the admin indicator.\n',
        design: '# Design\n',
        tasks: '- [x] one\n',
        nestedTasks: { '2.md': '- [ ] two\n' },
        specs: {
          admin: [
            '# Spec Delta',
            '',
            '## ADDED Requirements',
            '',
            '### Requirement: Admin status',
            '',
            'The system SHALL report status.',
            '',
            '#### Scenario: Elevated',
            '',
            '- **WHEN** token is high',
            '- **THEN** status is administrator',
            '',
            '## RENAMED Requirements',
            '',
            '- FROM: ### Requirement: Old name',
            '- TO: ### Requirement: New name',
            '',
          ].join('\n'),
        },
      },
      true,
    )
    setModified(join(directory, 'proposal.md'), AT_10)
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-27-add-admin',
              completedTasks: 5,
              totalTasks: 5,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, '2026-10-27-add-admin', true)
    expect(change).toMatchObject({
      name: '2026-10-27-add-admin',
      phase: 'archived',
      archived: true,
      archivedAt: '2026-10-27',
      completedTasks: 5,
      totalTasks: 5,
      summary: 'Adds the admin indicator.',
    })
    expect(change.deltas).toEqual([
      {
        capability: 'admin',
        operation: 'ADDED',
        requirements: [
          {
            name: 'Admin status',
            text: 'The system SHALL report status.',
            scenarios: [
              {
                name: 'Elevated',
                rawText: '- **WHEN** token is high\n- **THEN** status is administrator',
              },
            ],
          },
        ],
      },
      {
        capability: 'admin',
        operation: 'RENAMED',
        requirements: [],
        rename: { from: 'Old name', to: 'New name' },
      },
    ])
    expect(change.taskFiles.map((file) => file.path)).toEqual([
      'openspec/changes/archive/2026-10-27-add-admin/tasks.md',
      'openspec/changes/archive/2026-10-27-add-admin/tasks/2.md',
    ])
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('parses a RENAMED delta in a file that also has added requirements', () => {
    const deltas = parseArchivedDeltas(
      'alpha',
      [
        '## ADDED Requirements',
        '',
        '### Requirement: New behavior',
        '',
        'The system SHALL work.',
        '',
        '#### Scenario: Works',
        '',
        '- **WHEN** x',
        '- **THEN** y',
        '',
        '## RENAMED Requirements',
        '',
        '* FROM: ### Requirement: Old name',
        '* TO: ### Requirement: New name',
        '',
      ].join('\n'),
    )
    expect(deltas[0]).toEqual({
      capability: 'alpha',
      operation: 'ADDED',
      requirements: [
        {
          name: 'New behavior',
          text: 'The system SHALL work.',
          scenarios: [{ name: 'Works', rawText: '- **WHEN** x\n- **THEN** y' }],
        },
      ],
    })
    expect(deltas[1]).toEqual({
      capability: 'alpha',
      operation: 'RENAMED',
      requirements: [],
      rename: { from: 'Old name', to: 'New name' },
    })
  })

  it('ignores headings inside a fenced example, including a shorter nested fence', () => {
    const deltas = parseArchivedDeltas(
      'alpha',
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Real',
        '',
        'Real text with an example:',
        '',
        '````markdown',
        '```markdown',
        '### Requirement: Example only',
        '',
        '#### Scenario: Fake',
        '',
        '- **WHEN** fake',
        '```',
        '````',
        '',
        '### Requirement: Second',
        '',
        'Second text.',
        '',
      ].join('\n'),
    )
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.requirements.map((req) => req.name)).toEqual(['Real', 'Second'])
    expect(deltas[0]?.requirements[0]?.scenarios).toEqual([])
    expect(deltas[0]?.requirements[0]?.text).toContain('### Requirement: Example only')
  })

  it('keeps a subheading and its following content inside the requirement', () => {
    const deltas = parseArchivedDeltas(
      'alpha',
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Bounded',
        '',
        'The system SHALL stay bounded.',
        '',
        '##### Limits',
        '',
        'The bound is described below.',
        '',
        '#### Scenario: Too large',
        '',
        '- **WHEN** the input is large',
        '- **THEN** the system refuses it',
        '',
      ].join('\n'),
    )
    const requirement = deltas[0]?.requirements[0]
    expect(requirement?.text).toContain('##### Limits')
    expect(requirement?.text).toContain('The bound is described below.')
    expect(requirement?.scenarios).toEqual([
      {
        name: 'Too large',
        rawText: '- **WHEN** the input is large\n- **THEN** the system refuses it',
      },
    ])
  })

  it('stops at an unsupported section instead of inheriting the operation', () => {
    const deltas = parseArchivedDeltas(
      'alpha',
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Real',
        '',
        'Real text.',
        '',
        '## Notes',
        '',
        '### Requirement: Informational',
        '',
        'Not a delta requirement.',
        '',
      ].join('\n'),
    )
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.requirements.map((req) => req.name)).toEqual(['Real'])
  })

  it('keeps several requirements and one without scenarios', () => {
    const deltas = parseArchivedDeltas(
      'alpha',
      [
        '## MODIFIED Requirements',
        '',
        '### Requirement: First',
        '',
        'First text.',
        '',
        '#### Scenario: One',
        '',
        '- **WHEN** x',
        '- **THEN** y',
        '',
        '### Requirement: Second',
        '',
        'Second text MUST hold.',
        '',
      ].join('\n'),
    )
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.requirements.map((req) => req.name)).toEqual(['First', 'Second'])
    expect(deltas[0]?.requirements[1]?.scenarios).toEqual([])
  })

  it('falls back to the raw Markdown body when no section parses', async () => {
    const cwd = workspace()
    const body = '# Delta\n\nPlain prose, no delta section.\n'
    writeChange(cwd, '2026-10-27-plain', { specs: { alpha: body } }, true)
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-27-plain',
              completedTasks: 1,
              totalTasks: 1,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, '2026-10-27-plain', true)
    expect(change.deltas).toEqual([])
    expect(change.specs).toEqual([expect.objectContaining({ capability: 'alpha', body })])
  })

  it('reports a missing archive directory', async () => {
    const cwd = workspace()
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-27-missing',
              completedTasks: 0,
              totalTasks: 0,
              status: 'no-tasks',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, '2026-10-27-missing', true)).rejects.toThrow(
      'the change directory is missing',
    )
  })

  it('refuses a name the archived list does not report', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nActive.\n' })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
          ]),
        }
      }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, 'add-auth', true)).rejects.toThrow(
      unreportedArchivedChangeMessage('add-auth'),
    )
  })

  it('refuses a traversal-shaped archived name even when reported', async () => {
    const cwd = workspace()
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '../escape',
              completedTasks: 0,
              totalTasks: 0,
              status: 'no-tasks',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    await expect(readWorkspaceChange(cwd, '../escape', true)).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('returns no task files when the archived change has none', async () => {
    const cwd = workspace()
    writeChange(cwd, '2026-10-27-no-tasks', { proposal: '# Why\n\nNothing.\n' }, true)
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-27-no-tasks',
              completedTasks: 0,
              totalTasks: 0,
              status: 'no-tasks',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    const change = await readWorkspaceChange(cwd, '2026-10-27-no-tasks', true)
    expect(change.taskFiles).toEqual([])
  })
})

describe('openspec capability reads', () => {
  it('lists capability rows with purpose, modification and provenance', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n## Purpose\n\nShows the admin state.\n')
    writeSpec(cwd, 'beta', '# Beta\n\nNo purpose section.\n')
    const producer = writeChange(
      cwd,
      '2026-10-27-add-alpha',
      { specs: { alpha: '## ADDED Requirements\n\n### Requirement: A\n\nText.\n' } },
      true,
    )
    setModified(join(producer, 'specs', 'alpha', 'spec.md'), AT_12)
    serveGit(
      gitOutput([
        {
          short: 'abc1234',
          paths: [
            'openspec/specs/alpha/spec.md',
            'openspec/changes/archive/2026-10-27-add-alpha/specs/alpha/spec.md',
          ],
        },
      ]),
    )
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return {
          stdout: specsOutput(cwd, [
            { id: 'alpha', requirementCount: 4 },
            { id: 'beta', requirementCount: 1 },
          ]),
        }
      }
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-27-add-alpha',
              completedTasks: 5,
              totalTasks: 5,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      return undefined
    })
    const rows = await listWorkspaceCapabilityRows(cwd)
    const alpha = rows.find((row) => row.id === 'alpha')
    expect(alpha).toMatchObject({
      id: 'alpha',
      requirementCount: 4,
      purpose: 'Shows the admin state.',
      lastChange: {
        name: '2026-10-27-add-alpha',
        date: '2026-10-27',
        completedTasks: 5,
        totalTasks: 5,
        commit: { short: 'abc1234' },
      },
      commit: { short: 'abc1234' },
    })
    const beta = rows.find((row) => row.id === 'beta')
    expect(beta).toMatchObject({ purpose: '', lastChange: null })
  })

  it('reads a capability with structured requirements, its file purpose and newest-first history', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n## Purpose\n\nThe file purpose.\n')
    writeChange(cwd, '2026-10-01-add-alpha', { specs: { alpha: '## ADDED Requirements\n' } }, true)
    writeChange(
      cwd,
      '2026-10-20-update-alpha',
      { specs: { alpha: '## MODIFIED Requirements\n' } },
      true,
    )
    writeChange(
      cwd,
      '2026-11-01-refine-alpha',
      { specs: { alpha: '## MODIFIED Requirements\n' } },
      true,
    )
    const longText = `The system SHALL ${'x'.repeat(600)}`
    serveGit(
      gitOutput([
        {
          short: 'fff1111',
          paths: ['openspec/specs/alpha/spec.md'],
        },
        {
          short: 'bbb2222',
          paths: ['openspec/changes/archive/2026-11-01-refine-alpha/specs/alpha/spec.md'],
        },
        {
          short: 'aaa3333',
          paths: ['openspec/changes/archive/2026-10-20-update-alpha/specs/alpha/spec.md'],
        },
        {
          short: 'ccc4444',
          paths: ['openspec/changes/archive/2026-10-01-add-alpha/specs/alpha/spec.md'],
        },
      ]),
    )
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'alpha', requirementCount: 2 }]) }
      }
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-10-01-add-alpha',
              completedTasks: 6,
              totalTasks: 6,
              status: 'complete',
              archived: true,
            },
            {
              name: '2026-10-20-update-alpha',
              completedTasks: 3,
              totalTasks: 4,
              status: 'complete',
              archived: true,
            },
            {
              name: '2026-11-01-refine-alpha',
              completedTasks: 2,
              totalTasks: 2,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      if (command[0] === 'show') {
        expect(command).toEqual(['show', 'alpha', '--json', '--type', 'spec'])
        return {
          stdout: specShowOutput(cwd, 'alpha', 'The CLI overview.', [
            requirement({ name: 'Long', text: longText }),
            requirement({ name: 'Short', text: 'The system MUST work.' }),
          ]),
        }
      }
      return undefined
    })
    const capability = await readWorkspaceCapability(cwd, 'alpha')
    expect(capability).toMatchObject({
      id: 'alpha',
      requirementCount: 2,
      purpose: 'The file purpose.',
      lastChange: { name: '2026-11-01-refine-alpha' },
    })
    expect(capability.requirements.map((req) => req.name)).toEqual(['Long', 'Short'])
    expect(capability.requirements[0]?.text).toHaveLength(617)
    expect(capability.history.map((entry) => entry.name)).toEqual([
      '2026-11-01-refine-alpha',
      '2026-10-20-update-alpha',
      '2026-10-01-add-alpha',
    ])
    expect(capability.history.map((entry) => entry.commit?.short)).toEqual([
      'bbb2222',
      'aaa3333',
      'ccc4444',
    ])
    expect(capability.commit).toEqual(expect.objectContaining({ short: 'fff1111' }))
    expect(execFileMock).toHaveBeenCalledTimes(1)
    const args = execFileMock.mock.calls[0]?.[1] as string[]
    expect(args).toEqual(
      expect.arrayContaining([
        'openspec/specs/alpha',
        'openspec/changes/archive/2026-11-01-refine-alpha',
        'openspec/changes/archive/2026-10-20-update-alpha',
        'openspec/changes/archive/2026-10-01-add-alpha',
      ]),
    )
  })

  it('falls back to the CLI overview when the spec has no Purpose section', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\nNo purpose here.\n')
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'alpha', requirementCount: 0 }]) }
      }
      if (command[0] === 'list') return { stdout: listOutput(cwd, []) }
      if (command[0] === 'show') {
        return { stdout: specShowOutput(cwd, 'alpha', 'The CLI overview.', []) }
      }
      return undefined
    })
    const capability = await readWorkspaceCapability(cwd, 'alpha')
    expect(capability.purpose).toBe('The CLI overview.')
  })

  it('reports no history for a synced-only capability', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n## Purpose\n\nOnly synced.\n')
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'alpha', requirementCount: 1 }]) }
      }
      if (command[0] === 'list') return { stdout: listOutput(cwd, []) }
      if (command[0] === 'show') {
        return { stdout: specShowOutput(cwd, 'alpha', 'Overview.', []) }
      }
      return undefined
    })
    const capability = await readWorkspaceCapability(cwd, 'alpha')
    expect(capability.history).toEqual([])
    expect(capability.lastChange).toBeNull()
  })

  it('refuses an id the CLI does not report without reading its spec', async () => {
    const cwd = workspace()
    mkdirSync(join(cwd, 'openspec', 'specs', 'wanted', 'spec.md'), { recursive: true })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'other', requirementCount: 1 }]) }
      }
      return undefined
    })
    await expect(readWorkspaceCapability(cwd, 'wanted')).rejects.toThrow(
      unreportedCapabilityMessage('wanted'),
    )
  })

  it('passes the explicit --type spec so a name shared with a change is unambiguous', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'same', '# Same\n\n## Purpose\n\nShared name.\n')
    writeChange(cwd, 'same', { tasks: '- [ ] one\n' })
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'same', requirementCount: 0 }]) }
      }
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            { name: 'same', completedTasks: 0, totalTasks: 1, status: 'in-progress' },
          ]),
        }
      }
      if (command[0] === 'show') {
        return { stdout: specShowOutput(cwd, 'same', 'Overview.', []) }
      }
      return undefined
    })
    await readWorkspaceCapability(cwd, 'same')
    const showCall = spawnMock.mock.calls.find((call) => commandOf(call[1]).at(0) === 'show')
    expect(showCall).toBeDefined()
    expect(commandOf(showCall?.[1] as string[])).toEqual([
      'show',
      'same',
      '--json',
      '--type',
      'spec',
    ])
  })

  it('finds provenance for a nested capability id', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'auth/login', '# Login\n\n## Purpose\n\nNested capability.\n')
    writeChange(
      cwd,
      '2026-11-01-add-login',
      { specs: { 'auth/login': '## ADDED Requirements\n\n### Requirement: Login\n\nText.\n' } },
      true,
    )
    serveGit(
      gitOutput([
        {
          short: 'abc1234',
          paths: ['openspec/changes/archive/2026-11-01-add-login/specs/auth/login/spec.md'],
        },
      ]),
    )
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'auth/login', requirementCount: 1 }]) }
      }
      if (command[0] === 'list') {
        return {
          stdout: listOutput(cwd, [
            {
              name: '2026-11-01-add-login',
              completedTasks: 3,
              totalTasks: 3,
              status: 'complete',
              archived: true,
            },
          ]),
        }
      }
      if (command[0] === 'show') {
        return { stdout: specShowOutput(cwd, 'auth/login', 'Overview.', []) }
      }
      return undefined
    })
    const capability = await readWorkspaceCapability(cwd, 'auth/login')
    expect(capability.history.map((entry) => entry.name)).toEqual(['2026-11-01-add-login'])
    expect(capability.lastChange?.name).toBe('2026-11-01-add-login')
    const rows = await listWorkspaceCapabilityRows(cwd)
    expect(rows.find((row) => row.id === 'auth/login')?.lastChange?.name).toBe(
      '2026-11-01-add-login',
    )
  })

  it('refuses a CLI-reported id a Windows shell could re-parse', async () => {
    const cwd = workspace()
    const payloads = ['alpha&echo.PWNED&rem', '%CMDCMDLINE%&echo.PWNED&rem']
    for (const evil of payloads) {
      autoCli((args) => {
        const command = commandOf(args)
        if (command[0] === 'list' && command[1] === '--specs') {
          return { stdout: specsOutput(cwd, [{ id: evil, requirementCount: 0 }]) }
        }
        if (command[0] === 'list') return { stdout: listOutput(cwd, []) }
        if (command[0] === 'show') {
          return { stdout: specShowOutput(cwd, evil, 'Overview.', []) }
        }
        return undefined
      })
      await expect(readWorkspaceCapability(cwd, evil)).rejects.toThrow(
        'cannot be passed to the CLI safely',
      )
      expect(
        spawnMock.mock.calls.some(
          (call) => commandOf(call[1]).at(0) === 'show' && commandOf(call[1]).at(1) === evil,
        ),
      ).toBe(false)
    }
  })

  it('falls back to the CLI overview when the inventory purpose section is unreadable', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n### Purpose\n\nOnly the CLI sees this.\n')
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'alpha', requirementCount: 2 }]) }
      }
      if (command[0] === 'list') return { stdout: listOutput(cwd, []) }
      if (command[0] === 'show') {
        expect(command).toEqual(['show', 'alpha', '--json', '--type', 'spec'])
        return { stdout: specShowOutput(cwd, 'alpha', 'The CLI overview.', []) }
      }
      return undefined
    })
    const rows = await listWorkspaceCapabilityRows(cwd)
    expect(rows[0]).toMatchObject({ id: 'alpha', purpose: 'The CLI overview.' })
  })

  it('refuses a capability spec that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    writeFileSync(join(outside, 'spec.md'), '# Outside\n')
    mkdirSync(join(cwd, 'openspec', 'specs'), { recursive: true })
    directoryLink(outside, join(cwd, 'openspec', 'specs', 'alpha'))
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'alpha', requirementCount: 1 }]) }
      }
      return undefined
    })
    await expect(readWorkspaceCapability(cwd, 'alpha')).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses a workspace without a local root before running the CLI', async () => {
    await expect(listWorkspaceCapabilities(workspace(false))).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    await expect(readWorkspaceCapability(workspace(false), 'alpha')).rejects.toThrow(
      NO_LOCAL_ROOT_MESSAGE,
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses malformed inventory output', async () => {
    const cwd = workspace()
    const malformed: unknown[] = [
      'not-an-array',
      [{ id: 'x' }],
      [{ id: '', requirementCount: 1 }],
      [{ id: 'x', requirementCount: -1 }],
      [{ id: 'x', requirementCount: 1.5 }],
    ]
    for (const specs of malformed) {
      autoCli(() => ({
        stdout: specsOutput(cwd, specs as { id: string; requirementCount: number }[]),
      }))
      await expect(listWorkspaceCapabilities(cwd)).rejects.toThrow(CAPABILITIES_MALFORMED_MESSAGE)
    }
  })

  it('reports a reported capability whose spec file cannot be read', async () => {
    const cwd = workspace()
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'ghost', requirementCount: 1 }]) }
      }
      return undefined
    })
    const error = await readWorkspaceCapability(cwd, 'ghost').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('Could not read the OpenSpec capability spec')
    expect(message).toContain(join(cwd, 'openspec', 'specs', 'ghost', 'spec.md'))
  })

  it('rejects malformed structured requirement output', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n## Purpose\n\nP.\n')
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--specs') {
        return { stdout: specsOutput(cwd, [{ id: 'alpha', requirementCount: 1 }]) }
      }
      if (command[0] === 'list') return { stdout: listOutput(cwd, []) }
      if (command[0] === 'show') {
        return { stdout: specShowOutput(cwd, 'alpha', 'Overview.', [{ name: 'x' }]) }
      }
      return undefined
    })
    await expect(readWorkspaceCapability(cwd, 'alpha')).rejects.toThrow(
      REQUIREMENTS_MALFORMED_MESSAGE,
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
  readonly routes: Map<string, FetchRoute>
  request(path: string, query: string): Promise<Response>
}

/** A desktop shell host has `connection.fetch` but no `webServer` service. */
function routeHarness(workspaces: ReadonlyMap<string, string>): RouteHarness {
  const routes = new Map<string, FetchRoute>()
  const services: Record<string, unknown> = {
    connection: {
      fetch: {
        register(route: FetchRoute) {
          routes.set(route.path, route)
          return () => {
            routes.delete(route.path)
          }
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
        throw new Error('the OpenSpec read routes must not depend on webServer')
      },
    },
  }
  const ctx = {
    get(name: string) {
      return services[name]
    },
    effect(callback: () => () => void) {
      return callback()
    },
  }
  registerChangeRoute(ctx as never)
  return {
    routes,
    request(path, query) {
      const route = routes.get(path)
      if (route === undefined) throw new Error(`route ${path} not registered`)
      return route.fetch(new Request(`http://localhost${path}${query}`, { method: 'GET' }))
    },
  }
}

/** The CLI answers every detail read needs, keyed by command. */
function serveDetail(
  cwd: string,
  options: {
    readonly rows: readonly CliRow[]
    readonly deltas?: readonly unknown[]
    readonly taskPaths?: readonly string[]
    readonly capabilities?: readonly { id: string; requirementCount: number }[]
    readonly spec?: { overview: string; requirements: readonly unknown[] }
  },
): void {
  autoCli((args) => {
    const command = commandOf(args)
    if (command[0] === 'list' && command[1] === '--all') {
      return { stdout: listOutput(cwd, options.rows) }
    }
    if (command[0] === 'list' && command[1] === '--specs') {
      return { stdout: specsOutput(cwd, options.capabilities ?? []) }
    }
    if (command[0] === 'show') {
      const type = command[command.indexOf('--type') + 1]
      if (type === 'change') return { stdout: changeShowOutput(cwd, options.deltas ?? []) }
      if (type === 'spec') {
        return {
          stdout: specShowOutput(
            cwd,
            command[1] ?? '',
            options.spec?.overview ?? '',
            options.spec?.requirements ?? [],
          ),
        }
      }
    }
    if (command[0] === 'status') {
      return { stdout: statusOutput(cwd, command[2] ?? '', options.taskPaths ?? []) }
    }
    return undefined
  })
}

describe('openspec read routes', () => {
  it('registers the three exact GET routes on the desktop shell carrier', () => {
    const harness = routeHarness(new Map())
    expect([...harness.routes.keys()]).toEqual([CHANGES_ROUTE, CHANGE_DETAIL_ROUTE, SPECS_ROUTE])
    for (const route of harness.routes.values()) {
      expect(route).toMatchObject({ methods: ['GET'], requestBody: 'buffered' })
    }
  })

  it('serves the extended change list with archived rows and all three counts', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nActive.\n' })
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [
        { name: 'add-auth', completedTasks: 1, totalTasks: 2, status: 'in-progress' },
        {
          name: '2026-10-27-old',
          completedTasks: 1,
          totalTasks: 1,
          status: 'complete',
          archived: true,
        },
      ],
      capabilities: [{ id: 'alpha', requirementCount: 4 }],
    })
    const response = await harness.request(CHANGES_ROUTE, '?session=s1')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      changes: Array<{ name: string; presence: unknown; phase: string }>
      archived: Array<{ name: string }>
      counts: unknown
    }
    expect(body.changes).toHaveLength(1)
    expect(body.changes[0]).toMatchObject({
      name: 'add-auth',
      phase: 'applying',
      presence: { proposal: true, design: false, tasks: false, specs: 0 },
    })
    expect(body.archived.map((row) => row.name)).toEqual(['2026-10-27-old'])
    expect(body.counts).toEqual({ active: 1, archived: 1, capabilities: 1 })
  })

  it('serves one active change with its deltas and task files', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      proposal: '# Why\n\nActive.\n',
      tasks: '- [ ] one\n',
      specs: { alpha: '# Delta\n' },
    })
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [{ name: 'add-auth', completedTasks: 0, totalTasks: 1, status: 'in-progress' }],
      deltas: [
        {
          spec: 'alpha',
          operation: 'ADDED',
          requirements: [requirement({ name: 'A', text: 'The system SHALL work.' })],
        },
      ],
      taskPaths: [join(directory, 'tasks.md')],
    })
    const response = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      change: { deltas: unknown[]; taskFiles: unknown[]; archived: boolean }
    }
    expect(body.change.deltas).toEqual([
      {
        capability: 'alpha',
        operation: 'ADDED',
        requirements: [{ name: 'A', text: 'The system SHALL work.', scenarios: [] }],
      },
    ])
    expect(body.change.taskFiles).toHaveLength(1)
    expect(body.change.archived).toBe(false)
  })

  it('serves an archived change and hides it from the active family', async () => {
    const cwd = workspace()
    writeChange(
      cwd,
      '2026-10-27-old',
      {
        proposal: '# Why\n\nOld.\n',
        specs: { alpha: '## ADDED Requirements\n\n### Requirement: Old\n\nOld text.\n' },
      },
      true,
    )
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [
        {
          name: '2026-10-27-old',
          completedTasks: 1,
          totalTasks: 1,
          status: 'complete',
          archived: true,
        },
      ],
    })
    const archived = await harness.request(
      CHANGE_DETAIL_ROUTE,
      '?session=s1&archived=1&name=2026-10-27-old',
    )
    expect(archived.status).toBe(200)
    const archivedBody = (await archived.json()) as {
      change: { archived: boolean; archivedAt: string }
    }
    expect(archivedBody.change).toMatchObject({ archived: true, archivedAt: '2026-10-27' })

    const active = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=2026-10-27-old')
    expect(active.status).toBe(400)
    await expect(active.json()).resolves.toEqual({
      error: unreportedChangeMessage('2026-10-27-old'),
    })

    const missingArchived = await harness.request(
      CHANGE_DETAIL_ROUTE,
      '?session=s1&archived=1&name=add-auth',
    )
    expect(missingArchived.status).toBe(400)
    await expect(missingArchived.json()).resolves.toEqual({
      error: unreportedArchivedChangeMessage('add-auth'),
    })
  })

  it('resolves a same-named active and archived change to different content', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nActive content.\n' })
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nArchived content.\n' }, true)
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [
        { name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
        { name: 'add-auth', completedTasks: 2, totalTasks: 2, status: 'complete', archived: true },
      ],
    })
    const active = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    expect(active.status).toBe(200)
    const activeBody = (await active.json()) as { change: { archived: boolean; summary: string } }
    expect(activeBody.change).toMatchObject({ archived: false, summary: 'Active content.' })

    const archived = await harness.request(
      CHANGE_DETAIL_ROUTE,
      '?session=s1&archived=1&name=add-auth',
    )
    expect(archived.status).toBe(200)
    const archivedBody = (await archived.json()) as {
      change: { archived: boolean; summary: string }
    }
    expect(archivedBody.change).toMatchObject({ archived: true, summary: 'Archived content.' })
  })

  it('serves the capability inventory with purpose and provenance', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n## Purpose\n\nShows it.\n')
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [],
      capabilities: [{ id: 'alpha', requirementCount: 2 }],
    })
    const response = await harness.request(SPECS_ROUTE, '?session=s1')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      capabilities: Array<{ id: string; purpose: string; lastChange: unknown }>
    }
    expect(body.capabilities).toEqual([
      expect.objectContaining({ id: 'alpha', purpose: 'Shows it.', lastChange: null }),
    ])
  })

  it('serves one capability with structured requirements and history', async () => {
    const cwd = workspace()
    writeSpec(cwd, 'alpha', '# Alpha\n\n## Purpose\n\nShows it.\n')
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [],
      capabilities: [{ id: 'alpha', requirementCount: 1 }],
      spec: {
        overview: 'Overview.',
        requirements: [requirement({ name: 'A', text: 'The system SHALL work.' })],
      },
    })
    const response = await harness.request(SPECS_ROUTE, '?session=s1&id=alpha')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      capability: { purpose: string; requirements: unknown[]; history: unknown[] }
    }
    expect(body.capability.purpose).toBe('Shows it.')
    expect(body.capability.requirements).toEqual([
      { name: 'A', text: 'The system SHALL work.', scenarios: [] },
    ])
    expect(body.capability.history).toEqual([])
  })

  it('requires a live session on every route without running the CLI', async () => {
    const harness = routeHarness(new Map())
    for (const path of [CHANGES_ROUTE, CHANGE_DETAIL_ROUTE, SPECS_ROUTE]) {
      const missing = await harness.request(path, '')
      expect(missing.status).toBe(400)
      await expect(missing.json()).resolves.toEqual({ error: 'A session id is required.' })
      const unknown = await harness.request(path, '?session=missing')
      expect(unknown.status).toBe(400)
      await expect(unknown.json()).resolves.toEqual({
        error: 'The session is not live in this host.',
      })
    }
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects a missing change name and a blank capability id', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    const change = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1')
    expect(change.status).toBe(400)
    await expect(change.json()).resolves.toEqual({ error: 'A change name is required.' })
    const capability = await harness.request(SPECS_ROUTE, '?session=s1&id=')
    expect(capability.status).toBe(400)
    await expect(capability.json()).resolves.toEqual({ error: 'A capability id is required.' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an item the CLI does not report', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, { rows: [], capabilities: [] })
    const change = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    expect(change.status).toBe(400)
    await expect(change.json()).resolves.toEqual({ error: unreportedChangeMessage('add-auth') })

    const capability = await harness.request(SPECS_ROUTE, '?session=s1&id=missing')
    expect(capability.status).toBe(400)
    await expect(capability.json()).resolves.toEqual({
      error: unreportedCapabilityMessage('missing'),
    })
  })

  it('returns the CLI failure as a readable 500 cause', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    autoCli((args) => {
      const command = commandOf(args)
      if (command[0] === 'list' && command[1] === '--all') {
        return { stdout: '', code: 1, stderr: 'not a valid workspace' }
      }
      return { stdout: '', code: 1, stderr: 'inventory unavailable' }
    })
    const change = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    expect(change.status).toBe(500)
    await expect(change.json()).resolves.toEqual({
      error: '`openspec list --all` failed: not a valid workspace',
    })

    const inventory = await harness.request(SPECS_ROUTE, '?session=s1')
    expect(inventory.status).toBe(500)
    await expect(inventory.json()).resolves.toEqual({
      error: '`openspec list --specs` failed: inventory unavailable',
    })
  })

  it('returns an unreadable artifact cause as a 500', async () => {
    const cwd = workspace()
    const directory = join(cwd, 'openspec', 'changes', 'add-auth')
    mkdirSync(join(directory, 'proposal.md'), { recursive: true })
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [{ name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' }],
    })
    const response = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Could not read the OpenSpec artifact')
    expect(body.error).toContain('proposal.md')
  })

  it('keeps every view working when git is unavailable', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nActive.\n' })
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [{ name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' }],
    })
    const response = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { change: { commit: unknown } }
    expect(body.change.commit).toBeNull()
  })

  it('reports a missing local root on the specs route without running the CLI', async () => {
    const cwd = workspace(false)
    const harness = routeHarness(new Map([['s1', cwd]]))
    const response = await harness.request(SPECS_ROUTE, '?session=s1')
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: NO_LOCAL_ROOT_MESSAGE })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('ignores request text other than the session and the item name', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n\nActive.\n' })
    const harness = routeHarness(new Map([['s1', cwd]]))
    serveDetail(cwd, {
      rows: [{ name: 'add-auth', completedTasks: 0, totalTasks: 0, status: 'no-tasks' }],
    })
    const response = await harness.request(
      CHANGE_DETAIL_ROUTE,
      '?session=s1&name=add-auth&path=/etc/passwd&name=../evil',
    )
    expect(response.status).toBe(200)
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
  })

  it('waits for late Host services and registers the three routes when they appear', () => {
    const registered: FetchRoute[] = []
    const disposers: (() => void)[] = []
    const services: Record<string, unknown> = {
      connection: {
        fetch: {
          register(route: FetchRoute) {
            registered.push(route)
            return () => {
              const index = registered.indexOf(route)
              if (index !== -1) registered.splice(index, 1)
            }
          },
        },
      },
      agents: { get: () => undefined },
      workingDirectory: { get: () => '' },
    }
    const serviceCtx = {
      get(name: string) {
        return services[name]
      },
      effect(callback: () => () => void) {
        const dispose = callback()
        disposers.push(dispose)
        return dispose
      },
    }
    let deps: readonly string[] | undefined
    let runInjected: ((serviceCtx: unknown) => void) | undefined
    const ctx = {
      get() {
        return undefined
      },
      inject(received: readonly string[], callback: (serviceCtx: unknown) => void) {
        deps = received
        runInjected = callback
        return { dispose() {} }
      },
    }

    registerChangeRoute(ctx as never)
    expect(registered).toEqual([])
    expect(deps).toEqual(['connection', 'agents', 'workingDirectory'])
    expect(runInjected).toBeDefined()

    runInjected?.(serviceCtx)
    expect(registered.map((route) => route.path)).toEqual([
      CHANGES_ROUTE,
      CHANGE_DETAIL_ROUTE,
      SPECS_ROUTE,
    ])
    for (const route of registered) {
      expect(route).toMatchObject({ methods: ['GET'], requestBody: 'buffered' })
    }
    for (const dispose of disposers) dispose()
    expect(registered).toEqual([])
  })

  it('registers immediately and never injects when the Host services already exist', () => {
    const registered: string[] = []
    let injectCalled = false
    const services: Record<string, unknown> = {
      connection: {
        fetch: {
          register(route: FetchRoute) {
            registered.push(route.path)
            return () => {}
          },
        },
      },
      agents: { get: () => undefined },
      workingDirectory: { get: () => '' },
    }
    const ctx = {
      get(name: string) {
        return services[name]
      },
      effect(callback: () => () => void) {
        return callback()
      },
      inject() {
        injectCalled = true
      },
    }
    registerChangeRoute(ctx as never)
    expect(registered).toEqual([CHANGES_ROUTE, CHANGE_DETAIL_ROUTE, SPECS_ROUTE])
    expect(injectCalled).toBe(false)
  })

  it('registers nothing on a host without the connection fetch registry', () => {
    const registered: string[] = []
    const partial = {
      get(name: string) {
        if (name !== 'connection') return undefined
        return {
          fetch: {
            register(route: FetchRoute) {
              registered.push(route.path)
            },
          },
        }
      },
    }
    expect(() => registerChangeRoute(partial as never)).not.toThrow()
    expect(registered).toEqual([])
    expect(() => registerChangeRoute({ get: () => undefined } as never)).not.toThrow()
  })
})
