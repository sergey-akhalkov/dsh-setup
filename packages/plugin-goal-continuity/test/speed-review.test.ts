import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  goalUserMessage,
  MUTATION_TOOLS,
  noticeText,
  REVIEWER_TOOLS,
  SpeedReviewHarness,
  speedReviewConfig,
  validSpeedup,
} from './speed-review-harness.js'

/**
 * The goal-round speed review is exercised with a real Cordis context, a fake
 * goal service, timed session events, and a fake subagent provider that
 * publishes a read-only reviewer child through the real `agent/created`
 * dispatch. No test needs a live Harness.
 */

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function create(
  options: Parameters<typeof SpeedReviewHarness.create>[0] = {},
  speedReview: Parameters<typeof speedReviewConfig>[0] = {},
  goal: Parameters<typeof SpeedReviewHarness.create>[2] = {},
): Promise<SpeedReviewHarness> {
  const created = await SpeedReviewHarness.create(options, speedReviewConfig(speedReview), goal)
  cleanup = created.cleanup
  return created.harness
}

function goal(harness: SpeedReviewHarness): NonNullable<SpeedReviewHarness['goal']> {
  const goal = harness.goal
  if (goal === undefined) throw new Error('test goal missing')
  return goal
}

/** Start a goal round as its own turn. */
function goalRound(harness: SpeedReviewHarness, round = 1, time = Date.now()): void {
  const current = goal(harness)
  current.roundsStarted = round
  harness.turnStart(round, time)
  harness.goalMessage(current, round, time + 1)
}

/** Seed one pending action record, as the previous round's review would have. */
async function seedPending(
  harness: SpeedReviewHarness,
  round = 1,
  speedupId = 'speedup-1-a1b2',
): Promise<void> {
  await harness.writeRecord(
    {
      version: 1,
      goal: 'goal-1',
      round,
      objective: 'Ship the migration.',
      metrics: {
        wallMs: 400_000,
        toolCalls: 14,
        errors: 1,
        workers: { subagent: 2 },
        slowCalls: [],
        nonToolMs: 100_000,
      },
      verdict: 'speedup',
      action: {
        bottleneck: 'the full check ran before two independent test files',
        action: 'start one worker while the main agent keeps integration',
        handoff: 'Change only the two test files and report the focused commands.',
        expectedSaving: '2-4 min per round',
        risk: 'low: the worker edits a test-only directory the main agent reviews',
        speedupId,
      },
      speedupId,
      status: 'pending',
      target: {
        provider: 'spawn',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
        preset: 'goal-reviewer',
      },
      reviewMs: 1_200,
      time: new Date().toISOString(),
      session: 'root-agent',
    },
    'goal-1',
    round,
  )
}

/** One active change with an eligible unchecked task. */
async function writeChangeTask(harness: SpeedReviewHarness): Promise<void> {
  await harness.writeFile(
    'openspec/changes/my-change/tasks.md',
    '# Tasks\n\n- [ ] 1.1 Implement the speed review\n  continuation text\n- [x] 2.1 Done\n',
  )
}

