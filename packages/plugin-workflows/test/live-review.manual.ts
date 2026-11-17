import { execFileSync, spawn as spawnProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/**
 * Manual live check for the lane review through the BUILT bundles (not part of
 * `pnpm test`). Run with:
 * `pnpm exec vitest run --config scripts/manual/vitest.config.ts -t "built bundle"`
 *
 * It loads `packages/plugin-workflows/lib/index.js` and
 * `packages/plugin-codex-subagent/lib/index.js` into a throwaway `DSH_HOME` and
 * a temp git workspace, reviews one lane section with the real Codex provider,
 * ticks a second task, reviews the same unit key again, and asserts the second
 * round resumed the same Codex thread while both rounds wrote the local record
 * and the committed approval.
 */

vi.mock('@deepseek-ai/dsh-subagent', () => ({
  NO_START_CAPABILITIES: Object.freeze({
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  }),
  assertPositiveFinite(_prefix: string, name: string, value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
  },
  assertUsableCwd(_prefix: string, _label: string, cwd: string) {
    return cwd
  },
  async settleRunResult(parts: {
    attempt: () => Promise<unknown>
    collectOutput: () => unknown[]
    collectDiagnostic?: () => string | undefined
    cancelled: () => boolean
    onError?: (error: Error, stopReason: string) => void
    signal: AbortSignal
    onAbort: () => void
  }) {
    try {
      const result = (await parts.attempt()) as { output: unknown[]; stopReason: string }
      return parts.cancelled() ? { output: parts.collectOutput(), stopReason: 'aborted' } : result
    } catch (error) {
      if (parts.cancelled()) return { output: parts.collectOutput(), stopReason: 'aborted' }
      try {
        parts.onError?.(error instanceof Error ? error : new Error(String(error)), 'error')
      } catch {}
      const diagnostic = parts.collectDiagnostic?.()
      return {
        output: parts.collectOutput(),
        ...(diagnostic === undefined ? {} : { diagnostic }),
        stopReason: 'error',
      }
    } finally {
      parts.signal.removeEventListener('abort', parts.onAbort)
    }
  },
  subprocessRunHandle(parts: {
    id: string
    result: Promise<unknown>
    signal: AbortSignal
    onAbort: () => void
    requestCancel: () => void
    teardown: () => Promise<void>
  }) {
    let disposal: Promise<void> | undefined
    return {
      id: parts.id,
      result: parts.result,
      dispose() {
        if (disposal !== undefined) return disposal
        parts.signal.removeEventListener('abort', parts.onAbort)
        parts.requestCancel()
        disposal = parts.teardown()
        return disposal
      },
    }
  },
}))

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (options: unknown) => options,
}))

const packageDir = join(import.meta.dirname, '..')
const codexDir = join(import.meta.dirname, '..', '..', 'plugin-codex-subagent')

interface SpawnSpec {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
}

