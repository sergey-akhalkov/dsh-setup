import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Definition, loadShippedDefinitions } from '../src/host/definitions.ts'
import {
  DRAFTS_ROOT,
  draftDirectory,
  draftPath,
  readDraft,
  writeDraft,
} from '../src/host/drafts.ts'
import { collectEvidencePaths } from '../src/host/evidence.ts'
import { OwnedCalls, runHumanStep } from '../src/host/executors.ts'
import { evaluateTurnClose } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { advanceIntake } from '../src/host/intake.ts'
import { issueCompletionReceipt, readReceipt } from '../src/host/receipts.ts'
import {
  createRun,
  setRunStatus,
  settleStep,
  type WorkflowRun,
  writeRun,
} from '../src/host/runs.ts'
import { renderMainSteer } from '../src/host/steer.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-drafts-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

describe('intake drafts', () => {
  it('writes an atomic draft path and never creates the change directory', async () => {
    const workspace = await tempWorkspace()
    expect(draftDirectory('auth')).toBe('.dsh/workflows/drafts/auth')
    expect(draftPath('auth', 'requirements.md')).toBe('.dsh/workflows/drafts/auth/requirements.md')
    const written = await writeDraft(workspace, 'auth', 'requirements.md', 'users and outcomes\n')
    expect(written.path).toBe('.dsh/workflows/drafts/auth/requirements.md')
    expect(await readDraft(workspace, 'auth', 'requirements.md')).toBe('users and outcomes\n')
    const names = await readdir(join(workspace, DRAFTS_ROOT, 'auth'))
    expect(names).toEqual(['requirements.md'])
    expect(await readdir(join(workspace, 'openspec')).catch(() => undefined)).toBeUndefined()
    const info = await lstat(
      join(workspace, '.dsh', 'workflows', 'drafts', 'auth', 'requirements.md'),
    )
    expect(info.isFile()).toBe(true)
  })

  it('refuses an invalid draft name and an escaping artifact path', async () => {
    const workspace = await tempWorkspace()
    for (const name of ['../auth', 'Auth', 'auth/v2', '', '..']) {
      expect(() => draftDirectory(name), name).toThrow(/not a validated change name/u)
      await expect(writeDraft(workspace, name, 'requirements.md', 'x'), name).rejects.toThrow()
    }
    for (const artifact of [
      '../requirements.md',
      '/etc/passwd',
      'a/../../b.md',
      'nested/../x.md',
      '',
    ]) {
      expect(() => draftPath('auth', artifact), artifact).toThrow()
      await expect(writeDraft(workspace, 'auth', artifact, 'x'), artifact).rejects.toThrow()
    }
  })

  it('keeps the existing draft when the atomic replacement fails', async () => {
    const workspace = await tempWorkspace()
    await writeDraft(workspace, 'auth', 'requirements.md', 'original\n')
    await expect(
      writeDraft(workspace, 'auth', 'requirements.md', 'replacement\n', {
        rename: async () => {
          throw new Error('rename failed')
        },
      }),
    ).rejects.toThrow(/rename failed/u)
    expect(await readDraft(workspace, 'auth', 'requirements.md')).toBe('original\n')
    expect(
      (await readdir(join(workspace, DRAFTS_ROOT, 'auth'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([])
  })

  it('refuses a draft directory that is a link outside the workspace', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
    await symlink(
      outside,
      join(workspace, DRAFTS_ROOT),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(writeDraft(workspace, 'auth', 'requirements.md', 'x')).rejects.toThrow(
      /drafts directory is a link/u,
    )
  })

  it('refuses a link redirecting a draft into openspec/changes', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, DRAFTS_ROOT), { recursive: true })
    await symlink(
      workspace,
      join(workspace, DRAFTS_ROOT, 'auth'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      writeDraft(workspace, 'auth', 'openspec/changes/auth/requirements.md', 'x'),
    ).rejects.toThrow(/link|escapes/u)
    expect(await readdir(join(workspace, 'openspec')).catch(() => undefined)).toBeUndefined()
  })

  it('creates nothing outside the workspace before refusing a linked ancestor', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await mkdir(join(workspace, '.dsh'), { recursive: true })
    await symlink(
      outside,
      join(workspace, '.dsh', 'workflows'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(writeDraft(workspace, 'auth', 'requirements.md', 'x')).rejects.toThrow(/link/u)
    expect(await readdir(outside)).toEqual([])

    const second = await tempWorkspace()
    const outsideSecond = await tempWorkspace()
    await mkdir(join(second, DRAFTS_ROOT), { recursive: true })
    await symlink(
      outsideSecond,
      join(second, DRAFTS_ROOT, 'auth'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(writeDraft(second, 'auth', 'requirements.md', 'x')).rejects.toThrow(
      /link|escapes/u,
    )
    expect(await readdir(outsideSecond)).toEqual([])
  })
})

describe('change-intake engine', () => {
  function intakeDefinition(): Definition {
    const definition = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    if (definition === undefined) throw new Error('the change-intake definition is missing')
    return definition
  }

  function newRun(definition: Definition, workspace: string): WorkflowRun {
    return createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: definition.steps.map((step) => step.id),
      now: 1_000,
    })
  }

  async function writeChangeArtifacts(workspace: string): Promise<void> {
    for (const [file, content] of [
      ['proposal.md', '# Proposal\n'],
      ['design.md', '# Design\n'],
      ['tasks.md', '- [ ] 1.1 Task\n'],
      ['specs/auth/spec.md', '# Spec\n'],
    ] as const) {
      await mkdir(join(workspace, 'openspec', 'changes', 'auth', dirname(file)), {
        recursive: true,
      })
      await writeFile(join(workspace, 'openspec', 'changes', 'auth', file), content, 'utf8')
    }
  }

  it('walks the seven steps in order, completes create-change from its owned call, and never dispatches delegate', async () => {
    const workspace = await tempWorkspace()
    const definition = intakeDefinition()
    const owned = new OwnedCalls()
    const auth = HostAuth.fromKey('test-intake-advance-key-012345')
    const toolCalls: Array<{
      callId: string
      name: string
      arguments: Record<string, unknown>
      ok: boolean
    }> = []
    const shellResults: Array<{
      callId: string
      command: string
      at: number
      exitCode: number
      foreground: boolean
    }> = []
    const context = {
      workspace,
      values: { name: 'auth' },
      toolCalls,
      shellResults,
      stepStartedAt: 2_500,
    }
    let delegateCalls = 0
    const hostShell = process.platform === 'win32' ? 'pwsh' : 'bash'
    let run = newRun(definition, workspace)

    const advance = (): ReturnType<typeof advanceIntake> =>
      advanceIntake({
        run,
        definition,
        values: { name: 'auth' },
        evidenceContext: context,
        owned,
        installedLegacy: new Set(['delegation-rules', 'goal-continuity']),
        auth,
        now: 2_000,
        toolRunner: {
          async call(request) {
            if (request.name === 'delegate') delegateCalls += 1
            expect(request.name).toBe(hostShell)
            const command = String(request.arguments.command ?? '')
            expect(command).toBe('openspec new change auth')
            toolCalls.push({
              callId: request.callId,
              name: hostShell,
              arguments: { ...request.arguments },
              ok: true,
            })
            await mkdir(join(workspace, 'openspec', 'changes', 'auth'), { recursive: true })
            await writeFile(
              join(workspace, 'openspec', 'changes', 'auth', '.openspec.yaml'),
              'version: 1\n',
              'utf8',
            )
            return { ok: true }
          },
        },
        readRecord: async () => ({
          ok: true,
          evidence: {
            kind: 'record',
            path: '.dsh/delegation/spec-review/auth/spec.json',
            digest: 'a'.repeat(64),
          },
        }),
        questions: { ask: async () => ({ answer: 'yes' }) },
      })

    let result = await advance()
    expect(result.waiting?.stepId).toBe('requirements')
    expect(result.waiting?.paths).toEqual(['.dsh/workflows/drafts/auth/requirements.md'])
    await writeDraft(workspace, 'auth', 'requirements.md', 'x'.repeat(200))
    run = (await advance()).run
    expect(run.steps.find((step) => step.id === 'requirements')?.state).toBe('done')
    await writeDraft(workspace, 'auth', 'architecture.md', 'architecture\n')
    run = (await advance()).run
    expect(run.steps.find((step) => step.id === 'architecture')?.state).toBe('done')
    await writeDraft(workspace, 'auth', 'interface.md', 'interface\n')
    result = await advance()
    expect(result.run.steps.find((step) => step.id === 'interface')?.state).toBe('done')
    expect(result.waiting?.stepId).toBe('spec')
    expect(toolCalls).toHaveLength(1)
    expect(owned.has(toolCalls[0]?.callId ?? '')).toBe(true)
    run = result.run
    expect(run.steps.find((step) => step.id === 'create-change')?.state).toBe('done')
    expect(delegateCalls).toBe(0)

    await writeChangeArtifacts(workspace)
    shellResults.push({
      callId: 'check-1',
      command: 'openspec validate auth --strict',
      at: 3_000,
      exitCode: 0,
      foreground: true,
    })
    const finished = await advance()
    run = finished.run
    expect(finished.completed).toBe(true)
    expect(await readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'intake',
      change: 'auth',
    })
    expect(run.steps.find((step) => step.id === 'spec')?.state).toBe('done')
    expect(run.steps.find((step) => step.id === 'spec-review')?.state).toBe('done')
    expect(run.steps.find((step) => step.id === 'approval')?.state).toBe('done')
    expect(delegateCalls).toBe(0)
    expect(toolCalls).toHaveLength(1)
  })

  it('keeps create-change open until .openspec.yaml exists without re-dispatching', async () => {
    const workspace = await tempWorkspace()
    const definition = intakeDefinition()
    const owned = new OwnedCalls()
    let run = newRun(definition, workspace)
    for (const step of ['requirements', 'architecture', 'interface']) {
      run = settleStep(run, step, 'done', { at: 1_500 })
    }
    const toolCalls: Array<{
      callId: string
      name: string
      arguments: Record<string, unknown>
      ok: boolean
    }> = []
    let dispatches = 0
    const advance = (): ReturnType<typeof advanceIntake> =>
      advanceIntake({
        run,
        definition,
        values: { name: 'auth' },
        evidenceContext: { workspace, values: { name: 'auth' }, toolCalls },
        owned,
        installedLegacy: new Set(['delegation-rules', 'goal-continuity']),
        now: 2_000,
        toolRunner: {
          async call(request) {
            dispatches += 1
            toolCalls.push({
              callId: request.callId,
              name: request.name,
              arguments: { ...request.arguments },
              ok: true,
            })
            return { ok: true }
          },
        },
      })
    let result = await advance()
    run = result.run
    expect(run.steps.find((step) => step.id === 'create-change')?.state).toBe('open')
    expect(result.waiting?.stepId).toBe('create-change')
    result = await advance()
    run = result.run
    expect(dispatches).toBe(1)
    expect(run.steps.find((step) => step.id === 'create-change')?.state).toBe('open')
    await mkdir(join(workspace, 'openspec', 'changes', 'auth'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', '.openspec.yaml'),
      'version: 1\n',
      'utf8',
    )
    result = await advance()
    run = result.run
    expect(run.steps.find((step) => step.id === 'create-change')?.state).toBe('done')
    expect(dispatches).toBe(1)
    expect(result.waiting?.stepId).toBe('spec')
  })

  it('does not complete or revive an intake whose owned creation call failed', async () => {
    const workspace = await tempWorkspace()
    const definition = intakeDefinition()
    let run = newRun(definition, workspace)
    for (const step of ['requirements', 'architecture', 'interface']) {
      run = settleStep(run, step, 'done', { at: 1_500 })
    }
    const advance = (): ReturnType<typeof advanceIntake> =>
      advanceIntake({
        run,
        definition,
        values: { name: 'auth' },
        evidenceContext: { workspace, values: { name: 'auth' } },
        owned: new OwnedCalls(),
        installedLegacy: new Set(['delegation-rules', 'goal-continuity']),
        now: 2_000,
        toolRunner: {
          async call() {
            return { ok: false, error: 'the creation command failed' }
          },
        },
      })
    const failed = await advance()
    run = failed.run
    expect(failed.completed).toBe(false)
    expect(run.steps.find((step) => step.id === 'create-change')?.state).toBe('failed')
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: {
        steer: () => {
          throw new Error('a terminal intake run must not be steered')
        },
      },
      evidenceContext: { workspace, values: { name: 'auth' } },
      turn: 2,
      maxBlocks: 3,
      installedLegacy: new Set(['delegation-rules', 'goal-continuity']),
    })
    expect(outcome.kind).toBe('allow')
    const again = await advance()
    expect(again.completed).toBe(false)
    expect(again.run.steps.find((step) => step.id === 'create-change')?.state).toBe('failed')
  })

  it('keeps spec open when strict validation fails and shows the paths the verifier checks', async () => {
    const workspace = await tempWorkspace()
    const definition = intakeDefinition()
    const owned = new OwnedCalls()
    let run = newRun(definition, workspace)
    for (const step of ['requirements', 'architecture', 'interface', 'create-change']) {
      run = settleStep(run, step, 'done', { at: 1_500 })
    }
    await writeChangeArtifacts(workspace)
    const context = {
      workspace,
      values: { name: 'auth' },
      stepStartedAt: 1_500,
      shellResults: [
        {
          callId: 'check-2',
          command: 'openspec validate auth --strict',
          at: 2_000,
          exitCode: 1,
          foreground: true,
        },
      ],
    }
    const result = await advanceIntake({
      run,
      definition,
      values: { name: 'auth' },
      evidenceContext: context,
      owned,
      installedLegacy: new Set(['delegation-rules', 'goal-continuity']),
      now: 2_100,
    })
    expect(result.waiting?.stepId).toBe('spec')
    expect(result.run.steps.find((step) => step.id === 'spec')?.state).toBe('open')

    for (const step of definition.steps) {
      if (step.executor !== 'main' || step.evidence === undefined) continue
      const text = renderMainSteer({
        run,
        definition,
        step,
        evidenceContext: { workspace, values: { name: 'auth' } },
      })
      for (const path of collectEvidencePaths(step.evidence, {
        workspace,
        values: { name: 'auth' },
      })) {
        expect(text, step.id).toContain(path)
      }
    }
  })
})

describe('end-to-end intake receipt', () => {
  it('writes the host-authenticated completion receipt and leaves a no open', async () => {
    const workspace = await tempWorkspace()
    const auth = HostAuth.fromKey('test-intake-host-key-0123456789')
    const definition = (() => {
      const found = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
      if (found === undefined) throw new Error('the change-intake definition is missing')
      return found
    })()
    const digest = 'a'.repeat(64)
    const runId = 'run-intake-e2e'
    let run = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: definition.steps.map((step) => step.id),
      now: 1_000,
      id: runId,
    })
    for (const step of [
      'requirements',
      'architecture',
      'interface',
      'create-change',
      'spec',
      'spec-review',
    ]) {
      run = settleStep(run, step, 'done', { at: 1_500 })
    }
    const refusedNo = await runHumanStep({
      run,
      step: definition.steps.at(-1) as (typeof definition.steps)[number],
      questions: { ask: async () => ({ answer: 'no' }) },
      evidenceContext: { workspace, values: { name: 'auth' } },
      now: 2_000,
    })
    expect(refusedNo.steps.find((step) => step.id === 'approval')?.state).not.toBe('done')
    expect(refusedNo.status).toBe('blocked')

    const accepted = await runHumanStep({
      run,
      step: definition.steps.at(-1) as (typeof definition.steps)[number],
      questions: { ask: async () => ({ answer: 'yes' }) },
      evidenceContext: { workspace, values: { name: 'auth' } },
      now: 2_100,
    })
    expect(accepted.steps.find((step) => step.id === 'approval')?.state).toBe('done')
    await writeRun(workspace, setRunStatus(accepted, 'completed', 2_200), auth)
    const receipt = await issueCompletionReceipt(workspace, runId, digest, auth, 2_300)
    expect(receipt).toMatchObject({ kind: 'intake', change: 'auth', digest })
    expect(await readReceipt(workspace, 'auth', auth)).toMatchObject({ change: 'auth' })
  })
})

