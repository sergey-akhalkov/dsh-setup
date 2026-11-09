import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installDefinition, loadApprovedDefinitions } from '../src/host/approval-store.ts'
import { validateDefinition } from '../src/host/definitions.ts'
import { writeDraft } from '../src/host/drafts.ts'
import { verifyEvidence } from '../src/host/evidence.ts'
import { OwnedCalls } from '../src/host/executors.ts'
import { authorizationWriteDecision } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { readReceipt, receiptPath } from '../src/host/receipts.ts'
import {
  createRun,
  readAuthenticatedRun,
  runPath,
  setRunStatus,
  writeRun,
} from '../src/host/runs.ts'
import { parseWorkflowsToolArgs } from '../src/host/tools.ts'

/** Compose the PEM marker at runtime so the repo secret scan does not flag the fixture. */
const PEM_BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' ')
const PEM_END = ['-----END', 'RSA', 'PRIVATE KEY-----'].join(' ')

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-security-'))
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
  return HostAuth.fromKey('test-security-host-key-0123456789')
}

function definitionJson(id = 'security-demo'): Record<string, unknown> {
  return {
    v: 1,
    id,
    name: id,
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
        id: 'requirements',
        title: 'Requirements',
        executor: 'main',
        prompt: 'Write the requirements.',
        evidence: { kind: 'file', path: 'out.md' },
        next: 'end',
      },
    ],
  }
}