function realSpawn(spec: SpawnSpec) {
  const child = spawnProcess(spec.argv[0] ?? '', spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env } as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    terminate: () => {
      child.kill('SIGTERM')
    },
    waitForExit: async () => {
      await done
    },
  }
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 600_000,
): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the live review did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describe('live review through the built bundles (manual)', () => {
  it('reviews one lane unit twice, resumes its Codex thread, and writes both records and approvals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflows-live-review-'))
    const workspace = join(root, 'workspace')
    const home = join(root, 'home')
    process.env.DSH_HOME = home
    process.env.DSH_WORKFLOWS_HOST_KEY = 'a'.repeat(64)
    await mkdir(workspace, { recursive: true })
    await mkdir(home, { recursive: true })
    try {
      const change = join(workspace, 'openspec', 'changes', 'live-check')
      await mkdir(join(change, 'specs', 'live-check'), { recursive: true })
      await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
      await writeFile(
        join(workspace, 'openspec', 'review-approval.json'),
        '{"version":1,"archiveGate":true}\n',
      )
      await writeFile(
        join(change, 'proposal.md'),
        '# Proposal\n\nAdd one banner line to lane.txt so the live review has a concrete, verifiable task.\n',
        'utf8',
      )
      await writeFile(
        join(change, 'design.md'),
        '# Design\n\nlane.txt contains exactly the single line `banner=live`; no other file changes. Acceptance: read lane.txt and confirm that line.\n',
        'utf8',
      )
      await writeFile(
        join(change, 'specs', 'live-check', 'spec.md'),
        '# Spec\n\n## Requirement: Lane banner\n\n`lane.txt` SHALL contain the single line `banner=live`.\n\n### Scenario: Banner present\n\n- **WHEN** `lane.txt` is read\n- **THEN** its only line is `banner=live`\n',
        'utf8',
      )
      await writeFile(
        join(change, 'tasks.md'),
        '# Tasks\n\n## 1. Live lane\n\n- [x] 1.1 Set lane.txt to the single line `banner=live`\n- [ ] 1.2 Confirm lane.txt contains `banner=live`\n',
        'utf8',
      )
      await writeFile(join(workspace, 'lane.txt'), 'banner=live\n', 'utf8')
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
      }
      git('init')
      git('config', 'user.name', 'live-review')
      git('config', 'user.email', 'live-review@example.test')
      git('add', '-A')
      git('commit', '-m', 'init')

      const workflows = await import(pathToFileURL(join(packageDir, 'lib', 'index.js')).href)
      const codex = await import(pathToFileURL(join(codexDir, 'lib', 'index.js')).href)
      const providerMap = new Map<
        string,
        { name: string; start: (request: unknown) => Promise<unknown> }
      >()
      const activations: Array<{ threadId?: string; threadReuse?: string }> = []
      const subagents = {
        registerProvider(provider: { name: string }) {
          providerMap.set(provider.name, provider as never)
        },
        getProvider: (name: string) => providerMap.get(name),
        async startActivation(spec: {
          provider: string
          prompt: { type: string; text: string }[]
          cwd?: string
          signal: AbortSignal
          agentOptions?: Record<string, unknown>
          parent?: unknown
        }) {
          const provider = providerMap.get(spec.provider)
          if (provider === undefined) throw new Error(`provider ${spec.provider} is missing`)
          let run: {
            id?: string
            result: Promise<{ threadId?: string; threadReuse?: string }>
            dispose: () => Promise<void>
          }
          try {
            run = (await provider.start({
              prompt: spec.prompt,
              cwd: spec.cwd,
              signal: spec.signal,
              agentOptions: spec.agentOptions,
              ...(spec.parent === undefined ? {} : { parent: spec.parent }),
            })) as never
          } catch (error) {
            throw error
          }
          const result = run.result.then((value) => {
            activations.push({ threadId: value.threadId, threadReuse: value.threadReuse })
            return value
          })
          return {
            childId: String(run.id ?? activations.length),
            result,
            dispose: async () => run.dispose(),
          }
        },
      }
      const tools: Array<{
        name: string
        execute: (args: unknown, exec: unknown) => Promise<unknown>
      }> = []
      const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
      const agent = {
        id: 'session-live',
        session: { id: 'session-live', header: { origin: 'root' as const } },
        ctx: { on: () => () => undefined },
        steer: () => undefined,
        inject: () => undefined,
        inbox: { remove: () => true },
      }
      const services = {
        agents: { get: () => agent, list: () => [agent] },
        workingDirectory: { get: () => workspace },
        fs: {
          resolve: async (path: string) => ({ targetKey: path }),
          watch: async () => async () => undefined,
        },
        connection: { fetch: { register: () => () => undefined } },
        tools: {
          register: (definition: { name: string }) => {
            tools.push(definition as never)
            return () => undefined
          },
          get: (name: string) => tools.find((tool) => tool.name === name),
        },
        commands: { register: () => () => undefined },
        systemPrompt: { context: () => () => undefined },
        subagents,
      }
      const ctx = {
        ...services,
        subprocess: { spawn: realSpawn },
        logger: { warn: () => undefined },
        get: (name: string) => (services as Record<string, unknown>)[name],
        provide: () => undefined,
        on(name: string, listener: (...args: unknown[]) => unknown) {
          const list = listeners.get(name) ?? []
          list.push(listener)
          listeners.set(name, list)
          return () => undefined
        },
        effect: (callback: () => () => void) => {
          callback()
          return () => undefined
        },
      }
      codex.apply(ctx)
      workflows.apply(ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const tool = tools.find((entry) => entry.name === 'workflows')
      if (tool === undefined) throw new Error('the workflows tool is missing')
      const start = async (section: string): Promise<string> => {
        const result = (await tool.execute(
          { action: 'start', definitionId: 'task-review', change: 'live-check', section },
          { agent },
        )) as { text?: string }
        expect(result.text ?? '').toContain('started at step "review"')
        return /run "?([^"\s]+)"? started/u.exec(result.text ?? '')?.[1] ?? ''
      }
      const recordPath = join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'task-review',
        'live-check',
        'tasks',
      )
      const approvals = join(workspace, 'openspec', 'changes', 'live-check', 'reviews')
      const records = async (): Promise<Array<Record<string, unknown>>> => {
        const files = await readdir(recordPath).catch(() => [] as string[])
        return Promise.all(
          files.map(
            async (file) =>
              JSON.parse(await readFile(join(recordPath, file), 'utf8')) as Record<string, unknown>,
          ),
        )
      }
      const approvalFiles = async (): Promise<string[]> =>
        readdir(approvals).catch(() => [] as string[])

      // Round 1: the section unit covers only the first checked task.
      const { listAuthenticatedRuns } = await import(
        pathToFileURL(join(packageDir, 'lib', 'runs.js')).href
      )
      const { HostAuth } = await import(pathToFileURL(join(packageDir, 'lib', 'host-auth.js')).href)
      const harnessAuth = HostAuth.fromKey(Buffer.from('a'.repeat(64), 'hex'))
      const firstRunId = await start('1')
      await waitFor(async () => (await records()).length === 1, 600_000)
      const firstRecord = (await records())[0] as {
        taskIds?: string[]
        digest?: string
        verdict?: string
        findings?: unknown[]
        error?: string
      }
      expect(firstRecord.verdict, JSON.stringify(firstRecord)).toBe('PASS')
      expect(firstRecord.taskIds).toHaveLength(1)
      await waitFor(async () => (await approvalFiles()).length === 1, 60_000)
      expect(activations).toHaveLength(1)
      expect(activations[0]?.threadReuse).toBe('created')
      // Release the finished round's run: the lane start refuses a partial
      // overlap with a live run, and the next round must reuse the unit key.
      await tool.execute({ action: 'cancel', runId: firstRunId }, { agent })
      await waitFor(async () => {
        const runs = (await listAuthenticatedRuns(workspace, harnessAuth)) as Array<{
          id: string
          status: string
        }>
        return runs.find((run) => run.id === firstRunId)?.status === 'cancelled'
      }, 60_000)

      // Round 2: ticking the second task keeps the unit key and changes the
      // unit's coverage, so the same lane is reviewed again.
      await writeFile(
        join(change, 'tasks.md'),
        '# Tasks\n\n## 1. Live lane\n\n- [x] 1.1 Set lane.txt to the single line `banner=live`\n- [x] 1.2 Confirm lane.txt contains `banner=live`\n',
        'utf8',
      )
      await start('1')
      // The same unit key reuses the record path, so the second round replaces
      // the first digest in place.
      await waitFor(async () => {
        const list = await records()
        const current = list[0]
        return (
          list.length === 1 && current?.digest !== firstRecord.digest && current?.verdict === 'PASS'
        )
      }, 600_000)
      const secondRecord = (await records())[0] as {
        digest?: string
        verdict?: string
        findings?: unknown[]
        error?: string
      }
      expect(secondRecord.digest).not.toBe(firstRecord.digest)
      await waitFor(async () => (await approvalFiles()).length === 2, 60_000)
      expect(activations).toHaveLength(2)
      expect(activations[1]?.threadReuse).toBe('resumed')
      expect(activations[1]?.threadId).toBe(activations[0]?.threadId)

      // The throwaway home stayed untouched and the built bundle wrote both
      // rounds' records and committed approvals in the workspace.
      expect(await readdir(home)).toEqual([])
      const reportPath = join(root, 'live-review-report.json')
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            workspace,
            records: recordPath,
            approvals,
            firstDigest: firstRecord.digest,
            secondDigest: secondRecord?.digest,
            threadId: activations[0]?.threadId,
            threadReuse: activations.map((entry) => entry.threadReuse),
          },
          null,
          2,
        ),
        'utf8',
      )
      console.log('LIVE-REVIEW-REPORT', reportPath)
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  }, 900_000)
})
