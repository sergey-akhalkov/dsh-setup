import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadShippedDefinitions } from '../../packages/plugin-workflows/src/host/definitions.ts'
import { verifyEvidence } from '../../packages/plugin-workflows/src/host/evidence.ts'
import { withVerifySettings } from '../../packages/plugin-workflows/src/host/parity.ts'

const repo = join(import.meta.dirname, '..', '..')

interface PatchRow {
  id?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

/**
 * The release-gated setup check: the composed owner defaults carry the
 * retained gates and the retired switches, the built setup tree loads, and
 * both accepted verify profiles resolve against the shipped definition.
 */
describe('setup release composition', () => {
  const loadPatch = async () => {
    const text = await readFile(join(repo, 'packages', 'setup', 'cordis.patch.yml'), 'utf8')
    return text
  }

  const configFor = async (id: string): Promise<Record<string, unknown>> => {
    const parsed = parse(await loadPatch()) as Array<{ insert?: PatchRow[] }> | PatchRow[]
    const rows = parsed.flatMap((entry) => ('insert' in entry ? (entry.insert ?? []) : []))
    const overrides = parsed.filter((entry): entry is PatchRow => !('insert' in entry))
    const configured = [...rows, ...overrides].filter((row) => row.id === id)
    const withConfig = configured.filter((row) => row.config !== undefined)
    const last = withConfig.at(-1)
    if (last?.config === undefined) throw new Error(`row "${id}" has no composed config`)
    return last.config
  }

  it('composes the retained review rules and the retired switches', async () => {
    const delegation = await configFor('dsh-setup-delegation-rules')
    const rules = delegation.rules as Array<Record<string, unknown>>
    for (const [id, when, gate] of [
      ['spec-review', 'spec-ready', 'strict'],
      ['task-review', 'spec-task-ready', 'strict'],
      ['integration-review', 'implementation-complete', 'soft'],
      ['lane-fanout', 'lane-assignment', 'strict'],
    ] as const) {
      const rule = rules.find((entry) => entry.id === id)
      expect(rule).toMatchObject({ when, gate })
    }
    for (const removed of [
      'task-progress',
      'lane-boundary',
      'blocker',
      'research',
      'advisor',
      'worker-fast',
      'worker-deep',
      'bug-fix',
    ]) {
      expect(rules.some((entry) => entry.id === removed)).toBe(false)
    }
    expect((delegation.gates as Record<string, unknown>).workflowOwned).toBe(false)
    const goal = await configFor('dsh-setup-goal-continuity')
    expect((goal.checkpoint as Record<string, unknown>).automation).toBe(false)
    const workflows = await configFor('dsh-setup-workflows')
    expect((workflows.verify as Record<string, unknown>).commands).toEqual([])
    const parsed = parse(await loadPatch()) as Array<{ insert?: PatchRow[] }> | PatchRow[]
    const rows = parsed.flatMap((entry) => ('insert' in entry ? (entry.insert ?? []) : []))
    expect(rows.find((row) => row.id === 'dsh-setup-verification-gate')?.disabled).toBe(true)
  })

  it('loads the built setup tree in a fresh profile', async () => {
    for (const [packageName, entry] of [
      ['plugin-delegation-rules', 'lib/host/index.js'],
      ['plugin-workflows', 'lib/index.js'],
    ] as const) {
      const file = join(repo, 'packages', 'setup', 'node_modules', '@dsh-setup', packageName, entry)
      const module = (await import(pathToFileURL(file).href)) as { apply?: unknown }
      expect(typeof module.apply).toBe('function')
    }
  })

  it('loads both accepted verify profiles against the shipped definition', async () => {
    const verify = loadShippedDefinitions().find((entry) => entry.id === 'verify')
    if (verify === undefined) throw new Error('the shipped verify definition is missing')
    const profiles = [
      { commands: ['pnpm check'], maxBlocks: 8 },
      { commands: ['cargo test --locked'], maxBlocks: 129 },
    ] as const
    for (const profile of profiles) {
      const definition = withVerifySettings(verify, profile)
      expect(definition.settings.maxBlocks).toBe(profile.maxBlocks)
      const context = {
        workspace: '/workspace',
        values: {},
        checkCommands: profile.commands,
        lastWriteAt: 100,
        shellResults: profile.commands.map((command, index) => ({
          callId: `check-${String(index)}`,
          command,
          at: 200,
          exitCode: 0,
          foreground: true,
          ok: true,
        })),
      }
      const check = await verifyEvidence({ kind: 'check', source: 'verify-settings' }, context)
      expect(check.ok).toBe(true)
      const wrong = await verifyEvidence(
        { kind: 'check', source: 'verify-settings' },
        { ...context, shellResults: [] },
      )
      expect(wrong.ok).toBe(false)
    }
  })
})
