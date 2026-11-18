import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptChange } from '../../plugin-workflows/src/host/adoption.ts'
import { authorizeUserArchive } from '../../plugin-workflows/src/host/archive-authorization.ts'
import type { Evidence } from '../../plugin-workflows/src/host/definitions.ts'
import {
  currentSpecDigest,
  type EvidenceContext,
  verifyEvidence,
} from '../../plugin-workflows/src/host/evidence.ts'
import { HostAuth } from '../../plugin-workflows/src/host/host-auth.ts'
import { listReceipts } from '../../plugin-workflows/src/host/receipts.ts'

/**
 * Committed acceptance for the exploratory-testing method: a disposable git
 * workspace with a minimal OpenSpec root runs a spec-less `explore-*` cycle
 * change through the intake spec evidence, adoption, and archive authorization,
 * then exercises a `fix-*` outcome change through the pending-decision and both
 * post-decision paths. The OpenSpec CLI is a machine prerequisite: its strict
 * validation and archive run when the binary is present, and the engine paths
 * are exercised either way.
 */

const INTAKE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../plugin-openspec/assets/workflows/change-intake.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  steps: Array<{ id: string; evidence?: Evidence }>
}

const A = 'explore-demo-2026-11-18'
const B = 'fix-demo-2026-11-18'
const KEY = 'exploratory-acceptance-host-key'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'exploratory-acceptance-'))
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

async function write(workspace: string, relative: string, text: string): Promise<void> {
  const file = join(workspace, relative)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text, 'utf8')
}

function git(workspace: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
}

