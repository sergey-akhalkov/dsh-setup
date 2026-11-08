import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Evidence } from '../src/host/definitions.ts'
import {
  currentSpecDigest,
  describeEvidence,
  type ShellResultObservation,
  type ToolCallObservation,
  verifyEvidence,
} from '../src/host/evidence.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-evidence-'))
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

async function writeArtifact(workspace: string, path: string, text = 'evidence\n'): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text, 'utf8')
}

function file(path: string, extra: Record<string, unknown> = {}): Evidence {
  return { kind: 'file', path, ...extra } as unknown as Evidence
}

const values = { name: 'auth' }

describe('file evidence', () => {
  it('accepts a present non-empty file and reports its size', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, '.dsh/workflows/drafts/auth/requirements.md', 'x'.repeat(200))
    const result = await verifyEvidence(file('.dsh/workflows/drafts/{name}/requirements.md'), {
      workspace,
      values,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.evidence).toMatchObject({ kind: 'file', bytes: 200 })
  })

  it('refuses a missing, empty, or too-small file and names the path', async () => {
    const workspace = await tempWorkspace()
    const missing = await verifyEvidence(file('missing.md'), { workspace, values })
    expect(missing).toMatchObject({
      ok: false,
      failure: { reason: 'missing-file', path: 'missing.md' },
    })
    await writeArtifact(workspace, 'empty.md', '')
    const empty = await verifyEvidence(file('empty.md'), { workspace, values })
    expect(empty).toMatchObject({ ok: false, failure: { reason: 'empty-file' } })
    await writeArtifact(workspace, 'small.md', 'tiny')
    const small = await verifyEvidence(file('small.md', { minBytes: 200 } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(small).toMatchObject({ ok: false, failure: { reason: 'too-small' } })
  })

  it('refuses a parent escape, an absolute path, and a symlink escape', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await writeArtifact(outside, 'secret.md')
    await writeArtifact(workspace, 'inside.md')
    expect(await verifyEvidence(file('../outside.txt'), { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'path-escape' },
    })
    expect(
      await verifyEvidence(file(join(outside, 'secret.md')), { workspace, values }),
    ).toMatchObject({
      ok: false,
      failure: { reason: 'path-escape' },
    })
    await symlink(
      outside,
      join(workspace, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(await verifyEvidence(file('link/secret.md'), { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'path-escape' },
    })
  })

  it('refuses an invalid or missing interpolation value', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'auth/requirements.md')
    expect(
      await verifyEvidence(file('{name}/requirements.md'), {
        workspace,
        values: { name: '../auth' },
      }),
    ).toMatchObject({ ok: false, failure: { reason: 'invalid-context' } })
    expect(
      await verifyEvidence(file('{name}/requirements.md'), { workspace, values: {} }),
    ).toMatchObject({ ok: false, failure: { reason: 'invalid-context' } })
  })
})

describe('all and glob evidence', () => {
  it('requires every item and reports the first failure with its item path', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'a.md')
    const partial: Evidence = {
      kind: 'all',
      items: [file('a.md'), file('b.md')],
    }
    expect(await verifyEvidence(partial, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'missing-file', path: 'b.md', item: 'items[1]' },
    })
  })

  it('reports a nested all failure with the complete item path', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'a.md')
    const nested: Evidence = {
      kind: 'all',
      items: [{ kind: 'all', items: [file('a.md'), file('missing.md')] }, file('c.md')],
    }
    expect(await verifyEvidence(nested, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'missing-file', item: 'items[0].items[1]' },
    })
  })

  it('expands a glob, requires a match, and refuses an empty match', async () => {
    const workspace = await tempWorkspace()
    const pattern = 'openspec/changes/{name}/specs/**/spec.md'
    await writeArtifact(workspace, 'openspec/changes/auth/specs/a/spec.md', 'one\n')
    await writeArtifact(workspace, 'openspec/changes/auth/specs/b/spec.md', 'two\n')
    const glob = file(pattern, { glob: true } as Partial<Evidence>)
    const matched = await verifyEvidence(glob, { workspace, values })
    expect(matched.ok).toBe(true)
    const noMatch = await verifyEvidence(
      file('openspec/changes/{name}/specs/**/nope.md', { glob: true } as Partial<Evidence>),
      {
        workspace,
        values,
      },
    )
    expect(noMatch).toMatchObject({ ok: false, failure: { reason: 'no-match' } })
    await writeArtifact(workspace, 'openspec/changes/auth/specs/c/spec.md', '')
    const empty = await verifyEvidence(glob, { workspace, values })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.failure.reason).toBe('empty-file')
  })
})