describe('workflow security', () => {
  it('refuses every direct model write to the protected workflow stores', () => {
    for (const path of [
      '.dsh/workflows/definitions/evil.json',
      '.dsh/workflows/approved.json',
      '.dsh/workflows/receipts/auth.json',
      '.dsh/workflows/runs/run-1.json',
    ]) {
      expect(
        authorizationWriteDecision({
          workspace: '/workspace',
          exec: { name: 'write', arguments: { path } },
          ownedCallIds: new Set(),
        }),
      ).toMatchObject({ kind: 'deny' })
    }
    expect(
      authorizationWriteDecision({
        workspace: '/workspace',
        exec: { name: 'write', arguments: { path: '.dsh/workflows/approved.json' } },
        ownedCallIds: new Set(['owned-1']),
        callId: 'owned-1',
      }),
    ).toEqual({ kind: 'allow' })
    // An unowned call id is not a bypass.
    expect(
      authorizationWriteDecision({
        workspace: '/workspace',
        exec: { name: 'write', arguments: { path: '.dsh/workflows/approved.json' } },
        ownedCallIds: new Set(['owned-1']),
        callId: 'model-call',
      }),
    ).toMatchObject({ kind: 'deny' })
  })

  it('refuses a model-written definition pair through an alternate path', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows', 'definitions'), { recursive: true })
    const file = join(workspace, '.dsh', 'workflows', 'definitions', 'security-demo.json')
    const bytes = `${JSON.stringify(definitionJson(), null, 2)}\n`
    await writeFile(file, bytes, 'utf8')
    await writeFile(
      join(workspace, '.dsh', 'workflows', 'approved.json'),
      `${JSON.stringify({ v: 1, approvals: { 'security-demo': { hash: 'a'.repeat(64), signature: 'b'.repeat(64) } } })}\n`,
      'utf8',
    )
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.map((entry) => entry.id)).not.toContain('security-demo')
    expect(loaded.errors.join('\n')).toMatch(/not approved by the host/u)
    // A fabricated completed run is never authoritative.
    const fabricated = setRunStatus(
      createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['requirements'],
        now: 1_000,
      }),
      'completed',
      2_000,
    )
    await mkdir(join(workspace, '.dsh', 'workflows', 'runs'), { recursive: true })
    await writeFile(runPath(workspace, fabricated.id), `${JSON.stringify(fabricated)}\n`, 'utf8')
    expect(await readAuthenticatedRun(workspace, fabricated.id, auth())).toBeUndefined()
    expect(await readReceipt(workspace, 'auth', auth())).toBeUndefined()
  })

  it('refuses a forged receipt and a definition modified after approval', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows', 'receipts'), { recursive: true })
    await writeFile(
      receiptPath(workspace, 'auth'),
      `${JSON.stringify({ v: 1, kind: 'adoption', change: 'auth', digest: 'a'.repeat(64), issuedAt: 1, workspaceKey: workspace, signature: 'f'.repeat(64) })}\n`,
      'utf8',
    )
    expect(await readReceipt(workspace, 'auth', auth())).toBeUndefined()

    const draft = await writeDraft(
      workspace,
      'auth',
      'definition.json',
      `${JSON.stringify(definitionJson('modified-demo'), null, 2)}\n`,
    )
    const installed = await installDefinition(workspace, join(workspace, draft.path), auth())
    expect(installed.definition.id).toBe('modified-demo')
    await writeFile(
      join(workspace, '.dsh', 'workflows', 'definitions', 'modified-demo.json'),
      `${JSON.stringify(definitionJson('modified-demo'), null, 2)}`,
      'utf8',
    )
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.map((entry) => entry.id)).not.toContain('modified-demo')
  })

  it('refuses model install/adoption actions and a raw script or credential', async () => {
    expect(() => parseWorkflowsToolArgs({ action: 'install', path: 'x' })).toThrow()
    expect(() => parseWorkflowsToolArgs({ action: 'adopt', name: 'auth' })).toThrow()
    expect(() =>
      parseWorkflowsToolArgs({ action: 'start', definitionId: 'x', script: 'rm -rf .' }),
    ).toThrow(/no raw script|unknown field/u)
    const withCredential = definitionJson()
    const credentialStep = (withCredential.steps as Array<Record<string, unknown>>)[0]
    if (credentialStep === undefined) throw new Error('missing step')
    credentialStep.prompt = 'Use sk-abcdefghijklmnopqrstuvwx to call the service.'
    expect(() => validateDefinition(withCredential)).toThrow(/credential-shaped value/u)
  })

  it('refuses a definition carrying a private key and installs nothing', async () => {
    const workspace = await tempWorkspace()
    const raw = definitionJson('pem-demo')
    const step = (raw.steps as Array<Record<string, unknown>>)[0]
    if (step === undefined) throw new Error('missing step')
    step.prompt = `${PEM_BEGIN}\\nMIIE\\n${PEM_END}`
    const source = join(workspace, 'pem-demo.json')
    await writeFile(source, JSON.stringify(raw), 'utf8')
    await expect(installDefinition(workspace, source, auth())).rejects.toThrow(
      /credential-shaped value/u,
    )
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.map((entry) => entry.id)).not.toContain('pem-demo')
    await expect(
      readFile(join(workspace, '.dsh/workflows/definitions/pem-demo.json'), 'utf8'),
    ).rejects.toThrow()
    const approvals = await readFile(join(workspace, '.dsh/workflows/approved.json'), 'utf8').catch(
      () => '',
    )
    expect(approvals).not.toContain('pem-demo')
  })

  it('refuses a path escape and registers only host-generated owned call ids', async () => {
    const workspace = await tempWorkspace()
    expect(
      await verifyEvidence({ kind: 'file', path: '../../etc/passwd' }, { workspace, values: {} }),
    ).toMatchObject({ ok: false, failure: { reason: 'path-escape' } })
    await expect(writeDraft(workspace, 'auth', '../escape.md', 'x')).rejects.toThrow()
    const owned = new OwnedCalls()
    expect(owned.has('model-call')).toBe(false)
    owned.add('owned-1')
    expect(owned.has('owned-1')).toBe(true)
    await writeRun(
      workspace,
      createRun({
        definition: 'security-demo',
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        steps: ['only'],
        now: 1_000,
      }),
      auth(),
    )
    expect(await readAuthenticatedRun(workspace, 'missing', auth())).toBeUndefined()
  })
})
