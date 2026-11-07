import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLesson,
  decideLesson,
  LessonStoreError,
  lessonStorePath,
  proposeLesson,
  readLessons,
} from '../src/host/lesson-store.ts'
import { makeWorkspace } from './helpers.js'

const run = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []
// Composed at runtime so the repository machine-path scan does not flag the fixture.
const WINDOWS_SECRET = ['C:', 'Users', 'owner', 'secret.ts'].join('\\')

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    class: 'path-boundary',
    title: 'Resolve a target by path components',
    body: 'When checking a target against an owned path, compare components.',
    appliesTo: { rules: ['task-review'], capabilities: ['delegation-rules'] },
    source: { change: 'add-x', taskId: '3.1', findingHashes: ['a'.repeat(16)] },
    now: 1_000,
    ...overrides,
  }
}

describe('lesson store', () => {
  it('round-trips a proposed lesson and counts a malformed line', async () => {
    const root = await workspace()
    const created = await proposeLesson(root, proposal())
    expect(created.kind).toBe('created')
    expect(created.lesson.id).toMatch(/^lesson-/)
    const read = await readLessons(root)
    expect(read.skipped).toBe(0)
    expect(read.lessons).toHaveLength(1)
    expect(read.lessons[0]).toMatchObject({
      class: 'path-boundary',
      title: 'Resolve a target by path components',
      status: 'proposed',
      appliesTo: { rules: ['task-review'], capabilities: ['delegation-rules'] },
      source: { change: 'add-x', taskId: '3.1' },
    })
    expect(read.lessons[0]?.body).toContain('compare components')
    expect(read.lessons[0]?.createdAt).toBe(1_000)

    await writeFile(lessonStorePath(root), `${JSON.stringify(read.lessons[0])}\nnot json\n`, 'utf8')
    const again = await readLessons(root)
    expect(again.skipped).toBe(1)
    expect(again.lessons).toHaveLength(1)
  })

  it('reads a missing store as empty', async () => {
    const root = await workspace()
    expect(await readLessons(root)).toEqual({ lessons: [], skipped: 0 })
  })

  it('updates one proposed record for a duplicate normalized class and title', async () => {
    const root = await workspace()
    await proposeLesson(root, proposal())
    const duplicate = await proposeLesson(
      root,
      proposal({
        title: '  resolve a TARGET by path components! ',
        body: 'Updated body.',
        now: 2_000,
      }),
    )
    expect(duplicate.kind).toBe('updated')
    const { lessons } = await readLessons(root)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.body).toBe('Updated body.')
    expect(lessons[0]?.createdAt).toBe(2_000)
  })

  it('evicts the oldest non-applied lesson at the count cap', async () => {
    const root = await workspace()
    await proposeLesson(root, proposal({ title: 'Oldest', now: 1 }))
    await proposeLesson(root, proposal({ title: 'Middle', now: 2 }))
    const created = await proposeLesson(root, proposal({ title: 'Newest', now: 3, maxLessons: 2 }))
    expect(created.kind).toBe('created')
    const { lessons } = await readLessons(root)
    expect(lessons.map((lesson) => lesson.title).sort()).toEqual(['Middle', 'Newest'])
  })

  it('keeps the updated proposed record when a cap forces eviction', async () => {
    const root = await workspace()
    await proposeLesson(root, proposal({ title: 'Evicted', now: 1 }))
    const kept = await proposeLesson(root, proposal({ title: 'Kept', now: 2 }))
    const updated = await proposeLesson(
      root,
      proposal({ title: 'Kept', body: 'Updated kept body.', now: 3, maxLessons: 1 }),
    )
    expect(updated.kind).toBe('updated')
    const { lessons } = await readLessons(root)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.id).toBe(kept.lesson.id)
    expect(lessons[0]?.body).toBe('Updated kept body.')
  })

  it('lets a queued write proceed after an earlier write failed', async () => {
    const root = await workspace()
    const first = await proposeLesson(root, proposal({ title: 'Applied one', now: 1 }))
    await decideLesson(root, first.lesson.id, 'accepted', 2)
    await applyLesson(root, first.lesson.id, 'openspec/specs/a/spec.md', 3)
    const second = await proposeLesson(root, proposal({ title: 'Applied two', now: 4 }))
    await decideLesson(root, second.lesson.id, 'accepted', 5)
    await applyLesson(root, second.lesson.id, 'openspec/specs/b/spec.md', 6)

    const failing = proposeLesson(root, proposal({ title: 'Blocked', now: 7, maxLessons: 1 }))
    const queued = proposeLesson(root, proposal({ title: 'Queued', now: 8, maxLessons: 5 }))
    await expect(failing).rejects.toThrow(/capacity/)
    await expect(queued).resolves.toMatchObject({ kind: 'created' })
    expect((await readLessons(root)).lessons.map((lesson) => lesson.title)).toContain('Queued')
  })

  it('retains both lessons written by independent module instances', async () => {
    const root = await workspace()
    vi.resetModules()
    const firstWriter = await import('../src/host/lesson-store.ts')
    vi.resetModules()
    const secondWriter = await import('../src/host/lesson-store.ts')
    await Promise.all([
      firstWriter.proposeLesson(root, proposal({ title: 'First writer', now: 1 })),
      secondWriter.proposeLesson(root, proposal({ title: 'Second writer', now: 2 })),
    ])
    const { lessons } = await firstWriter.readLessons(root)
    expect(lessons.map((lesson) => lesson.title).sort()).toEqual(['First writer', 'Second writer'])
  })

  it('fails with the lock path when another writer holds the lock', async () => {
    const root = await workspace()
    const path = lessonStorePath(root)
    await mkdir(dirname(path), { recursive: true })
    const lock = `${path}.lock`
    await mkdir(lock)
    await expect(proposeLesson(root, proposal())).rejects.toThrow(
      /lesson store is locked by another writer .*\.lock.*remove that lock/,
    )
    await rm(lock, { recursive: true, force: true })
    const created = await proposeLesson(root, proposal())
    expect(created.kind).toBe('created')
    expect((await readLessons(root)).lessons).toHaveLength(1)
  })

  it('refuses an applied-only full store with capacity and leaves it unchanged', async () => {
    const root = await workspace()
    const first = await proposeLesson(root, proposal({ title: 'Applied one', now: 1 }))
    await decideLesson(root, first.lesson.id, 'accepted', 2)
    await applyLesson(root, first.lesson.id, 'openspec/specs/a/spec.md', 3)
    const second = await proposeLesson(root, proposal({ title: 'Applied two', now: 4 }))
    await decideLesson(root, second.lesson.id, 'accepted', 5)
    await applyLesson(root, second.lesson.id, 'openspec/specs/b/spec.md', 6)
    const before = await readLessons(root)

    const error = await proposeLesson(
      root,
      proposal({ title: 'Refused', now: 7, maxLessons: 2 }),
    ).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(LessonStoreError)
    expect((error as LessonStoreError).code).toBe('capacity')
    expect((error as Error).message).toMatch(/capacity/)
    expect(await readLessons(root)).toEqual(before)
  })

  it('truncates an oversized body to the store bound', async () => {
    const root = await workspace()
    const created = await proposeLesson(root, proposal({ body: 'x'.repeat(4_096) }))
    expect(created.lesson.body.length).toBeLessThanOrEqual(2_000)
    expect(created.lesson.body.endsWith('…')).toBe(true)
    const { lessons } = await readLessons(root)
    expect(lessons[0]?.body.length).toBeLessThanOrEqual(2_000)
  })

  it('refuses to store a machine path or a credential', async () => {
    const root = await workspace()
    await expect(
      proposeLesson(root, proposal({ body: `See ${WINDOWS_SECRET} for the fix.` })),
    ).rejects.toThrow(/machine path/)
    await expect(
      proposeLesson(root, proposal({ body: `Use sk-${'ABCDEFGH12345678'} for auth.` })),
    ).rejects.toThrow(/credential/)
    expect((await readLessons(root)).lessons).toHaveLength(0)
  })

  it('writes only untracked local scratch under .dsh', async () => {
    const root = await workspace()
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, '.gitignore'), '.dsh/\n', 'utf8')
    await run('git', ['init'], { cwd: root })
    await proposeLesson(root, proposal())
    const path = lessonStorePath(root)
    expect(basename(path)).toMatch(/^[0-9a-f]{16}\.jsonl$/)
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd: root })
    expect(stdout).not.toContain('.dsh')
  })
})

describe('lesson store file', () => {
  it('keeps the workspace root out of the file', async () => {
    const root = await workspace()
    await proposeLesson(root, proposal())
    const raw = await readFile(lessonStorePath(root), 'utf8')
    expect(raw).not.toContain(root)
  })
})
