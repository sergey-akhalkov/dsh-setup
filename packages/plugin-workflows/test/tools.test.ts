import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runWorkflowCommand } from '../src/host/commands.ts'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { registerActiveRunsContext, renderActiveRunsContext } from '../src/host/prompt.ts'
import { createRun, type WorkflowRun } from '../src/host/runs.ts'
import {
  executeWorkflowsTool,
  parseWorkflowsToolArgs,
  type WorkflowsToolHost,
} from '../src/host/tools.ts'

const TEMP_DIRECTORIES: string[] = []

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

function definition(id: string, overrides: Record<string, unknown> = {}): Definition {
  return validateDefinition({
    v: 1,
    id,
    name: id,
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'requirements',
        title: 'Requirements',
        executor: 'main',
        prompt: 'Write the requirements.',
        evidence: { kind: 'file', path: 'out.md' },
        next: 'end',
      },
    ],
    ...overrides,
  })
}

function runFor(workspace: string, id = 'run-1', session = 'session-1'): WorkflowRun {
  return createRun({
    definition: 'model-start',
    trigger: 'turn.stopping',
    session,
    workspace,
    context: { name: 'auth' },
    steps: ['requirements'],
    now: 1_000,
    id,
  })
}

interface Calls {
  starts: number
  resumes: number
  cancels: number
}

function host(
  definitions: readonly Definition[],
  runs: WorkflowRun[] = [],
  calls: Calls = { starts: 0, resumes: 0, cancels: 0 },
): WorkflowsToolHost {
  return {
    workspace: '/workspace',
    session: 'session-1',
    definitions,
    auth: HostAuth.fromKey('test-tools-host-key-0123456789'),
    maxRuns: 5,
    listRuns: async () => runs,
    readRun: async (runId) => runs.find((run) => run.id === runId),
    startRun: async (entry) => {
      calls.starts += 1
      const run = createRun({
        definition: entry.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace: '/workspace',
        steps: entry.steps.map((step) => step.id),
        now: 1_000,
      })
      runs.push(run)
      return { run, firstStep: entry.steps[0]?.id ?? 'requirements' }
    },
    resumeRun: async (runId) => {
      calls.resumes += 1
      return { run: runs.find((run) => run.id === runId) as WorkflowRun, stepId: 'requirements' }
    },
    cancelRun: async (runId) => {
      calls.cancels += 1
      return runs.find((run) => run.id === runId) as WorkflowRun
    },
    questions: {
      ask: async () => ({ answer: 'yes' }),
    },
  }
}

