import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FS_CHANGE_DEBOUNCE_MS,
  type FsChangeEvent,
  type FsChangeWatcher,
  fileEntry,
  isInside,
  startFsChangeWatcher,
} from '../src/host/fs-change.ts'

interface FakeFs {
  readonly service: {
    resolve(path: string): Promise<{ targetKey: string }>
    watch(
      target: { targetKey: string },
      changed: (error?: Error) => void,
      signal: AbortSignal,
    ): Promise<() => Promise<void>>
  }
  readonly watches: Map<string, (error?: Error) => void>
  readonly closed: string[]
  failNextAttach(): void
  fire(error?: Error): void
  firePath(suffix: string, error?: Error): void
}

function fakeFs(options: { attachHook?: (target: string) => void } = {}): FakeFs {
  const watches = new Map<string, (error?: Error) => void>()
  const closed: string[] = []
  let fail = false
  return {
    service: {
      resolve: async (path: string) => ({ targetKey: path }),
      async watch(target, changed) {
        if (fail) {
          fail = false
          throw new Error('watch failed')
        }
        watches.set(target.targetKey, changed)
        options.attachHook?.(target.targetKey)
        return async () => {
          closed.push(target.targetKey)
        }
      },
    },
    watches,
    closed,
    failNextAttach: () => {
      fail = true
    },
    fire: (error?: Error) => {
      for (const changed of watches.values()) changed(error)
    },
    firePath: (suffix: string, error?: Error) => {
      for (const [target, changed] of watches) {
        if (target.endsWith(suffix)) changed(error)
      }
    },
  }
}

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-fs-'))
  TEMP_DIRECTORIES.push(directory)
  await mkdir(join(directory, 'openspec', 'changes', 'add-one'), { recursive: true })
  await writeFile(
    join(directory, 'openspec', 'changes', 'add-one', 'tasks.md'),
    '- [ ] 1.1\n',
    'utf8',
  )
  return directory
}

