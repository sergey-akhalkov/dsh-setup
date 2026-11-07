import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FS_CHANGE_DEBOUNCE_MS,
  type FsChangeEvent,
  type FsChangeWatcher,
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
}

function fakeFs(): FakeFs {
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
