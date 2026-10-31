import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_BLOCK_REVIEW_CONFIG } from '../lib/index.js'
import {
  BlockReviewHarness,
  decisionCode,
  MUTATION_TOOLS,
  noticeText,
  REVIEWER_TOOLS,
  reviewConfig,
  validBlocker,
  validNotBlocker,
} from './block-review-harness.js'

/**
 * The block-review gate is exercised with a real Cordis context, a fake goal
 * service, and a fake subagent provider that publishes a reviewer child through
 * the real `agent/created` dispatch. No test needs a live Harness.
 */

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function create(
  options: Parameters<typeof BlockReviewHarness.create>[0] = {},
  blockReview: Parameters<typeof reviewConfig>[0] = {},
  goal: Parameters<typeof BlockReviewHarness.create>[2] = {},
): Promise<BlockReviewHarness> {
  const created = await BlockReviewHarness.create(options, reviewConfig(blockReview), goal)
  cleanup = created.cleanup
  return created.harness
}

/** Start a new direct-human turn with one user message. */
function humanTurn(harness: BlockReviewHarness, text = 'keep going'): void {
  harness.turnStart()
  harness.directMessage(text)
}

/** Start a new goal round with the exact goal-round message. */
function roundTurn(harness: BlockReviewHarness, round: number): void {
  harness.turnStart()
  const goal = harness.goal
  if (goal === undefined) throw new Error('test goal missing')
  goal.roundsStarted = round
  harness.goalRound(goal, round)
}