async function waitFor(check: () => boolean): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 3000) throw new Error('the watcher did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

describe('openspec change watcher', () => {
  it('uses a 250 ms debounce window', () => {
    expect(FS_CHANGE_DEBOUNCE_MS).toBe(250)
  })

  it('reports a real file create, modify, and delete after the baseline', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    const watcher = await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 5,
    })
    await watcher.start()
    expect(events).toEqual([])

    await mkdir(join(workspace, 'openspec', 'changes', 'add-two'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-two', 'tasks.md'),
      '- [ ] 2.1\n',
      'utf8',
    )
    fs.fire()
    await waitFor(() => events.some((event) => event.path.endsWith('add-two/tasks.md')))
    expect(events.find((event) => event.path.endsWith('add-two/tasks.md'))?.change).toBe('created')
    expect(events.find((event) => event.path.endsWith('add-two/tasks.md'))?.hash).toMatch(
      /^[a-f0-9]{16}$/u,
    )

    events.length = 0
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-one', 'tasks.md'),
      '- [x] 1.1\n',
      'utf8',
    )
    fs.fire()
    await waitFor(() => events.some((event) => event.change === 'modified'))
    expect(events.find((event) => event.change === 'modified')?.path).toBe(
      'openspec/changes/add-one/tasks.md',
    )

    events.length = 0
    await rm(join(workspace, 'openspec', 'changes', 'add-two', 'tasks.md'))
    fs.fire()
    await waitFor(() => events.some((event) => event.change === 'deleted'))
    expect(events.find((event) => event.change === 'deleted')?.path).toBe(
      'openspec/changes/add-two/tasks.md',
    )
    await watcher.dispose()
  })

  it('rescans after a watcher error so a missed create is visible', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    const errors: Error[] = []
    const rescans: string[] = []
    const watcher = await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: (error) => errors.push(error),
      onRescan: (reason) => rescans.push(reason),
      debounceMs: 5,
    })
    await mkdir(join(workspace, 'openspec', 'changes', 'add-three'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-three', 'proposal.md'),
      '# three\n',
      'utf8',
    )
    fs.fire(new Error('watcher dropped an event'))
    await waitFor(() => events.some((event) => event.path.endsWith('add-three/proposal.md')))
    expect(errors[0]?.message).toBe('watcher dropped an event')
    expect(rescans[0]).toContain('watcher dropped an event')
    await watcher.dispose()
  })

  it('observes review JSON files inside a change', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    await mkdir(join(workspace, 'openspec', 'changes', 'add-one', 'reviews'), { recursive: true })
    const watcher = await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 5,
    })
    await watcher.start()
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-one', 'reviews', 'task-a.json'),
      '{"verdict":"PASS"}\n',
      'utf8',
    )
    fs.fire()
    await waitFor(() => events.some((event) => event.path.endsWith('reviews/task-a.json')))
    expect(events.find((event) => event.path.endsWith('reviews/task-a.json'))?.change).toBe(
      'created',
    )
    events.length = 0
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-one', 'reviews', 'task-a.json'),
      '{"verdict":"ERROR"}\n',
      'utf8',
    )
    fs.fire()
    await waitFor(() => events.some((event) => event.change === 'modified'))
    events.length = 0
    await rm(join(workspace, 'openspec', 'changes', 'add-one', 'reviews', 'task-a.json'))
    fs.fire()
    await waitFor(() => events.some((event) => event.change === 'deleted'))
    await watcher.dispose()
  })

  it('rescans after the initial watches attach so an edit during initialization is seen', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs({
      attachHook: async (target) => {
        if (target.includes('add-one')) {
          await writeFile(
            join(workspace, 'openspec', 'changes', 'add-one', 'tasks.md'),
            '- [x] 1.1\n',
            'utf8',
          )
        }
      },
    })
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 5,
    })
    await waitFor(() => events.some((event) => event.change === 'modified'))
    expect(events.find((event) => event.change === 'modified')?.path).toBe(
      'openspec/changes/add-one/tasks.md',
    )
  })

  it("does not let a busy directory postpone another directory's event", async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, 'openspec', 'changes', 'add-two'), { recursive: true })
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 100,
    })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-two', 'tasks.md'),
      '- [ ] 2.1\n',
      'utf8',
    )
    fs.firePath(join('openspec', 'changes', 'add-two'))
    const busy = setInterval(() => {
      fs.firePath(join('openspec', 'changes'))
    }, 20)
    try {
      await waitFor(() => events.some((event) => event.path.includes('add-two/tasks.md')))
    } finally {
      clearInterval(busy)
    }
  })

  it('refuses a reviews link that escapes the workspace', async () => {
    const workspace = await tempWorkspace()
    const external = await tempWorkspace()
    await mkdir(join(workspace, 'openspec', 'changes', 'add-linked'), { recursive: true })
    await writeFile(join(external, 'external.json'), '{}\n', 'utf8')
    let linked = false
    try {
      await symlink(
        join(external),
        join(workspace, 'openspec', 'changes', 'add-linked', 'reviews'),
        'junction',
      )
      linked = true
    } catch {
      // A host without link permission still exercises the containment rule.
    }
    expect(isInside(workspace, join(external, 'external.json'))).toBe(false)
    expect(isInside(workspace, join(workspace, 'openspec', 'changes', 'add-one', 'tasks.md'))).toBe(
      true,
    )
    if (!linked) return
    const errors: Error[] = []
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fakeFs().service,
      onChange: (event) => events.push(event),
      onError: (error) => errors.push(error),
      debounceMs: 5,
    })
    expect(errors.some((error) => error.message.includes('outside the workspace'))).toBe(true)
    expect(events.some((event) => event.path.includes('external.json'))).toBe(false)
  })

  it('defers a change until its own directory window and coalesces repeat writes', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, 'openspec', 'changes', 'add-two'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-two', 'tasks.md'),
      '- [ ] 2.1\n',
      'utf8',
    )
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 250,
    })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-one', 'tasks.md'),
      '- [x] 1.1\n',
      'utf8',
    )
    fs.firePath('add-one')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-two', 'tasks.md'),
      '- [x] 2.1\n',
      'utf8',
    )
    fs.firePath('add-two')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(events.some((event) => event.path.includes('add-two/tasks.md'))).toBe(false)
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-two', 'tasks.md'),
      '- [x] 2.2\n',
      'utf8',
    )
    fs.firePath('add-two')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const addTwo = events.filter((event) => event.path.includes('add-two/tasks.md'))
    expect(addTwo).toHaveLength(1)
  })

  it('rescans after a newly discovered directory attaches', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs({
      attachHook: async (target) => {
        if (target.includes('add-late')) {
          await writeFile(
            join(workspace, 'openspec', 'changes', 'add-late', 'tasks.md'),
            '- [ ] 9.1\n',
            'utf8',
          )
        }
      },
    })
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 5,
    })
    await mkdir(join(workspace, 'openspec', 'changes', 'add-late'), { recursive: true })
    fs.firePath('changes')
    await waitFor(() => events.some((event) => event.path.includes('add-late/tasks.md')))
  })

  it('scans a workspace opened through a junction', async () => {
    const external = await tempWorkspace()
    const holder = await tempWorkspace()
    const linked = join(holder, 'linked')
    try {
      await symlink(external, linked, 'junction')
    } catch {
      return
    }
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace: linked,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 5,
    })
    await writeFile(
      join(external, 'openspec', 'changes', 'add-one', 'tasks.md'),
      '- [x] 1.1\n',
      'utf8',
    )
    fs.fire()
    await waitFor(() => events.some((event) => event.change === 'modified'))
    expect(events.some((event) => event.path === 'openspec/changes/add-one/tasks.md')).toBe(true)
  })

  it('defers a discovered directory until its own window and coalesces repeat writes', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 250,
    })
    const started = Date.now()
    await mkdir(join(workspace, 'openspec', 'changes', 'add-late'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-late', 'tasks.md'),
      '- [ ] 9.1\n',
      'utf8',
    )
    fs.firePath('changes')
    await new Promise((resolve) => setTimeout(resolve, 100))
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-late', 'tasks.md'),
      '- [x] 9.1\n',
      'utf8',
    )
    await waitFor(() => events.some((event) => event.path.includes('add-late/tasks.md')))
    expect(Date.now() - started).toBeGreaterThanOrEqual(200)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const late = events.filter((event) => event.path.includes('add-late/tasks.md'))
    expect(late).toHaveLength(1)
    expect(late[0]?.change).toBe('created')
  })

  it('emits a review event on its own window while the parent keeps notifying', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 250,
    })
    await mkdir(join(workspace, 'openspec', 'changes', 'add-one', 'reviews'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-one', 'reviews', '2.5.json'),
      '{"verdict":"PASS"}\n',
      'utf8',
    )
    fs.firePath('add-one')
    const busy = setInterval(() => fs.firePath('add-one'), 50)
    try {
      await waitFor(() => events.some((event) => event.path.endsWith('reviews/2.5.json')))
    } finally {
      clearInterval(busy)
    }
  })

  it('closes every watched directory on dispose and stops emitting', async () => {
    const workspace = await tempWorkspace()
    const fs = fakeFs()
    const events: FsChangeEvent[] = []
    const watcher: FsChangeWatcher = await startFsChangeWatcher({
      workspace,
      fs: fs.service,
      onChange: (event) => events.push(event),
      onError: vi.fn(),
      debounceMs: 5,
    })
    expect(fs.watches.size).toBeGreaterThan(0)
    await watcher.dispose()
    expect(fs.closed).toHaveLength(fs.watches.size)
    await writeFile(
      join(workspace, 'openspec', 'changes', 'add-one', 'tasks.md'),
      '- [x] 1.1\n',
      'utf8',
    )
    fs.fire()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(events).toEqual([])
  })
})

it('gives two oversized revisions distinct hashes', async () => {
  const workspace = await tempWorkspace()
  const file = join(workspace, 'big.md')
  await writeFile(file, 'a'.repeat(300 * 1024), 'utf8')
  const first = await fileEntry(file)
  await writeFile(file, 'b'.repeat(320 * 1024), 'utf8')
  const second = await fileEntry(file)
  expect(first?.hash).toMatch(/^[a-f0-9]{16}$/u)
  expect(second?.hash).toMatch(/^[a-f0-9]{16}$/u)
  expect(second?.hash).not.toBe(first?.hash)
})
