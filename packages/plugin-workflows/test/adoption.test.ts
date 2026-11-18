import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptChange, verifyAdoptionEvidence, verifyWholeSpecRecord } from '../src/host/adoption.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import type { HumanQuestionService } from '../src/host/executors.ts'
import { evaluateArchiveGate } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { listReceipts, readReceipt, receiptPath } from '../src/host/receipts.ts'
import { executeWorkflowsTool, type WorkflowsToolHost } from '../src/host/tools.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-adoption-'))
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

function auth(): HostAuth {
  return HostAuth.fromKey('test-adoption-host-key-0123456789')
}

function answers(answer: string): HumanQuestionService {
  return { ask: async () => ({ answer }) }
}

/** The model-tool host: adoption only reads the workspace, auth, and questions. */
function toolHost(workspace: string, questions: HumanQuestionService): WorkflowsToolHost {
  return {
    workspace,
    session: 'session-1',
    definitions: [],
    auth: auth(),
    questions,
    now: () => 2_000,
    startRun: async () => {
      throw new Error('the adopt test does not start runs')
    },
    resumeRun: async () => {
      throw new Error('the adopt test does not resume runs')
    },
    cancelRun: async () => {
      throw new Error('the adopt test does not cancel runs')
    },
    listRuns: async () => [],
    readRun: async () => undefined,
  }
}

async function writeArtifact(
  workspace: string,
  path: string,
  content = '# artifact\n',
): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/** Write a current whole-spec PASS record for the change's present digest. */
async function writePassRecord(workspace: string, change: string, digest: string): Promise<void> {
  const directory = `.dsh/workflows/records/spec-review/${change}`
  await writeArtifact(
    workspace,
    `${directory}/spec.json`,
    `${JSON.stringify(
      {
        rule: 'spec-review',
        change,
        phase: 'spec',
        scope: 'whole',
        verdict: 'PASS',
        digest,
        findings: [],
        time: '2026-11-07T00:00:00.000Z',
        target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
      },
      null,
      2,
    )}\n`,
  )
}

/** Write the four artifacts and a current whole-spec PASS record. */
async function adoptable(workspace: string, change = 'auth'): Promise<string> {
  await writeArtifact(workspace, `openspec/changes/${change}/proposal.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/design.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/tasks.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/specs/${change}/spec.md`)
  const digest = (await currentSpecDigest(workspace, change)) as string
  await writePassRecord(workspace, change, digest)
  return digest
}

/** Write a spec-less change with the marker and a current whole-spec PASS record. */
async function adoptableSpecLess(workspace: string, change = 'auth'): Promise<string> {
  await writeArtifact(workspace, `openspec/changes/${change}/proposal.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/design.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/tasks.md`)
  await writeArtifact(
    workspace,
    `openspec/changes/${change}/.openspec.yaml`,
    'schema: spec-driven\nskip_specs: true\n',
  )
  const digest = (await currentSpecDigest(workspace, change)) as string
  await writePassRecord(workspace, change, digest)
  return digest
}

