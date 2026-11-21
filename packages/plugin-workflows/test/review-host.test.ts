import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateDefinition } from '../src/host/definitions.ts'
import { currentSpecDigest, reviewDigest } from '../src/host/evidence.ts'
import { SOFT_SETTLEMENT } from '../src/host/gates.ts'
import { defaultGit } from '../src/host/git.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { issueAdoptionReceipt, readReceipt } from '../src/host/receipts.ts'
import { definitionsRegistry } from '../src/host/registry.ts'
import { ReviewScheduler } from '../src/host/review-scheduler.ts'
import { reviewInputTree } from '../src/host/review-snapshot.ts'
import {
  createRun,
  listAuthenticatedRuns,
  readAuthenticatedRun,
  settleStep,
  writeRun,
} from '../src/host/runs.ts'
import { sectionRecordId, taskIdOf } from '../src/host/tasks.ts'

/**
 * Host-level regression for the native review executor: a frozen task snapshot
 * whose copied tasks.md no longer carries the selected task checked starts no
 * reviewer and releases the snapshot and its lease.
 */

type Listener = (...args: unknown[]) => unknown

const KEY = 'a'.repeat(64)
const SNAPSHOTS = join('.dsh', 'workflows', 'snapshots')
const TASK_ID = taskIdOf('Task')

const TEMP_DIRECTORIES: string[] = []

