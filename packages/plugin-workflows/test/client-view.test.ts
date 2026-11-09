import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkflowRoutes,
  DEFINITIONS_ROUTE,
  EVIDENCE_ROUTE,
  RECEIPTS_ROUTE,
} from '../src/host/api.ts'
import type { Definition } from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { engineRuns, sessionRuns } from '../src/host/projection.ts'
import { issueAdoptionReceipt, listReceipts } from '../src/host/receipts.ts'
import {
  addViolation,
  createRun,
  runsDirectory,
  setRunStatus,
  settleStep,
  writeRun,
} from '../src/host/runs.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-client-'))
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
  return HostAuth.fromKey('test-client-host-key-0123456789')
}

const DEFINITION = {
  id: 'change-intake',
  name: 'OpenSpec change intake',
  version: 1,
  trigger: { kind: 'tool.pre-execute', match: { tool: 'shell' }, mode: 'active', dedupe: 'name' },
  settings: { risk: 'low', allowModelStart: false, gateOwnership: 'own' },
  steps: [
    {
      id: 'requirements',
      title: 'Requirements',
      executor: 'main',
      ownership: 'own',
      blockTurnClose: true,
    },
    {
      id: 'spec-review',
      title: 'Spec review',
      executor: 'tool',
      ownership: 'defer',
      blockTurnClose: true,
    },
  ],
} as unknown as Definition

describe('workflows view data', () => {
  it('shows a running run, a blocked run with a violation, and a malformed run file', async () => {
    const workspace = await tempWorkspace()
    const running = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      steps: ['requirements'],
      now: 1_000,
    })
    await writeRun(workspace, running, auth())
    let blocked = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      steps: ['requirements'],
      now: 2_000,
      id: 'run-blocked-1',
    })
    blocked = settleStep(blocked, 'requirements', 'blocked', {
      at: 2_100,
      reason: 'missing evidence',
    })
    blocked = addViolation(blocked, 'the turn closed at the cap', {
      step: 'requirements',
      at: 2_200,
    })
    blocked = setRunStatus(blocked, 'blocked', 2_200)
    await writeRun(workspace, blocked, auth())
    await mkdir(runsDirectory(workspace), { recursive: true })
    await writeFile(join(runsDirectory(workspace), 'malformed.json'), '{not json\n', 'utf8')

    const runs = await engineRuns(workspace)
    const runningRow = runs.find((run) => run.id === `workflow:${running.id}`)
    expect(runningRow).toMatchObject({ status: 'running', source: 'workflow' })
    expect(runningRow?.steps[0]).toMatchObject({ id: 'requirements', state: 'open' })
    const blockedRow = runs.find((run) => run.id === 'workflow:run-blocked-1')
    expect(blockedRow).toMatchObject({ status: 'running' })
    expect(blockedRow?.steps.find((step) => step.title === 'VIOLATION')).toBeDefined()
    expect(blockedRow?.steps.find((step) => step.id === 'requirements')?.reason).toBe(
      'missing evidence',
    )
    const malformed = runs.find((run) => run.id === 'workflow:malformed')
    expect(malformed).toMatchObject({ status: 'unknown' })
    expect(malformed?.error).toBeDefined()
    const sessionRows = await sessionRuns(workspace, 'session-1')
    expect(sessionRows.find((run) => run.id === 'workflow:malformed')).toBeDefined()
    // A parseable but incomplete record is also a diagnostic.
    await writeFile(
      join(runsDirectory(workspace), 'incomplete.json'),
      `${JSON.stringify({ v: 1, id: 'incomplete' })}\n`,
      'utf8',
    )
    const incompleteRows = await sessionRuns(workspace, 'session-1')
    expect(incompleteRows.find((run) => run.id === 'workflow:incomplete')?.error).toBeDefined()
    // A record without a session is also a malformed diagnostic.
    await writeFile(
      join(runsDirectory(workspace), 'missing-session.json'),
      `${JSON.stringify({ v: 1, id: 'missing-session', definition: 'change-intake', status: 'running', steps: [] })}\n`,
      'utf8',
    )
    const missingSessionRows = await sessionRuns(workspace, 'session-1')
    expect(
      missingSessionRows.find((run) => run.id === 'workflow:missing-session')?.error,
    ).toBeDefined()
    // Another session's valid failed run stays in its own session.
    const otherBase = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-B',
      workspace,
      steps: ['requirements'],
      id: 'run-other-failed',
      now: 5_000,
    })
    await writeRun(workspace, setRunStatus(otherBase, 'failed', 5_100), auth())
    const scopedRows = await sessionRuns(workspace, 'session-1')
    expect(scopedRows.find((run) => run.id === 'workflow:run-other-failed')).toBeUndefined()
  })

  it('serves the definitions and the authenticated adoption receipt', async () => {
    const workspace = await tempWorkspace()
    await issueAdoptionReceipt(workspace, 'auth', 'a'.repeat(64), auth(), 3_000)
    const receipts = await listReceipts(workspace, auth())
    expect(receipts).toHaveLength(1)
    const routes = createWorkflowRoutes({
      agents: { get: () => ({ session: {} }) },
      workingDirectory: { get: () => workspace },
      journal: { read: async () => ({ records: [] }) } as never,
      healthFor: () =>
        ({
          snapshot: () => ({ listenerCount: 5, journalWritable: true, triggerCount: 9 }),
          stateFor: () => 'healthy',
        }) as never,
      triggers: [],
      definitionsFor: () => [DEFINITION],
      receiptsFor: async () => receipts,
    })
    const definitionsRoute = routes.find((entry) => entry.path === DEFINITIONS_ROUTE)
    const receiptsRoute = routes.find((entry) => entry.path === RECEIPTS_ROUTE)
    expect(definitionsRoute).toBeDefined()
    const definitionsResponse = await definitionsRoute?.fetch(
      new Request(`http://localhost${DEFINITIONS_ROUTE}?session=s1`),
    )
    expect(definitionsResponse?.status).toBe(200)
    const definitionsBody = (await definitionsResponse?.json()) as {
      definitions: Array<{ id: string; steps: Array<{ ownership: string }> }>
    }
    expect(definitionsBody.definitions[0]?.id).toBe('change-intake')
    expect(definitionsBody.definitions[0]?.steps[1]?.ownership).toBe('defer')
    const receiptsBody = (await (
      await receiptsRoute?.fetch(new Request(`http://localhost${RECEIPTS_ROUTE}?session=s1`))
    )?.json()) as { receipts: Array<{ change: string; kind: string }> }
    expect(receiptsBody.receipts[0]).toMatchObject({ change: 'auth', kind: 'adoption' })

    // A workflow run record link is served with the same containment and redaction.
    const run = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: ['requirements'],
      id: 'run-record-link',
      now: 4_000,
    })
    await writeRun(workspace, run, auth())
    const evidenceRoute = routes.find((entry) => entry.path === EVIDENCE_ROUTE)
    expect(evidenceRoute).toBeDefined()
    const evidenceResponse = await evidenceRoute?.fetch(
      new Request(
        `http://localhost${EVIDENCE_ROUTE}?session=s1&path=${encodeURIComponent('.dsh/workflows/runs/run-record-link.json')}`,
      ),
    )
    expect(evidenceResponse?.status).toBe(200)
  })
})