async function writeJson(workspace: string, path: string, value: unknown): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeChangeArtifacts(workspace: string): Promise<string> {
  await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# Proposal\n')
  await writeArtifact(workspace, 'openspec/changes/auth/design.md', '# Design\n')
  await writeArtifact(workspace, 'openspec/changes/auth/tasks.md', '- [ ] 1.1 Task\n')
  await writeArtifact(workspace, 'openspec/changes/auth/specs/x/spec.md', '# Spec\n')
  return (await currentSpecDigest(workspace, 'auth')) as string
}

describe('record and tool evidence', () => {
  it('accepts a matching whole-spec PASS record and its current digest', async () => {
    const workspace = await tempWorkspace()
    const digest = await writeChangeArtifacts(workspace)
    await writeJson(workspace, '.dsh/delegation/spec-review/auth/spec.json', {
      rule: 'spec-review',
      change: 'auth',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest,
      findings: [],
      time: '2026-01-01T00:00:00.000Z',
      target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    const evidence: Evidence = {
      kind: 'record',
      rule: 'spec-review',
      change: '{name}',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'current',
    }
    const result = await verifyEvidence(evidence, { workspace, values })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.evidence).toMatchObject({ kind: 'record', digest })
    const explicit = await verifyEvidence(
      { ...evidence, path: '.dsh/delegation/spec-review/{name}/spec.json' } as Evidence,
      { workspace, values },
    )
    expect(explicit.ok).toBe(true)
  })

  it('refuses a stale digest, a missing record, and a task-scoped record as whole-spec evidence', async () => {
    const workspace = await tempWorkspace()
    await writeChangeArtifacts(workspace)
    await writeJson(workspace, '.dsh/delegation/spec-review/auth/spec.json', {
      rule: 'spec-review',
      change: 'auth',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'b'.repeat(64),
      findings: [],
      time: '2026-01-01T00:00:00.000Z',
      target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    const record: Evidence = {
      kind: 'record',
      rule: 'spec-review',
      change: '{name}',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'current',
    }
    expect(await verifyEvidence(record, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'record-mismatch', path: '.dsh/delegation/spec-review/auth/spec.json' },
    })
    await writeJson(workspace, '.dsh/delegation/spec-review/auth/spec.json', {
      rule: 'spec-review',
      change: 'auth',
      phase: 'spec',
      scope: 'task',
      taskId: '0123456789abcdef',
      verdict: 'PASS',
      digest: 'b'.repeat(64),
      findings: [],
      time: '2026-01-01T00:00:00.000Z',
      target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    const taskScoped = await verifyEvidence(record, { workspace, values })
    expect(taskScoped).toMatchObject({ ok: false, failure: { reason: 'record-mismatch' } })
    if (!taskScoped.ok)
      expect(taskScoped.failure.detail).toMatch(/task-scoped record is not whole-spec/u)
    expect(
      await verifyEvidence(
        { ...record, path: '.dsh/delegation/spec-review/auth/missing.json' } as Evidence,
        { workspace, values },
      ),
    ).toMatchObject({ ok: false, failure: { reason: 'missing-file' } })
  })

  it('accepts a checkpoint record and refuses a non-checkpoint file', async () => {
    const workspace = await tempWorkspace()
    const checkpointPath = `.dsh/work-checkpoints/${'a'.repeat(16)}/3.json`
    await writeJson(workspace, checkpointPath, {
      turn: 3,
      outcome: 'done',
      lanes: [{ id: 'l1', owner: 'lead', scope: ['src'], state: 'done' }],
      next: 'tests',
    })
    const evidence: Evidence = {
      kind: 'record',
      source: 'checkpoint',
      rule: 'goal-continuity',
      verdict: 'done',
      path: checkpointPath,
    }
    const result = await verifyEvidence(evidence, { workspace, values })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.evidence.detail).toContain('checkpoint turn 3')
    await writeJson(workspace, checkpointPath, { turn: 3, outcome: 'continue', lanes: [] })
    expect(await verifyEvidence(evidence, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'record-mismatch' },
    })
  })

  it('matches a completed tool call with its arguments and refuses a failed one', async () => {
    const workspace = await tempWorkspace()
    const commands: ToolCallObservation[] = [
      {
        callId: 'call-1',
        name: 'shell',
        arguments: { command: 'openspec new change auth', workdir: 'repo' },
        ok: true,
      },
      {
        callId: 'call-2',
        name: 'shell',
        arguments: { command: 'openspec validate auth --strict' },
        ok: false,
      },
      {
        callId: 'call-3',
        name: 'shell',
        arguments: { argv: ['openspec', 'validate', 'auth'] },
        ok: true,
      },
    ]
    const evidence: Evidence = {
      kind: 'tool',
      name: 'shell',
      command: 'openspec new change {name}',
    }
    const matched = await verifyEvidence(evidence, { workspace, values, toolCalls: commands })
    expect(matched.ok).toBe(true)
    if (matched.ok) expect(matched.evidence.callId).toBe('call-1')
    expect(
      await verifyEvidence(
        { kind: 'tool', name: 'shell', command: 'openspec validate {name} --strict' } as Evidence,
        { workspace, values, toolCalls: commands },
      ),
    ).toMatchObject({ ok: false, failure: { reason: 'no-call' } })
    expect(
      await verifyEvidence(
        {
          kind: 'tool',
          name: 'shell',
          args: { command: 'openspec new change auth', workdir: 'other' },
        } as Evidence,
        { workspace, values, toolCalls: commands },
      ),
    ).toMatchObject({ ok: false, failure: { reason: 'no-call' } })
    expect(
      await verifyEvidence(
        {
          kind: 'tool',
          name: 'shell',
          args: { argv: ['openspec', 'validate', 'auth', '--help'] },
        } as Evidence,
        { workspace, values, toolCalls: commands },
      ),
    ).toMatchObject({ ok: false, failure: { reason: 'no-call' } })
    expect(
      await verifyEvidence(
        {
          kind: 'tool',
          name: 'shell',
          args: { argv: ['openspec', 'validate', 'auth'] },
        } as Evidence,
        { workspace, values, toolCalls: commands },
      ),
    ).toMatchObject({ ok: true })
  })
})

function shell(overrides: Partial<ShellResultObservation> = {}): ShellResultObservation {
  return {
    callId: 'call-1',
    command: 'openspec validate auth --strict',
    at: 200,
    exitCode: 0,
    foreground: true,
    ...overrides,
  }
}

describe('check and human evidence', () => {
  it('accepts a foreground zero exit after the step start and refuses each failure shape', async () => {
    const workspace = await tempWorkspace()
    const evidence: Evidence = { kind: 'check', command: 'openspec validate {name} --strict' }
    const base = { workspace, values, stepStartedAt: 100 }
    const accepted = await verifyEvidence(evidence, { ...base, shellResults: [shell()] })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.evidence).toMatchObject({ kind: 'check', callId: 'call-1' })
    for (const bad of [
      shell({ exitCode: 1 }),
      shell({ timedOut: true }),
      shell({ signal: 'SIGINT' }),
      shell({ sandboxDenied: true }),
      shell({ at: 50 }),
      shell({ foreground: false }),
    ]) {
      expect(
        await verifyEvidence(evidence, { ...base, shellResults: [bad] }),
        JSON.stringify(bad),
      ).toMatchObject({ ok: false, failure: { reason: 'check-failed' } })
    }
    expect(await verifyEvidence(evidence, { ...base, shellResults: [] })).toMatchObject({
      ok: false,
      failure: { reason: 'check-failed' },
    })
  })

  it('completes only on the declared user answer and refuses no', async () => {
    const workspace = await tempWorkspace()
    const evidence: Evidence = { kind: 'human', answer: 'yes' }
    expect(await verifyEvidence(evidence, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'no-answer' },
    })
    const rejected = await verifyEvidence(evidence, {
      workspace,
      values,
      answers: [{ answer: 'no', at: 1 }],
    })
    expect(rejected).toMatchObject({ ok: false, failure: { reason: 'rejected-answer' } })
    if (!rejected.ok) expect(rejected.failure.detail).toContain('is not one of: yes')
    const accepted = await verifyEvidence(evidence, {
      workspace,
      values,
      answers: [
        { answer: 'No', at: 1 },
        { answer: 'Yes', at: 2 },
      ],
    })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.evidence).toMatchObject({ kind: 'human', answer: 'Yes' })
    const multi: Evidence = { kind: 'human', answer: ['yes', 'approve'] }
    expect(
      await verifyEvidence(multi, { workspace, values, answers: [{ answer: 'approve' }] }),
    ).toMatchObject({ ok: true })
  })

  it('never satisfies a critical step with a declaration', async () => {
    const workspace = await tempWorkspace()
    const evidence: Evidence = { kind: 'declaration' }
    expect(await verifyEvidence(evidence, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'invalid-evidence' },
    })
    const nonCritical = await verifyEvidence(evidence, {
      workspace,
      values,
      nonCriticalStep: true,
    })
    expect(nonCritical.ok).toBe(true)
    if (nonCritical.ok) expect(nonCritical.evidence).toMatchObject({ kind: 'declaration' })
  })
})