afterEach(async () => {
  delete process.env.DSH_WORKFLOWS_HOST_KEY
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-review-host-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

function reviewDefinition(): ReturnType<typeof validateDefinition> {
  return validateDefinition({
    v: 1,
    id: 'native-task-review',
    name: 'Native task review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
      gate: 'review',
      gateIdentity: 'native-task-review',
    },
    steps: [
      {
        id: 'review',
        title: 'Review the checked task',
        executor: 'review',
        review: { target: 'codex', instruction: 'review-task', scope: 'task' },
        evidence: {
          kind: 'record',
          rule: 'native-task-review',
          change: '{name}',
          scope: 'task',
          task: '{taskId}',
          verdicts: ['PASS', 'ERROR'],
          path: '.dsh/workflows/records/native-task-review/{name}/tasks/{taskId}.json',
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

/** A whole-scope review definition that settles a stored FINDINGS/PASS round. */
function settlementDefinition(): ReturnType<typeof validateDefinition> {
  return validateDefinition({
    v: 1,
    id: 'settle-spec-review',
    name: 'Settle spec review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
      gate: 'review',
      gateIdentity: 'settle-spec-review',
    },
    steps: [
      {
        id: 'review',
        title: 'Review the whole change spec',
        executor: 'review',
        review: { target: 'codex', instruction: 'review-spec', scope: 'whole', phase: 'spec' },
        evidence: {
          kind: 'record',
          rule: 'settle-spec-review',
          change: '{name}',
          phase: 'spec',
          scope: 'whole',
          verdicts: ['PASS', 'ERROR'],
          digest: 'current',
          path: '.dsh/workflows/records/settle-spec-review/{name}/spec.json',
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

/** A git-backed change whose only task is present but unchecked in the snapshot. */
async function gitWorkspace(): Promise<string> {
  const workspace = await tempWorkspace()
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const changeDir = join(workspace, 'openspec', 'changes', 'auth')
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
  await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
  await mkdir(join(changeDir, 'specs', 'auth'), { recursive: true })
  await writeFile(join(changeDir, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'review-host')
  git('config', 'user.email', 'review-host@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return workspace
}

interface DelayedReviewHost {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  /** The digest echoed by each started reviewer's prompt. */
  readonly digests: string[]
  /** Release one pending reviewer activation. */
  readonly releases: Array<() => void>
  /** The steer texts the host sent to the session-1 agent. */
  readonly steers: string[]
  /** The model tool definitions the host registered (the `workflows` tool). */
  readonly toolDefinitions: Array<Record<string, unknown>>
  /** Resolves when a released activation is disposed, i.e. teardown is confirmed. */
  readonly disposed: Promise<void>
  emit(name: string, ...args: unknown[]): Promise<unknown>
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A fake host whose reviewer activations stay pending until each is released. */
function delayedReviewHost(workspace: string, verdict: 'PASS' | 'FINDINGS'): DelayedReviewHost {
  const listeners = new Map<string, Listener[]>()
  const digests: string[] = []
  const releases: Array<() => void> = []
  const steers: string[] = []
  const toolDefinitions: Array<Record<string, unknown>> = []
  let confirmDispose: (() => void) | undefined
  const disposed = new Promise<void>((resolve) => {
    confirmDispose = resolve
  })
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' } },
    ctx: { on: () => () => {} },
    steer: (message: unknown) => {
      const content = (message as { content?: Array<{ text?: string }> }).content
      steers.push(content?.map((block) => block.text ?? '').join('') ?? '')
    },
    inject: () => {},
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
      if (name === 'connection') {
        return { fetch: { register: () => () => {} } }
      }
      if (name === 'userQuestions') {
        return {
          ask: async (request: { questions: ReadonlyArray<{ id: string }> }) => ({
            answers: request.questions.map((question) => ({
              id: question.id,
              selected: ['yes'],
            })),
          }),
        }
      }
      if (name === 'subagents') {
        return {
          getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
          startActivation: async (spec: { prompt: { text: string }[] }) => {
            const instruction = spec.prompt.map((block) => block.text).join('\n')
            const digest = /- Digest: ([a-f0-9]{64})/u.exec(instruction)?.[1] ?? ''
            digests.push(digest)
            const pending = new Promise<void>((resolve) => {
              releases.push(resolve)
            })
            const findings =
              verdict === 'FINDINGS'
                ? [
                    {
                      severity: 'P0',
                      class: 'state-persistence',
                      title: 'late verdict',
                      evidence: 'the review ran after the settlement',
                      fix: 'fence the queued reviewer',
                    },
                  ]
                : []
            return {
              childId: `child-${digests.length}`,
              result: pending.then(() => ({
                output: [
                  {
                    type: 'text',
                    text: `\`\`\`json\n${JSON.stringify({ digest, verdict, findings })}\n\`\`\``,
                  },
                ],
                stopReason: 'completed',
              })),
              dispose: async () => {
                confirmDispose?.()
              },
            }
          },
        }
      }
      if (name === 'systemPrompt') return { context: () => () => {} }
      if (name === 'tools') {
        return {
          get: () => undefined,
          register: (definition: unknown) => {
            toolDefinitions.push(definition as Record<string, unknown>)
            return () => {}
          },
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
  const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
    let result: unknown
    for (const listener of listeners.get(name) ?? []) result = await listener(...args)
    return result
  }
  return { ctx, agent, digests, releases, steers, toolDefinitions, disposed, emit }
}

describe('native review host admission', () => {
  it('starts no reviewer for an unchecked frozen task and removes its snapshot lease', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const listeners = new Map<string, Listener[]>()
    let activationCalls = 0
    const agent = {
      id: 'session-1',
      session: { id: 'session-1', header: { origin: 'root' } },
      ctx: { on: () => () => {} },
      steer: () => {},
      inject: () => {},
    }
    const add = (name: string, listener: Listener): void => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
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
        if (name === 'connection') {
          return {
            fetch: {
              register: () => () => {},
            },
          }
        }
        if (name === 'subagents') {
          return {
            getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
            startActivation: async () => {
              activationCalls += 1
              throw new Error('an unchecked frozen task must not start a reviewer')
            },
          }
        }
        if (name === 'systemPrompt') return { context: () => () => {} }
        return undefined
      },
      provide: () => {},
      on(name: string, listener: Listener): () => void {
        add(name, listener)
        return () => {}
      },
      effect: () => () => {},
    }
    const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = await listener(...args)
      return result
    }
    try {
      apply(ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth', taskId: TASK_ID },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await emit('agent/turn-stopping', { agent, turn: 1 })
      const settled = await readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps[0]?.state).toBe('failed')
      expect(settled?.steps[0]?.reason).toContain('changed or became unchecked')
      // The rejected frozen task starts no reviewer.
      expect(activationCalls).toBe(0)
      // Its checkout and lease are gone, not left renewing.
      const snapshots = await readdir(join(workspace, SNAPSHOTS)).catch(() => [] as string[])
      expect(snapshots).toEqual([])
    } finally {
      unregister()
    }
  })

  it('admits whole-scope phases separately through the host', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definitions = ['spec', 'integration'].map((phase) =>
      validateDefinition({
        v: 1,
        id: `phase-${phase}`,
        name: `Phase ${phase}`,
        version: 1,
        trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
        settings: {
          allowModelStart: true,
          risk: 'low',
          gateOwnership: 'own',
          maxBlocks: 3,
          allowIntent: false,
          gate: 'review',
          gateIdentity: 'phase-review',
        },
        steps: [
          {
            id: 'review',
            title: 'Whole review',
            executor: 'review',
            review: {
              target: 'codex',
              instruction: phase === 'spec' ? 'review-spec' : 'review-integration',
              scope: 'whole',
              phase,
            },
            evidence: {
              kind: 'record',
              rule: 'phase-review',
              change: '{name}',
              scope: 'whole',
              verdicts: ['PASS', 'ERROR'],
              digest: 'current',
              path: `.dsh/workflows/records/phase-${phase}/{name}/${phase}.json`,
            },
            next: 'end',
            blockTurnClose: true,
          },
        ],
      }),
    )
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions,
    })
    const host = delayedReviewHost(workspace, 'PASS')
    const { emit, agent } = host
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      for (const definition of definitions) {
        const run = createRun({
          definition: definition.id,
          trigger: 'turn.stopping',
          session: 'session-1',
          workspace,
          context: { name: 'auth' },
          steps: ['review'],
          now: 1_000,
        })
        await writeRun(workspace, run, auth)
      }
      await emit('agent/turn-stopping', { agent, turn: 1 })
      // Both admissions must start before either result arrives; with the host
      // phase omitted the second dedupes and only one activation starts.
      await waitFor(() => host.releases.length >= 2)
      expect(host.releases).toHaveLength(2)
      for (const release of host.releases) release()
      const records = await Promise.all(
        definitions.map(async (definition) => {
          const path = join(
            workspace,
            '.dsh/workflows/records',
            definition.id,
            'auth',
            `${definition.steps[0]?.review?.phase ?? ''}.json`,
          )
          for (let attempt = 0; attempt < 250; attempt += 1) {
            const text = await readFile(path, 'utf8').catch(() => undefined)
            if (text !== undefined) return JSON.parse(text) as { verdict: string }
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
          throw new Error(`no record for ${definition.id}`)
        }),
      )
      expect(records.map((record) => record.verdict)).toEqual(['PASS', 'PASS'])
    } finally {
      unregister()
    }
  })

  it('publishes the frozen whole-spec verdict while the live artifacts change', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definition = validateDefinition({
      v: 1,
      id: 'native-spec-review',
      name: 'Native spec review',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: true,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
        gate: 'review',
        gateIdentity: 'native-spec-review',
      },
      steps: [
        {
          id: 'review',
          title: 'Review the whole change spec',
          executor: 'review',
          review: { target: 'codex', instruction: 'review-spec', scope: 'whole', phase: 'spec' },
          evidence: {
            kind: 'record',
            rule: 'native-spec-review',
            change: '{name}',
            phase: 'spec',
            scope: 'whole',
            verdicts: ['PASS', 'ERROR'],
            digest: 'current',
            path: '.dsh/workflows/records/native-spec-review/{name}/spec.json',
          },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    })
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      const frozenDigest = await currentSpecDigest(workspace, 'auth')
      if (frozenDigest === undefined) throw new Error('the change digest is missing')
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.releases.length >= 1)
      // Edit a reviewed plan artifact while the snapshot review runs: the frozen
      // verdict still publishes, with no input-change ERROR, and its record is
      // stale against the edited artifacts.
      await writeFile(
        join(workspace, 'openspec', 'changes', 'auth', 'design.md'),
        '# Design\n\nAn edited decision.\n',
        'utf8',
      )
      host.releases[0]?.()
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'native-spec-review',
        'auth',
        'spec.json',
      )
      await waitFor(async () => (await readFile(recordPath, 'utf8').catch(() => '')) !== '')
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
      expect(record.verdict).toBe('PASS')
      expect(record.error).toBeUndefined()
      expect(record.digest).toBe(reviewDigest({ scope: 'whole', specDigest: frozenDigest }))
      const liveDigest = await currentSpecDigest(workspace, 'auth')
      expect(liveDigest).not.toBe(frozenDigest)
      expect(record.digest).not.toBe(
        reviewDigest({ scope: 'whole', specDigest: liveDigest as string }),
      )
      // The step is not done from a stale record: the unit is due again.
      const settled = await readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps[0]?.state).not.toBe('done')
      // Wait for the settlement cleanup so the next close reads a stable store.
      await waitFor(
        async () => (await readdir(join(workspace, SNAPSHOTS)).catch(() => [])).length === 0,
      )
      // The next close starts the next round on the same unit key and, while it
      // is live, is the silent waiting close.
      const steered = host.steers.length
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      await waitFor(() => host.releases.length >= 2)
      expect(host.steers).toHaveLength(steered)
      host.releases[1]?.()
      await waitFor(async () => {
        const settledAgain = await readAuthenticatedRun(workspace, run.id, auth)
        return settledAgain?.steps[0]?.state === 'done'
      })
    } finally {
      unregister()
    }
  })

  it('discards a live-fallback whole-spec verdict when a reviewed artifact changes', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    // The project's own negation keeps `.dsh` unignored even after the automatic
    // exclude rule: the snapshot is refused and the review falls back to the
    // live artifacts under the mutation guard.
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n!.dsh/\n', 'utf8')
    const definition = validateDefinition({
      v: 1,
      id: 'fallback-spec-review',
      name: 'Fallback spec review',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: true,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
        gate: 'review',
        gateIdentity: 'fallback-spec-review',
      },
      steps: [
        {
          id: 'review',
          title: 'Review the whole change spec',
          executor: 'review',
          review: { target: 'codex', instruction: 'review-spec', scope: 'whole', phase: 'spec' },
          evidence: {
            kind: 'record',
            rule: 'fallback-spec-review',
            change: '{name}',
            phase: 'spec',
            scope: 'whole',
            verdicts: ['PASS', 'ERROR'],
            digest: 'current',
            path: '.dsh/workflows/records/fallback-spec-review/{name}/spec.json',
          },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    })
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.releases.length >= 1)
      await writeFile(
        join(workspace, 'openspec', 'changes', 'auth', 'proposal.md'),
        '# Proposal\n\nAn edit-read-restore cannot pass this guard.\n',
        'utf8',
      )
      host.releases[0]?.()
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'fallback-spec-review',
        'auth',
        'spec.json',
      )
      await waitFor(async () => (await readFile(recordPath, 'utf8').catch(() => '')) !== '')
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
      expect(record.verdict).toBe('ERROR')
      expect(record.failureClass).toBe('reviewed-inputs-changed')
    } finally {
      unregister()
    }
  })

  it.each([
    { name: 'changes the skip_specs marker', restore: false },
    { name: 'changes and restores the skip_specs marker', restore: true },
  ])('discards a live-fallback whole-spec verdict when the run $name', async ({ restore }) => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    // A spec-less change: the marker is the reviewed eligibility state.
    await rm(join(workspace, 'openspec', 'changes', 'auth', 'specs'), {
      recursive: true,
      force: true,
    })
    const markerPath = join(workspace, 'openspec', 'changes', 'auth', '.openspec.yaml')
    const original = 'schema: spec-driven\nskip_specs: true\n'
    await writeFile(markerPath, original, 'utf8')
    // The project's own negation keeps `.dsh` unignored: the snapshot is refused
    // and the review falls back to the live artifacts under the mutation guard.
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n!.dsh/\n', 'utf8')
    const definition = validateDefinition({
      v: 1,
      id: 'fallback-marker-review',
      name: 'Fallback marker review',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: true,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
        gate: 'review',
        gateIdentity: 'fallback-marker-review',
      },
      steps: [
        {
          id: 'review',
          title: 'Review the whole change spec',
          executor: 'review',
          review: { target: 'codex', instruction: 'review-spec', scope: 'whole', phase: 'spec' },
          evidence: {
            kind: 'record',
            rule: 'fallback-marker-review',
            change: '{name}',
            phase: 'spec',
            scope: 'whole',
            verdicts: ['PASS', 'ERROR'],
            digest: 'current',
            path: '.dsh/workflows/records/fallback-marker-review/{name}/spec.json',
          },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    })
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.releases.length >= 1)
      await writeFile(markerPath, 'schema: spec-driven\nskip_specs: false\n', 'utf8')
      if (restore) await writeFile(markerPath, original, 'utf8')
      host.releases[0]?.()
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'fallback-marker-review',
        'auth',
        'spec.json',
      )
      await waitFor(async () => (await readFile(recordPath, 'utf8').catch(() => '')) !== '')
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
      expect(record.verdict).toBe('ERROR')
      expect(record.failureClass).toBe('reviewed-inputs-changed')
      expect(String(record.error)).toContain('.openspec.yaml')
    } finally {
      unregister()
    }
  })

  it('normalizes task ticks and approvals out of the change artifact digest', async () => {
    const workspace = await gitWorkspace()
    const before = await currentSpecDigest(workspace, 'auth')
    if (before === undefined) throw new Error('the change digest is missing')
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    expect(await currentSpecDigest(workspace, 'auth')).toBe(before)
    // A portable approval is not a reviewed plan artifact.
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'reviews', '0123456789abcdef.json'), '{}\n', 'utf8')
    expect(await currentSpecDigest(workspace, 'auth')).toBe(before)
    // A reviewed plan artifact does move the digest.
    await writeFile(join(changeDir, 'design.md'), '# Design\n\nA new decision.\n', 'utf8')
    expect(await currentSpecDigest(workspace, 'auth')).not.toBe(before)
  })

  it('accepts the creation spec PASS after later task ticks without refreshing it', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const creationDigest = await currentSpecDigest(workspace, 'auth')
    if (creationDigest === undefined) throw new Error('the creation digest is missing')
    // The whole-spec review passed while the task was unchecked, and the owner
    // adoption receipt was issued at that creation digest.
    const specRecordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(specRecordDir, { recursive: true })
    await writeFile(
      join(specRecordDir, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest: creationDigest, findings: [], time: '2026-11-17T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    await issueAdoptionReceipt(workspace, 'auth', creationDigest, auth, 3_000)
    // Later work ticks the task and writes its portable approval.
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    expect(await currentSpecDigest(workspace, 'auth')).toBe(creationDigest)
    const taskId = taskIdOf('Task')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(
      join(changeDir, 'reviews', `${taskId}.json`),
      `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], target: { provider: 'codex-subagent' }, time: '2026-11-17T00:01:00.000Z' })}\n`,
      'utf8',
    )
    // A current integration PASS over the ticked worktree binds the content tree.
    const tree = await reviewInputTree(
      workspace,
      { dir: changeDir },
      defaultGit,
      AbortSignal.timeout(10_000),
    )
    const integrationRecordDir = join(
      workspace,
      '.dsh',
      'workflows',
      'records',
      'integration-review',
      'auth',
    )
    await mkdir(integrationRecordDir, { recursive: true })
    await writeFile(
      join(integrationRecordDir, 'integration.json'),
      `${JSON.stringify({ rule: 'integration-review', change: 'auth', phase: 'integration', scope: 'whole', verdict: 'PASS', digest: reviewDigest({ scope: 'whole', specDigest: creationDigest, tree }), findings: [], time: '2026-11-17T00:02:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    // The archive accepts the creation PASS: no spec re-review, no new receipt.
    const host = delayedReviewHost(workspace, 'PASS')
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'archive-after-ticks',
        name: 'pwsh',
        arguments: { command: 'openspec archive auth' },
      },
      async () => ({ kind: 'continue' }),
    )) as { kind?: string; reason?: string } | undefined
    if (decision?.kind === 'deny') {
      throw new Error(`the creation PASS was not durable: ${decision.reason ?? ''}`)
    }
    expect(decision?.kind).not.toBe('deny')
    expect(await readReceipt(workspace, 'auth', auth)).toMatchObject({ kind: 'adoption' })
  })

  it('does not complete a shipped review step from an ERROR record', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const digest = await currentSpecDigest(workspace, 'auth')
    if (digest === undefined) throw new Error('the change digest is missing')
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'ERROR', digest: reviewDigest({ scope: 'whole', specDigest: digest }), findings: [], failureClass: 'invalid-output', error: 'the reviewer returned prose only', time: '2026-11-17T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    const host = delayedReviewHost(workspace, 'PASS')
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    const run = createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: ['review'],
      now: 1_000,
    })
    await writeRun(workspace, run, auth)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const settled = await readAuthenticatedRun(workspace, run.id, auth)
    // A stored terminal ERROR at the current digest settles the step failed: no
    // new reviewer starts for the same snapshot, and the reason names the verdict.
    expect(settled?.steps[0]?.state).toBe('failed')
    expect(settled?.steps[0]?.reason).toContain('settled on ERROR (invalid-output)')
    // Give a stray reviewer publication the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const record = JSON.parse(await readFile(join(recordDir, 'spec.json'), 'utf8')) as {
      verdict: string
    }
    expect(record.verdict).toBe('ERROR')
  })

  it.each(['FINDINGS', 'PASS'] as const)(
    'keeps a nonCritical review required past the old soft budget and publishes the late %s verdict',
    async (verdict) => {
      process.env.DSH_WORKFLOWS_HOST_KEY = KEY
      const workspace = await gitWorkspace()
      const definition = validateDefinition({
        v: 1,
        id: 'native-integration-review',
        name: 'Native integration review',
        version: 1,
        trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
        settings: {
          allowModelStart: true,
          risk: 'low',
          gateOwnership: 'own',
          maxBlocks: 1,
          allowIntent: false,
          gate: 'review',
          gateIdentity: 'native-integration-review',
        },
        steps: [
          {
            id: 'review',
            title: 'Review the worktree',
            executor: 'review',
            review: {
              target: 'codex',
              instruction: 'review-integration',
              scope: 'whole',
              phase: 'integration',
            },
            evidence: {
              kind: 'record',
              rule: 'native-integration-review',
              change: '{name}',
              scope: 'whole',
              phase: 'integration',
              verdicts: ['PASS', 'ERROR'],
              digest: 'current-worktree',
              path: '.dsh/workflows/records/native-integration-review/{name}/integration.json',
            },
            next: 'end',
            blockTurnClose: true,
            nonCritical: true,
          },
        ],
      })
      const unregister = definitionsRegistry.register({
        source: 'workflows-test',
        definitions: [definition],
      })
      const host = delayedReviewHost(workspace, verdict)
      try {
        apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
        const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
        const run = createRun({
          definition: definition.id,
          trigger: 'turn.stopping',
          session: 'session-1',
          workspace,
          context: { name: 'auth' },
          steps: ['review'],
          now: 1_000,
        })
        await writeRun(workspace, run, auth)
        // The first close refuses once and starts the delayed reviewer.
        await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
        await waitFor(() => host.digests.length === 1)
        // The second close is the waiting close: the old soft settlement is
        // gone, so the run stays open and records no violation.
        await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
        const waiting = await readAuthenticatedRun(workspace, run.id, auth)
        expect(['running', 'blocked']).toContain(waiting?.status)
        expect(waiting?.reason).not.toBe(SOFT_SETTLEMENT)
        expect(waiting?.violations).toHaveLength(0)
        expect(waiting?.steps[0]?.state).not.toBe('cancelled')
        // The delayed verdict publishes and settles the step.
        host.releases[0]?.()
        await host.disposed
        const recordPath = join(
          workspace,
          '.dsh/workflows/records/native-integration-review/auth/integration.json',
        )
        await waitFor(
          async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
        )
        const record = JSON.parse(await readFile(recordPath, 'utf8')) as { verdict: string }
        expect(record.verdict).toBe(verdict)
        await waitFor(async () => {
          const current = await readAuthenticatedRun(workspace, run.id, auth)
          return current?.steps[0]?.state === (verdict === 'PASS' ? 'done' : 'blocked')
        })
        if (verdict === 'PASS') {
          // The next close advances the settled run to completion.
          await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
          const completed = await readAuthenticatedRun(workspace, run.id, auth)
          expect(completed?.status).toBe('completed')
          expect(completed?.violations).toHaveLength(0)
        } else {
          const after = await readAuthenticatedRun(workspace, run.id, auth)
          expect(after?.status).not.toBe('completed')
          expect(after?.steps[0]?.state).toBe('blocked')
          expect(after?.violations).toHaveLength(0)
        }
      } finally {
        unregister()
      }
    },
  )
})

/** The OpenSpec plugin's contributed intake, as the real profile registers it. */
function contributedIntake(): ReturnType<typeof validateDefinition> {
  return validateDefinition(
    JSON.parse(
      readFileSync(
        join(
          fileURLToPath(new URL('.', import.meta.url)),
          '..',
          '..',
          'plugin-openspec',
          'assets',
          'workflows',
          'change-intake.json',
        ),
        'utf8',
      ),
    ),
  )
}

describe('shared whole-spec review admission', () => {
  it('keeps the intake run when the built-in review of the shared identity is live', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const intake = contributedIntake()
    const unregister = definitionsRegistry.register({
      source: '@dsh-setup/plugin-openspec',
      definitions: [intake],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      // Session 2's built-in whole-spec review is running while session 1
      // advances its intake: both steps share the canonical spec-review
      // identity, its queue admission, and its record.
      const builtin = createRun({
        definition: 'spec-review',
        trigger: 'turn.stopping',
        session: 'session-2',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, builtin, auth)
      let intakeRun = createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: intake.steps.map((step) => step.id),
        now: 2_000,
      })
      for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
        intakeRun = settleStep(intakeRun, step, 'done', { at: 2_100 })
      }
      await writeRun(workspace, intakeRun, auth)
      const steersTwo: string[] = []
      const agentTwo = {
        ...host.agent,
        id: 'session-2',
        session: { id: 'session-2', header: { origin: 'root' as const } },
        steer: (message: unknown) => {
          const content = (message as { content?: Array<{ text?: string }> }).content
          steersTwo.push(content?.map((block) => block.text ?? '').join('') ?? '')
        },
      }
      // Session 2 starts the shared review and leaves it live.
      await host.emit('agent/turn-stopping', { agent: agentTwo, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      const beforeIntake = host.steers.length
      // Session 1 must keep its own run and stay pending instead of adopting
      // the live built-in run, whose steps would replace the intake's.
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      const admitted = await readAuthenticatedRun(workspace, intakeRun.id, auth)
      expect(admitted?.definition.id).toBe('change-intake')
      expect(admitted?.steps.map((step) => step.id)).toEqual(intake.steps.map((step) => step.id))
      expect(admitted?.steps.find((step) => step.id === 'spec-review')?.state).toBe('open')
      // A live review of the shared identity covers the intake step too: the
      // close waits silently instead of steering the same unit.
      expect(host.steers).toHaveLength(beforeIntake)
      // The shared identity ran one reviewer, not two.
      expect(host.digests).toHaveLength(1)
      // A waiting run publishes no record while it waits: the shared record
      // belongs to the live attempt and does not exist yet.
      const sharedRecordPath = join(workspace, '.dsh/workflows/records/spec-review/auth/spec.json')
      expect(await readFile(sharedRecordPath, 'utf8').catch(() => undefined)).toBeUndefined()
      expect(admitted?.steps.find((step) => step.id === 'spec-review')?.evidence).toBeUndefined()
      // A waiting close submits no steer: session 2's own close ends silently
      // while its review is live (design D3).
      expect(steersTwo).toHaveLength(0)
      // The shared PASS record satisfies the intake step, so its close passes
      // and the completed intake issues its receipt.
      const release = host.releases[0]
      if (release === undefined) throw new Error('the shared review never started')
      release()
      const recordPath = sharedRecordPath
      await waitFor(
        async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
      )
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      const completed = await readAuthenticatedRun(workspace, intakeRun.id, auth)
      expect(completed?.status).toBe('completed')
      expect(completed?.steps.every((step) => step.state === 'done')).toBe(true)
      expect(await readReceipt(workspace, 'auth', auth)).toMatchObject({
        kind: 'intake',
        change: 'auth',
      })
    } finally {
      unregister()
    }
  })
})

const SECTION = { key: '1', title: '1. Section' }
const SECTION_TASKS = ['First task', 'Second task', 'Third task']
const SECTION_IDS = SECTION_TASKS.map((text) => taskIdOf(text))

/** A git-backed change whose section 1 has every task checked. */
async function sectionWorkspace(): Promise<string> {
  const workspace = await tempWorkspace()
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const changeDir = join(workspace, 'openspec', 'changes', 'auth')
  await mkdir(join(changeDir, 'reviews'), { recursive: true })
  await writeFile(
    join(changeDir, 'tasks.md'),
    `# Tasks\n\n## ${SECTION.title}\n\n${SECTION_TASKS.map((text, index) => `- [x] 1.${String(index + 1)} ${text}`).join('\n')}\n`,
    'utf8',
  )
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'review-host')
  git('config', 'user.email', 'review-host@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return workspace
}

/** One section run whose context names the whole checked coverage. */
async function startSectionRun(
  workspace: string,
  definition: ReturnType<typeof reviewDefinition>,
): Promise<{ readonly runId: string; readonly recordPath: string }> {
  const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
  const run = createRun({
    definition: definition.id,
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace,
    context: {
      name: 'auth',
      taskId: sectionRecordId(SECTION.key),
      section: SECTION.key,
      sectionTitle: SECTION.title,
      taskIds: SECTION_IDS,
    },
    steps: ['review'],
    now: 1_000,
  })
  await writeRun(workspace, run, auth)
  return {
    runId: run.id,
    recordPath: join(
      workspace,
      '.dsh',
      'workflows',
      'records',
      definition.id,
      'auth',
      'tasks',
      `${sectionRecordId(SECTION.key)}.json`,
    ),
  }
}

describe('section review publication through the host', () => {
  it('preserves a matching approval and publishes only the missing section approvals', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await sectionWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const changeDir = join(workspace, 'openspec', 'changes', 'auth')
      // The first task already carries a matching approval in a formatting the
      // publisher must leave byte-identical; its digest is a prior review's.
      const preserved = `${JSON.stringify(
        {
          rule: definition.id,
          change: 'auth',
          scope: 'task',
          taskId: SECTION_IDS[0],
          digest: 'b'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      )}\n`
      const preservedPath = join(changeDir, 'reviews', `${SECTION_IDS[0]}.json`)
      await writeFile(preservedPath, preserved, 'utf8')
      const { runId, recordPath } = await startSectionRun(workspace, definition)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      host.releases[0]?.()
      await waitFor(
        async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
      )
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
        readonly verdict: string
        readonly digest: string
        readonly section: string
        readonly taskId: string
        readonly taskIds: string[]
      }
      expect(record).toMatchObject({
        scope: 'task',
        section: SECTION.key,
        taskId: sectionRecordId(SECTION.key),
        taskIds: SECTION_IDS,
        verdict: 'PASS',
      })
      // The matching approval stays byte-identical; the missing covered tasks
      // each get the section verdict's own approval.
      expect(await readFile(preservedPath, 'utf8')).toBe(preserved)
      for (const taskId of SECTION_IDS.slice(1)) {
        const approval = JSON.parse(
          await readFile(join(changeDir, 'reviews', `${taskId}.json`), 'utf8'),
        ) as Record<string, unknown>
        expect(approval).toMatchObject({
          rule: definition.id,
          change: 'auth',
          taskId,
          digest: record.digest,
          verdict: 'PASS',
        })
      }
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const stepState = async (): Promise<string | undefined> =>
        (await readAuthenticatedRun(workspace, runId, auth))?.steps[0]?.state
      await waitFor(async () => (await stepState()) !== 'open')
      expect(
        (await readAuthenticatedRun(workspace, runId, auth))?.steps[0]?.state,
        (await readAuthenticatedRun(workspace, runId, auth))?.steps[0]?.reason,
      ).toBe('done')
    } finally {
      unregister()
    }
  })

  it('replaces a malformed approval instead of preserving it', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await sectionWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const changeDir = join(workspace, 'openspec', 'changes', 'auth')
      // A malformed approval that matches the reviewer identity but not the
      // portable schema: completion coverage rejects it, so the section PASS
      // must replace it rather than preserve its bytes.
      const malformed = `${JSON.stringify(
        {
          rule: definition.id,
          change: 'auth',
          scope: 'whole',
          taskId: SECTION_IDS[0],
          digest: 'not-a-digest',
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      )}\n`
      const path = join(changeDir, 'reviews', `${SECTION_IDS[0]}.json`)
      await writeFile(path, malformed, 'utf8')
      const { recordPath } = await startSectionRun(workspace, definition)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      host.releases[0]?.()
      await waitFor(
        async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
      )
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as { digest: string }
      const replaced = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      expect(replaced).toMatchObject({
        rule: definition.id,
        change: 'auth',
        scope: 'task',
        taskId: SECTION_IDS[0],
        digest: record.digest,
        verdict: 'PASS',
      })
      expect(replaced.digest).toMatch(/^[0-9a-f]{64}$/u)
    } finally {
      unregister()
    }
  })

  it('keeps an existing approval byte-identical when a section FINDINGS names it', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await sectionWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'FINDINGS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const changeDir = join(workspace, 'openspec', 'changes', 'auth')
      // A review already approved the first task. Design D4 reopens the review
      // obligation on a section FINDINGS; it never deletes that approval.
      const approval = `${JSON.stringify(
        {
          rule: definition.id,
          change: 'auth',
          scope: 'task',
          taskId: SECTION_IDS[0],
          digest: 'c'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      )}\n`
      const path = join(changeDir, 'reviews', `${SECTION_IDS[0]}.json`)
      await writeFile(path, approval, 'utf8')
      const { runId, recordPath } = await startSectionRun(workspace, definition)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      host.releases[0]?.()
      await waitFor(
        async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
      )
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as { verdict: string }
      expect(record.verdict).toBe('FINDINGS')
      expect(await readFile(path, 'utf8')).toBe(approval)
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      await waitFor(
        async () =>
          (await readAuthenticatedRun(workspace, runId, auth))?.steps[0]?.state === 'blocked',
      )
      const steersBefore = host.steers.length
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      expect(host.steers.length).toBeGreaterThan(steersBefore)
    } finally {
      unregister()
    }
  })

  it('reopens the covered section tasks on a section FINDINGS', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await sectionWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'FINDINGS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const changeDir = join(workspace, 'openspec', 'changes', 'auth')
      const { runId, recordPath } = await startSectionRun(workspace, definition)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      host.releases[0]?.()
      await waitFor(
        async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
      )
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
        readonly verdict: string
        readonly section: string
        readonly taskIds: string[]
      }
      expect(record).toMatchObject({ scope: 'task', section: SECTION.key, taskIds: SECTION_IDS })
      expect(record.verdict).toBe('FINDINGS')
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const stepState = async (): Promise<string | undefined> =>
        (await readAuthenticatedRun(workspace, runId, auth))?.steps[0]?.state
      await waitFor(async () => (await stepState()) === 'blocked')
      const blocked = await readAuthenticatedRun(workspace, runId, auth)
      expect(blocked?.steps[0]?.state).toBe('blocked')
      expect(blocked?.steps[0]?.reason).toContain('FINDINGS')
      expect(blocked?.status).not.toBe('completed')
      // No covered task is approved, so every one of them still needs a review.
      for (const taskId of SECTION_IDS) {
        expect(
          await readFile(join(changeDir, 'reviews', `${taskId}.json`), 'utf8').catch(
            () => undefined,
          ),
        ).toBeUndefined()
      }
      // The next close keeps the section obligation open instead of passing it.
      const steersBefore = host.steers.length
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      expect(host.steers.length).toBeGreaterThan(steersBefore)
      expect((await readAuthenticatedRun(workspace, runId, auth))?.status).not.toBe('completed')
    } finally {
      unregister()
    }
  })
})