/** Run the prerequisite CLI when the machine has it; undefined when it does not. */
function openspec(workspace: string, ...args: string[]): number | undefined {
  const probe = spawnSync('openspec', ['--version'], {
    cwd: workspace,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (probe.error !== undefined || probe.status !== 0) return undefined
  const result = spawnSync('openspec', args, {
    cwd: workspace,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return result.status ?? 1
}

async function root(workspace: string): Promise<void> {
  await write(
    workspace,
    'openspec/specs/demo/spec.md',
    `# Demo capability

## Purpose

A disposable capability for the acceptance.

## Requirements

### Requirement: Demo greeting

The system SHALL greet a user with a single-line greeting.

#### Scenario: Greeting shown

- **WHEN** a user opens the demo surface
- **THEN** the system shows a greeting
`,
  )
  git(workspace, 'init')
  git(workspace, 'config', 'user.name', 'exploratory-acceptance')
  git(workspace, 'config', 'user.email', 'acceptance@example.test')
}

async function cycleChange(workspace: string): Promise<void> {
  await write(
    workspace,
    `openspec/changes/${A}/.openspec.yaml`,
    'schema: spec-driven\ncreated: 2026-11-18\nskip_specs: true\n',
  )
  await write(
    workspace,
    `openspec/changes/${A}/proposal.md`,
    `# Proposal

## Why

Why this area now: \`demo greeting\`, knowledge mode, score 9; no hard override.

## What Changes

- In scope: \`the demo greeting\`
- Expected outcome: \`an outcome change when a finding is actionable\`

## State snapshot

\`One scenario and no oracle-backed test.\`

## Non-goals

- \`the secondary surface\`
`,
  )
  await write(
    workspace,
    `openspec/changes/${A}/design.md`,
    `# Design

## Focus register

| Area | B | K | T | C | D | A | S | F | Score | Evidence |
| --- | - | - | - | - | - | - | - | - | ----- | -------- |
| demo greeting | 3 | 3 | 3 | 0 | 0 | 0 | 3 | 1 | 9 | \`openspec/specs/demo/spec.md\` |

Selected focus: \`demo greeting\`. Focus mode: \`knowledge\`. Heuristic family: \`state/data\`.

Rejected candidates: \`secondary — no gap\`.

## Charter

- Mission: find a wrong or missing greeting.
- Risk hypothesis: an empty greeting reaches the user.
- Areas: the demo surface.
- Oracles: \`Demo greeting\` in \`openspec/specs/demo/spec.md\`.
- Heuristics: state/data.
- Timebox: 20 minutes.
- Out-of-scope: the secondary surface.
- Exit criteria: one executed observation of the greeting.

## Approval decision

- Decision: approved (acceptance).
`,
  )
  await write(
    workspace,
    `openspec/changes/${A}/state.md`,
    `# State

## Focus register

| Area | B | K | T | C | D | A | S | F | Score | Evidence |
| --- | - | - | - | - | - | - | - | - | ----- | -------- |
| demo greeting | 3 | 3 | 3 | 0 | 0 | 0 | 3 | 1 | 9 | \`openspec/specs/demo/spec.md\` |

## Next-cycle input

- Recheck the greeting once its fix lands.
`,
  )
  await write(
    workspace,
    `openspec/changes/${A}/brief.md`,
    `# Project brief

## Stack

\`Node.js\`

## Commands

- Test: \`none\`

## Safety boundaries

\`no production data; no live Harness profile\`

## Criticality table

| Area | Criticality | Why |
| --- | --- | --- |
| demo greeting | high | user-facing core path |

## Oracle sources

\`openspec/specs/demo/spec.md\`
`,
  )
  await write(
    workspace,
    `openspec/changes/${A}/tasks.md`,
    `# Tasks

## 1. State and focus

- [x] 1.1 Record the focus register in \`state.md\`.

## 2. Sessions

- [ ] 2.1 Run session 1 and record its evidence.

## 3. Triage and outcome

- [ ] 3.1 Write the triage table and every candidate finding record.
- [ ] 3.2 Create the outcome change B.
- [ ] 3.3 Update \`brief.md\`, \`state.md\`, and close A.
`,
  )
}

async function outcomeChange(workspace: string): Promise<void> {
  await write(
    workspace,
    `openspec/changes/${B}/.openspec.yaml`,
    'schema: spec-driven\ncreated: 2026-11-18\nskip_specs: true\n',
  )
  await write(
    workspace,
    `openspec/changes/${B}/proposal.md`,
    `# Proposal

## Why

The cycle found one actionable candidate; the user must classify it before any fix.

### Findings summary

| ID | Severity | Observed | Expected / oracle | Evidence | Proposed class | Confidence | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-1 | P2 | greeting is empty | Demo greeting scenario | \`findings/F-001.md\` | bug | high | fix |

## What Changes

The outcome depends on the classification: a bug becomes a red test and a fix mapped to the
existing greeting scenario.

### Classification decision requested

\`Classify F-1 before any fix task runs.\`
`,
  )
  await write(
    workspace,
    `openspec/changes/${B}/design.md`,
    `# Design

## Decision log

| Finding | Decision | Severity | Rationale | Oracle or scenario | Action |
| --- | --- | --- | --- | --- | --- |
| F-1 | pending | P2 | awaiting the user | Greeting shown | fix |

## Spec decision

- Delta: none
- \`skip_specs\`: true
`,
  )
  await write(
    workspace,
    `openspec/changes/${B}/findings/F-001.md`,
    `# F-1: greeting is empty

- Severity: P2
- Confidence: high
- Proposed class: bug
- Status: candidate
- Hypothesis: no

## Observed behavior

\`The demo surface shows an empty greeting.\`

## Expected behavior or oracle

\`Demo greeting\` scenario: the system shows a greeting.
`,
  )
  await write(
    workspace,
    `openspec/changes/${B}/tasks.md`,
    `# Tasks

## 1. Review

- [x] 1.1 Confirm the findings table and the decision log are complete.

## 2. Findings

- [ ] 2.1 F-1: add the failing regression test and record the red run.
- [ ] 2.2 F-1: apply the fix and confirm the test passes.
- [ ] 2.3 F-1: map the finding to the named existing scenario.
`,
  )
}

/** The intake spec evidence with the observed (or prerequisite-absent) validation result. */
function intakeSpecEvidence(
  workspace: string,
  change: string,
  exitCode: number,
): { evidence: Evidence; context: EvidenceContext } {
  const spec = INTAKE.steps.find((entry) => entry.id === 'spec')
  if (spec?.evidence === undefined) throw new Error('the change-intake spec step has no evidence')
  const at = Date.now()
  return {
    evidence: spec.evidence,
    context: {
      workspace,
      values: { name: change },
      stepStartedAt: at - 1_000,
      shellResults: [
        {
          callId: 'acceptance-validate',
          command: `openspec validate ${change} --strict`,
          at,
          exitCode,
          foreground: true,
        },
      ],
    },
  }
}

describe('exploratory testing method acceptance', () => {
  it('runs a spec-less cycle change through intake, adoption, and archive', async () => {
    const workspace = await tempWorkspace()
    await root(workspace)
    await cycleChange(workspace)
    const validation = openspec(workspace, 'validate', A, '--strict')
    if (validation !== undefined) expect(validation).toBe(0)

    const spec = intakeSpecEvidence(workspace, A, validation ?? 0)
    const intake = await verifyEvidence(spec.evidence, spec.context)
    expect(intake).toMatchObject({ ok: true })

    const digest = (await currentSpecDigest(workspace, A)) as string
    await write(
      workspace,
      `.dsh/workflows/records/spec-review/${A}/spec.json`,
      `${JSON.stringify({
        rule: 'spec-review',
        change: A,
        phase: 'spec',
        scope: 'whole',
        verdict: 'PASS',
        digest,
        findings: [],
        time: '2026-11-18T00:00:00.000Z',
        target: { provider: 'codex-subagent' },
      })}\n`,
    )
    const auth = HostAuth.fromKey(KEY)
    const adopted = await adoptChange({
      workspace,
      change: A,
      auth,
      questions: { ask: async () => ({ answer: 'yes' }) },
      now: Date.now(),
    })
    expect(adopted.ok).toBe(true)
    const authorized = await authorizeUserArchive(workspace, A, auth)
    expect(authorized).toEqual({ ok: true })
    expect(await listReceipts(workspace, auth)).toHaveLength(1)

    const archived = openspec(workspace, 'archive', A, '--yes')
    if (archived !== undefined) {
      expect(archived).toBe(0)
      const entries = await readdir(join(workspace, 'openspec', 'changes', 'archive'))
      expect(entries.some((entry) => entry.endsWith(A))).toBe(true)
    }
  })

  it('keeps a spec-less outcome change blocked until the decision and lands both outcomes', async () => {
    const workspace = await tempWorkspace()
    await root(workspace)
    await outcomeChange(workspace)
    const initial = openspec(workspace, 'validate', B, '--strict')
    if (initial !== undefined) expect(initial).toBe(0)

    const pendingTasks = await readFile(
      join(workspace, 'openspec', 'changes', B, 'tasks.md'),
      'utf8',
    )
    expect(pendingTasks).not.toMatch(/^-\s*\[x\]\s*2\./mu)
    const pendingDesign = await readFile(
      join(workspace, 'openspec', 'changes', B, 'design.md'),
      'utf8',
    )
    expect(pendingDesign).toContain('| F-1 | pending |')

    // The recorded decision maps the finding to the existing scenario: B stays spec-less.
    await write(
      workspace,
      `openspec/changes/${B}/design.md`,
      `# Design

## Decision log

| Finding | Decision | Severity | Rationale | Oracle or scenario | Action |
| --- | --- | --- | --- | --- | --- |
| F-1 | bug | P2 | contradicts the greeting scenario | Greeting shown | fix |

## Spec decision

- Delta: none
- \`skip_specs\`: true
`,
    )
    const stillSpecLess = openspec(workspace, 'validate', B, '--strict')
    if (stillSpecLess !== undefined) expect(stillSpecLess).toBe(0)
    const marker = await readFile(
      join(workspace, 'openspec', 'changes', B, '.openspec.yaml'),
      'utf8',
    )
    expect(marker).toContain('skip_specs: true')

    // A requirement change replaces the marker with a delta that validates.
    await write(workspace, `openspec/changes/${B}/.openspec.yaml`, 'schema: spec-driven\n')
    await write(
      workspace,
      `openspec/changes/${B}/specs/demo/spec.md`,
      `## MODIFIED Requirements

### Requirement: Demo greeting

The system SHALL greet a user with a single-line greeting and SHALL never render it empty.

#### Scenario: Greeting shown

- **WHEN** a user opens the demo surface
- **THEN** the system shows a greeting

#### Scenario: Empty greeting refused

- **WHEN** the greeting would render empty
- **THEN** the system shows the documented fallback
`,
    )
    const withDelta = openspec(workspace, 'validate', B, '--strict')
    if (withDelta !== undefined) expect(withDelta).toBe(0)
    const withoutMarker = await readFile(
      join(workspace, 'openspec', 'changes', B, '.openspec.yaml'),
      'utf8',
    )
    expect(withoutMarker).not.toContain('skip_specs: true')
  })
})