async function recordsFor(harness: BlockReviewHarness, goalId = 'goal-1'): Promise<string[]> {
  try {
    return (
      await readdir(join(harness.workspace, '.dsh', 'goal-continuity', 'block-review', goalId))
    )
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}

describe('block review skip conditions', () => {
  it('does not review a non-block goal action', async () => {
    const harness = await create()
    humanTurn(harness)
    const { decision, next } = await harness.block({ action: 'complete' })
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
    expect(await recordsFor(harness)).toHaveLength(0)
  })

  it('does not review a subagent call', async () => {
    const harness = await create()
    const subagent = {
      id: 'subagent-1',
      session: {
        id: 'subagent-1',
        header: {
          version: 1,
          id: 'subagent-1',
          createdAt: Date.now(),
          isSeeded: false,
          origin: 'subagent',
        },
        snapshotEvents: () => [],
      },
    } as unknown as Agent
    humanTurn(harness)
    const { decision, next } = await harness.block({}, subagent)
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
  })

  it('does not review without an active goal or with a stale reference', async () => {
    const harness = await create()
    humanTurn(harness)
    harness.goal = undefined
    expect((await harness.block()).decision).toEqual({ kind: 'allow' })
    expect(harness.startCalls).toHaveLength(0)

    harness.setGoal({ roundsStarted: 0 })
    humanTurn(harness)
    expect((await harness.block({ goal_id: 'other-goal' })).decision).toEqual({ kind: 'allow' })
    expect((await harness.block({ revision: 99 })).decision).toEqual({ kind: 'allow' })
    expect(harness.startCalls).toHaveLength(0)
  })

  it('does not review an explicit user block request', async () => {
    const harness = await create()
    humanTurn(harness, 'Please mark it blocked and stop.')
    const { decision, next } = await harness.block()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
  })

  it('reviews a negated block instruction instead of bypassing the gate', async () => {
    const harness = await create()
    humanTurn(harness, 'Do not mark the goal blocked; continue working.')
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('reviews a conditional block instruction', async () => {
    const harness = await create()
    humanTurn(harness, 'If you cannot find another route, mark the goal blocked.')
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('does not treat a quoted block phrase as an explicit request', async () => {
    const harness = await create()
    humanTurn(harness, 'The note said "mark the goal blocked", but keep working.')
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('leaves a premature goal-round call to the goal tool and charges no budget', async () => {
    const harness = await create()
    roundTurn(harness, 1)
    const { decision, next } = await harness.block()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
    expect(await recordsFor(harness)).toHaveLength(0)

    roundTurn(harness, 3)
    await harness.block()
    expect(harness.startCalls).toHaveLength(1)
    expect(await recordsFor(harness)).toHaveLength(1)
  })

  it('reviews at a non-default rounded threshold', async () => {
    const harness = await create({}, { blockedAfterConsecutiveRounds: 5 })
    roundTurn(harness, 4)
    expect((await harness.block()).decision).toEqual({ kind: 'allow' })
    expect(harness.startCalls).toHaveLength(0)

    roundTurn(harness, 5)
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('reviews a direct-human continue turn below the threshold', async () => {
    const harness = await create()
    roundTurn(harness, 1)
    humanTurn(harness, 'keep going')
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('does not review when blockReview is disabled', async () => {
    const harness = await create({}, { enabled: false })
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
  })

  it('keeps the deterministic supervisor free of subagent starts', async () => {
    const harness = await create()
    harness.setGoal()
    harness.ctx.emit('agent/created', { agent: harness.agent, source: 'startup' })
    harness.ctx.emit('session/event', harness.session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as never)
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.startCalls).toHaveLength(0)
  })
})

describe('inspected incident replays', () => {
  it('denies the sibling-repository approval block with the edit as the next action', async () => {
    const harness = await create({
      respond: () => validNotBlocker('add the missing method in the sibling automation repository'),
    })
    roundTurn(harness, 3)
    const { decision, next } = await harness.block({
      blocked_reason:
        'the sibling automation repository needs a missing method; only the user can approve that edit',
    })
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(JSON.stringify(decision)).toContain('add the missing method in the sibling automation')
    expect(harness.goal?.phase).toBe('active')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('denies the HMI testability block with the test-only route', async () => {
    const harness = await create({
      respond: () => validNotBlocker('add a test-only HMI activation flag'),
    })
    roundTurn(harness, 3)
    const { decision, next } = await harness.block({
      blocked_reason: 'the HMI is not testable; the user must approve a test-only activation hook',
    })
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(JSON.stringify(decision)).toContain('test-only HMI activation flag')
  })

  it('allows a genuine restart block with the exact user action', async () => {
    const harness = await create({
      respond: () => validBlocker('restart the DeepSeek Harness app'),
    })
    roundTurn(harness, 3)
    const { decision } = await harness.block({
      blocked_reason: 'the app must be restarted to load the new Host composition',
    })
    expect(decision).toEqual({ kind: 'allow' })
    expect(noticeText(harness)).toContain('restart the DeepSeek Harness app')
  })
})

describe('block review verdict mapping', () => {
  it('denies a not-blocker verdict with the reviewer next action and the code', async () => {
    const harness = await create({ respond: () => validNotBlocker('edit the sibling repository') })
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(next).not.toHaveBeenCalled()
    expect(decision).toMatchObject({
      kind: 'deny',
      info: { name: 'goal-block-review', code: 'GOAL_BLOCK_REVIEW_REJECTED' },
    })
    expect(JSON.stringify(decision)).toContain('edit the sibling repository')
    expect(harness.goal?.phase).toBe('active')
    expect(harness.injected).toHaveLength(0)
  })

  it('allows a blocker verdict and names the exact user action in a notice', async () => {
    const harness = await create({
      respond: () => validBlocker('restart the DeepSeek Harness app'),
    })
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(noticeText(harness)).toContain('restart the DeepSeek Harness app')
    const [record] = await recordsFor(harness)
    expect(record).toBeDefined()
    const parsed = (await harness.readRecord(
      'goal-1',
      (record as string).replace('.json', ''),
    )) as {
      verdict?: string
      verified?: boolean
      reviewed?: boolean
      userAction?: string
      target?: { provider?: string; preset?: string }
      time?: string
      session?: string
    }
    expect(parsed.verdict).toBe('blocker')
    expect(parsed.verified).toBe(true)
    expect(parsed.reviewed).toBe(true)
    expect(parsed.userAction).toBe('restart the DeepSeek Harness app')
    expect(parsed.target).toMatchObject({ provider: 'spawn', preset: 'goal-reviewer' })
    expect(parsed.time).toMatch(/T/u)
    expect(parsed.session).toBe('root-agent')
  })

  it.each([
    ['prose only', 'I think this is a blocker.'],
    [
      'two blocks',
      `${validNotBlocker('one')}\n\n\`\`\`json\n${JSON.stringify({ verdict: 'blocker', userAction: 'restart' })}\n\`\`\``,
    ],
    [
      'missing nextStep',
      `\`\`\`json\n${JSON.stringify({ verdict: 'not-blocker', userAction: null })}\n\`\`\``,
    ],
    [
      'both actions',
      `\`\`\`json\n${JSON.stringify({ verdict: 'blocker', userAction: 'restart', nextStep: 'edit' })}\n\`\`\``,
    ],
    [
      'unknown field',
      `\`\`\`json\n${JSON.stringify({ verdict: 'not-blocker', nextStep: 'edit', why: 'because' })}\n\`\`\``,
    ],
  ])('treats a %s verdict as a review error, never a blocker', async (_label, text) => {
    const harness = await create({ respond: () => text })
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
    expect(await recordsFor(harness)).toHaveLength(1)
    const [record] = await recordsFor(harness)
    const parsed = await harness.readRecord('goal-1', (record as string).replace('.json', ''))
    expect(parsed.verdict).toBe('review-error')
  })
})

describe('question review gate', () => {
  it('denies a goal-round question when an authorized route exists', async () => {
    const harness = await create({
      respond: () => validNotBlocker('add the test-only activation hook yourself'),
    })
    roundTurn(harness, 3)
    const { decision, next } = await harness.question()
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    expect(JSON.stringify(decision)).toContain('add the test-only activation hook yourself')
    expect(harness.goal?.phase).toBe('active')
    expect(harness.injected).toHaveLength(0)
    expect(harness.startCalls).toHaveLength(1)
  })

  it('allows a question only the user can answer', async () => {
    const harness = await create({
      respond: () => validBlocker('provide the deployment credential'),
    })
    roundTurn(harness, 3)
    const { decision, next } = await harness.question()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.injected).toHaveLength(0)
    expect(harness.goal?.phase).toBe('active')
  })

  it('leaves the recommended option as the reviewer route, not evidence', async () => {
    const harness = await create({
      respond: () => validNotBlocker('add the test-only hook now'),
    })
    roundTurn(harness, 3)
    const { decision } = await harness.question()
    expect(decisionCode(decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    expect(harness.lastPrompt()).toContain('(Recommended)')
  })

  it('does not review a direct-human turn', async () => {
    const harness = await create()
    humanTurn(harness, 'keep going')
    const { decision, next } = await harness.question()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
  })

  it('does not review a subagent question', async () => {
    const harness = await create()
    roundTurn(harness, 3)
    // The subagent sees the exact same goal-round log, so only the root-agent
    // exclusion can keep the review from starting here.
    const subagent = {
      id: 'subagent-1',
      session: {
        id: 'subagent-1',
        header: {
          version: 1,
          id: 'subagent-1',
          createdAt: Date.now(),
          isSeeded: false,
          origin: 'subagent',
        },
        snapshotEvents: () => harness.events,
      },
    } as unknown as Agent
    const { decision, next } = await harness.question({}, subagent)
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
  })

  it('does not review without an active goal', async () => {
    const harness = await create()
    harness.goal = undefined
    harness.turnStart()
    expect((await harness.question()).decision).toEqual({ kind: 'allow' })
    expect(harness.startCalls).toHaveLength(0)

    // A matching goal-round message keeps only the phase check from approving
    // this question for review.
    const paused = harness.setGoal({ phase: 'paused' })
    harness.turnStart()
    harness.goalRound(paused, 0)
    expect((await harness.question()).decision).toEqual({ kind: 'allow' })
    expect(harness.startCalls).toHaveLength(0)
  })

  it('does not review when reviewQuestions is false', async () => {
    const harness = await create({}, { reviewQuestions: false })
    roundTurn(harness, 3)
    const { decision, next } = await harness.question()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(0)
  })

  it('reuses a matching question digest without a second subagent run', async () => {
    const harness = await create()
    roundTurn(harness, 3)
    expect(decisionCode((await harness.question()).decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    expect(decisionCode((await harness.question()).decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
    expect(await recordsFor(harness)).toHaveLength(1)
  })

  it('keeps question and block verdicts separate for identical subject text', async () => {
    const harness = await create()
    roundTurn(harness, 3)
    // The question subject is JSON-normalized arguments; the block subject is
    // the block reason. With no further evidence between the calls, only the
    // subject kind can keep the two digests apart.
    const subject = '{"questions":[]}'
    const question = await harness.question({ questions: [] })
    expect(decisionCode(question.decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    const block = await harness.block({ blocked_reason: subject })
    expect(decisionCode(block.decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(2)
    const names = await recordsFor(harness)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    const parsed = await Promise.all(
      names.map((name) => harness.readRecord('goal-1', name.replace('.json', ''))),
    )
    expect(parsed.map((record) => record.subject).sort()).toEqual(['block', 'question'])
  })

  it('shares the per-goal bound with block reviews', async () => {
    const harness = await create({}, { maxReviewsPerGoal: 1 })
    roundTurn(harness, 3)
    expect(decisionCode((await harness.question()).decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    const second = await harness.question({
      questions: [{ question: 'Should I narrow the scope and stop early?' }],
    })
    expect(decisionCode(second.decision)).toBe('GOAL_BLOCK_REVIEW_EXHAUSTED')
    expect(second.next).not.toHaveBeenCalled()
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.goal?.phase).toBe('active')
  })

  it('exhausts one shared bound after a block review spends it', async () => {
    const harness = await create({}, { maxReviewsPerGoal: 1 })
    roundTurn(harness, 3)
    expect(decisionCode((await harness.block()).decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
    // The block review above spent the only unit; this question must not start
    // a second reviewer even though it is a different subject and digest.
    const question = await harness.question({
      questions: [{ question: 'Should I narrow the scope and stop early?' }],
    })
    expect(decisionCode(question.decision)).toBe('GOAL_BLOCK_REVIEW_EXHAUSTED')
    expect(question.next).not.toHaveBeenCalled()
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.goal?.phase).toBe('active')
    const names = await recordsFor(harness)
    const records = await Promise.all(
      names.map((name) => harness.readRecord('goal-1', name.replace('.json', ''))),
    )
    expect(records.map((record) => record.subject).sort()).toEqual(['block', 'question'])
    expect(records.find((record) => record.subject === 'question')?.verdict).toBe('exhausted')
  })

  it('denies a question when its reviewer errors under the default policy', async () => {
    const harness = await create({ respond: () => 'no fenced verdict' })
    roundTurn(harness, 3)
    const { decision, next } = await harness.question()
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.goal?.phase).toBe('active')
    const [name] = await recordsFor(harness)
    const record = await harness.readRecord('goal-1', (name as string).replace('.json', ''))
    expect(record).toMatchObject({ subject: 'question', verdict: 'review-error', reviewed: true })
  })

  it('allows an unverified question when the error policy is allow', async () => {
    const harness = await create({ respond: () => 'no fenced verdict' }, { onReviewError: 'allow' })
    roundTurn(harness, 3)
    const { decision, next } = await harness.question()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.goal?.phase).toBe('active')
    expect(noticeText(harness)).toContain('UNVERIFIED')
    expect(noticeText(harness)).toContain('onReviewError')
    expect(noticeText(harness)).toContain('Question review')
    const [name] = await recordsFor(harness)
    const record = await harness.readRecord('goal-1', (name as string).replace('.json', ''))
    expect(record).toMatchObject({
      subject: 'question',
      verdict: 'review-error',
      reviewed: true,
      verified: false,
      policy: 'onReviewError',
    })
  })

  it('allows a question when the exhausted policy is allow', async () => {
    const harness = await create({}, { maxReviewsPerGoal: 1, onExhausted: 'allow' })
    roundTurn(harness, 3)
    expect(decisionCode((await harness.question()).decision)).toBe('GOAL_QUESTION_REVIEW_REJECTED')
    const second = await harness.question({
      questions: [{ question: 'Should I defer the rest of the scope?' }],
    })
    expect(second.decision).toEqual({ kind: 'allow' })
    expect(second.next).toHaveBeenCalledTimes(1)
    expect(harness.startCalls).toHaveLength(1)
    expect(noticeText(harness)).toContain('UNVERIFIED')
    expect(noticeText(harness)).toContain('onExhausted')
    const names = await recordsFor(harness)
    const records = await Promise.all(
      names.map((name) => harness.readRecord('goal-1', name.replace('.json', ''))),
    )
    expect(records.find((record) => record.verdict === 'exhausted')).toMatchObject({
      subject: 'question',
      verified: false,
      reviewed: false,
      policy: 'onExhausted',
    })
  })

  it('follows the unavailable policy for a question', async () => {
    const harness = await create(
      { restrictError: new Error('scope is missing') },
      { onUnavailable: 'deny' },
    )
    roundTurn(harness, 3)
    const { decision, next } = await harness.question()
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_UNAVAILABLE')
    expect(harness.goal?.phase).toBe('active')
    // A policy decision is recorded with the same subject as a verdict record.
    const [name] = await recordsFor(harness)
    const record = await harness.readRecord('goal-1', (name as string).replace('.json', ''))
    expect(record).toMatchObject({ subject: 'question', verdict: 'unavailable', verified: false })
  })

  it('allows an unverified question under the default unavailable policy', async () => {
    const harness = await create({ restrictError: new Error('scope is missing') })
    roundTurn(harness, 3)
    const { decision } = await harness.question()
    expect(decision).toEqual({ kind: 'allow' })
    expect(noticeText(harness)).toContain('UNVERIFIED')
    expect(noticeText(harness)).toContain('Question review')
  })

  it('records the subject and the bounded question text', async () => {
    const harness = await create()
    roundTurn(harness, 3)
    await harness.question()
    const [name] = await recordsFor(harness)
    const record = await harness.readRecord('goal-1', (name as string).replace('.json', ''))
    expect(record.subject).toBe('question')
    expect(String(record.subjectText)).toContain('Only a test-only activation hook')
    expect(record.verdict).toBe('not-blocker')
  })
})

describe('review subject on the record', () => {
  it('records a block review with the block subject', async () => {
    const harness = await create()
    humanTurn(harness)
    await harness.block()
    const [name] = await recordsFor(harness)
    const record = await harness.readRecord('goal-1', (name as string).replace('.json', ''))
    expect(record.subject).toBe('block')
    expect(String(record.subjectText)).toContain('sibling automation repository')
  })
})

describe('block review execution', () => {
  it('starts a fresh-context reviewer with the configured preset and model', async () => {
    const harness = await create({}, { provider: 'spawn' })
    humanTurn(harness)
    await harness.block()
    const [run] = harness.runs
    expect(run).toBeDefined()
    expect(run).toMatchObject({
      provider: 'spawn',
      label: 'goal-block-review',
      agentPreset: 'goal-reviewer',
      parentId: 'root-agent',
      cwd: harness.workspace,
      agentOptions: { model: 'deepseek-flash', reasoningEffort: 'max' },
    })
    expect(harness.lastPrompt()).toContain('independent, read-only reviewer')
    expect(harness.lastPrompt().length).toBeLessThanOrEqual(24_000)
  })

  it('applies the read-only allowlist to the reviewer child scope', async () => {
    const harness = await create({
      respond: (run) =>
        run.prompt.includes('danger-full-access')
          ? validNotBlocker('make the test-only change')
          : validNotBlocker('edit the sibling repository'),
    })
    humanTurn(harness)
    await harness.block()
    expect(harness.restrictions).toHaveLength(1)
    expect(harness.restrictions[0]?.allow).toEqual([...REVIEWER_TOOLS])
    const surface = harness.reviewerSurface()
    for (const tool of MUTATION_TOOLS) expect(surface).not.toContain(tool)
    for (const tool of REVIEWER_TOOLS) expect(surface).toContain(tool)
    expect((harness.agent.session.header as { permissionPreset?: string }).permissionPreset).toBe(
      'danger-full-access',
    )
  })

  it('treats a failed child-scope restriction as unavailable and follows the allow policy', async () => {
    const harness = await create({ restrictError: new Error('scope is missing') })
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(noticeText(harness)).toContain('UNVERIFIED')
    expect(noticeText(harness)).toContain('onUnavailable')
    const [record] = await recordsFor(harness)
    const parsed = await harness.readRecord('goal-1', (record as string).replace('.json', ''))
    expect(parsed).toMatchObject({
      subject: 'block',
      verdict: 'unavailable',
      verified: false,
      policy: 'onUnavailable',
    })
  })

  it('denies an unavailable reviewer when the unavailable policy is deny', async () => {
    const harness = await create(
      { restrictError: new Error('scope is missing') },
      { onUnavailable: 'deny' },
    )
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_UNAVAILABLE')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('treats a missing provider as unavailable', async () => {
    const harness = await create({}, { provider: 'missing', onUnavailable: 'deny' })
    humanTurn(harness)
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_UNAVAILABLE')
    expect(JSON.stringify(decision)).toContain('not registered')
  })

  it('requires the agentPreset capability and a fresh context', async () => {
    const noPreset = await create(
      { capabilities: { agentPreset: false } },
      { onUnavailable: 'deny' },
    )
    humanTurn(noPreset)
    expect(decisionCode((await noPreset.block()).decision)).toBe('GOAL_BLOCK_REVIEW_UNAVAILABLE')
    await cleanup?.()
    cleanup = undefined

    const inherits = await create({ inheritsParentContext: true }, { onUnavailable: 'deny' })
    humanTurn(inherits)
    expect(decisionCode((await inherits.block()).decision)).toBe('GOAL_BLOCK_REVIEW_UNAVAILABLE')
  })

  it('keeps a provider start failure as a review error', async () => {
    const harness = await create({ startError: new Error('spawn refused') })
    humanTurn(harness)
    const { decision, next } = await harness.block()
    expect(next).not.toHaveBeenCalled()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
    expect(JSON.stringify(decision)).toContain('spawn refused')
    expect(await recordsFor(harness)).toHaveLength(1)
  })

  it('treats a missing or disabled preset as unavailable', async () => {
    const harness = await create(
      { startError: new Error('agent preset "goal-reviewer" is not declared') },
      { onUnavailable: 'deny' },
    )
    humanTurn(harness)
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_UNAVAILABLE')
    expect(JSON.stringify(decision)).toContain('is not declared')
  })

  it('treats a non-completed stop reason as a review error', async () => {
    const harness = await create({ stopReason: 'error' })
    humanTurn(harness)
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
  })

  it('times out and disposes the reviewer', async () => {
    const harness = await create({ hang: true }, { timeoutMs: 50 })
    humanTurn(harness)
    const { decision } = await harness.block()
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
    expect(harness.disposals).toHaveLength(1)
    expect(harness.disposals[0]).toHaveBeenCalled()
  })

  it('cancels a review through the tool-call signal', async () => {
    const harness = await create({ hang: true })
    humanTurn(harness)
    const controller = new AbortController()
    const call = harness.block({}, harness.agent, controller.signal)
    controller.abort()
    const { decision } = await call
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
    expect(JSON.stringify(decision)).toContain('cancelled')
    expect(harness.disposals).toHaveLength(1)
  })
})

describe('block review record, cache, and budget', () => {
  it('writes an atomic digest-bound record under local state', async () => {
    const harness = await create()
    humanTurn(harness)
    await harness.block()
    const names = await recordsFor(harness)
    expect(names).toHaveLength(1)
    const record = await harness.readRecord('goal-1', (names[0] as string).replace('.json', ''))
    expect(record).toMatchObject({
      version: 1,
      goal: 'goal-1',
      revision: 1,
      digest: (names[0] as string).replace('.json', ''),
      verdict: 'not-blocker',
      verified: true,
      reviewed: true,
      nextStep: 'make the sibling edit',
    })
    expect(record.evidenceSummary).toMatchObject({ rounds: 0 })
  })

  it('reuses a matching digest without a second subagent run', async () => {
    const harness = await create()
    humanTurn(harness)
    await harness.block()
    const second = await harness.block()
    expect(decisionCode(second.decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
    expect(await recordsFor(harness)).toHaveLength(1)
  })

  it('does not reuse a stale digest and starts a new review', async () => {
    const harness = await create()
    humanTurn(harness)
    await harness.block()
    await harness.block({ blocked_reason: 'a different obstacle now blocks the goal' })
    expect(harness.startCalls).toHaveLength(2)
    expect(await recordsFor(harness)).toHaveLength(2)
  })

  it('checks the cache before the per-goal bound', async () => {
    const harness = await create({}, { maxReviewsPerGoal: 1 })
    humanTurn(harness)
    await harness.block()
    const second = await harness.block()
    expect(decisionCode(second.decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('denies further proposals when the bound is exhausted', async () => {
    const harness = await create({}, { maxReviewsPerGoal: 1 })
    humanTurn(harness)
    await harness.block()
    const second = await harness.block({ blocked_reason: 'new evidence after the first review' })
    expect(decisionCode(second.decision)).toBe('GOAL_BLOCK_REVIEW_EXHAUSTED')
    expect(second.next).not.toHaveBeenCalled()
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.goal?.phase).toBe('active')
    const names = await recordsFor(harness)
    expect(names).toHaveLength(2)
    const listed = await Promise.all(
      names.map((name) => harness.readRecord('goal-1', name.replace('.json', ''))),
    )
    const exhausted = listed.find((record) => record.verdict === 'exhausted')
    expect(exhausted).toMatchObject({ verdict: 'exhausted', verified: false, reviewed: false })
  })

  it('charges a failed review against the per-goal bound', async () => {
    const harness = await create({ respond: () => 'no fenced verdict' }, { maxReviewsPerGoal: 1 })
    humanTurn(harness)
    const first = await harness.block()
    expect(decisionCode(first.decision)).toBe('GOAL_BLOCK_REVIEW_ERROR')
    const second = await harness.block()
    expect(decisionCode(second.decision)).toBe('GOAL_BLOCK_REVIEW_EXHAUSTED')
    // The exhausted policy record overwrites the digest record; the attempt stays charged.
    const third = await harness.block()
    expect(decisionCode(third.decision)).toBe('GOAL_BLOCK_REVIEW_EXHAUSTED')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('bounds repeated identical review attempts, not distinct digests', async () => {
    const harness = await create({ respond: () => 'still no verdict' }, { maxReviewsPerGoal: 2 })
    humanTurn(harness)
    await harness.block()
    await harness.block()
    const third = await harness.block()
    expect(decisionCode(third.decision)).toBe('GOAL_BLOCK_REVIEW_EXHAUSTED')
    expect(harness.startCalls).toHaveLength(2)
  })

  it('allows an unverified block when the exhausted policy is allow', async () => {
    const harness = await create({}, { maxReviewsPerGoal: 1, onExhausted: 'allow' })
    humanTurn(harness)
    await harness.block()
    const second = await harness.block({ blocked_reason: 'new evidence after the first review' })
    expect(second.decision).toEqual({ kind: 'allow' })
    expect(second.next).toHaveBeenCalledTimes(1)
    expect(noticeText(harness)).toContain('UNVERIFIED')
    expect(noticeText(harness)).toContain('onExhausted')
    const names = await recordsFor(harness)
    expect(names).toHaveLength(2)
  })
})

describe('standing grants in the reviewer evidence', () => {
  it('denies a permission block covered by a dated grant', async () => {
    const harness = await create({
      respond: (run) =>
        run.prompt.includes('sibling repository edits')
          ? validNotBlocker('edit the sibling repository')
          : validBlocker('grant the permission'),
    })
    await harness.writeFile(
      'AGENTS.md',
      '# Workspace\n\n- 2026-10-01 user: standing grant for sibling repository edits, means only.\n',
    )
    humanTurn(harness)
    const { decision } = await harness.block({
      blocked_reason: 'the user must approve edits to the sibling automation repository',
    })
    expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    expect(harness.lastPrompt()).toContain('standing grant for sibling repository edits')
  })

  it('keeps an out-of-scope action a user decision', async () => {
    const harness = await create({
      respond: (run) =>
        run.prompt.includes('publication and credentials excluded')
          ? validBlocker('publish the package and provide the credential')
          : validNotBlocker('continue'),
    })
    await harness.writeFile(
      'AGENTS.md',
      '- 2026-10-01 user: grant for code changes only; publication and credentials excluded.\n',
    )
    humanTurn(harness)
    const { decision } = await harness.block({
      blocked_reason: 'the user must publish the package and provide the publication credential',
    })
    expect(decision).toEqual({ kind: 'allow' })
    expect(noticeText(harness)).toContain('publish the package')
  })

  it('does not apply a stale or foreign grant', async () => {
    const harness = await create({
      respond: (run) =>
        run.prompt.includes('another workspace')
          ? validBlocker('provide the credential for this workspace')
          : validNotBlocker('continue'),
    })
    await harness.writeFile(
      '.dsh/goal-continuity/grants.json',
      JSON.stringify([
        {
          date: '2026-09-01',
          workspace: 'another workspace',
          scope: 'credentials',
          status: 'stale',
        },
      ]),
    )
    humanTurn(harness)
    const { decision } = await harness.block({
      blocked_reason: 'only the user has the credential for this workspace',
    })
    expect(decision).toEqual({ kind: 'allow' })
    expect(harness.lastPrompt()).toContain('another workspace')
    expect(harness.lastPrompt()).toContain('stale')
  })
})

describe('bounded and redacted evidence', () => {
  it('includes only the last three goal rounds and bounds tool results', async () => {
    const harness = await create({
      respond: () => validNotBlocker('continue'),
    })
    harness.turnStart()
    for (let round = 1; round <= 5; round += 1) {
      const goal = harness.goal
      if (goal === undefined) throw new Error('test goal missing')
      goal.roundsStarted = round
      harness.goalRound(goal, round)
      const call = harness.toolCall('read', { file_path: `src/round-${round}.ts` })
      harness.toolResult(call, `round result ${round}`)
    }
    await harness.block()
    const prompt = harness.lastPrompt()
    expect(prompt).toContain('Round 5')
    expect(prompt).toContain('Round 4')
    expect(prompt).toContain('Round 3')
    expect(prompt).not.toContain('Round 2')
    expect(prompt).not.toContain('Round 1')
  })

  it('redacts machine paths and obvious credentials in evidence and the record', async () => {
    const leaked = join(process.cwd(), 'secret-dir', 'credentials.txt')
    const secret = ['sk', 'live', '0123456789abcdef'].join('-')
    const harness = await create({
      respond: () => validNotBlocker('continue'),
    })
    roundTurn(harness, 3)
    const call = harness.toolCall('read', { file_path: leaked })
    harness.toolResult(call, `contents at ${leaked}: ${secret}`)
    await harness.block()
    const prompt = harness.lastPrompt()
    expect(prompt).not.toContain('secret-dir')
    expect(prompt).not.toContain(secret)
    expect(prompt).toContain('[path]')

    const [name] = await recordsFor(harness)
    const raw = await readFile(
      harness.recordPath('goal-1', (name as string).replace('.json', '')),
      'utf8',
    )
    expect(raw).not.toContain('secret-dir')
    expect(raw).not.toContain(secret)
  })

  it('includes the runtime permission policy from the session messages', async () => {
    const harness = await create({ respond: () => validNotBlocker('continue') })
    harness.runtimeContext(
      'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: danger-full-access.',
      [
        {
          name: 'sandbox-policy',
          text: 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications.',
        },
      ],
    )
    humanTurn(harness)
    await harness.block()
    expect(harness.lastPrompt()).toContain('DSH file policy: danger-full-access')
  })

  it('bounds the reviewer prompt and keeps the bundled instructions first', async () => {
    const harness = await create({ respond: () => validNotBlocker('continue') })
    roundTurn(harness, 3)
    for (let index = 0; index < 12; index += 1) {
      const call = harness.toolCall('read', { file_path: `src/file-${index}.ts` })
      harness.toolResult(call, `result ${index}`.repeat(200))
    }
    await harness.block()
    const prompt = harness.lastPrompt()
    expect(prompt.length).toBeLessThanOrEqual(24_000)
    expect(prompt.startsWith('You are an independent, read-only reviewer')).toBe(true)
  })

  it('keeps the runtime policy and standing grants when tool evidence is large', async () => {
    const harness = await create({ respond: () => validNotBlocker('continue') })
    await harness.writeFile(
      'AGENTS.md',
      '# Workspace\n\n- 2026-10-01 user: standing grant for sibling repository edits, means only.\n',
    )
    harness.runtimeContext('Current DSH file policy: danger-full-access.', [
      { name: 'sandbox-policy', text: 'Current DSH file policy: danger-full-access.' },
    ])
    harness.turnStart()
    for (let index = 0; index < 5; index += 1) harness.directMessage('x'.repeat(800))
    for (let round = 1; round <= 3; round += 1) {
      const goal = harness.goal
      if (goal === undefined) throw new Error('test goal missing')
      goal.roundsStarted = round
      harness.goalRound(goal, round)
      for (let index = 0; index < 8; index += 1) {
        const call = harness.toolCall('read', { file_path: `src/round-${round}-file-${index}.ts` })
        harness.toolResult(call, `result ${round}-${index} `.repeat(40))
      }
    }
    await harness.block()
    const prompt = harness.lastPrompt()
    expect(prompt.length).toBeLessThanOrEqual(24_000)
    expect(prompt).toContain('### Runtime permission policy')
    expect(prompt).toContain('DSH file policy: danger-full-access')
    expect(prompt).toContain('### Standing grants')
    expect(prompt).toContain('standing grant for sibling repository edits')
  })
})

describe('reviewer prompt asset', () => {
  it('labels a question review and carries the question rules', async () => {
    const harness = await create()
    roundTurn(harness, 3)
    await harness.question()
    const prompt = harness.lastPrompt()
    expect(prompt).toContain('Proposed question')
    expect(prompt).toContain('## Questions')
    expect(prompt).toContain('answer this itself')
    expect(prompt).toContain('(Recommended)')
    expect(prompt).toContain('reversible choice')
  })

  it('labels a block review', async () => {
    const harness = await create()
    humanTurn(harness)
    await harness.block()
    const prompt = harness.lastPrompt()
    expect(prompt).toContain('Block reason')
    expect(prompt).not.toContain('Proposed question')
  })

  it('carries the user-only definition, defaults, and strict output within its bound', async () => {
    const asset = await readFile(
      join(process.cwd(), 'packages', 'plugin-goal-continuity', 'assets', 'blocker-review.md'),
      'utf8',
    )
    expect(asset.length).toBeLessThanOrEqual(6000)
    for (const phrase of [
      'only the user can perform',
      'default to `not-blocker`',
      'A menu is not a blocker',
      'production behavior change',
      'standing',
      'untrusted data',
      '"verdict": "blocker"',
      '"nextStep"',
      'proposed user question',
      'answer this itself',
      '(Recommended)',
      'reversible choice',
    ]) {
      expect(asset).toContain(phrase)
    }
    expect(asset).not.toContain('mcp_call')
    expect(asset).toMatch(/Return exactly one fenced JSON block/u)
  })
})

describe('default configuration', () => {
  it('keeps the documented block-review defaults', () => {
    expect(DEFAULT_BLOCK_REVIEW_CONFIG).toEqual({
      enabled: true,
      reviewQuestions: true,
      provider: 'spawn',
      model: 'deepseek-flash',
      reasoningEffort: 'max',
      reviewerPreset: 'goal-reviewer',
      blockedAfterConsecutiveRounds: 3,
      timeoutMs: 300000,
      maxReviewsPerGoal: 3,
      onReviewError: 'deny',
      onUnavailable: 'allow',
      onExhausted: 'deny',
    })
  })
})