describe('glob limits and safety', () => {
  it('enforces minBytes on every glob match', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'small.md', 'tiny')
    const result = await verifyEvidence(
      file('*.md', { glob: true, minBytes: 100 } as Partial<Evidence>),
      { workspace, values },
    )
    expect(result).toMatchObject({ ok: false, failure: { reason: 'too-small' } })
  })

  it('fails instead of approving a glob that hit its traversal limit', async () => {
    const workspace = await tempWorkspace()
    for (let index = 0; index < 201; index += 1) {
      await writeArtifact(workspace, `many/file-${String(index)}.md`, 'x')
    }
    const result = await verifyEvidence(file('many/*.md', { glob: true } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(result).toMatchObject({ ok: false, failure: { reason: 'limit-exceeded' } })
  })

  it('refuses a glob that meets an escaping symlink', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await writeArtifact(workspace, 'good.md')
    await writeArtifact(outside, 'secret.md')
    try {
      await symlink(join(outside, 'secret.md'), join(workspace, 'link.md'), 'file')
    } catch {
      return
    }
    const result = await verifyEvidence(file('*.md', { glob: true } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(result).toMatchObject({ ok: false, failure: { reason: 'path-escape' } })
  })

  it('fails a glob whose match lies beyond the depth limit', async () => {
    const workspace = await tempWorkspace()
    const nested = Array.from({ length: 14 }, (_, index) => `d${String(index)}`).join('/')
    await writeArtifact(workspace, `${nested}/deep.md`, 'x')
    const result = await verifyEvidence(file('**/deep.md', { glob: true } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(result).toMatchObject({ ok: false, failure: { reason: 'limit-exceeded' } })
  })
})

describe('glob traversal edge cases', () => {
  it('collects direct and nested files under a trailing **', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'assets/a.json', 'x')
    await writeArtifact(workspace, 'assets/nested/b.json', 'y')
    const result = await verifyEvidence(file('assets/**', { glob: true } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.evidence.bytes).toBeGreaterThanOrEqual(2)
  })

  it('fails when a glob cannot read a subtree', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'good.md', 'x')
    await writeArtifact(workspace, 'locked/secret.md', 'y')
    try {
      await chmod(join(workspace, 'locked'), 0o000)
    } catch {
      return
    }
    const result = await verifyEvidence(file('**/*.md', { glob: true } as Partial<Evidence>), {
      workspace,
      values,
    })
    await chmod(join(workspace, 'locked'), 0o755).catch(() => undefined)
    if (result.ok) return
    expect(result.failure.reason).toBe('unreadable')
  })
})

