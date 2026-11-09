import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLesson,
  decideLesson,
  LessonStoreError,
  lessonRevision,
  lessonStorePath,
  proposeLesson,
  readLessons,
} from '../src/host/lesson-store.ts'
import { makeWorkspace } from './helpers.js'

const run = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []
// Composed at runtime so the repository machine-path scan does not flag the fixture.
const WINDOWS_SECRET = ['C:', 'Users', 'owner', 'secret.ts'].join('\\')
const POSIX_PATH = ['', 'home', 'owner', 'private.txt'].join('/')
const TILDE_PATH = ['~', '.config', 'private.txt'].join('/')

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

/** A store just under the 1 MB cap: 199 applied lessons plus one last record. */
async function writeNearCapStore(
  root: string,
  lastStatus: 'proposed' | 'accepted',
): Promise<{ id: string; raw: string }> {
  const path = lessonStorePath(root)
  await mkdir(dirname(path), { recursive: true })
  const filler = Array.from({ length: 199 }, (_, index) => ({
    v: 1,
    id: `lesson-${String(index).padStart(4, '0')}`,
    class: 'other',
    title: `Filler ${index}`,
    body: 'x'.repeat(4_000),
    appliesTo: { rules: [], capabilities: [] },
    status: 'applied',
    source: {},
    createdAt: index,
    decidedAt: index,
    appliedIn: 'openspec/specs/filler/spec.md',
  }))
  const last = {
    v: 1,
    id: 'lesson-9999',
    class: 'other',
    title: 'Last lesson',
    body: '',
    appliesTo: { rules: [], capabilities: [] },
    status: lastStatus,
    source: {},
    createdAt: 1_000,
    ...(lastStatus === 'accepted' ? { decidedAt: 1_000 } : {}),
  }
  const base = [...filler, last]
  const target = 999_990
  const padding = Math.max(
    target - Buffer.byteLength(`${base.map((r) => JSON.stringify(r)).join('\n')}\n`),
    0,
  )
  const records = base.map((record, index) =>
    index === base.length - 1 ? { ...record, body: 'x'.repeat(padding) } : record,
  )
  const raw = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  expect(Buffer.byteLength(raw)).toBeGreaterThan(990_000)
  expect(Buffer.byteLength(raw)).toBeLessThan(1_000_000)
  await writeFile(path, raw, 'utf8')
  return { id: 'lesson-9999', raw }
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

  it('evicts down to the byte cap when the count cap allows the write', async () => {
    const root = await workspace()
    const path = lessonStorePath(root)
    await mkdir(dirname(path), { recursive: true })
    const lines = Array.from({ length: 520 }, (_, index) =>
      JSON.stringify({
        v: 1,
        id: `lesson-${String(index).padStart(4, '0')}`,
        class: 'other',
        title: `Filler ${index}`,
        body: 'x'.repeat(1_900),
        appliesTo: { rules: [], capabilities: [] },
        status: 'proposed',
        source: {},
        createdAt: index,
      }),
    )
    await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
    expect((await readFile(path, 'utf8')).length).toBeGreaterThan(1_000_000)

    const created = await proposeLesson(
      root,
      proposal({ title: 'After byte cap', maxLessons: 1_000 }),
    )
    expect(created.kind).toBe('created')
    const { lessons } = await readLessons(root)
    expect(lessons.length).toBeLessThan(520)
    expect(lessons.map((lesson) => lesson.title)).toContain('After byte cap')
  })

  it('keeps a machine path out of every stored field', async () => {
    const root = await workspace()
    await expect(proposeLesson(root, proposal({ title: `See ${WINDOWS_SECRET}` }))).rejects.toThrow(
      /machine path/,
    )
    await expect(
      proposeLesson(root, proposal({ source: { change: WINDOWS_SECRET } })),
    ).rejects.toThrow(/machine path/)
    expect((await readLessons(root)).lessons).toHaveLength(0)
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

  it('refuses to store credentials and assignment-delimited machine paths', async () => {
    const root = await workspace()
    await expect(
      proposeLesson(root, proposal({ body: `See ${WINDOWS_SECRET} for the fix.` })),
    ).rejects.toThrow(/machine path/)
    await expect(
      proposeLesson(root, proposal({ body: `log=${POSIX_PATH} and path=${TILDE_PATH}` })),
    ).rejects.toThrow(/machine path/)
    await expect(
      proposeLesson(root, proposal({ body: '{"password":"example-secret-value"}' })),
    ).rejects.toThrow(/credential/)
    await expect(
      proposeLesson(root, proposal({ body: 'Authorization: Bearer example-access-token' })),
    ).rejects.toThrow(/credential/)
    const openingMarker = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ')
    await expect(
      proposeLesson(root, proposal({ body: `${openingMarker}\nkey material without a footer` })),
    ).rejects.toThrow(/credential/)
    expect((await readLessons(root)).lessons).toHaveLength(0)
  })

  it('fails closed when git cannot verify the workspace', async () => {
    const root = await workspace()
    const originalPath = process.env.PATH
    process.env.PATH = ''
    try {
      await expect(proposeLesson(root, proposal())).rejects.toThrow(/git is unavailable/)
    } finally {
      process.env.PATH = originalPath
    }
    expect(await readLessons(root)).toEqual({ lessons: [], skipped: 0 })
  })

  it('refuses to create the store in a git repository that does not ignore .dsh', async () => {
    const root = await workspace()
    await run('git', ['init'], { cwd: root })
    await expect(proposeLesson(root, proposal())).rejects.toThrow(/not git-ignored/)
    expect(await readLessons(root)).toEqual({ lessons: [], skipped: 0 })
  })

  it('refuses a decision whose expected revision changed inside the lock', async () => {
    const root = await workspace()
    const created = await proposeLesson(root, proposal({ now: 1 }))
    const staleRevision = lessonRevision(created.lesson)
    await proposeLesson(root, proposal({ body: 'Updated body.', now: 2 }))
    await expect(
      decideLesson(root, created.lesson.id, 'accepted', 3, { expectedRevision: staleRevision }),
    ).rejects.toThrow(/changed while the question was open/)
    const lesson = (await readLessons(root)).lessons[0]
    expect(lesson?.status).toBe('proposed')
    expect(lesson?.body).toBe('Updated body.')
  })

  it('updates the existing proposed revision on repeated proposals after acceptance', async () => {
    const root = await workspace()
    const accepted = await proposeLesson(root, proposal())
    await decideLesson(root, accepted.lesson.id, 'accepted', 2)
    const revision = await proposeLesson(root, proposal({ body: 'Revision one.', now: 3 }))
    expect(revision.kind).toBe('revision')
    const repeated = await proposeLesson(root, proposal({ body: 'Revision two.', now: 4 }))
    expect(repeated.kind).toBe('updated')
    const { lessons } = await readLessons(root)
    expect(lessons.filter((lesson) => lesson.status === 'proposed')).toHaveLength(1)
    expect(lessons.find((lesson) => lesson.id === revision.lesson.id)?.body).toBe('Revision two.')
    expect(lessons.find((lesson) => lesson.id === accepted.lesson.id)?.status).toBe('accepted')
  })

  it('refuses a decision that would exceed the byte cap and leaves the store unchanged', async () => {
    const root = await workspace()
    const { id, raw } = await writeNearCapStore(root, 'proposed')
    await expect(decideLesson(root, id, 'accepted', 5_000)).rejects.toThrow(/capacity/)
    expect(await readFile(lessonStorePath(root), 'utf8')).toBe(raw)
    expect((await readLessons(root)).lessons.find((lesson) => lesson.id === id)?.status).toBe(
      'proposed',
    )
  })

  it('refuses an application that would exceed the byte cap and leaves the store unchanged', async () => {
    const root = await workspace()
    const { id, raw } = await writeNearCapStore(root, 'accepted')
    await expect(applyLesson(root, id, 'openspec/specs/a/spec.md', 6_000)).rejects.toThrow(
      /capacity/,
    )
    expect(await readFile(lessonStorePath(root), 'utf8')).toBe(raw)
    expect((await readLessons(root)).lessons.find((lesson) => lesson.id === id)?.status).toBe(
      'accepted',
    )
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