describe('workflows tool', () => {
  it('lists definitions and starts an allowed definition exactly once', async () => {
    const calls: Calls = { starts: 0, resumes: 0, cancels: 0 }
    const entry = definition('model-start')
    const target = host([entry], [], calls)
    const listed = await executeWorkflowsTool({ action: 'list' }, target)
    expect(listed).toContain('model-start')
    const started = await executeWorkflowsTool(
      { action: 'start', definitionId: 'model-start' },
      target,
    )
    expect(started).toContain('started at step "requirements"')
    expect(calls.starts).toBe(1)
  })

  it('refuses a definition that disallows a model start and a high-risk start without yes', async () => {
    const noStart = definition('no-start', {
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
    })
    await expect(
      executeWorkflowsTool({ action: 'start', definitionId: 'no-start' }, host([noStart])),
    ).rejects.toThrow(/refuses a model start/u)
    const high = definition('high-risk', {
      settings: {
        allowModelStart: true,
        risk: 'high',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
    })
    const refusing: WorkflowsToolHost = { ...host([high]), questions: undefined }
    await expect(
      executeWorkflowsTool({ action: 'start', definitionId: 'high-risk' }, refusing),
    ).rejects.toThrow(/direct user yes/u)
  })

  it('resumes and cancels an authenticated run in the same session without starting a new one', async () => {
    const calls: Calls = { starts: 0, resumes: 0, cancels: 0 }
    const runs = [runFor('/workspace')]
    const target = host([definition('model-start')], runs, calls)
    expect(await executeWorkflowsTool({ action: 'resume', runId: 'run-1' }, target)).toContain(
      'resumed at step',
    )
    expect(await executeWorkflowsTool({ action: 'cancel', runId: 'run-1' }, target)).toContain(
      'cancelled',
    )
    expect(calls.starts).toBe(0)
    expect(calls.resumes).toBe(1)
    expect(calls.cancels).toBe(1)
    const other = runFor('/workspace', 'run-other', 'session-2')
    await expect(
      executeWorkflowsTool(
        { action: 'resume', runId: 'run-other' },
        host([definition('model-start')], [other]),
      ),
    ).rejects.toThrow(/another session/u)
    await expect(
      executeWorkflowsTool(
        { action: 'resume', runId: 'missing' },
        host([definition('model-start')], []),
      ),
    ).rejects.toThrow(/unsigned, modified, or unreadable/u)
  })

  it('bounds status text', async () => {
    const entry = definition('model-start')
    const many = Array.from({ length: 200 }, (_, index) => ({
      id: `step-${String(index)}`,
      state: 'open' as const,
    }))
    const runs = [
      {
        ...runFor('/workspace'),
        steps: many,
      },
    ]
    const text = await executeWorkflowsTool(
      { action: 'status', runId: 'run-1' },
      host([entry], runs),
    )
    expect(text.length).toBeLessThanOrEqual(1200)
  })

  it('refuses a text claim, a raw script, and a non-verifiable evidence kind', async () => {
    const target = host([definition('model-start')], [runFor('/workspace')])
    await expect(
      executeWorkflowsTool({ action: 'evidence', runId: 'run-1', stepId: 'requirements' }, target),
    ).rejects.toThrow(/text claim is not evidence/u)
    await expect(
      executeWorkflowsTool(
        { action: 'start', definitionId: 'model-start', script: 'rm -rf .' },
        target,
      ),
    ).rejects.toThrow(/no raw script/u)
    await expect(
      executeWorkflowsTool(
        {
          action: 'evidence',
          runId: 'run-1',
          stepId: 'requirements',
          evidence: { kind: 'declaration', ref: 'x' },
        },
        target,
      ),
    ).rejects.toThrow(/evidence kind must be "file"/u)
    expect(() => parseWorkflowsToolArgs({ action: 'adopt', name: 'auth' })).toThrow(
      /action must be|unknown field/u,
    )
    expect(() => parseWorkflowsToolArgs({ action: 'install', path: 'x' })).toThrow(
      /action must be|unknown field/u,
    )
  })

  it('asks the user before a high-risk model start and refuses no, timeout, cancel, and failure', async () => {
    const high = definition('high-risk', {
      settings: {
        allowModelStart: true,
        risk: 'high',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
    })
    const asks: string[] = []
    const yesCalls: Calls = { starts: 0, resumes: 0, cancels: 0 }
    const yesHost: WorkflowsToolHost = {
      ...host([high], [], yesCalls),
      questions: {
        ask: async () => {
          asks.push('ask')
          return { answer: 'yes' }
        },
      },
      startRun: async (entry) => {
        asks.push('start')
        yesCalls.starts += 1
        const run = runFor('/workspace', `run-${String(yesCalls.starts)}`)
        return { run: { ...run, definition: entry.id }, firstStep: 'requirements' }
      },
    }
    expect(
      await executeWorkflowsTool({ action: 'start', definitionId: 'high-risk' }, yesHost),
    ).toContain('started')
    expect(yesCalls.starts).toBe(1)
    expect(asks).toEqual(['ask', 'start'])

    for (const answer of [
      { answer: 'no' },
      { timedOut: true },
      { cancelled: true },
      new Error('the question service failed'),
    ]) {
      const calls: Calls = { starts: 0, resumes: 0, cancels: 0 }
      const refusing: WorkflowsToolHost = {
        ...host([high], [], calls),
        questions: {
          ask: async () => {
            if (answer instanceof Error) throw answer
            return answer
          },
        },
        startRun: async () => {
          calls.starts += 1
          throw new Error('the high-risk start must not run')
        },
      }
      await expect(
        executeWorkflowsTool({ action: 'start', definitionId: 'high-risk' }, refusing),
      ).rejects.toThrow()
      expect(calls.starts).toBe(0)
    }
  })

  it('verifies tool, check, human, and file evidence and binds the submitted reference', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-tools-'))
    TEMP_DIRECTORIES.push(workspace)
    await writeFile(join(workspace, 'out.md'), 'evidence\n', 'utf8')
    const entry = validateDefinition({
      v: 1,
      id: 'evidence-demo',
      name: 'Evidence demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'tool-step',
          title: 'Tool',
          executor: 'main',
          prompt: 'Run it.',
          evidence: { kind: 'tool', name: 'shell', command: 'openspec validate auth --strict' },
          next: 'check-step',
        },
        {
          id: 'check-step',
          title: 'Check',
          executor: 'main',
          prompt: 'Check it.',
          evidence: { kind: 'check', command: 'openspec validate {name} --strict' },
          next: 'human-step',
        },
        {
          id: 'human-step',
          title: 'Human',
          executor: 'main',
          prompt: 'Ask it.',
          evidence: { kind: 'human', answer: 'yes' },
          next: 'file-step',
        },
        {
          id: 'file-step',
          title: 'File',
          executor: 'main',
          prompt: 'Write it.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    })
    const run = createRun({
      definition: entry.id,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: entry.steps.map((step) => step.id),
      id: 'run-evidence',
      now: 1_000,
    })
    const target: WorkflowsToolHost = {
      ...host([entry], [run]),
      workspace,
      evidenceContext: () => ({
        toolCalls: [
          {
            callId: 'call-tool',
            name: 'pwsh',
            arguments: { command: 'openspec validate auth --strict' },
            ok: true,
          },
        ],
        shellResults: [
          {
            callId: 'call-check',
            command: 'openspec validate auth --strict',
            at: 200,
            exitCode: 0,
            foreground: true,
          },
        ],
        stepStartedAt: 100,
        answers: [{ answer: 'yes' }],
      }),
    }
    const evidence = (stepId: string, kind: string, ref: string): unknown => ({
      action: 'evidence',
      runId: 'run-evidence',
      stepId,
      evidence: { kind, ref },
    })
    expect(
      await executeWorkflowsTool(evidence('tool-step', 'tool', 'call-tool') as never, target),
    ).toContain('verified')
    expect(
      await executeWorkflowsTool(evidence('check-step', 'check', 'call-check') as never, target),
    ).toContain('verified')
    expect(
      await executeWorkflowsTool(evidence('human-step', 'human', 'yes') as never, target),
    ).toContain('verified')
    expect(
      await executeWorkflowsTool(evidence('file-step', 'file', 'out.md') as never, target),
    ).toContain('verified')
    await expect(
      executeWorkflowsTool(evidence('tool-step', 'tool', 'other-call') as never, target),
    ).rejects.toThrow(/not the host-verified evidence/u)
    await expect(
      executeWorkflowsTool(evidence('file-step', 'file', '../outside.txt') as never, target),
    ).rejects.toThrow(/not workspace-relative/u)
    await expect(
      executeWorkflowsTool(evidence('file-step', 'file', 'missing.md') as never, target),
    ).rejects.toThrow(/not the host-verified evidence/u)
  })
})

describe('workflows command and prompt context', () => {
  function commandHost(calls: Record<string, number>) {
    return {
      workspace: '/workspace',
      session: 'session-1',
      questions: { ask: async () => ({ answer: 'yes' }) },
      openView: () => 'view opened',
      run: async (id: string) => {
        calls.run = (calls.run ?? 0) + 1
        return { runId: `run-${id}`, firstStep: 'requirements' }
      },
      resume: async () => {
        calls.resume = (calls.resume ?? 0) + 1
        return { stepId: 'spec' }
      },
      install: async (path: string) => {
        calls.install = (calls.install ?? 0) + 1
        return { id: path.split('/').at(-1)?.replace('.json', '') ?? 'mine' }
      },
      adopt: async () => {
        calls.adopt = (calls.adopt ?? 0) + 1
        return { ok: true }
      },
      status: async () => 'bounded status',
    }
  }

  it('opens the view and starts nothing for a display-only command', async () => {
    const calls: Record<string, number> = {}
    const result = await runWorkflowCommand('', commandHost(calls))
    expect(result).toEqual({ kind: 'view', text: 'view opened' })
    expect(calls).toEqual({})
  })

  it('runs, resumes, installs after confirmation, and adopts', async () => {
    const calls: Record<string, number> = {}
    const host = commandHost(calls)
    expect(await runWorkflowCommand('run model-start', host)).toMatchObject({ kind: 'result' })
    expect(await runWorkflowCommand('resume run-1', host)).toMatchObject({ kind: 'result' })
    expect(await runWorkflowCommand('status', host)).toEqual({
      kind: 'result',
      text: 'bounded status',
    })
    expect(await runWorkflowCommand('install .dsh/workflows/drafts/mine.json', host)).toMatchObject(
      {
        kind: 'result',
      },
    )
    expect(await runWorkflowCommand('adopt auth', host)).toMatchObject({ kind: 'result' })
    expect(calls).toEqual({ run: 1, resume: 1, install: 1, adopt: 1 })

    const silent = { ...commandHost({}), questions: undefined }
    expect(await runWorkflowCommand('install x.json', silent)).toMatchObject({ kind: 'error' })
    const no = { ...commandHost({}), questions: { ask: async () => ({ answer: 'no' }) } }
    expect(await runWorkflowCommand('install x.json', no)).toMatchObject({ kind: 'error' })
    expect(await runWorkflowCommand('unknown', host)).toMatchObject({ kind: 'error' })
  })

  it('renders no context when no run is active and caps the active lines', () => {
    expect(renderActiveRunsContext([])).toBe('')
    const run = runFor('/workspace')
    const one = renderActiveRunsContext([run])
    expect(one).toContain('model-start')
    expect(one).toContain('requirements')
    expect(one.split('\n')).toHaveLength(1)
    const many = Array.from({ length: 9 }, (_, index) => ({
      ...runFor('/workspace', `run-${String(index)}`),
    }))
    const lines = renderActiveRunsContext(many).split('\n')
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines.at(-1)).toContain('more active run')
  })

  it('names the branch pending step, not the array-first one', () => {
    const base = runFor('/workspace')
    const run = {
      ...base,
      branchPath: ['yes', 'join'],
      steps: [
        { ...base.steps[0], id: 'join', state: 'open' as const },
        { ...base.steps[0], id: 'yes', state: 'blocked' as const },
      ],
    }
    const text = renderActiveRunsContext([run])
    expect(text).toContain('step yes')
    expect(text).not.toContain('step join')
  })

  it('registers the dynamic context only when the system-prompt service exists', () => {
    const registered: Array<{ name: string; text: () => string }> = []
    const ok = registerActiveRunsContext(
      {
        systemPrompt: {
          context: (contribution) => {
            registered.push(contribution)
            return () => {}
          },
        },
        effect: (callback) => callback(),
      },
      () => [],
    )
    expect(ok).toBe(true)
    expect(registered[0]?.name).toBe('workflows-active-runs')
    expect(registered[0]?.text()).toBe('')
    expect(registerActiveRunsContext({}, () => [])).toBe(false)
  })
})