describe('review round settlement', () => {
  it('settles an explicit start on FINDINGS and starts no reviewer on later closes', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definition = settlementDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'FINDINGS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth', explicitReview: true },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'settle-spec-review',
        'auth',
        'spec.json',
      )
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      host.releases[0]?.()
      await waitFor(
        async () =>
          (JSON.parse(await readFile(recordPath, 'utf8').catch(() => '{}')) as { verdict?: string })
            .verdict === 'FINDINGS',
      )
      const stepState = async (): Promise<string | undefined> =>
        (await readAuthenticatedRun(workspace, run.id, auth))?.steps[0]?.state
      await waitFor(async () => (await stepState()) === 'blocked')
      // The explicit round's verdict settles every later automatic close: the
      // close is refused with the verdict and starts no second reviewer.
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      const steers = host.steers.join('\n')
      expect(steers).toContain('settled on FINDINGS')
      expect(steers).toContain('start a fresh round')
      expect(await stepState()).toBe('blocked')
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(host.releases).toHaveLength(1)
      expect(host.digests).toHaveLength(1)
      const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
        | {
            execute: (
              args: Record<string, unknown>,
              context: { agent: unknown },
            ) => Promise<{ text?: string }>
          }
        | undefined
      // The status keeps the existing orphaned token and names the verdict in
      // the step reason; no new liveness token appears.
      const status = await tool?.execute({ action: 'status', runId: run.id }, { agent: host.agent })
      expect(status?.text).toContain('review orphaned')
      expect(status?.text).toContain('FINDINGS')
      // An explicit start for the settled unit dispatches exactly one reviewer.
      const started = await tool?.execute(
        { action: 'start', definitionId: definition.id, change: 'auth' },
        { agent: host.agent },
      )
      expect(started?.text).toContain('started')
      await waitFor(() => host.releases.length === 2)
      expect(host.digests).toHaveLength(2)
    } finally {
      unregister()
    }
  })

  it('reuses a stored section PASS through its covered approvals without a reviewer', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await sectionWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const recordId = sectionRecordId(SECTION.key)
      const digest = 'c'.repeat(64)
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        definition.id,
        'auth',
        'tasks',
        `${recordId}.json`,
      )
      await mkdir(join(recordPath, '..'), { recursive: true })
      await writeFile(
        recordPath,
        `${JSON.stringify({
          definition: definition.id,
          rule: definition.id,
          change: 'auth',
          phase: 'task',
          scope: 'task',
          taskId: recordId,
          section: SECTION.key,
          sectionTitle: SECTION.title,
          taskIds: SECTION_IDS,
          digest,
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          reviewer: 'codex',
          time: '2026-01-01T00:00:00.000Z',
        })}\n`,
        'utf8',
      )
      for (const taskId of SECTION_IDS) {
        await writeFile(
          join(workspace, 'openspec', 'changes', 'auth', 'reviews', `${taskId}.json`),
          `${JSON.stringify({
            rule: definition.id,
            change: 'auth',
            scope: 'task',
            taskId,
            digest,
            verdict: 'PASS',
            findings: [],
            target: { provider: 'codex-subagent' },
            time: '2026-01-01T00:00:00.000Z',
          })}\n`,
          'utf8',
        )
      }
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: {
          name: 'auth',
          taskId: recordId,
          section: SECTION.key,
          sectionTitle: SECTION.title,
          taskIds: SECTION_IDS,
          explicitReview: true,
        },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      // The old check looked for an approval keyed by the synthetic section id
      // and blocked this reuse; the covered approvals now settle the step.
      expect(host.digests).toHaveLength(0)
      const settled = await readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps[0]?.state).toBe('done')
    } finally {
      unregister()
    }
  })

  it.each(['FINDINGS', 'PASS'] as const)(
    'settles a section %s record published from the live fallback',
    async (verdict) => {
      process.env.DSH_WORKFLOWS_HOST_KEY = KEY
      const workspace = await sectionWorkspace()
      // The project's own negation keeps `.dsh` unignored after the automatic
      // exclude rule, so the snapshot is refused and the review uses the live
      // worktree under the mutation guard.
      await writeFile(join(workspace, '.gitignore'), '.dsh/\n!.dsh/\n', 'utf8')
      const definition = reviewDefinition()
      const unregister = definitionsRegistry.register({
        source: 'workflows-test',
        definitions: [definition],
      })
      const host = delayedReviewHost(workspace, verdict)
      try {
        apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
        const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
        const { runId, recordPath } = await startSectionRun(workspace, definition)
        await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
        await waitFor(() => host.digests.length === 1)
        host.releases[0]?.()
        await waitFor(
          async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
        )
        const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
          readonly verdict: string
          readonly worktreeDigest?: string
        }
        expect(record.verdict).toBe(verdict)
        // No snapshot could be built: the record binds the live worktree digest.
        expect(record.worktreeDigest).toBeDefined()
        const stepState = async (): Promise<string | undefined> =>
          (await readAuthenticatedRun(workspace, runId, auth))?.steps[0]?.state
        await waitFor(async () => (await stepState()) !== 'open')
        await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
        await new Promise((resolve) => setTimeout(resolve, 200))
        expect(host.digests).toHaveLength(1)
      } finally {
        unregister()
      }
    },
  )

  it('settles a stored fallback PASS without a reviewer', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await sectionWorkspace()
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n!.dsh/\n', 'utf8')
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const recordId = sectionRecordId(SECTION.key)
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        definition.id,
        'auth',
        'tasks',
        `${recordId}.json`,
      )
      await mkdir(join(recordPath, '..'), { recursive: true })
      await writeFile(
        recordPath,
        `${JSON.stringify({
          definition: definition.id,
          rule: definition.id,
          change: 'auth',
          phase: 'task',
          scope: 'task',
          taskId: recordId,
          section: SECTION.key,
          sectionTitle: SECTION.title,
          taskIds: SECTION_IDS,
          digest: 'e'.repeat(64),
          worktreeDigest: 'f'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          reviewer: 'codex',
          time: '2026-01-01T00:00:00.000Z',
        })}\n`,
        'utf8',
      )
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: {
          name: 'auth',
          taskId: recordId,
          section: SECTION.key,
          sectionTitle: SECTION.title,
          taskIds: SECTION_IDS,
        },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      // The fallback PASS record settles the unit without a second reviewer.
      expect(host.digests).toHaveLength(0)
      const settled = await readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps[0]?.state).toBe('done')
    } finally {
      unregister()
    }
  })

  it('starts exactly one whole-scope round after the reviewed digest moves', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definition = settlementDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const specDigest = await currentSpecDigest(workspace, 'auth')
      if (specDigest === undefined) throw new Error('the change digest is missing')
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'settle-spec-review',
        'auth',
        'spec.json',
      )
      await mkdir(join(recordPath, '..'), { recursive: true })
      await writeFile(
        recordPath,
        `${JSON.stringify({
          definition: definition.id,
          rule: definition.id,
          change: 'auth',
          phase: 'spec',
          scope: 'whole',
          digest: reviewDigest({ scope: 'whole', specDigest }),
          verdict: 'FINDINGS',
          findings: [
            {
              severity: 'P1',
              class: 'missing-test',
              title: 'No test',
              evidence: 'the change has no test',
              fix: 'add the test',
            },
          ],
          target: { provider: 'codex-subagent' },
          reviewer: 'codex',
          time: '2026-01-01T00:00:00.000Z',
        })}\n`,
        'utf8',
      )
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      expect(host.steers.join('\n')).toContain('settled on FINDINGS')
      expect(host.digests).toHaveLength(0)
      // The reviewed artifacts move: exactly one round becomes eligible.
      await writeFile(
        join(workspace, 'openspec', 'changes', 'auth', 'design.md'),
        '# Design\n\nA changed decision.\n',
        'utf8',
      )
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      await waitFor(() => host.digests.length === 1)
      // A live round is the waiting close and starts no second reviewer.
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(host.digests).toHaveLength(1)
      host.releases[0]?.()
      await waitFor(async () => {
        const stored = await readAuthenticatedRun(workspace, run.id, auth)
        return stored?.steps[0]?.state !== 'open'
      })
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 4 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(host.digests).toHaveLength(1)
    } finally {
      unregister()
    }
  })

  it('supersedes a verdict-less interrupted round with one fresh reviewer', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const host = delayedReviewHost(workspace, 'PASS')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const predecessor = createRun({
        definition: 'spec-review',
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        id: 'run-interrupted-predecessor',
        now: 1_000,
      })
      await writeRun(
        workspace,
        { ...predecessor, status: 'interrupted', reason: 'interrupted by a host restart' },
        auth,
      )
      // Attribute the change to this session so the trigger evaluates it.
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: 'call-attributed-write',
          name: 'write',
          arguments: { file_path: 'openspec/changes/auth/design.md' },
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(() => host.digests.length === 1)
      const runs = await listAuthenticatedRuns(workspace, auth)
      const reviewRuns = runs.filter((entry) => entry.definition.id === 'spec-review')
      expect(reviewRuns).toHaveLength(2)
      const storedPredecessor = reviewRuns.find((entry) => entry.id === predecessor.id)
      expect(storedPredecessor?.status).toBe('cancelled')
      expect(storedPredecessor?.reason).toContain('superseded')
      const successor = reviewRuns.find((entry) => entry.id !== predecessor.id)
      expect(successor).toBeDefined()
      // The interrupted attempt carries no verdict: no record was synthesized.
      expect(
        await readFile(
          join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth', 'spec.json'),
          'utf8',
        ).catch(() => undefined),
      ).toBeUndefined()
    } finally {
      host.releases[0]?.()
    }
  })

  it('settles a unit before the scheduler enqueue', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definition = settlementDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const host = delayedReviewHost(workspace, 'PASS')
    const enqueue = vi.spyOn(ReviewScheduler.prototype, 'enqueue')
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const specDigest = await currentSpecDigest(workspace, 'auth')
      if (specDigest === undefined) throw new Error('the change digest is missing')
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'settle-spec-review',
        'auth',
        'spec.json',
      )
      await mkdir(join(recordPath, '..'), { recursive: true })
      await writeFile(
        recordPath,
        `${JSON.stringify({
          definition: definition.id,
          rule: definition.id,
          change: 'auth',
          phase: 'spec',
          scope: 'whole',
          digest: reviewDigest({ scope: 'whole', specDigest }),
          verdict: 'FINDINGS',
          findings: [
            {
              severity: 'P1',
              class: 'missing-test',
              title: 'No test',
              evidence: 'the change has no test',
              fix: 'add the test',
            },
          ],
          target: { provider: 'codex-subagent' },
          reviewer: 'codex',
          time: '2026-01-01T00:00:00.000Z',
        })}\n`,
        'utf8',
      )
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      expect(host.steers.join('\n')).toContain('settled on FINDINGS')
      expect(enqueue).not.toHaveBeenCalled()
      expect(host.digests).toHaveLength(0)
      const stored = await readAuthenticatedRun(workspace, run.id, auth)
      expect(stored?.steps[0]?.state).toBe('blocked')
    } finally {
      enqueue.mockRestore()
      unregister()
    }
  })
})
