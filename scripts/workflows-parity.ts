/**
 * The release-bound retirement parity runner.
 *
 * Replays the shared fixture table through the owned workflow decisions and
 * compares each decision with the legacy decision the fixture carries. A
 * mismatch fails and names the case and both reasons. Without arguments it
 * writes the tracked report; `--check` recomputes the table and fails when the
 * tracked report is missing, stale, or mismatched. `at` is informational.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Definition,
  loadShippedDefinitions,
} from '../packages/plugin-workflows/lib/definitions.js'
import {
  PARITY_CHANGE,
  PARITY_REPORT_NAME,
  resolveVerifySettings,
  shippedParityReportPath,
  templateHash,
} from '../packages/plugin-workflows/lib/parity.js'
import { PARITY_CASES, runParityCase } from '../packages/plugin-workflows/test/parity-fixtures.ts'

export interface GateSummary {
  cases: number
  mismatches: number
  status: 'pass' | 'fail'
}

export interface BuiltReport {
  v: 1
  change: string
  at: string
  templates: Record<string, string>
  settings: Record<string, { type: string; cases: unknown[] }>
  gates: Record<string, GateSummary>
  retained: Record<string, { cases: number; status: 'legacy' }>
  mismatches: string[]
}

const TEMPLATE_IDS = ['retro', 'task-review', 'verify'] as const

/** Two profiles with different commands and caps, one above the legacy 128. */
const SETTINGS_CASES = [
  { commands: ['pnpm check'], maxBlocks: 8 },
  { commands: ['rtk pnpm check', 'cargo test'], maxBlocks: 129 },
] as const

function templateDefinitions(): Definition[] {
  const shipped = loadShippedDefinitions()
  const templates: Definition[] = []
  for (const id of TEMPLATE_IDS) {
    const definition = shipped.find((entry) => entry.id === id)
    if (definition === undefined) throw new Error(`the shipped definition "${id}" is missing`)
    templates.push(definition)
  }
  return templates
}

/** Validate both settings profiles and record the matrix the contract accepts. */
function settingsMatrix(): BuiltReport['settings'] {
  for (const profile of SETTINGS_CASES) {
    resolveVerifySettings(profile)
  }
  return {
    'verify.commands': {
      type: 'non-empty string list',
      cases: SETTINGS_CASES.map((profile) => profile.commands),
    },
    'verify.maxBlocks': {
      type: 'positive safe integer',
      cases: SETTINGS_CASES.map((profile) => profile.maxBlocks),
    },
  }
}

/** Recompute the whole parity table. */
export async function buildParityReport(now = new Date()): Promise<BuiltReport> {
  const templates: Record<string, string> = {}
  for (const definition of templateDefinitions()) {
    templates[definition.id] = templateHash(definition)
  }
  const gates: Record<string, GateSummary> = {
    checkpoint: { cases: 0, mismatches: 0, status: 'pass' },
    'task-review': { cases: 0, mismatches: 0, status: 'pass' },
    verification: { cases: 0, mismatches: 0, status: 'pass' },
  }
  const retained: BuiltReport['retained'] = {
    'spec-review': { cases: 0, status: 'legacy' },
    'task-progress': { cases: 0, status: 'legacy' },
    'lane-assignment': { cases: 0, status: 'legacy' },
  }
  const mismatches: string[] = []
  for (const parityCase of PARITY_CASES) {
    if (parityCase.gate === 'retained') {
      const group = parityCase.retained?.group
      if (group === undefined) continue
      const key = group === 'lane' ? 'lane-assignment' : group
      retained[key] = { cases: (retained[key]?.cases ?? 0) + 1, status: 'legacy' }
      continue
    }
    const gate = gates[parityCase.gate]
    if (gate === undefined) continue
    gate.cases += 1
    const result = await runParityCase(parityCase)
    if (result.ok) continue
    gate.mismatches += 1
    gate.status = 'fail'
    const workflow = result.workflow
    mismatches.push(
      `${parityCase.id}: legacy ${parityCase.legacy.decision} (${parityCase.legacy.reason}); workflow ${workflow?.decision ?? 'missing'} (${workflow?.reason ?? 'no workflow decision'})`,
    )
  }
  return {
    v: 1,
    change: PARITY_CHANGE,
    at: now.toISOString(),
    templates,
    settings: settingsMatrix(),
    gates,
    retained,
    mismatches,
  }
}

function comparable(report: BuiltReport): string {
  return JSON.stringify({ ...report, at: '' })
}

/** Write the tracked report; a failing table exits non-zero. */
export async function writeParityReport(file = shippedParityReportPath()): Promise<BuiltReport> {
  const report = await buildParityReport()
  if (report.mismatches.length > 0) return report
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

export interface ParityCheckResult {
  readonly ok: boolean
  readonly detail: string
}

/** Recompute and compare with the tracked report, ignoring the informational `at`. */
export async function checkParityReport(
  file = shippedParityReportPath(),
): Promise<ParityCheckResult> {
  const current = await buildParityReport()
  if (current.mismatches.length > 0) {
    return {
      ok: false,
      detail: `parity mismatches: ${current.mismatches.join('; ')}`,
    }
  }
  if (!existsSync(file)) {
    return { ok: false, detail: `the tracked parity report is missing at "${file}"` }
  }
  let tracked: BuiltReport
  try {
    tracked = JSON.parse(readFileSync(file, 'utf8')) as BuiltReport
  } catch (error) {
    return {
      ok: false,
      detail: `the tracked parity report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (comparable(tracked) !== comparable(current)) {
    const templateMismatch = TEMPLATE_IDS.find(
      (id) => tracked.templates?.[id] !== current.templates[id],
    )
    if (templateMismatch !== undefined) {
      return {
        ok: false,
        detail: `the tracked parity report is stale: definition "${templateMismatch}" template hash is ${String(tracked.templates?.[templateMismatch])}, expected ${current.templates[templateMismatch]}`,
      }
    }
    return {
      ok: false,
      detail: 'the tracked parity report is stale or mismatched; run pnpm workflows:parity',
    }
  }
  return { ok: true, detail: 'the tracked parity report matches the recomputed table' }
}

function isEntrypoint(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && fileURLToPath(import.meta.url) === entry
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')
  if (check) {
    const result = await checkParityReport()
    if (!result.ok) {
      console.error(`workflows-parity: ${result.detail}`)
      process.exitCode = 1
      return
    }
    console.log(`workflows-parity: ${result.detail}`)
    return
  }
  const report = await writeParityReport()
  if (report.mismatches.length > 0) {
    for (const mismatch of report.mismatches) console.error(`workflows-parity: ${mismatch}`)
    console.error(
      `workflows-parity: ${String(report.mismatches.length)} mismatch(es); the migration must not flip ownership`,
    )
    process.exitCode = 1
    return
  }
  const summary = Object.entries(report.gates)
    .map(([gate, entry]) => `${gate} ${String(entry.cases)}`)
    .join(', ')
  console.log(
    `workflows-parity: wrote ${PARITY_REPORT_NAME} (${summary}; retained ${Object.values(
      report.retained,
    )
      .map((entry) => String(entry.cases))
      .reduce((total, count) => total + Number(count), 0)} case(s))`,
  )
}

if (isEntrypoint()) {
  void main()
}