it('keeps the evidence contract when the prompt exceeds the steer budget', () => {
  const found = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
  if (found === undefined) throw new Error('the change-intake definition is missing')
  const definition = found
  const base = definition.steps[0] as (typeof definition.steps)[number]
  const step = { ...base, prompt: 'x'.repeat(5_000) }
  const run = createRun({
    definition: definition.id,
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace: '/workspace',
    steps: [step.id],
  })
  const text = renderMainSteer({
    run,
    definition,
    step,
    evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
  })
  expect(text.length).toBeLessThanOrEqual(2000)
  expect(text).toContain('Evidence required:')
  expect(text).toContain('.dsh/workflows/drafts/auth/requirements.md')
  expect(text).not.toContain('{name}')
})

it('does not redact a validated evidence path', () => {
  const found = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
  if (found === undefined) throw new Error('the change-intake definition is missing')
  const definition = found
  const base = definition.steps[0] as (typeof definition.steps)[number]
  const path = '.dsh/workflows/drafts/auth/basic requirements.md'
  const step = {
    ...base,
    prompt: 'Write the file.',
    evidence: { kind: 'file' as const, path },
  }
  const run = createRun({
    definition: definition.id,
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace: '/workspace',
    steps: [step.id],
  })
  const text = renderMainSteer({
    run,
    definition,
    step,
    evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
  })
  expect(text).toContain(path)
})
it('keeps the contract when prompt redaction expands the text', () => {
  const found = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
  if (found === undefined) throw new Error('the change-intake definition is missing')
  const definition = found
  const base = definition.steps[0] as (typeof definition.steps)[number]
  const step = {
    ...base,
    prompt: 'Describe Basic UI behavior. '.repeat(150),
    evidence: { kind: 'file' as const, path: '.dsh/workflows/drafts/{name}/requirements.md' },
  }
  const run = createRun({
    definition: definition.id,
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace: '/workspace',
    steps: [step.id],
  })
  const text = renderMainSteer({
    run,
    definition,
    step,
    evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
  })
  expect(text).toContain('Evidence required:')
  expect(text).toContain('.dsh/workflows/drafts/auth/requirements.md')
})

it('renders the resolved record task id in a main steer', () => {
  const found = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
  if (found === undefined) throw new Error('the change-intake definition is missing')
  const definition = found
  const base = definition.steps[0] as (typeof definition.steps)[number]
  const step = {
    ...base,
    prompt: 'Wait for the review.',
    evidence: {
      kind: 'record' as const,
      rule: 'task-review',
      change: '{name}',
      phase: 'task',
      scope: 'task',
      task: '{taskId}',
      verdict: 'PASS',
    },
  }
  const run = createRun({
    definition: definition.id,
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace: '/workspace',
    steps: [step.id],
  })
  const text = renderMainSteer({
    run,
    definition,
    step,
    evidenceContext: {
      workspace: '/workspace',
      values: { name: 'auth', taskId: '0123456789abcdef' },
    },
  })
  expect(text).toContain('task=0123456789abcdef')
  expect(text).not.toContain('{taskId}')
})
