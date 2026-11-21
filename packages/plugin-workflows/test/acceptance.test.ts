import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditActive } from '../../../scripts/reviews-check.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { issueAdoptionReceipt } from '../src/host/receipts.ts'
import { listAuthenticatedRuns, readAuthenticatedRun } from '../src/host/runs.ts'
import { sectionRecordId, taskIdOf } from '../src/host/tasks.ts'

/**
 * The local acceptance for the lane-owned review loop: the real plugin entry
 * drives two lane units, a whole-spec review, and a required integration review
 * in a temp workspace, with a scripted reviewer behind the subagent service and
 * a throwaway `DSH_HOME`. The report records the run, record, and approval paths
 * the scenarios verified.
 */

type Listener = (...args: unknown[]) => unknown

const KEY = 'a'.repeat(64)
const CHANGE = 'acceptance-live'
const LANE_ONE = 'First acceptance work'
const LANE_TWO = 'Second acceptance work'
const OWNED = join(import.meta.dirname, '..', '..', '..')
const REPORT = 'acceptance-report.json'

const TEMP_DIRECTORIES: string[] = []
let home = ''
let previousHome: string | undefined
let previousKey: string | undefined
const report: {
  v: number
  dshHome: string
  liveProfileTouched: boolean
  scenarios: Array<Record<string, unknown>>
} = { v: 1, dshHome: '', liveProfileTouched: false, scenarios: [] }

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflows-acceptance-'))
  TEMP_DIRECTORIES.push(root)
  home = join(root, 'home')
  await mkdir(home, { recursive: true })
  previousHome = process.env.DSH_HOME
  previousKey = process.env.DSH_WORKFLOWS_HOST_KEY
  process.env.DSH_HOME = home
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  report.dshHome = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousKey === undefined) delete process.env.DSH_WORKFLOWS_HOST_KEY
  else process.env.DSH_WORKFLOWS_HOST_KEY = previousKey
  // The throwaway home proves no scenario reached the owner's profile.
  expect(await readdir(home)).toEqual([])
  await mkdir(join(OWNED, '.tmp'), { recursive: true })
  await writeFile(join(OWNED, '.tmp', REPORT), JSON.stringify(report, null, 2), 'utf8')
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }),
  )
})

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs)
      throw new Error('the acceptance host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

interface Activation {
  key: string
  round: number
  digest: string
  release: () => void
}

/** One scripted reviewer: lane 1 is FINDINGS then PASS, every other unit PASSes. */
interface ScriptedReviewer {
  readonly activations: Activation[]
  /** When set, a start for this review key fails as an unavailable provider. */
  failKey?: string
  start(spec: { prompt: { type: string; text: string }[] }): Promise<unknown>
}

function scriptedReviewer(): ScriptedReviewer {
  const activations: Activation[] = []
  const releases: Array<() => void> = []
  const counts = new Map<string, number>()
  const reviewer: ScriptedReviewer = {
    activations,
    start: async (spec) => {
      const instruction = spec.prompt.map((block) => block.text).join('\n')
      const key = /- Review key: (.+)$/mu.exec(instruction)?.[1]?.trim() ?? ''
      if (reviewer.failKey !== undefined && key === reviewer.failKey) {
        throw Object.assign(new Error('the reviewer provider is unavailable'), {
          name: 'ConfigError',
        })
      }
      const digest = /- Digest: ([a-f0-9]{64})/u.exec(instruction)?.[1] ?? ''
      const round = (counts.get(key) ?? 0) + 1
      counts.set(key, round)
      const pending = new Promise<void>((resolve) => {
        releases.push(resolve)
      })
      const release = releases.at(-1) as () => void
      const input: Activation = { key, round, digest, release }
      activations.push(input)
      return {
        childId: `child-${String(activations.length)}`,
        result: pending.then(() => {
          const verdict = key.endsWith(':section:1') && round === 1 ? 'FINDINGS' : 'PASS'
          const findings =
            verdict === 'FINDINGS'
              ? [
                  {
                    severity: 'P1',
                    class: 'docs-drift',
                    title: 'The lane one note is incomplete',
                    evidence: 'The scripted reviewer reported one P1 for lane one.',
                    fix: 'Extend the lane one note and re-run the review.',
                  },
                ]
              : []
          return {
            output: [
              {
                type: 'text' as const,
                text: `\`\`\`json\n${JSON.stringify({
                  digest,
                  verdict,
                  findings,
                  ...(round > 1 ? { previous: [{ id: 'f1', status: 'closed' }] } : {}),
                })}\n\`\`\``,
              },
            ],
            stopReason: 'completed',
          }
        }),
        dispose: async () => undefined,
      }
    },
  }
  return reviewer
}

interface FakeHost {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  readonly steers: Array<{ content?: Array<{ text?: string }> }>
  readonly removed: string[]
  readonly injected: number[]
  /** Turns started by claiming a queued gate message. */
  readonly resumedTurns: number[]
  /** The model tool definitions the host registered (the `workflows` tool). */
  readonly toolDefinitions: Array<Record<string, unknown>>
  /** The gate messages still queued for the agent to claim. */
  pendingCount(): number
  /** What the agent loop does next: claim one queued message and start its turn. */
  claimInbox(): unknown
  emit(name: string, ...args: unknown[]): Promise<unknown>
}

function fakeHost(workspace: string, reviewer: ScriptedReviewer, withReviewer = true): FakeHost {
  const listeners = new Map<string, Listener[]>()
  const steers: Array<{ content?: Array<{ text?: string }> }> = []
  const removed: string[] = []
  const injected: number[] = []
  const resumedTurns: number[] = []
  const toolDefinitions: Array<Record<string, unknown>> = []
  // A real pending inbox: a steer queues its message id, a claim starts a turn,
  // and a removal deletes exactly that queued message.
  const queued = new Map<string, unknown>()
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' as const } },
    ctx: { on: () => () => {} },
    steer: (message: unknown) => {
      steers.push(message as { content?: Array<{ text?: string }> })
      const id = (message as { id?: unknown }).id
      if (typeof id === 'string' && id !== '') queued.set(id, message)
    },
    inbox: {
      remove: (id: unknown) => {
        const key = String(id)
        removed.push(key)
        return queued.delete(key)
      },
      claim: () => {
        const next = queued.keys().next()
        if (next.done === true) return undefined
        const message = queued.get(next.value)
        queued.delete(next.value)
        resumedTurns.push(Date.now())
        return message
      },
    },
    inject: () => {
      injected.push(Date.now())
    },
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: string) => ({ targetKey: path }),
          watch: async () => async () => {},
        }
      }
      if (name === 'connection') return { fetch: { register: () => () => {} } }
      if (name === 'tools') {
        return {
          get: () => undefined,
          register: (definition: unknown) => {
            toolDefinitions.push(definition as Record<string, unknown>)
            return () => {}
          },
        }
      }
      if (name === 'commands') return { register: () => () => {} }
      if (name === 'systemPrompt') return { context: () => () => {} }
      if (name === 'subagents' && withReviewer) {
        return {
          getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
          startActivation: (spec: { prompt: { type: string; text: string }[] }) =>
            reviewer.start(spec),
        }
      }
      return undefined
    },
    provide: () => {},
    on(name: string, listener: Listener): () => void {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    effect(callback: () => () => void): () => void {
      callback()
      return () => {}
    },
  }
  return {
    ctx,
    agent,
    steers,
    removed,
    injected,
    resumedTurns,
    toolDefinitions,
    pendingCount: () => queued.size,
    claimInbox: () => (agent.inbox.claim as () => unknown)(),
    emit: async (name, ...args) => {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = await listener(...args)
      return result
    },
  }
}