describe('adoption of existing changes', () => {
  it('adopts a pre-existing change with a current PASS record and writes the receipt', async () => {
    const workspace = await tempWorkspace()
    const digest = await adoptable(workspace)
    const result = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('yes'),
      now: 2_000,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.receipt).toMatchObject({ kind: 'adoption', change: 'auth', digest })
      expect(await readReceipt(workspace, 'auth', auth())).toMatchObject({ change: 'auth' })
    }
    // The change directory is left in place, never recreated or moved.
    expect(
      await readFile(join(workspace, 'openspec', 'changes', 'auth', 'proposal.md'), 'utf8'),
    ).toBe('# artifact\n')
  })

  it('adopts a pre-existing active change, including add-workflow-obligations', async () => {
    const workspace = await tempWorkspace()
    const change = 'add-workflow-obligations'
    const digest = await adoptable(workspace, change)
    const result = await adoptChange({
      workspace,
      change,
      auth: auth(),
      questions: answers('yes'),
      now: 2_100,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.receipt).toMatchObject({ kind: 'adoption', change, digest })
      expect(await readReceipt(workspace, change, auth())).toMatchObject({ change })
    }
  })

  it('adopts a change whose whole-spec PASS exists only in the native store', async () => {
    const workspace = await tempWorkspace()
    const digest = await adoptable(workspace, 'auth')
    const result = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('yes'),
      now: 2_050,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.receipt).toMatchObject({ kind: 'adoption', change: 'auth', digest })
    }
  })

  it('adopts a spec-less change with skip_specs and a current PASS', async () => {
    const workspace = await tempWorkspace()
    const digest = await adoptableSpecLess(workspace)
    const result = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('yes'),
      now: 2_050,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.receipt).toMatchObject({ kind: 'adoption', change: 'auth', digest })
    }
    expect(await readReceipt(workspace, 'auth', auth())).toMatchObject({ change: 'auth' })
  })

  it('refuses a spec-less change whose marker was removed after PASS and names it', async () => {
    const workspace = await tempWorkspace()
    await adoptableSpecLess(workspace)
    await rm(join(workspace, 'openspec', 'changes', 'auth', '.openspec.yaml'))
    const refused = await verifyAdoptionEvidence(workspace, 'auth')
    expect(refused).toMatchObject({ ok: false })
    if (!refused.ok) expect(refused.reason).toContain('specs/**/spec.md')
    if (!refused.ok) expect(refused.reason).toContain('skip_specs: true')
    const result = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('yes'),
    })
    expect(result).toMatchObject({ ok: false })
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    // Changing the effective declaration invalidates the current PASS too.
    const changed = await tempWorkspace()
    await adoptableSpecLess(changed)
    await writeArtifact(
      changed,
      'openspec/changes/auth/.openspec.yaml',
      'schema: spec-driven\nskip_specs: false\n',
    )
    expect((await verifyWholeSpecRecord(changed, 'auth')).ok).toBe(false)
    const changedRefused = await verifyAdoptionEvidence(changed, 'auth')
    expect(changedRefused).toMatchObject({ ok: false })
    if (!changedRefused.ok) expect(changedRefused.reason).toContain('skip_specs: true')

    // A duplicate key is invalid YAML: stale PASS and no eligible declaration.
    const duplicate = await tempWorkspace()
    await adoptableSpecLess(duplicate)
    await writeArtifact(
      duplicate,
      'openspec/changes/auth/.openspec.yaml',
      'schema: spec-driven\nskip_specs: true\nskip_specs: false\n',
    )
    expect((await verifyWholeSpecRecord(duplicate, 'auth')).ok).toBe(false)
    const duplicateRefused = await verifyAdoptionEvidence(duplicate, 'auth')
    expect(duplicateRefused).toMatchObject({ ok: false })
    if (!duplicateRefused.ok) expect(duplicateRefused.reason).toContain('skip_specs: true')

    // The escaped spelling of the same duplicate key fails closed too.
    const escaped = await tempWorkspace()
    await adoptableSpecLess(escaped)
    await writeArtifact(
      escaped,
      'openspec/changes/auth/.openspec.yaml',
      'schema: spec-driven\nskip_specs: true\n"skip\\u005fspecs": false\n',
    )
    expect((await verifyWholeSpecRecord(escaped, 'auth')).ok).toBe(false)
    const escapedRefused = await verifyAdoptionEvidence(escaped, 'auth')
    expect(escapedRefused).toMatchObject({ ok: false })
    if (!escapedRefused.ok) expect(escapedRefused.reason).toContain('skip_specs: true')

    // A non-boolean scalar spelling is not the marker: the PASS is stale and
    // eligibility refuses without honoring the declaration.
    const invalid = await tempWorkspace()
    await adoptableSpecLess(invalid)
    await writeArtifact(
      invalid,
      'openspec/changes/auth/.openspec.yaml',
      'schema: spec-driven\nskip_specs: true#disabled\n',
    )
    expect((await verifyWholeSpecRecord(invalid, 'auth')).ok).toBe(false)
    const invalidRefused = await verifyAdoptionEvidence(invalid, 'auth')
    expect(invalidRefused).toMatchObject({ ok: false })
    if (!invalidRefused.ok) expect(invalidRefused.reason).toContain('skip_specs: true')
  })

  it('refuses a change with neither a spec file nor the marker despite a current PASS', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'openspec/changes/auth/proposal.md')
    await writeArtifact(workspace, 'openspec/changes/auth/design.md')
    await writeArtifact(workspace, 'openspec/changes/auth/tasks.md')
    const digest = (await currentSpecDigest(workspace, 'auth')) as string
    // The record is current; only the artifact eligibility forces the refusal.
    await writePassRecord(workspace, 'auth', digest)
    expect((await verifyWholeSpecRecord(workspace, 'auth')).ok).toBe(true)
    const refused = await verifyAdoptionEvidence(workspace, 'auth')
    expect(refused).toMatchObject({ ok: false })
    if (!refused.ok) expect(refused.reason).toContain('skip_specs: true')
  })

  it('names a stale record instead of a missing one', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    expect((await verifyWholeSpecRecord(workspace, 'auth')).ok).toBe(true)
    // A changed artifact makes the recorded digest stale, not absent.
    await writeArtifact(workspace, 'openspec/changes/auth/design.md', '# changed design\n')
    const stale = await verifyWholeSpecRecord(workspace, 'auth')
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.failure.reason).not.toBe('missing-file')
  })

  it('blocks a missing artifact and a stale record without writing a receipt', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    await rm(join(workspace, 'openspec', 'changes', 'auth', 'design.md'))
    const missing = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('yes'),
    })
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok) expect(missing.reason).toContain('missing-file')
    await writeArtifact(workspace, 'openspec/changes/auth/design.md')
    // A changed artifact makes the recorded digest stale.
    await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# changed proposal\n')
    expect((await verifyAdoptionEvidence(workspace, 'auth')).ok).toBe(false)
    const stale = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('yes'),
    })
    expect(stale).toMatchObject({ ok: false })
    if (!stale.ok) expect(stale.reason).toContain('record-mismatch')
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a change modified while the confirmation is pending', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const changed = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: {
        ask: async () => {
          await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# changed\n')
          return { answer: 'yes' }
        },
      },
      now: 2_000,
    })
    expect(changed).toMatchObject({ ok: false })
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const second = await tempWorkspace()
    await adoptable(second)
    const removed = await adoptChange({
      workspace: second,
      change: 'auth',
      auth: auth(),
      questions: {
        ask: async () => {
          await rm(join(second, 'openspec', 'changes', 'auth', 'design.md'))
          return { answer: 'yes' }
        },
      },
      now: 2_000,
    })
    expect(removed).toMatchObject({ ok: false })
    await expect(readFile(receiptPath(second, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a change and a refreshed PASS while the confirmation is pending', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const changed = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: {
        ask: async () => {
          await writeArtifact(workspace, 'openspec/changes/auth/proposal.md', '# changed\n')
          // Refresh the PASS to the new current digest: re-verification succeeds,
          // so only the digest comparison can refuse the receipt.
          const digest = (await currentSpecDigest(workspace, 'auth')) as string
          await writeArtifact(
            workspace,
            '.dsh/workflows/records/spec-review/auth/spec.json',
            `${JSON.stringify(
              {
                rule: 'spec-review',
                change: 'auth',
                phase: 'spec',
                scope: 'whole',
                verdict: 'PASS',
                digest,
                findings: [],
                time: '2026-11-07T00:00:00.000Z',
                target: {
                  provider: 'codex-subagent',
                  model: 'gpt-6-astra',
                  reasoningEffort: 'xhigh',
                },
              },
              null,
              2,
            )}\n`,
          )
          return { answer: 'yes' }
        },
      },
      now: 2_000,
    })
    expect(changed).toMatchObject({ ok: false })
    if (!changed.ok) expect(changed.reason).toContain('changed while the confirmation')
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a change whose artifact is a symbolic link', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const target = join(workspace, 'linked-proposal.md')
    await writeFile(target, '# linked\n', 'utf8')
    const proposal = join(workspace, 'openspec', 'changes', 'auth', 'proposal.md')
    await rm(proposal)
    try {
      await symlink(target, proposal, 'file')
    } catch (error) {
      // Creating a file symlink needs developer mode on Windows; skip only the
      // host that cannot express the attack.
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return
      }
      throw error
    }
    let asked = 0
    const result = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: {
        ask: async () => {
          asked += 1
          return { answer: 'yes' }
        },
      },
      now: 2_000,
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('symbolic link')
    expect(asked).toBe(0)
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a change that becomes a symbolic link while the question is open', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const target = join(workspace, 'linked-proposal.md')
    await writeFile(target, '# linked\n', 'utf8')
    const proposal = join(workspace, 'openspec', 'changes', 'auth', 'proposal.md')
    const probe = join(workspace, 'linked-probe.md')
    try {
      await symlink(target, probe, 'file')
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return
      }
      throw error
    }
    await rm(probe)
    const result = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: {
        ask: async () => {
          await rm(proposal)
          await symlink(target, proposal, 'file')
          return { answer: 'yes' }
        },
      },
      now: 2_000,
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('symbolic link')
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('writes nothing when the user answers no or the question service is unavailable', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const no = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: answers('no'),
    })
    expect(no).toMatchObject({ ok: false })
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const noService = await adoptChange({ workspace, change: 'auth', auth: auth() })
    expect(noService).toMatchObject({ ok: false })
    if (!noService.ok) expect(noService.reason).toContain('question service')
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('adopts through the model tool only after the user answers yes', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    expect(
      await executeWorkflowsTool(
        { action: 'adopt', change: 'auth' },
        toolHost(workspace, answers('yes')),
      ),
    ).toContain('adopted')
    const receipt = await readReceipt(workspace, 'auth', auth())
    expect(receipt).toMatchObject({ change: 'auth' })
    // Exactly one authenticated receipt was issued.
    expect(await listReceipts(workspace, auth())).toHaveLength(1)
    // The host-signed receipt is what the archive gate accepts.
    expect(
      evaluateArchiveGate({
        change: 'auth',
        runs: [],
        receipts: receipt === undefined ? [] : [receipt],
        specRecord: {
          ok: true,
          evidence: {
            kind: 'record',
            path: '.dsh/workflows/records/spec-review/auth/spec.json',
            digest: 'a'.repeat(64),
          },
        },
      }).kind,
    ).toBe('allow')

    const refused = await tempWorkspace()
    await adoptable(refused)
    await expect(
      executeWorkflowsTool({ action: 'adopt', change: 'auth' }, toolHost(refused, answers('no'))),
    ).rejects.toThrow(/did not confirm/u)
    await expect(readFile(receiptPath(refused, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses an invalid change name, a timed-out question, and a missing question service', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const invalid = await adoptChange({
      workspace,
      change: 'Bad Name',
      auth: auth(),
      questions: answers('yes'),
    })
    expect(invalid).toMatchObject({ ok: false })
    if (!invalid.ok) expect(invalid.reason).toContain('not a valid change name')
    const timedOut = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      questions: { ask: async () => ({ timedOut: true }) },
    })
    expect(timedOut).toMatchObject({ ok: false })
    if (!timedOut.ok) expect(timedOut.reason).toContain('timed out')
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a forged adoption receipt after reload', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows', 'receipts'), { recursive: true })
    await writeFile(
      receiptPath(workspace, 'auth'),
      `${JSON.stringify({
        v: 1,
        kind: 'adoption',
        change: 'auth',
        digest: 'a'.repeat(64),
        issuedAt: 1,
        signature: 'f'.repeat(64),
      })}\n`,
      'utf8',
    )
    expect(await readReceipt(workspace, 'auth', auth())).toBeUndefined()
  })
})