describe('path component normalization', () => {
  it('accepts leading ./ and repeated separators in a glob', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'a.md', 'x')
    await writeArtifact(workspace, 'src/host/x.ts', 'y')
    const dotted = await verifyEvidence(file('./*.md', { glob: true } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(dotted.ok).toBe(true)
    const repeated = await verifyEvidence(
      file('src//host/*.ts', { glob: true } as Partial<Evidence>),
      { workspace, values },
    )
    expect(repeated.ok).toBe(true)
  })

  it('accepts a filename beginning with two dots and still refuses an escape', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, '..drafts/valid.md', 'x')
    const valid = await verifyEvidence(file('..drafts/valid.md'), { workspace, values })
    expect(valid.ok).toBe(true)
    const escape = await verifyEvidence(file('../outside.md'), { workspace, values })
    expect(escape).toMatchObject({ ok: false, failure: { reason: 'path-escape' } })
  })
})

describe('record validation through the shared readers', () => {
  const target = { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' }

  it('refuses a PASS record that still carries findings', async () => {
    const workspace = await tempWorkspace()
    const digest = await writeChangeArtifacts(workspace)
    await writeJson(workspace, '.dsh/delegation/spec-review/auth/spec.json', {
      rule: 'spec-review',
      change: 'auth',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest,
      findings: [{ severity: 'P1', title: 'x', evidence: 'x', fix: 'x' }],
      time: '2026-01-01T00:00:00.000Z',
      target,
    })
    const result = await verifyEvidence(
      {
        kind: 'record',
        rule: 'spec-review',
        change: 'auth',
        phase: 'spec',
        scope: 'whole',
        verdict: 'PASS',
        digest: 'current',
      },
      { workspace, values },
    )
    expect(result).toMatchObject({ ok: false, failure: { reason: 'record-mismatch' } })
  })

  it('refuses a malformed checkpoint record', async () => {
    const workspace = await tempWorkspace()
    const checkpointPath = `.dsh/work-checkpoints/${'a'.repeat(16)}/3.json`
    await writeJson(workspace, checkpointPath, {
      turn: 3,
      outcome: 'continue',
      lanes: [null],
      next: 'tests',
    })
    const result = await verifyEvidence(
      {
        kind: 'record',
        source: 'checkpoint',
        rule: 'goal-continuity',
        verdict: 'continue',
        path: checkpointPath,
      },
      { workspace, values },
    )
    expect(result).toMatchObject({ ok: false, failure: { reason: 'record-mismatch' } })
  })

  it('refuses a local task PASS missing digest, findings, target, or time', async () => {
    const workspace = await tempWorkspace()
    const path = `.dsh/delegation/task-review/auth/0123456789abcdef.json`
    await writeJson(workspace, path, {
      rule: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: '0123456789abcdef',
      verdict: 'PASS',
    })
    const result = await verifyEvidence(
      {
        kind: 'record',
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        task: '0123456789abcdef',
        verdict: 'PASS',
        path,
      },
      { workspace, values },
    )
    expect(result).toMatchObject({ ok: false, failure: { reason: 'record-mismatch' } })
  })

  it('refuses a malformed portable task record', async () => {
    const workspace = await tempWorkspace()
    const path = 'openspec/changes/auth/reviews/0123456789abcdef.json'
    await writeJson(workspace, path, {
      rule: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: '0123456789abcdef',
      verdict: 'PASS',
    })
    const result = await verifyEvidence(
      {
        kind: 'record',
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        task: '0123456789abcdef',
        verdict: 'PASS',
        path,
      },
      { workspace, values },
    )
    expect(result).toMatchObject({ ok: false, failure: { reason: 'record-mismatch' } })
  })
})

it('matches the canonical taskId only and refuses a conflicting alias', async () => {
  const workspace = await tempWorkspace()
  const path = `.dsh/delegation/task-review/auth/0123456789abcdef.json`
  await writeJson(workspace, path, {
    rule: 'task-review',
    change: 'auth',
    phase: 'task',
    scope: 'task',
    taskId: '0123456789abcdef',
    task: 'fedcba9876543210',
    digest: 'a'.repeat(64),
    verdict: 'PASS',
    findings: [],
    time: '2026-01-01T00:00:00.000Z',
    target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
  })
  const evidence = (task: string): Evidence => ({
    kind: 'record',
    rule: 'task-review',
    change: 'auth',
    scope: 'task',
    task,
    verdict: 'PASS',
    path,
  })
  expect(await verifyEvidence(evidence('fedcba9876543210'), { workspace, values })).toMatchObject({
    ok: false,
    failure: { reason: 'record-mismatch' },
  })
  expect(await verifyEvidence(evidence('0123456789abcdef'), { workspace, values })).toMatchObject({
    ok: true,
  })
})

it('accepts a qualifying retry after an earlier failure or stale result and requires a step start', async () => {
  const workspace = await tempWorkspace()
  const evidence: Evidence = { kind: 'check', command: 'openspec validate {name} --strict' }
  const base = { workspace, values, stepStartedAt: 100 }
  const retried = await verifyEvidence(evidence, {
    ...base,
    shellResults: [
      shell({ callId: 'failed-attempt', at: 150, exitCode: 1 }),
      shell({ callId: 'successful-retry', at: 200 }),
    ],
  })
  expect(retried.ok).toBe(true)
  if (retried.ok) expect(retried.evidence.callId).toBe('successful-retry')
  const afterStale = await verifyEvidence(evidence, {
    ...base,
    shellResults: [
      shell({ callId: 'stale-attempt', at: 50 }),
      shell({ callId: 'fresh-attempt', at: 200 }),
    ],
  })
  expect(afterStale.ok).toBe(true)
  if (afterStale.ok) expect(afterStale.evidence.callId).toBe('fresh-attempt')
  const missingStart = await verifyEvidence(evidence, {
    workspace,
    values,
    shellResults: [shell({ callId: 'historical', at: 1 })],
  })
  expect(missingStart).toMatchObject({ ok: false, failure: { reason: 'check-failed' } })
})

describe('resolved evidence descriptions', () => {
  it('resolves the command, tool arguments, and record path the verifier checks', () => {
    const context = { workspace: '/workspace', values: { name: 'auth' } }
    expect(
      describeEvidence({ kind: 'check', command: 'openspec validate {name} --strict' }, context),
    ).toContain('openspec validate auth --strict')
    expect(
      describeEvidence(
        {
          kind: 'tool',
          name: 'shell',
          command: 'openspec new change {name}',
          args: { argv: ['openspec', 'new', 'change', '{name}'] },
        },
        context,
      ),
    ).toContain('openspec new change auth')
    const record = describeEvidence(
      {
        kind: 'record',
        rule: 'spec-review',
        change: '{name}',
        phase: 'spec',
        scope: 'whole',
        verdict: 'PASS',
        digest: 'current',
      },
      context,
    )
    expect(record).toContain('.dsh/delegation/spec-review/auth/spec.json')
    expect(record).toContain('scope=whole')
    expect(record).toContain('digest=current')
  })
})

it('renders tool arguments that the verifier accepts, without truncation', async () => {
  const context = { workspace: '/workspace', values: { name: 'auth' } }
  const described = describeEvidence(
    { kind: 'tool', name: 'shell', args: { change: '{name}' } },
    context,
  )
  expect(described).toContain('"change":"auth"')
  const verified = await verifyEvidence(
    { kind: 'tool', name: 'shell', args: { change: '{name}' } },
    {
      ...context,
      toolCalls: [{ callId: 'call-1', name: 'shell', arguments: { change: 'auth' }, ok: true }],
    },
  )
  expect(verified.ok).toBe(true)
  const long = describeEvidence(
    { kind: 'tool', name: 'shell', args: { prefix: 'a'.repeat(220), required: 'expected-tail' } },
    context,
  )
  expect(long).toContain('expected-tail')
  expect(long).toContain('a'.repeat(220))
})