function messagesOf(decision: unknown): Array<{ content: Array<{ type: string; text?: string }> }> {
  const value = decision as {
    kind?: string
    messages?: Array<{ content: Array<{ type: string; text?: string }> }>
  }
  return value.kind === 'enter' ? (value.messages ?? []) : []
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('goal-round review execution', () => {
  it('starts one read-only child and records a no-action verdict', async () => {
    const harness = await create({}, { everyRound: true })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })

    const record = await harness.waitForRecord('goal-1', 1)
    expect(harness.startCalls).toHaveLength(1)
    expect(record).toMatchObject({
      version: 1,
      goal: 'goal-1',
      round: 1,
      verdict: 'no-action',
      status: 'no-action',
      target: { provider: 'spawn', preset: 'goal-reviewer' },
      session: 'root-agent',
    })
    expect(typeof record.reviewMs).toBe('number')
    const run = harness.runs[0]
    expect(run).toMatchObject({
      provider: 'spawn',
      label: 'goal-round-review',
      agentPreset: 'goal-reviewer',
      parentId: 'root-agent',
      cwd: harness.workspace,
      agentOptions: { model: 'deepseek-flash', reasoningEffort: 'max' },
    })
    expect(harness.lastPrompt()).toMatch(
      /^You are an independent, read-only reviewer of one completed goal round/u,
    )
    expect(harness.lastPrompt()).toContain('## Round metrics')
    expect(harness.restrictions[0]?.allow).toEqual([...REVIEWER_TOOLS])
    const surface = harness.reviewerSurface()
    for (const tool of MUTATION_TOOLS) expect(surface).not.toContain(tool)
    for (const tool of REVIEWER_TOOLS) expect(surface).toContain(tool)
    expect(harness.injected).toHaveLength(0)
    expect(harness.steers).toHaveLength(0)
  })

  it('starts no review below every threshold', async () => {
    const harness = await create({}, { minToolCalls: 5 })
    const current = goal(harness)
    const t0 = 1_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(current, 1, t0 + 1)
    const call = harness.toolCall('read', { file_path: 'src/a.ts' }, t0 + 10)
    harness.toolResult(call, 'ok', t0 + 20)
    harness.turnEnd({ kind: 'completed' }, t0 + 30)
    await flush()
    expect(harness.startCalls).toHaveLength(0)
    expect(await harness.tryReadRecord('goal-1', 1)).toBeUndefined()
  })

  it('reuses an existing record instead of starting a second child', async () => {
    const harness = await create({}, { everyRound: true })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await harness.waitForRecord('goal-1', 1)
    expect(harness.startCalls).toHaveLength(1)

    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await flush()
    expect(harness.startCalls).toHaveLength(1)
  })

  it('starts a review when only the tool-call threshold is met', async () => {
    const harness = await create({}, { minToolCalls: 2, minMinutes: 60, slowCallMs: 3_600_000 })
    const current = goal(harness)
    const t0 = 1_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(current, 1, t0 + 1)
    for (let index = 0; index < 2; index += 1) {
      const call = harness.toolCall('read', { file_path: `src/${index}.ts` }, t0 + 10)
      harness.toolResult(call, 'ok', t0 + 11)
    }
    harness.turnEnd({ kind: 'completed' }, t0 + 20)
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record.verdict).toBe('no-action')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('starts a review when only the wall-time threshold is met', async () => {
    const harness = await create(
      {},
      { minToolCalls: 1000, minMinutes: 0.05, slowCallMs: 3_600_000 },
    )
    const current = goal(harness)
    const t0 = 2_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(current, 1, t0 + 1)
    const call = harness.toolCall('read', { file_path: 'src/a.ts' }, t0 + 10)
    harness.toolResult(call, 'ok', t0 + 20)
    harness.turnEnd({ kind: 'completed' }, t0 + 5_000)
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record.verdict).toBe('no-action')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('starts a review when only the slow-call threshold is met', async () => {
    const harness = await create({}, { minToolCalls: 1000, minMinutes: 60, slowCallMs: 1_000 })
    const current = goal(harness)
    const t0 = 3_000_000
    harness.turnStart(1, t0)
    harness.goalMessage(current, 1, t0 + 1)
    const call = harness.toolCall('pwsh', { command: 'pnpm check' }, t0 + 10)
    harness.toolResult(call, 'done', t0 + 1_510)
    harness.turnEnd({ kind: 'completed' }, t0 + 2_000)
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record.verdict).toBe('no-action')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('caps the review at maxPerGoal', async () => {
    const harness = await create({}, { everyRound: true, maxPerGoal: 1 })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await harness.waitForRecord('goal-1', 1)
    goalRound(harness, 2)
    harness.turnEnd({ kind: 'completed' })
    await flush()
    expect(harness.startCalls).toHaveLength(1)
    expect(await harness.tryReadRecord('goal-1', 2)).toBeUndefined()
  })

  it('reuses a persisted record instead of starting a child', async () => {
    const harness = await create({}, { everyRound: true })
    await harness.writeRecord(
      {
        version: 1,
        goal: 'goal-1',
        round: 1,
        objective: 'Ship the migration.',
        metrics: {
          wallMs: 1,
          toolCalls: 0,
          errors: 0,
          workers: {},
          slowCalls: [],
          nonToolMs: 1,
        },
        verdict: 'no-action',
        status: 'no-action',
        target: {
          provider: 'spawn',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
          preset: 'goal-reviewer',
        },
        reviewMs: 5,
        time: new Date().toISOString(),
        session: 'root-agent',
      },
      'goal-1',
      1,
    )
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await flush()
    expect(harness.startCalls).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).verdict).toBe('no-action')
  })

  it('does not start a second child for the same round after a failed record write', async () => {
    const harness = await create({}, { everyRound: true, maxPerGoal: 2 })
    await harness.writeFile('.dsh/goal-continuity/retro/goal-1', 'not a directory')
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await flush()
    expect(harness.startCalls).toHaveLength(1)
    expect(await harness.tryReadRecord('goal-1', 1)).toBeUndefined()
  })

  it('records an error when the review child startup stalls', async () => {
    const harness = await create({ startHang: true }, { everyRound: true, timeoutMs: 50 })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'error', status: 'error' })
    expect(String(record.detail)).toContain('did not finish within 50 ms')
    expect(harness.startCalls).toHaveLength(1)
  })

  it('writes the timeout record even when disposal stalls', async () => {
    const harness = await create(
      { hang: true, disposeHang: true },
      { everyRound: true, timeoutMs: 50 },
    )
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'error', status: 'error' })
    expect(harness.disposals[0]).toHaveBeenCalled()
  })

  it('records a timeout as an error and never retries that round', async () => {
    const harness = await create({ hang: true }, { everyRound: true, timeoutMs: 50 })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'error', status: 'error' })
    expect(String(record.detail)).toContain('did not finish within 50 ms')
    expect(harness.disposals).toHaveLength(1)
    expect(harness.disposals[0]).toHaveBeenCalled()

    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await flush()
    expect(harness.startCalls).toHaveLength(1)
    expect(harness.injected).toHaveLength(0)
    expect(harness.steers).toHaveLength(0)
  })

  it('records a malformed verdict as an error without an action', async () => {
    const harness = await create({ respond: () => 'no fenced verdict' }, { everyRound: true })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'error', status: 'error' })
    expect(String(record.detail)).toContain('invalid')
    expect(record.action).toBeUndefined()
    expect(harness.injected).toHaveLength(0)
  })

  it.each([
    ['missing required fields', { verdict: 'speedup' }],
    [
      'blank required field',
      {
        verdict: 'speedup',
        bottleneck: '   ',
        action: 'a',
        handoff: 'h',
        expectedSaving: '2 min',
        risk: 'low',
        speedupId: 'speedup-1-aaaa',
      },
    ],
    [
      'mistyped required field',
      {
        verdict: 'speedup',
        bottleneck: 7,
        action: 'a',
        handoff: 'h',
        expectedSaving: '2 min',
        risk: 'low',
        speedupId: 'speedup-1-aaaa',
      },
    ],
    [
      'extra speedup field',
      {
        verdict: 'speedup',
        bottleneck: 'b',
        action: 'a',
        handoff: 'h',
        expectedSaving: '2 min',
        risk: 'low',
        speedupId: 'speedup-1-aaaa',
        extra: true,
      },
    ],
    ['extra no-action field', { verdict: 'no-action', extra: true }],
    [
      'invalid speedup id',
      {
        verdict: 'speedup',
        bottleneck: 'b',
        action: 'a',
        handoff: 'h',
        expectedSaving: '2 min',
        risk: 'low',
        speedupId: 'bad-id',
      },
    ],
    ['unknown verdict', { verdict: 'maybe' }],
  ])('rejects a strict-verdict schema case: %s', async (_label, value) => {
    const harness = await create(
      { respond: () => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` },
      { everyRound: true },
    )
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'error', status: 'error' })
    expect(String(record.detail)).toContain('invalid')
    expect(record.action).toBeUndefined()
  })

  it('treats an unavailable provider as no review and no action', async () => {
    const harness = await create({}, { everyRound: true, provider: 'missing' })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'error', status: 'error' })
    expect(String(record.detail)).toContain('not registered')
    expect(harness.startCalls).toHaveLength(0)
    expect(record.action).toBeUndefined()
  })

  it('starts no review when speedReview is disabled', async () => {
    const harness = await create({}, { enabled: false, everyRound: true })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await flush()
    expect(harness.startCalls).toHaveLength(0)
  })
})

describe('next-round brief', () => {
  it('carries the speed policy and the pending action with the exact decline call', async () => {
    const harness = await create()
    await writeChangeTask(harness)
    harness.availableTools.add('task_progress')
    await seedPending(harness, 1)
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    const decision = await harness.preStep(2, [goalUserMessage(current, 2)])
    const messages = messagesOf(decision)
    expect(messages).toHaveLength(1)
    const text = noticeText(messages[0] as never)
    expect(text).toContain('Speed policy:')
    expect(text).toContain('Pending speedup speedup-1-a1b2')
    expect(text).toContain('bottleneck: the full check ran')
    expect(text).toContain('Record: .dsh/goal-continuity/retro/goal-1/1.json')
    expect(text).toContain('Start a worker whose arguments contain speedup-1-a1b2')
    const taskId = createHash('sha256')
      .update('Implement the speed review')
      .digest('hex')
      .slice(0, 16)
    expect(text).toContain(
      `task_progress(task: "${taskId}", status: "in-progress", reason: "declined speedup-1-a1b2`,
    )
    expect(text.length).toBeLessThanOrEqual(1500)
  })

  it('reserves the record path, instruction, and decline call for maximum fields', async () => {
    const harness = await create()
    harness.availableTools.add('task_progress')
    const long = 'z'.repeat(300)
    const quoted = `Support the "fast" option ${'q'.repeat(400)}`
    await harness.writeFile(
      'openspec/changes/my-change/tasks.md',
      `# Tasks\n\n- [ ] 7.1 ${quoted}\n- [x] 7.2 Done\n`,
    )
    await harness.writeRecord(
      {
        version: 1,
        goal: 'goal-1',
        round: 3,
        objective: 'Ship the migration.',
        metrics: {
          wallMs: 1,
          toolCalls: 1,
          errors: 0,
          workers: {},
          slowCalls: [],
          nonToolMs: 0,
        },
        verdict: 'speedup',
        action: {
          bottleneck: long,
          action: long,
          handoff: long,
          expectedSaving: long,
          risk: long,
          speedupId: 'speedup-3-c3d4',
        },
        speedupId: 'speedup-3-c3d4',
        status: 'pending',
        target: {
          provider: 'spawn',
          model: 'deepseek-flash',
          reasoningEffort: 'max',
          preset: 'goal-reviewer',
        },
        reviewMs: 10,
        time: new Date().toISOString(),
        session: 'root-agent',
      },
      'goal-1',
      3,
    )
    const current = goal(harness)
    current.roundsStarted = 4
    harness.turnStart(4)
    const messages = messagesOf(await harness.preStep(4, [goalUserMessage(current, 4)]))
    const text = noticeText(messages[0] as never)
    expect(text.length).toBeLessThanOrEqual(1500)
    expect(text).toContain('Pending speedup speedup-3-c3d4')
    expect(text).toContain('Record: .dsh/goal-continuity/retro/goal-1/3.json')
    expect(text).toContain('Start a worker whose arguments contain speedup-3-c3d4')
    expect(text).toMatch(
      /task_progress\(task: "[0-9a-f]{16}", status: "in-progress", reason: "declined speedup-3-c3d4/u,
    )
    expect(text).not.toContain(quoted)
  })

  it('carries the policy only when no action is pending', async () => {
    const harness = await create()
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    const messages = messagesOf(await harness.preStep(2, [goalUserMessage(current, 2)]))
    expect(messages).toHaveLength(1)
    const text = noticeText(messages[0] as never)
    expect(text).toContain('Speed policy:')
    expect(text).not.toContain('Pending speedup')
    expect(text).not.toContain('speedup-')
  })

  it('is not injected on a non-goal turn', async () => {
    const harness = await create()
    harness.turnStart(2)
    harness.directMessage('keep going')
    expect(messagesOf(await harness.preStep(2))).toHaveLength(0)
  })

  it('is not injected when the brief is disabled, but the gate still applies', async () => {
    const harness = await create({}, { brief: false })
    await writeChangeTask(harness)
    harness.availableTools.add('task_progress')
    harness.availableTools.add('subagent')
    await seedPending(harness, 1)
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    expect(messagesOf(await harness.preStep(2, [goalUserMessage(current, 2)]))).toHaveLength(0)
    harness.goalMessage(current, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0])).toContain('speedup-1-a1b2')
  })

  it('announces the completed round action, not a newer pending one', async () => {
    const harness = await create({ defer: true }, { everyRound: true })
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    goalRound(harness, 2)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(2))

    harness.releaseLast(validSpeedup('speedup-2-bbbb'))
    await harness.waitForRecord('goal-1', 2)
    const current = goal(harness)
    current.roundsStarted = 3
    harness.turnStart(3)
    // The real first step brief announces the pending action and marks it delivered.
    await harness.preStep(3, [goalUserMessage(current, 3)])
    harness.goalMessage(current, 3)
    harness.release(validSpeedup('speedup-1-aaaa'))
    await harness.waitForRecord('goal-1', 1)
    await vi.waitFor(() => expect(harness.injected).toHaveLength(1))
    const text = noticeText(harness.injected[0])
    expect(text).toContain('speedup-1-aaaa')
    expect(text).toContain('Record: .dsh/goal-continuity/retro/goal-1/1.json')
    expect(text).toContain('declined speedup-1-aaaa')
    expect(text).not.toContain('speedup-2-bbbb')
  })

  it('announces an action that completes during first-step admission', async () => {
    const harness = await create({ defer: true }, { everyRound: true })
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    // The brief composes before the action exists.
    const messages = messagesOf(await harness.preStep(2, [goalUserMessage(current, 2)]))
    expect(noticeText(messages[0] as never)).not.toContain('Pending speedup')
    harness.release(validSpeedup('speedup-2-a1b2'))
    await harness.waitForRecord('goal-1', 1)
    // The action finished after the brief; admitting the goal step delivers it.
    harness.goalMessage(current, 2)
    await vi.waitFor(() => expect(harness.injected).toHaveLength(1))
    const text = noticeText(harness.injected[0])
    expect(text).toContain('speedup-2-a1b2')
    expect(text).toContain('.dsh/goal-continuity/retro/goal-1/1.json')
  })

  it('delivers a completed action once when admission and late completion overlap', async () => {
    const harness = await create({ defer: true }, { everyRound: true })
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    harness.goalMessage(current, 2)
    harness.release(validSpeedup('speedup-2-a1b2'))
    await harness.waitForRecord('goal-1', 1)
    // Admission races the review's own late delivery for the same action.
    harness.goalMessage(current, 2)
    await vi.waitFor(() => expect(harness.injected.length).toBeGreaterThanOrEqual(1))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(harness.injected).toHaveLength(1)
    expect(noticeText(harness.injected[0])).toContain('speedup-2-a1b2')
  })

  it('announces every unannounced action at first-step admission', async () => {
    const harness = await create({ defer: true }, { everyRound: true })
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    goalRound(harness, 2)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(2))
    harness.releaseLast(validSpeedup('speedup-2-bbbb'))
    await harness.waitForRecord('goal-1', 2)

    const current = goal(harness)
    current.roundsStarted = 3
    harness.turnStart(3)
    const messages = messagesOf(await harness.preStep(3, [goalUserMessage(current, 3)]))
    expect(noticeText(messages[0] as never)).toContain('speedup-2-bbbb')
    // Round 1's review completes before the goal message is admitted.
    harness.release(validSpeedup('speedup-1-aaaa'))
    await harness.waitForRecord('goal-1', 1)
    harness.goalMessage(current, 3)
    await vi.waitFor(() => expect(harness.injected).toHaveLength(1))
    const text = noticeText(harness.injected[0])
    expect(text).toContain('speedup-1-aaaa')
    expect(text).not.toContain('speedup-2-bbbb')
  })

  it('does not deliver a late action into a non-goal turn', async () => {
    const harness = await create({ defer: true }, { everyRound: true })
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    harness.goalMessage(current, 2)
    harness.release(validSpeedup('speedup-2-a1b2'))
    // Switch to a non-goal turn while the late delivery awaits its lookup.
    harness.turnEnd({ kind: 'completed' }, Date.now(), 2)
    harness.turnStart(3)
    harness.directMessage('keep going')
    await harness.waitForRecord('goal-1', 1)
    await flush()
    expect(harness.injected).toHaveLength(0)
  })

  it('finds the OpenSpec root from a nested session working directory', async () => {
    const harness = await create()
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    await harness.writeFile('packages/pkg/.keep', '')
    harness.cwd = join(harness.workspace, 'packages', 'pkg')
    await seedPending(harness, 1)
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    const messages = messagesOf(await harness.preStep(2, [goalUserMessage(current, 2)]))
    const text = noticeText(messages[0] as never)
    expect(text).toContain('Pending speedup speedup-1-a1b2')
    expect(text).toMatch(/task_progress\(task: "[0-9a-f]{16}"/u)
  })

  it('injects a late action result during the running goal round', async () => {
    const harness = await create({ defer: true }, { everyRound: true })
    goalRound(harness, 1)
    harness.turnEnd({ kind: 'completed' })
    await vi.waitFor(() => expect(harness.startCalls).toHaveLength(1))
    const current = goal(harness)
    current.roundsStarted = 2
    harness.turnStart(2)
    expect(messagesOf(await harness.preStep(2, [goalUserMessage(current, 2)]))).toHaveLength(1)
    harness.goalMessage(current, 2)
    harness.release(validSpeedup('speedup-2-a1b2'))
    const record = await harness.waitForRecord('goal-1', 1)
    expect(record).toMatchObject({ verdict: 'speedup', status: 'pending' })
    await vi.waitFor(() => expect(harness.injected).toHaveLength(1))
    const text = noticeText(harness.injected[0])
    expect(text).toContain('Speed review found a speedup for round 1')
    expect(text).toContain('speedup-2-a1b2')
    expect(text).toContain('.dsh/goal-continuity/retro/goal-1/1.json')
    expect(text.length).toBeLessThanOrEqual(1500)
  })
})