async function acceptanceWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'workflows-acceptance-ws-'))
  TEMP_DIRECTORIES.push(workspace)
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const change = join(workspace, 'openspec', 'changes', CHANGE)
  await mkdir(join(change, 'specs', CHANGE), { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# Proposal\n\nShip the acceptance loop.\n', 'utf8')
  await writeFile(
    join(change, 'design.md'),
    '# Design\n\nThe engine owns the review loop.\n',
    'utf8',
  )
  await writeFile(
    join(change, 'specs', CHANGE, 'spec.md'),
    '# Spec\n\n## Requirement\n\nThe change is reviewed before archive.\n',
    'utf8',
  )
  await writeFile(
    join(change, 'tasks.md'),
    `# Tasks\n\n## 1. First lane (lane 1, owns \`src/**\`)\n\n- [x] 1.1 ${LANE_ONE}\n\n## 2. Second lane (lane 2, owns \`docs/**\`)\n\n- [x] 2.1 ${LANE_TWO}\n`,
    'utf8',
  )
  await writeFile(
    join(workspace, 'openspec', 'review-approval.json'),
    JSON.stringify({ version: 1, archiveGate: true }),
    'utf8',
  )
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'lane.txt'), 'lane one\n', 'utf8')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'local-acceptance')
  git('config', 'user.email', 'local-acceptance@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return workspace
}

