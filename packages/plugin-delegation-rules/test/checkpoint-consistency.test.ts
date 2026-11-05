import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeSubagents, Harness, makeWorkspace, steerTexts, writeChange } from './helpers.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

type Section = [heading: string, tasks: Array<[number: string, text: string, checked: boolean]>]

function plan(sections: Section[]): string {
  const lines = ['# Tasks', '']
  for (const [heading, tasks] of sections) {
    lines.push(`## ${heading}`, '')
    for (const [number, text, checked] of tasks) {
      lines.push(`- [${checked ? 'x' : ' '}] ${number} ${text}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

const FIGURE = [
  { number: '1.1', text: 'First code' },
  { number: '1.2', text: 'Second code' },
  { number: '2.1', text: 'Write docs' },
  { number: '3.1', text: 'Run the gate' },
]

function twoLanes(code1: boolean, code2: boolean): string {
  return plan([
    [
      '1. Code (owns `src/**`)',
      [
        ['1.1', 'First code', code1],
        ['1.2', 'Second code', code2],
      ],
    ],
    ['2. Docs (owns `docs/a.md`)', [['2.1', 'Write docs', false]]],
    ['3. Serial tail (owns `packages/setup/**`)', [['3.1', 'Run the gate', false]]],
  ])
}

function oneLane(checked: boolean): string {
  return plan([['1. Code (owns `src/**`)', [['1.1', 'First code', checked]]]])
}

function laneConfig() {
  return {
    targets: {},
    rules: [
      {
        id: 'lane-fanout',
        when: 'lane-assignment' as const,
        contract: 'note' as const,
        gate: 'strict' as const,
      },
    ],
  }
}

type CheckpointLaneFixture = { id: string; owner: string; scope: string[]; state?: string }

function checkpointArgs(options: {
  lanes: CheckpointLaneFixture[]
  action?: string
  targets?: string[]
}): Record<string, unknown> {
  return {
    outcome: 'continue',
    verified: ['the work is verified'],
    lanes: options.lanes,
    bottleneck: {
      id: 'bottleneck-1',
      owner: 'lane-worker',
      action: options.action ?? 'worker_start',
      ...(options.targets === undefined ? {} : { targets: options.targets }),
    },
    next: 'continue with the next action',
  }
}

interface Setup {
  harness: Harness
  dir: string
}

/** Tick lane 1 and assign lane 2 to a tagged worker in the same turn. */
async function tickedAndAssigned(
  before: string,
  after: string,
  nestedCwd?: string,
): Promise<Setup> {
  const root = await workspace()
  const dir = await writeChange(root, 'change-a', FIGURE)
  await writeFile(join(dir, 'tasks.md'), before, 'utf8')
  const cwd = nestedCwd === undefined ? root : join(root, nestedCwd)
  const harness = new Harness({ cwd, config: laneConfig(), agents: new FakeSubagents() })
  await harness.preStep(1)
  await harness.writeResult(join(dir, 'tasks.md'), before, after, harness.agent, 'edit')
  await writeFile(join(dir, 'tasks.md'), after, 'utf8')
  await harness.toolOutcome('subagent', { prompt: 'lane-tag: change-a#2. Implement the docs.' }, {})
  return { harness, dir }
}

async function steersOf(setup: Setup): Promise<string> {
  await setup.harness.turnStopping(1)
  return steerTexts(setup.harness.agent).join('\n')
}

describe('worker-assigned checkpoint consistency', () => {
  it('passes when the assigned task lane is covered by a worker-owned checkpoint lane', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['docs/a.md'] }],
      }),
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(setup)).toBe('')
  })

  it('refuses a worker-assigned lane with no matching checkpoint lane', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'code', owner: 'lane-worker', scope: ['src/**'] }],
      }),
      { text: 'checkpoint saved' },
    )
    const message = await steersOf(setup)
    expect(message).toContain('rule "lane-fanout"')
    expect(message).toContain('lane "2. Docs (owns `docs/a.md`)" has no matching checkpoint lane')
  })

  it('refuses a worker-assigned lane covered only by a lead-owned checkpoint lane', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lead', scope: ['docs/a.md'] }],
      }),
      { text: 'checkpoint saved' },
    )
    const message = await steersOf(setup)
    expect(message).toContain(
      'lane "2. Docs (owns `docs/a.md`)" is covered only by lead-owned checkpoint lane(s)',
    )
  })

  it('refuses a lead_action bottleneck that targets the worker-assigned lane', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['docs/a.md'] }],
        action: 'lead_action',
        targets: ['docs/a.md'],
      }),
      { text: 'checkpoint saved' },
    )
    const message = await steersOf(setup)
    expect(message).toContain('lead_action bottleneck may not edit worker-assigned work')
    expect(message).toContain('use action "worker_start"')
    expect(message).toContain('"user_decision"')
  })

  it('accepts user_decision for a bottleneck targeting the worker-assigned lane', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['docs/a.md'] }],
        action: 'user_decision',
        targets: ['docs/a.md'],
      }),
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(setup)).toBe('')
  })

  it('matches equivalent path spellings in checkpoint scope and lead_action target', async () => {
    const covered = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await covered.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({ lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['./docs/a.md'] }] }),
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(covered)).toBe('')

    const escaped = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await escaped.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['./docs/a.md'] }],
        action: 'lead_action',
        targets: ['docs/./a.md'],
      }),
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(escaped)).toContain(
      'lead_action bottleneck may not edit worker-assigned work',
    )
  })

  it('resolves checkpoint paths against a nested session working directory', async () => {
    const nested = (code: boolean): string =>
      plan([
        [
          '1. Code (owns `packages/app/src/**`)',
          [
            ['1.1', 'First code', code],
            ['1.2', 'Second code', false],
          ],
        ],
        ['2. Docs (owns `packages/app/docs/**`)', [['2.1', 'Write docs', false]]],
        ['3. Serial tail (owns `packages/setup/**`)', [['3.1', 'Run the gate', false]]],
      ])

    const covered = await tickedAndAssigned(nested(false), nested(true), 'packages/app')
    await covered.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['docs/guide.md'] }],
      }),
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(covered)).toBe('')

    const escaped = await tickedAndAssigned(nested(false), nested(true), 'packages/app')
    await escaped.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({
        lanes: [{ id: 'docs', owner: 'lane-worker', scope: ['docs/guide.md'] }],
        action: 'lead_action',
        targets: ['docs/guide.md'],
      }),
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(escaped)).toContain(
      'lead_action bottleneck may not edit worker-assigned work',
    )
  })

  it('fails open on an unreadable checkpoint argument tree', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      { outcome: 'continue', lanes: 'not a plan' },
      { text: 'checkpoint saved' },
    )
    expect(await steersOf(setup)).not.toContain('worker-assigned')
  })

  it('fails open on an unreadable task lane plan', async () => {
    const setup = await tickedAndAssigned(twoLanes(false, false), twoLanes(true, false))
    await setup.harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({ lanes: [{ id: 'docs', owner: 'lead', scope: ['docs/a.md'] }] }),
      { text: 'checkpoint saved' },
    )
    await rm(join(setup.dir, 'tasks.md'))
    expect(await steersOf(setup)).not.toContain('worker-assigned')
  })

  it('reports nothing when no task lane was assigned to a tagged worker', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', FIGURE)
    const before = oneLane(false)
    const after = oneLane(true)
    await writeFile(join(dir, 'tasks.md'), before, 'utf8')
    const harness = new Harness({ cwd: root, config: laneConfig(), agents: new FakeSubagents() })
    await harness.preStep(1)
    await harness.writeResult(join(dir, 'tasks.md'), before, after, harness.agent, 'edit')
    await writeFile(join(dir, 'tasks.md'), after, 'utf8')
    await harness.toolOutcome(
      'work_checkpoint',
      checkpointArgs({ lanes: [{ id: 'code', owner: 'lead', scope: ['src/**'] }] }),
      { text: 'checkpoint saved' },
    )
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).not.toContain('worker-assigned')
  })
})