describe('follow-through gate', () => {
  async function gateHarness(
    speedReview: Parameters<typeof speedReviewConfig>[0] = {},
    tools: string[] = ['subagent', 'task_progress'],
  ): Promise<SpeedReviewHarness> {
    const harness = await create({}, speedReview)
    for (const tool of tools) harness.availableTools.add(tool)
    await writeChangeTask(harness)
    await seedPending(harness, 1)
    goalRound(harness, 2)
    return harness
  }

  it('accepts a successful worker start whose arguments contain the speedup id', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('subagent', {
      description: 'apply speedup',
      prompt: 'Apply speedup-1-a1b2 and report the result.',
    })
    harness.toolResult(call, 'started')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('started')
  })

  it('does not accept a worker start without the speedup id', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('subagent', { prompt: 'unrelated work' })
    harness.toolResult(call, 'started')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('pending')
  })

  it('does not accept a cached delegation result as a worker start', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('delegate', {
      rule: 'task-review',
      change: 'my-change',
      context: 'apply speedup-1-a1b2',
    })
    harness.toolResult(
      call,
      'rule "task-review" PASS (reused record openspec/changes/my-change/reviews/abc.json)\n',
    )
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('pending')
  })

  it('accepts a delegation result that started a review run', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('delegate', {
      rule: 'task-review',
      change: 'my-change',
      context: 'apply speedup-1-a1b2',
    })
    harness.toolResult(call, 'rule "task-review" review started\nrun: run-1\nstate: running\n')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('started')
  })

  it('accepts a started answer delegate even when its answer mentions a queued review', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('delegate', {
      rule: 'research',
      context: 'apply speedup-1-a1b2',
    })
    harness.toolResult(
      call,
      'The review queued behind the existing task-review; here is the analysis.\n',
    )
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('started')
  })

  it('accepts an answer delegate whose first line mentions a reused record', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('delegate', {
      rule: 'research',
      context: 'apply speedup-1-a1b2',
    })
    harness.toolResult(
      call,
      'The previous review passed (reused record reviews/abc.json); here is the new analysis.\n',
    )
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('started')
  })

  it('accepts an answer delegate whose first line is a queued-review envelope', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('delegate', {
      rule: 'research',
      context: 'apply speedup-1-a1b2',
    })
    harness.toolResult(
      call,
      'rule "task-review" review queued\nrun: run-9\n\n(no gate record: this answer does not satisfy a strict review rule)',
    )
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('started')
  })

  it('does not accept a cached findings record that quotes the answer trailer', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('delegate', {
      rule: 'task-review',
      change: 'my-change',
      context: 'apply speedup-1-a1b2',
    })
    harness.toolResult(
      call,
      'rule "task-review" FINDINGS (reused record openspec/changes/my-change/reviews/abc.json)\nchange: my-change\n\n1 blocking finding(s):\n- P1 x\n  evidence: (no gate record: this answer does not satisfy a strict review rule)\n  fix: y\n\nA FINDINGS record does not satisfy a strict gate; fix the findings and re-run the rule.\n',
    )
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('pending')
  })

  it('ignores unchecked tasks in directories task_progress skips', async () => {
    const harness = await create()
    harness.availableTools.add('subagent')
    harness.availableTools.add('task_progress')
    await harness.writeFile('openspec/changes/.scratch/tasks.md', '- [ ] 1.1 Run tests\n')
    await seedPending(harness, 1)
    goalRound(harness, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('accepts a successful task_progress note whose reason contains the speedup id', async () => {
    const harness = await gateHarness()
    const call = harness.toolCall('task_progress', {
      task: '1.1 Implement the speed review',
      status: 'in-progress',
      reason: 'declined speedup-1-a1b2: not applied this round',
    })
    harness.toolResult(call, 'progress note written')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('declined')
  })

  it('steers once with the action id and record path when neither evidence exists', async () => {
    const harness = await gateHarness()
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0])
    expect(text).toContain('speedup-1-a1b2')
    expect(text).toContain('.dsh/goal-continuity/retro/goal-1/1.json')
    expect(text).toContain('task_progress(')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect((await harness.readRecord('goal-1', 1)).status).toBe('pending')
  })

  it('reports nothing for a missing record', async () => {
    const harness = await create()
    harness.availableTools.add('subagent')
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    goalRound(harness, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('reports nothing for an unreadable record', async () => {
    const harness = await create()
    harness.availableTools.add('subagent')
    harness.availableTools.add('task_progress')
    await writeChangeTask(harness)
    await harness.writeFile('.dsh/goal-continuity/retro/goal-1/1.json', 'not json')
    goalRound(harness, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('skips a subagent turn', async () => {
    const harness = await gateHarness()
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
    await harness.turnStopping(2, subagent)
    expect(harness.steers).toHaveLength(0)
  })

  it('fails open when a task_progress decline path is unavailable', async () => {
    const harness = await gateHarness({}, ['subagent'])
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('fails open when no active change has an eligible unchecked task', async () => {
    const harness = await create()
    harness.availableTools.add('subagent')
    harness.availableTools.add('task_progress')
    await seedPending(harness, 1)
    goalRound(harness, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('fails open when the eligible task id is ambiguous across changes', async () => {
    const harness = await create()
    harness.availableTools.add('subagent')
    harness.availableTools.add('task_progress')
    await harness.writeFile('openspec/changes/a-change/tasks.md', '- [ ] 1.1 Run tests\n')
    await harness.writeFile('openspec/changes/b-change/tasks.md', '- [ ] 1.1 Run tests\n')
    await seedPending(harness, 1)
    goalRound(harness, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('fails open when duplicate task text shares the id within one change', async () => {
    const harness = await create()
    harness.availableTools.add('subagent')
    harness.availableTools.add('task_progress')
    await harness.writeFile(
      'openspec/changes/my-change/tasks.md',
      '- [x] 1.1 Run tests\n- [ ] 2.1 Run tests\n',
    )
    await seedPending(harness, 1)
    goalRound(harness, 2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('fails open when no worker-start tool is registered', async () => {
    const harness = await gateHarness({}, ['task_progress'])
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('does not apply on a non-goal turn', async () => {
    const harness = await gateHarness()
    harness.turnStart(3)
    harness.directMessage('keep going')
    await harness.turnStopping(3)
    expect(harness.steers).toHaveLength(0)
  })
})