describe('local acceptance: the lane review loop', () => {
  it('runs two lanes, a whole-spec review, and a required integration review until PASS', async () => {
    const workspace = await acceptanceWorkspace()
    const reviewer = scriptedReviewer()
    const host = fakeHost(workspace, reviewer)
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await new Promise((resolve) => setTimeout(resolve, 200))

    const recordPath = (rule: string, file: string): string =>
      join(workspace, '.dsh', 'workflows', 'records', rule, CHANGE, file)
    const approvalPath = (taskId: string): string =>
      join(workspace, 'openspec', 'changes', CHANGE, 'reviews', `${taskId}.json`)
    const laneOneRecord = recordPath('task-review', join('tasks', `${sectionRecordId('1')}.json`))
    const laneTwoRecord = recordPath('task-review', join('tasks', `${sectionRecordId('2')}.json`))
    const specRecord = recordPath('spec-review', 'spec.json')
    const integrationRecord = recordPath('integration-review', 'integration.json')

    // A successful change-artifact write attributes the session to the change.
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'acceptance-involved',
        name: 'write',
        arguments: { file_path: `openspec/changes/${CHANGE}/design.md` },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )

    // Close 1: every due lane starts in one pass, with the two whole-scope
    // reviews, and every one of them is live before the close decides.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => reviewer.activations.length >= 4)
    const firstRound = [...reviewer.activations]
    const keys = firstRound.map((entry) => entry.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        `review:${CHANGE}:section:1`,
        `review:${CHANGE}:section:2`,
        `review:${CHANGE}:whole:spec`,
        `review:${CHANGE}:whole:integration`,
      ]),
    )
    // The waiting close is silent: no steer, no injection, no VIOLATION.
    expect(host.steers).toHaveLength(0)
    expect(host.injected).toHaveLength(0)
    const lanes = (await listAuthenticatedRuns(workspace, auth)).filter(
      (run) => run.definition.id === 'task-review',
    )
    expect(lanes.map((run) => run.context.section).sort()).toEqual(['1', '2'])
    for (const lane of lanes) {
      const view = await readAuthenticatedRun(workspace, lane.id, auth)
      expect(view?.violations).toHaveLength(0)
      expect(view?.steps.find((step) => step.id === 'review')?.state).toBe('open')
    }

    // Round 1: lane one reports FINDINGS, everything else PASSes.
    firstRound.find((entry) => entry.key.endsWith(':section:1'))?.release()
    firstRound.find((entry) => entry.key.endsWith(':section:2'))?.release()
    firstRound.find((entry) => entry.key.endsWith(':whole:spec'))?.release()
    firstRound.find((entry) => entry.key.endsWith(':whole:integration'))?.release()
    await waitFor(async () => (await readFile(laneOneRecord, 'utf8').catch(() => '')) !== '')
    await waitFor(async () => (await readFile(laneTwoRecord, 'utf8').catch(() => '')) !== '')
    await waitFor(async () => (await readFile(specRecord, 'utf8').catch(() => '')) !== '')
    await waitFor(async () => (await readFile(integrationRecord, 'utf8').catch(() => '')) !== '')
    const laneOneVerdict = JSON.parse(await readFile(laneOneRecord, 'utf8')) as {
      verdict: string
    }
    expect(laneOneVerdict.verdict).toBe('FINDINGS')
    expect(await readFile(approvalPath(taskIdOf(LANE_ONE)), 'utf8').catch(() => '')).toBe('')
    expect(
      (JSON.parse(await readFile(approvalPath(taskIdOf(LANE_TWO)), 'utf8')) as { verdict: string })
        .verdict,
    ).toBe('PASS')
    const frozenSpec = await readFile(specRecord, 'utf8')
    expect((JSON.parse(frozenSpec) as { verdict: string }).verdict).toBe('PASS')
    expect(
      (JSON.parse(await readFile(integrationRecord, 'utf8')) as { verdict: string }).verdict,
    ).toBe('PASS')

    // Close 2: the lane FINDINGS is historical — a code fix does not restart it;
    // the close refuses with the verdict and the documented explicit remedy. The
    // integration PASS is now stale against the changed worktree and starts one
    // round of its own.
    const laneOneKey = firstRound.find((entry) => entry.key.endsWith(':section:1'))?.key
    await writeFile(join(workspace, 'src', 'lane.txt'), 'lane one fixed\n', 'utf8')
    await waitFor(
      async () =>
        (await readdir(join(workspace, '.dsh', 'workflows', 'snapshots')).catch(() => []))
          .length === 0,
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(() => reviewer.activations.length >= 5, 60_000)
    const secondRound = reviewer.activations.slice(firstRound.length)
    expect(secondRound.filter((entry) => entry.key === laneOneKey)).toHaveLength(0)
    const refusal = host.steers
      .map((message) => (message.content ?? []).map((block) => block.text ?? '').join(''))
      .join('\n')
    expect(refusal).toContain('settled on FINDINGS')
    expect(refusal).toContain('start a fresh round')
    // The documented remedy starts exactly one fresh lane round on its unit key.
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (
            args: Record<string, unknown>,
            context: { agent: unknown },
          ) => Promise<{ text?: string }>
        }
      | undefined
    const started = await tool?.execute(
      { action: 'start', definitionId: 'task-review', change: CHANGE, section: '1' },
      { agent: host.agent },
    )
    expect(started?.text).toContain('started')
    await waitFor(() => reviewer.activations.length >= 6, 60_000)
    const laneOneAgain = reviewer.activations.find(
      (entry) => entry.key === laneOneKey && entry.round === 2,
    )
    expect(laneOneAgain).toBeDefined()
    expect(laneOneAgain?.key).toBe(laneOneKey)
    laneOneAgain?.release()
    secondRound
      .find((entry) => entry.key.endsWith(':whole:integration') && entry.round === 2)
      ?.release()
    await waitFor(
      async () => (await readFile(approvalPath(taskIdOf(LANE_ONE)), 'utf8').catch(() => '')) !== '',
    )
    // One more close lets every review run settle from its record; the triggers
    // start no new round because every unit now has a current PASS.
    const beforeSettle = reviewer.activations.length
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
    await waitFor(async () => {
      const all = await listAuthenticatedRuns(workspace, auth)
      return (
        all.length > 0 &&
        all.every(
          (run) =>
            !run.steps.some(
              (step) => step.id === 'review' && step.state !== 'done' && step.state !== 'cancelled',
            ),
        )
      )
    }, 60_000)
    expect(reviewer.activations).toHaveLength(beforeSettle)
    const audit = await auditActive(workspace, CHANGE)
    expect(audit.ok, audit.lines.join('\n')).toBe(true)

    // The whole-spec PASS stays current: parallel worktree work never stales it.
    const specDigest = await currentSpecDigest(workspace, CHANGE)
    expect((JSON.parse(await readFile(specRecord, 'utf8')) as { verdict: string }).verdict).toBe(
      'PASS',
    )
    expect(specDigest).toBeDefined()

    // The integration review is required: with every other evidence present the
    // archive is refused while its record is stale, and the user click is the
    // override beyond this scenario.
    const specDigestNow = await currentSpecDigest(workspace, CHANGE)
    await issueAdoptionReceipt(workspace, CHANGE, specDigestNow as string, auth, 3_000)
    const archive = async (
      callId: string,
    ): Promise<{ kind?: string; reason?: string } | undefined> =>
      (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command: `openspec archive ${CHANGE}` },
        },
        async () => ({ kind: 'continue' }),
      )) as { kind?: string; reason?: string } | undefined
    const allowed = await archive('acceptance-archive-allowed')
    if (allowed?.kind === 'deny') throw new Error(`archive denied: ${allowed.reason ?? ''}`)
    await writeFile(join(workspace, 'src', 'lane.txt'), 'lane one changed again\n', 'utf8')
    const stale = await archive('acceptance-archive-stale')
    expect(stale?.kind).toBe('deny')
    expect(stale?.reason).toContain('integration-review')

    // A user stop wins over the close: the aborted close starts nothing.
    const beforeStop = reviewer.activations.length
    const steersBeforeStop = host.steers.length
    const controller = new AbortController()
    controller.abort()
    await host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 3,
      signal: controller.signal,
    })
    expect(reviewer.activations).toHaveLength(beforeStop)
    expect(host.steers).toHaveLength(steersBeforeStop)
    expect(host.injected).toHaveLength(0)
    report.scenarios.push({
      scenario: 'lane review loop',
      change: CHANGE,
      laneOneKey,
      specKey: `review:${CHANGE}:whole:spec`,
      integrationKey: `review:${CHANGE}:whole:integration`,
      laneOneRecord,
      laneTwoRecord,
      specRecord,
      integrationRecord,
      laneOneApproval: approvalPath(taskIdOf(LANE_ONE)),
      laneTwoApproval: approvalPath(taskIdOf(LANE_TWO)),
      waitingClose: 'no steer, no injection, no violation',
      stop: 'no review start, no steer, no injection',
    })
  }, 120_000)

  it('aborts an in-progress refused close and revokes its queued gate message', async () => {
    const workspace = await acceptanceWorkspace()
    const reviewer = scriptedReviewer()
    // No reviewer service: every review start fails synchronously, so the gate
    // submits its refusal steer and the close is in progress when the stop lands.
    const host = fakeHost(workspace, reviewer, false)
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'stop-involved',
        name: 'write',
        arguments: { file_path: `openspec/changes/${CHANGE}/design.md` },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await waitFor(() => host.steers.length > 0)
    const submitted = host.steers.length
    expect(submitted).toBeGreaterThan(0)
    // The refused close queued its gate messages in the pending inbox.
    expect(host.pendingCount()).toBe(submitted)
    const queuedIds = host.steers
      .map((message) => (message as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string')
    controller.abort()
    await closing
    // The abort revokes exactly the queued gate messages, so the pending inbox
    // is empty and no turn can resume from it.
    expect(host.pendingCount()).toBe(0)
    expect(host.removed).toEqual(queuedIds)
    expect(host.claimInbox()).toBeUndefined()
    expect(host.resumedTurns).toHaveLength(0)
    expect(host.injected).toHaveLength(0)
    expect(reviewer.activations).toHaveLength(0)
    const runs = await listAuthenticatedRuns(workspace, auth)
    // No review run completed from the stopped close.
    expect(
      runs.some((run) => run.definition.id === 'task-review' && run.status === 'completed'),
    ).toBe(false)
    report.scenarios.push({
      scenario: 'aborted refused close',
      change: CHANGE,
      gateMessages: submitted,
      revoked: host.removed.length,
      pending: host.pendingCount(),
      resumedTurns: host.resumedTurns.length,
      injected: host.injected.length,
    })
  }, 120_000)
})
