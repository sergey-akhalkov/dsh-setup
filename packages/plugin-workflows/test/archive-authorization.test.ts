import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { authorizeUserArchive } from '../src/host/archive-authorization.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { evaluateArchiveGate } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import type { WorkflowReceipt } from '../src/host/receipts.ts'

/**
 * The required integration review on the archive path: the agent command is
 * refused while its current PASS is missing or stale, and the user-clicked
 * archive stays the explicit human override.
 */

const TEMP_DIRECTORIES: string[] = []
const DIGEST = 'a'.repeat(64)

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-archive-auth-'))
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

async function writeArtifact(workspace: string, path: string, text = 'artifact\n'): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text, 'utf8')
}

async function writeJson(workspace: string, path: string, value: unknown): Promise<void> {
  await writeArtifact(workspace, path, `${JSON.stringify(value, null, 2)}\n`)
}

/** A change directory whose whole-spec PASS record is current. */
async function writableChange(workspace: string): Promise<string> {
  await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# Proposal\n')
  await writeArtifact(workspace, 'openspec/changes/auth/design.md', '# Design\n')
  await writeArtifact(workspace, 'openspec/changes/auth/tasks.md', '- [x] 1.1 Task\n')
  await writeArtifact(workspace, 'openspec/changes/auth/specs/workflows/spec.md', '# Spec\n')
  const digest = (await currentSpecDigest(workspace, 'auth')) as string
  await writeJson(workspace, '.dsh/workflows/records/spec-review/auth/spec.json', {
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
  return digest
}

/** A spec-less change whose marker and whole-spec PASS record are current. */
async function specLessChange(workspace: string): Promise<string> {
  await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# Proposal\n')
  await writeArtifact(workspace, 'openspec/changes/auth/design.md', '# Design\n')
  await writeArtifact(workspace, 'openspec/changes/auth/tasks.md', '- [x] 1.1 Task\n')
  await writeArtifact(
    workspace,
    'openspec/changes/auth/.openspec.yaml',
    'schema: spec-driven\nskip_specs: true\n',
  )
  const digest = (await currentSpecDigest(workspace, 'auth')) as string
  await writeJson(workspace, '.dsh/workflows/records/spec-review/auth/spec.json', {
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
  return digest
}

function intakeReceipt(): WorkflowReceipt {
  return {
    v: 1,
    kind: 'intake',
    change: 'auth',
    digest: DIGEST,
    issuedAt: 1,
    workspaceKey: '/workspace',
    signature: 'test',
  }
}

function currentSpec(): {
  ok: true
  evidence: { kind: 'record'; path: string; digest: string }
} {
  return {
    ok: true,
    evidence: {
      kind: 'record',
      path: '.dsh/workflows/records/spec-review/auth/spec.json',
      digest: DIGEST,
    },
  }
}

describe('integration review archive requirement', () => {
  it('refuses a missing or stale integration PASS and allows a current one', () => {
    const base = {
      change: 'auth',
      runs: [],
      receipts: [intakeReceipt()],
      specRecord: currentSpec(),
    }
    const missing = evaluateArchiveGate({
      ...base,
      integrationReview: {
        ok: false,
        text: 'the task list is complete and the current integration-review PASS is missing',
      },
    })
    expect(missing.kind).toBe('deny')
    if (missing.kind === 'deny') expect(missing.reason).toContain('integration-review')
    const stale = evaluateArchiveGate({
      ...base,
      integrationReview: {
        ok: false,
        text: 'the task list is complete and the current integration-review PASS is stale',
      },
    })
    expect(stale.kind).toBe('deny')
    if (stale.kind === 'deny') expect(stale.reason).toContain('stale')
    const current = evaluateArchiveGate({ ...base, integrationReview: { ok: true } })
    expect(current.kind).toBe('allow')
    // An incomplete task list omits the requirement entirely.
    const incomplete = evaluateArchiveGate({ ...base })
    expect(incomplete.kind).toBe('allow')
  })
})

describe('spec-less archive eligibility', () => {
  it('denies a click through the archive gate for a change with neither spec nor marker', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# Proposal\n')
    await writeArtifact(workspace, 'openspec/changes/auth/design.md', '# Design\n')
    await writeArtifact(workspace, 'openspec/changes/auth/tasks.md', '- [x] 1.1 Task\n')
    const digest = (await currentSpecDigest(workspace, 'auth')) as string
    await writeJson(workspace, '.dsh/workflows/records/spec-review/auth/spec.json', {
      rule: 'spec-review',
      change: 'auth',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest,
      findings: [],
      time: '2026-01-01T00:00:00.000Z',
      target: { provider: 'codex-subagent' },
    })
    const { verifySpecEligibility } = await import('../src/host/adoption.ts')
    const eligibility = await verifySpecEligibility(workspace, 'auth')
    expect(eligibility).toMatchObject({ ok: false })

    const decision = evaluateArchiveGate({
      change: 'auth',
      runs: [],
      receipts: [intakeReceipt()],
      specRecord: currentSpec(),
      specEligibility: eligibility,
    })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.reason).toContain('specs/**/spec.md')
      expect(decision.reason).toContain('skip_specs: true')
    }
  })

  it('authorizes a spec-less click and refuses it after the marker is removed', async () => {
    const workspace = await tempWorkspace()
    await specLessChange(workspace)
    const auth = HostAuth.fromKey('test-archive-host-key-0123456789')
    expect(await authorizeUserArchive(workspace, 'auth', auth)).toEqual({ ok: true })

    const removed = await tempWorkspace()
    await specLessChange(removed)
    await rm(join(removed, 'openspec', 'changes', 'auth', '.openspec.yaml'))
    const refused = await authorizeUserArchive(removed, 'auth', auth)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toContain('skip_specs: true')
  })
})

describe('user-clicked archive override', () => {
  it('authorizes the click while the integration PASS is missing', async () => {
    const workspace = await tempWorkspace()
    await writableChange(workspace)
    // No integration record exists at all; the click is the explicit override.
    const result = await authorizeUserArchive(
      workspace,
      'auth',
      HostAuth.fromKey('test-archive-host-key-0123456789'),
    )
    expect(result).toEqual({ ok: true })
  })

  it('authorizes the click while the integration record is stale', async () => {
    const workspace = await tempWorkspace()
    await writableChange(workspace)
    await writeJson(workspace, '.dsh/workflows/records/integration-review/auth/integration.json', {
      rule: 'integration-review',
      change: 'auth',
      phase: 'integration',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'b'.repeat(64),
      worktreeDigest: 'b'.repeat(64),
      findings: [],
      time: '2026-01-01T00:00:00.000Z',
      target: { provider: 'codex-subagent' },
    })
    const result = await authorizeUserArchive(
      workspace,
      'auth',
      HostAuth.fromKey('test-archive-host-key-0123456789'),
    )
    expect(result).toEqual({ ok: true })
  })
})
