import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateDefinition } from '../../packages/plugin-workflows/src/host/definitions.ts'
import {
  parityLoadIssues,
  readParityReport,
  resolveVerifySettings,
} from '../../packages/plugin-workflows/src/host/parity.ts'

/**
 * The release-bound migration check: a throwaway copy of the built setup is the
 * exact vendored tree a git install delivers. The installed report must bound
 * every own definition, the retired switches must be in the composed patch, the
 * retained gates must stay, and two profile verify settings must load.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

describe('fresh-workspace migration', () => {
  let root = ''
  let setup = ''
  const vendored = (): string => join(setup, 'node_modules', '@dsh-setup', 'plugin-workflows')

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-fresh-workspace-'))
    setup = join(root, 'setup')
    cpSync(join(repoRoot, 'packages', 'setup'), setup, { recursive: true })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('ships the parity report and loads every own definition from the installed tree', () => {
    const reportPath = join(vendored(), 'assets', 'parity', 'retire-legacy-gates.json')
    const { report, error } = readParityReport(reportPath)
    expect(error).toBeUndefined()
    if (report === undefined) throw new Error('the installed tree has no parity report')
    const definitionsDir = join(vendored(), 'assets', 'definitions')
    const definitions = readdirSync(definitionsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) =>
        validateDefinition(JSON.parse(readFileSync(join(definitionsDir, name), 'utf8')), name),
      )
    expect(definitions.map((definition) => definition.id).sort()).toEqual([
      'change-intake',
      'retro',
      'task-review',
      'verify',
    ])
    const result = parityLoadIssues(definitions, report, reportPath, error)
    expect(result.issues).toEqual([])
    expect([...result.refused]).toEqual([])
    for (const gate of Object.values(report.gates)) expect(gate.status).toBe('pass')
    const ownership = new Map(
      definitions.map((definition) => [definition.id, definition.settings.gateOwnership]),
    )
    expect(ownership.get('task-review')).toBe('own')
    expect(ownership.get('retro')).toBe('own')
    expect(ownership.get('verify')).toBe('own')
  })

  it('ships the retired switches and keeps the retained gates', () => {
    const patch = readFileSync(join(setup, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('workflowOwned: false')
    expect(patch).toContain('automation: false')
    expect(patch).toContain('- id: dsh-setup-verification-gate')
    expect(patch.match(/disabled: true/gu)?.length).toBe(1)
    expect(patch).toContain('verify:')
    expect(patch).toContain('maxBlocks: 8')
    expect(patch).toContain('bottleneckAge: 2')
    expect(patch).toContain('stepInterval: 40')
    expect(patch).toContain('enforceParallel: true')
    for (const retained of ['spec-review', 'lane-fanout']) expect(patch).toContain(retained)
  })

  it('accepts two profile verify settings, including a cap above 128', () => {
    const first = resolveVerifySettings({ commands: ['pnpm check'], maxBlocks: 8 })
    expect(first.commands).toEqual(['pnpm check'])
    expect(first.maxBlocks).toBe(8)
    const second = resolveVerifySettings({
      commands: ['rtk pnpm check', 'cargo test'],
      maxBlocks: 129,
    })
    expect(second.commands).toEqual(['rtk pnpm check', 'cargo test'])
    expect(second.maxBlocks).toBe(129)
  })
})
