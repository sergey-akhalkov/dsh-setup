import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptChange, verifyAdoptionEvidence } from '../src/host/adoption.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import type { HumanQuestionService } from '../src/host/executors.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { readReceipt, receiptPath } from '../src/host/receipts.ts'

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

async function writeArtifact(
  workspace: string,
  path: string,
  content = '# artifact\n',
): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/** Write the four artifacts and a current whole-spec PASS record. */
async function adoptable(workspace: string, change = 'auth'): Promise<string> {
  await writeArtifact(workspace, `openspec/changes/${change}/proposal.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/design.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/tasks.md`)
  await writeArtifact(workspace, `openspec/changes/${change}/specs/${change}/spec.md`)
  const digest = (await currentSpecDigest(workspace, change)) as string
  await writeArtifact(
    workspace,
    `.dsh/delegation/spec-review/${change}/spec.json`,
    `${JSON.stringify(
      {
        rule: 'spec-review',
        change,
        phase: 'spec',
        scope: 'whole',
        verdict: 'PASS',
        digest,
        findings: [],
      },
      null,
      2,
    )}\n`,
  )
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
      userStarted: true,
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

  it('blocks a missing artifact and a stale record without writing a receipt', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    await rm(join(workspace, 'openspec', 'changes', 'auth', 'design.md'))
    const missing = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      userStarted: true,
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
      userStarted: true,
      questions: answers('yes'),
    })
    expect(stale).toMatchObject({ ok: false })
    if (!stale.ok) expect(stale.reason).toContain('record-mismatch')
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('writes nothing when the user answers no or the model tries to adopt', async () => {
    const workspace = await tempWorkspace()
    await adoptable(workspace)
    const no = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      userStarted: true,
      questions: answers('no'),
    })
    expect(no).toMatchObject({ ok: false })
    await expect(readFile(receiptPath(workspace, 'auth'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const model = await adoptChange({
      workspace,
      change: 'auth',
      auth: auth(),
      userStarted: false,
      questions: answers('yes'),
    })
    expect(model).toMatchObject({ ok: false })
    if (!model.ok) expect(model.reason).toContain('user-started only')
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
