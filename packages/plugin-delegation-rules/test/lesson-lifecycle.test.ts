import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  executeReviewLesson,
  type LessonToolContext,
  lessonRevision,
  type UserQuestionItem,
  type UserQuestionsService,
} from '../src/host/learning-tools.ts'
import {
  applyLesson,
  lessonStorePath,
  proposeLesson,
  readLessons,
} from '../src/host/lesson-store.ts'
import { makeWorkspace } from './helpers.js'

const cleanups: Array<() => Promise<void>> = []

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

class FakeQuestions implements UserQuestionsService {
  calls: Array<{ questions: UserQuestionItem[] }> = []
  selected: string[] = ['Accept']
  beforeAnswer?: () => Promise<void>

  async ask(request: { questions: UserQuestionItem[] }): Promise<{
    answers: Array<{ id: string; selected: string[] }>
  }> {
    this.calls.push(request)
    if (this.beforeAnswer !== undefined) await this.beforeAnswer()
    return {
      answers: request.questions.map((question) => ({
        id: question.id,
        selected: this.selected,
      })),
    }
  }
}

function context(root: string, questions?: FakeQuestions, now = 1_000): LessonToolContext {
  return {
    workspaceRoot: root,
    now: () => new Date(now),
    ...(questions === undefined ? {} : { userQuestions: questions }),
  }
}

const PROPOSAL = {
  action: 'propose',
  class: 'path-boundary',
  title: 'Resolve a target by path components',
  body: 'When checking a target against an owned path, compare components.',
  appliesTo: { rules: ['task-review'], capabilities: ['delegation-rules'] },
  source: { change: 'add-x', taskId: '3.1', findingHashes: ['a'.repeat(16)] },
}

// Composed at runtime so the repository machine-path scan does not flag the fixture.
const WINDOWS_TARGET = ['C:', 'Users', 'owner', 'x.txt'].join('\\')

describe('review_lesson lifecycle', () => {
  it('lists, proposes, accepts, and applies a lesson through user answers', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    const proposed = await executeReviewLesson(PROPOSAL, context(root, questions))
    expect(proposed).toContain('proposed')
    expect(proposed).toContain('never injected until a user accepts')

    const listed = await executeReviewLesson({ action: 'list' }, context(root))
    expect(listed).toContain('[proposed]')
    expect(listed).toContain('Resolve a target by path components')
    const id = /lesson-[a-z0-9-]+/.exec(listed)?.[0] ?? ''
    expect(id).toMatch(/^lesson-/)

    questions.selected = ['Accept']
    const accepted = await executeReviewLesson(
      { action: 'decide', id, decision: 'accept' },
      context(root, questions),
    )
    expect(accepted).toContain('accepted')

    questions.selected = ['Apply']
    const applied = await executeReviewLesson(
      { action: 'apply', id, target: 'openspec/specs/delegation-rules/spec.md' },
      context(root, questions),
    )
    expect(applied).toContain('applied in openspec/specs/delegation-rules/spec.md')
    const listedAgain = await executeReviewLesson({ action: 'list' }, context(root))
    expect(listedAgain).toContain('[applied]')
    expect(listedAgain).toContain('applied in openspec/specs/delegation-rules/spec.md')
  })

  it('rejects a lesson on a user no and refuses invalid transitions', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Reject']
    const rejected = await executeReviewLesson(
      { action: 'decide', id, decision: 'reject' },
      context(root, questions),
    )
    expect(rejected).toContain('rejected')
    await expect(
      executeReviewLesson(
        { action: 'apply', id, target: 'openspec/specs/a/spec.md' },
        context(root, questions),
      ),
    ).rejects.toThrow(/apply requires an accepted lesson/)

    await executeReviewLesson({ ...PROPOSAL, title: 'Second lesson' }, context(root, questions))
    const second = (await readLessons(root)).lessons.find(
      (lesson) => lesson.title === 'Second lesson',
    )
    questions.selected = ['Accept']
    await executeReviewLesson(
      { action: 'decide', id: second?.id ?? '', decision: 'accept' },
      context(root, questions),
    )
    await expect(
      executeReviewLesson(
        { action: 'decide', id: second?.id ?? '', decision: 'accept' },
        context(root, questions),
      ),
    ).rejects.toThrow(/only a proposed lesson can be accepted or rejected/)
  })

  it('validates ids, classes, titles, bodies, and decisions before any effect', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await expect(
      executeReviewLesson(
        { action: 'propose', class: 'made-up', title: 'Title', body: 'Body' },
        context(root),
      ),
    ).rejects.toThrow(/fixed vocabulary/)
    await expect(
      executeReviewLesson(
        { action: 'propose', class: 'security', title: '', body: 'Body' },
        context(root),
      ),
    ).rejects.toThrow(/title must be a non-empty string/)
    await expect(
      executeReviewLesson(
        { action: 'propose', class: 'security', title: 'Title', body: '' },
        context(root),
      ),
    ).rejects.toThrow(/body must be a non-empty string/)
    await expect(
      executeReviewLesson(
        { action: 'decide', id: 'lesson-missing', decision: 'accept' },
        context(root, questions),
      ),
    ).rejects.toThrow(/was not found/)
    await expect(
      executeReviewLesson(
        { action: 'decide', id: 'lesson-0000000000000001', decision: 'maybe' },
        context(root, questions),
      ),
    ).rejects.toThrow(/decision must be "accept" or "reject"/)
    expect(questions.calls).toHaveLength(0)
    expect((await readLessons(root)).lessons).toHaveLength(0)
  })

  it('validates an apply target before asking the user', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Accept']
    await executeReviewLesson(
      { action: 'decide', id, decision: 'accept' },
      context(root, questions),
    )
    questions.calls = []

    await expect(
      executeReviewLesson(
        { action: 'apply', id, target: `See ${WINDOWS_TARGET}` },
        context(root, questions),
      ),
    ).rejects.toThrow(/machine path/)
    await expect(
      executeReviewLesson(
        { action: 'apply', id, target: 'token=example-secret-value' },
        context(root, questions),
      ),
    ).rejects.toThrow(/credential/)
    expect(questions.calls).toHaveLength(0)
    expect((await readLessons(root)).lessons[0]?.status).toBe('accepted')
  })

  it('refuses an invalid decide transition before asking the user', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Accept']
    await executeReviewLesson(
      { action: 'decide', id, decision: 'accept' },
      context(root, questions),
    )
    questions.calls = []

    await expect(
      executeReviewLesson({ action: 'decide', id, decision: 'reject' }, context(root, questions)),
    ).rejects.toThrow(/only a proposed lesson can be accepted or rejected/)
    expect(questions.calls).toHaveLength(0)
    expect((await readLessons(root)).lessons[0]?.status).toBe('accepted')
  })

  it('leaves the lesson unchanged on a cancelled or mismatched answer', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''

    questions.selected = []
    expect(
      await executeReviewLesson(
        { action: 'decide', id, decision: 'accept' },
        context(root, questions),
      ),
    ).toContain('unchanged')
    questions.selected = ['Reject']
    expect(
      await executeReviewLesson(
        { action: 'decide', id, decision: 'accept' },
        context(root, questions),
      ),
    ).toContain('did not confirm acceptance')
    expect((await readLessons(root)).lessons[0]?.status).toBe('proposed')
  })

  it('never accepts a model-supplied answer', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    await expect(
      executeReviewLesson(
        { action: 'decide', id, decision: 'accept', answer: 'yes' },
        context(root, questions),
      ),
    ).rejects.toThrow(/unknown field\(s\): answer.*user-questions service/)
    expect(questions.calls).toHaveLength(0)
    expect((await readLessons(root)).lessons[0]?.status).toBe('proposed')
  })

  it('requires a target before applying and records the time', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Accept']
    await executeReviewLesson(
      { action: 'decide', id, decision: 'accept' },
      context(root, questions, 5_000),
    )

    await expect(
      executeReviewLesson({ action: 'apply', id }, context(root, questions, 6_000)),
    ).rejects.toThrow(/target must be a non-empty string/)
    questions.selected = ['Apply']
    await executeReviewLesson(
      {
        action: 'apply',
        id,
        target: 'packages/plugin-delegation-rules/test/lesson-lifecycle.test.ts',
      },
      context(root, questions, 7_000),
    )
    const lesson = (await readLessons(root)).lessons[0]
    expect(lesson?.status).toBe('applied')
    expect(lesson?.appliedIn).toBe('packages/plugin-delegation-rules/test/lesson-lifecycle.test.ts')
    expect(lesson?.decidedAt).toBe(7_000)
  })

  it('refuses a stale answer for a proposed lesson and names the current revision', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Accept']
    questions.beforeAnswer = async () => {
      await proposeLesson(root, { ...PROPOSAL, body: 'Changed body.', now: 9_000 })
    }
    const error = await executeReviewLesson(
      { action: 'decide', id, decision: 'accept' },
      context(root, questions),
    ).catch((cause: unknown) => cause)
    expect((error as Error).message).toMatch(/changed while the question was open/)
    const current = (await readLessons(root)).lessons[0]
    if (current === undefined) throw new Error('expected the lesson to still exist')
    expect((error as Error).message).toContain(lessonRevision(current))
    expect(current.status).toBe('proposed')
  })

  it('refuses a stale apply answer when the lesson left accepted', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const id = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Accept']
    await executeReviewLesson(
      { action: 'decide', id, decision: 'accept' },
      context(root, questions, 5_000),
    )

    questions.selected = ['Apply']
    questions.beforeAnswer = async () => {
      await applyLesson(root, id, 'openspec/specs/other/spec.md', 6_000)
    }
    const error = await executeReviewLesson(
      { action: 'apply', id, target: 'openspec/specs/target/spec.md' },
      context(root, questions, 7_000),
    ).catch((cause: unknown) => cause)
    expect((error as Error).message).toMatch(/changed while the question was open/)
    expect((await readLessons(root)).lessons[0]?.appliedIn).toBe('openspec/specs/other/spec.md')
  })

  it('creates a proposed revision for a duplicate of an accepted lesson without changing it', async () => {
    const root = await workspace()
    const questions = new FakeQuestions()
    await executeReviewLesson(PROPOSAL, context(root, questions))
    const acceptedId = (await readLessons(root)).lessons[0]?.id ?? ''
    questions.selected = ['Accept']
    await executeReviewLesson(
      { action: 'decide', id: acceptedId, decision: 'accept' },
      context(root, questions),
    )
    const acceptedBefore = (await readLessons(root)).lessons[0]

    const revisionText = await executeReviewLesson(
      { ...PROPOSAL, body: 'A different body for the same class and title.' },
      context(root, questions, 2_000),
    )
    expect(revisionText).toContain('proposed')
    const { lessons } = await readLessons(root)
    expect(lessons).toHaveLength(2)
    const accepted = lessons.find((lesson) => lesson.id === acceptedId)
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.body).toBe(acceptedBefore?.body)
    const revision = lessons.find((lesson) => lesson.status === 'proposed')
    expect(revision?.supersedes).toBe(acceptedId)
    expect(revision?.body).toBe('A different body for the same class and title.')
    expect(await readFile(lessonStorePath(root), 'utf8')).toContain(acceptedId)
  })
})
