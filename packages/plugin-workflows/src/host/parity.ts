import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Definition,
  type LegacySignalState,
  type OwnershipResolution,
  resolveOwnership,
} from './definitions.js'
import { type NumberedTaskLine, sectionSelectable, taskSections } from './tasks.js'

/**
 * The release-bound retirement parity: the tracked report, its template
 * hashes, the verify settings contract, and the legacy decisions the owned
 * workflow gates reproduce. A definition may flip to `own` only when the
 * shipped report covers its template and every gate case passed.
 */

export const PARITY_CHANGE = 'retire-legacy-gates'
export const PARITY_REPORT_NAME = 'retire-legacy-gates.json'

export interface ParitySettingsEntry {
  readonly type: string
  readonly cases: readonly unknown[]
}

export interface ParityGateEntry {
  readonly cases: number
  readonly mismatches: number
  readonly status: string
}

export interface ParityRetainedEntry {
  readonly cases: number
  readonly replayed: number
  readonly status: string
}

export interface ParityReport {
  readonly v: 1
  readonly change: string
  readonly at: string
  readonly templates: Readonly<Record<string, string>>
  readonly settings: Readonly<Record<string, ParitySettingsEntry>>
  readonly gates: Readonly<Record<string, ParityGateEntry>>
  readonly retained: Readonly<Record<string, ParityRetainedEntry>>
  readonly mismatches: readonly string[]
}

/** Deterministic JSON: sorted object keys, so a template hash is order-free. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The parity-bound template: trigger, steps, evidence shape, gate ownership,
 * and the settings schema. Profile-provided verify values are excluded.
 */
export function templateHash(definition: Definition): string {
  const settings = definition.settings
  const template = {
    trigger: definition.trigger,
    steps: definition.steps,
    settings: {
      allowModelStart: settings.allowModelStart,
      risk: settings.risk,
      gateOwnership: settings.gateOwnership,
      // The verify definition's maxBlocks is a validated profile setting, not
      // template content; two profiles with different caps share one report.
      ...(definition.id === 'verify' ? {} : { maxBlocks: settings.maxBlocks }),
      allowIntent: settings.allowIntent,
      ...(settings.allowTools === undefined ? {} : { allowTools: settings.allowTools }),
      ...(settings.legacy === undefined ? {} : { legacy: settings.legacy }),
    },
  }
  return `sha256-${createHash('sha256').update(canonical(template)).digest('hex')}`
}

/** The five retirement ids, bound by id even if editable metadata is removed. */
const RETIREMENT_IDS: ReadonlySet<string> = new Set([
  'retro',
  'task-review',
  'verify',
  'spec-review',
  'integration-review',
])

/** No legacy signal steers, so a definition keeps its declared ownership. */
const NO_LEGACY: LegacySignalState = { installed: new Set(), enabled: new Set() }

/** The profile's effective ownership of a definition and its steps. */
function effectiveOwnership(
  definition: Definition,
  legacy: LegacySignalState | undefined,
): OwnershipResolution {
  return resolveOwnership(
    definition,
    legacy?.installed ?? NO_LEGACY.installed,
    legacy?.enabled ?? NO_LEGACY.enabled,
  )
}

/**
 * The report binds the five retirement ids whenever effectively owned, plus any
 * definition that effectively owns a retirement review signal through a step of
 * its own: the contributed change-intake runs the spec-review decision itself,
 * so it needs that signal's certification. An enabled legacy signal resolves
 * the matching definition or step to defer, so a rollback is not bound and the
 * legacy owner executes instead.
 */
export function reportBoundDefinitions(
  definitions: readonly Definition[],
  legacy?: LegacySignalState,
): Definition[] {
  return definitions.filter((definition) => {
    const resolved = effectiveOwnership(definition, legacy)
    return (
      resolved.ownership === 'own' &&
      (RETIREMENT_IDS.has(definition.id) || ownedRetirementSignals(definition, resolved).length > 0)
    )
  })
}

/**
 * The remedy for a refused retirement definition. A review definition has no
 * legacy switch after Release B; the surviving checkpoint and verification
 * sources keep theirs.
 */
function retirementSwitch(definitionId: string): string {
  if (definitionId === 'retro') return 'checkpoint.automation: true'
  if (definitionId === 'verify') return 'enable the verification-gate row'
  return 'fix the parity report, the retained baseline, or the definition'
}

/** The assets/parity directory, resolving from src and from lib. */
export function parityAssetDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(here, '../assets/parity'), resolve(here, '../../assets/parity')]
  return candidates.find((candidate) => existsSync(candidate)) ?? (candidates[0] as string)
}

export function shippedParityReportPath(): string {
  return join(parityAssetDirectory(), PARITY_REPORT_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function settingsEntries(value: unknown): Record<string, ParitySettingsEntry> | undefined {
  if (!isRecord(value)) return undefined
  const entries: Record<string, ParitySettingsEntry> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.type !== 'string' || !Array.isArray(entry.cases)) {
      return undefined
    }
    entries[key] = { type: entry.type, cases: entry.cases }
  }
  return entries
}

function gateEntries(value: unknown): Record<string, ParityGateEntry> | undefined {
  if (!isRecord(value)) return undefined
  const entries: Record<string, ParityGateEntry> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      !isRecord(entry) ||
      typeof entry.cases !== 'number' ||
      typeof entry.mismatches !== 'number' ||
      typeof entry.status !== 'string'
    ) {
      return undefined
    }
    entries[key] = {
      cases: entry.cases,
      mismatches: entry.mismatches,
      status: entry.status,
    }
  }
  return entries
}

function retainedEntries(value: unknown): Record<string, ParityRetainedEntry> | undefined {
  if (!isRecord(value)) return undefined
  const entries: Record<string, ParityRetainedEntry> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      !isRecord(entry) ||
      typeof entry.cases !== 'number' ||
      typeof entry.replayed !== 'number' ||
      typeof entry.status !== 'string'
    ) {
      return undefined
    }
    entries[key] = { cases: entry.cases, replayed: entry.replayed, status: entry.status }
  }
  return entries
}

/** Read and shape-check the tracked report. */
export function readParityReport(file: string = shippedParityReportPath()): {
  report?: ParityReport
  error?: string
} {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { error: `the parity report "${file}" is missing or unreadable` }
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    return {
      error: `the parity report "${file}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!isRecord(value)) return { error: 'the parity report must be a JSON object' }
  const templates = value.templates
  if (
    !isRecord(templates) ||
    !Object.values(templates).every((entry) => typeof entry === 'string')
  ) {
    return { error: 'the parity report must map each template id to its hash' }
  }
  const settings = settingsEntries(value.settings)
  const gates = gateEntries(value.gates)
  if (settings === undefined || gates === undefined) {
    return { error: 'the parity report settings and gates sections are malformed' }
  }
  const retained = retainedEntries(value.retained)
  if (retained === undefined) return { error: 'the parity report retained cases are malformed' }
  if (
    !Array.isArray(value.mismatches) ||
    !value.mismatches.every((entry) => typeof entry === 'string')
  ) {
    return { error: 'the parity report mismatches must be a list of strings' }
  }
  return {
    report: {
      v: 1,
      change: String(value.change ?? ''),
      at: String(value.at ?? ''),
      templates: templates as Record<string, string>,
      settings,
      gates,
      retained,
      mismatches: value.mismatches,
    },
  }
}

/** The rollback switch a refused definition names. */
export function legacySwitchFor(plugin: string, signal: string): string {
  if (plugin === 'goal-continuity') return 'checkpoint.automation: true'
  if (plugin === 'verification-gate') return 'enable the verification-gate row'
  return `enable "${plugin}/${signal}"`
}

/** The report gate key for one legacy-gate definition id. */
function gateKeyOf(definitionId: string): string {
  if (definitionId === 'retro') return 'checkpoint'
  if (definitionId === 'verify') return 'verification'
  return definitionId
}

/** A retired gate certified by the report's replayed retained cases. */
export type RetainedGate =
  | 'spec-review'
  | 'integration-review'
  | 'task-progress'
  | 'lane-assignment'

/**
 * The retirement review signals a definition effectively owns through its own
 * steps. A contributed definition such as change-intake runs the spec-review
 * decision itself, so the signal's retained replay certifies that path too. An
 * effectively deferred definition or step owns nothing.
 */
function ownedRetirementSignals(
  definition: Definition,
  resolved: OwnershipResolution,
): RetainedGate[] {
  if (resolved.ownership !== 'own') return []
  const signals = new Set<RetainedGate>()
  for (const step of definition.steps) {
    const ownership =
      resolved.steps.find((entry) => entry.id === step.id)?.ownership ?? step.ownership ?? 'own'
    if (ownership !== 'own') continue
    const signal =
      step.legacy?.signal ??
      (step.executor === 'review' && (step.id === 'spec-review' || step.id === 'integration-review')
        ? step.id
        : undefined)
    if (signal === 'spec-review' || signal === 'integration-review') signals.add(signal)
  }
  return [...signals].sort()
}

/** Whether every case of one retained group replayed with a matching decision. */
function retainedCertified(entry: ParityRetainedEntry | undefined): boolean {
  return (
    entry !== undefined &&
    entry.status === 'replayed' &&
    entry.cases > 0 &&
    entry.replayed === entry.cases
  )
}

/**
 * The runtime certification of one retired gate: a recorded mismatch, an absent
 * case table, or a replay that did not complete is a failure. A missing or
 * changed evaluator surfaces as such an entry, so the gate is never certified
 * from a stale table. Returns one line naming the cause and the rollback.
 */
export function retiredGateIssue(
  report: ParityReport | undefined,
  reportError: string | undefined,
  reportPath: string,
  group: RetainedGate,
): string | undefined {
  const remedy = `fix the parity report, the retained baseline, or the definition, then run pnpm workflows:parity`
  if (report === undefined) {
    return `the parity report is missing or unreadable at "${reportPath}" (${reportError ?? 'no report'}); ${remedy}`
  }
  const entry = report.retained[group]
  if (entry === undefined) {
    return `the parity report does not carry the retained "${group}" cases; a missing evaluator fails certification; ${remedy}`
  }
  if (!retainedCertified(entry)) {
    return `the retained "${group}" parity cases did not replay (status ${entry.status}, ${String(entry.replayed)}/${String(entry.cases)}); a missing evaluator or a decision mismatch fails certification; ${remedy}`
  }
  if (report.mismatches.length > 0) {
    const first = (report.mismatches[0] ?? '').slice(0, 200)
    return `the parity report records ${String(report.mismatches.length)} mismatch(es) ("${first}"); a decision mismatch fails certification; ${remedy}`
  }
  return undefined
}

/** Every issue that blocks one `own` definition from loading, with its id. */
export interface ParityLoadResult {
  readonly issues: readonly string[]
  readonly refused: ReadonlySet<string>
}

/**
 * Every parity issue that blocks one effectively owned definition from loading,
 * with its id. The profile's legacy signal state resolves a rolled-back
 * definition or step to defer, so it is none of parity's business.
 */
export function parityLoadIssues(
  definitions: readonly Definition[],
  report: ParityReport | undefined,
  reportPath: string,
  reportError: string | undefined,
  legacy?: LegacySignalState,
): ParityLoadResult {
  const bound = reportBoundDefinitions(definitions, legacy)
  const issues: string[] = []
  const refused = new Set<string>()
  const ownedSignals = (definition: Definition): RetainedGate[] =>
    ownedRetirementSignals(definition, effectiveOwnership(definition, legacy))
  if (bound.length === 0) return { issues, refused }
  if (report === undefined) {
    for (const definition of bound) {
      refused.add(definition.id)
      if (!RETIREMENT_IDS.has(definition.id)) {
        if (ownedSignals(definition).length > 0) {
          issues.push(
            `workflow definition "${definition.id}": fix the parity report, the retained baseline, or the definition; the parity report is missing at "${reportPath}" (${reportError ?? 'no report'})`,
          )
        }
        continue
      }
      const rollback = retirementSwitch(definition.id)
      issues.push(
        `workflow definition "${definition.id}": set ${rollback} to fall back to the legacy gate; the parity report is missing at "${reportPath}" (${reportError ?? 'no report'})`,
      )
    }
    return { issues, refused }
  }
  const mismatch =
    report.mismatches.length === 0
      ? undefined
      : `the parity report records ${String(report.mismatches.length)} mismatch(es) ("${(report.mismatches[0] ?? '').slice(0, 200)}"); a decision mismatch fails certification`
  const verifyIsBound = bound.some((definition) => definition.id === 'verify')
  for (const definition of bound) {
    if (!RETIREMENT_IDS.has(definition.id)) {
      // A contributed step owns the signal and writes the shared record, so the
      // signal's replayed retained cases certify it; no template hash covers a
      // definition the workflows plugin does not ship.
      for (const signal of ownedSignals(definition)) {
        const retained = retiredGateIssue(report, undefined, reportPath, signal)
        if (retained === undefined) continue
        refused.add(definition.id)
        issues.push(`workflow definition "${definition.id}": ${retained}`)
      }
      continue
    }
    const rollback = retirementSwitch(definition.id)
    if (mismatch !== undefined) {
      refused.add(definition.id)
      issues.push(`workflow definition "${definition.id}": set ${rollback}; ${mismatch}`)
      continue
    }
    const expected = report.templates[definition.id]
    const actual = templateHash(definition)
    if (expected === undefined) {
      refused.add(definition.id)
      issues.push(
        `workflow definition "${definition.id}": the parity report does not cover its template hash (actual ${actual}); set ${rollback} or run pnpm workflows:parity`,
      )
      continue
    }
    if (expected !== actual) {
      refused.add(definition.id)
      issues.push(
        `workflow definition "${definition.id}": template hash ${actual} does not match the report's ${expected}; set ${rollback} or run pnpm workflows:parity`,
      )
      continue
    }
    if (definition.id === 'spec-review' || definition.id === 'integration-review') {
      const retained = retiredGateIssue(report, undefined, reportPath, definition.id)
      if (retained !== undefined) {
        refused.add(definition.id)
        issues.push(`workflow definition "${definition.id}": ${retained}`)
      }
      continue
    }
    const gate = report.gates[gateKeyOf(definition.id)]
    if (gate === undefined || gate.status !== 'pass' || gate.mismatches !== 0) {
      refused.add(definition.id)
      issues.push(
        `workflow definition "${definition.id}": the parity gate is not pass (${gate?.status ?? 'missing'}); set ${rollback} or fix the parity cases`,
      )
    }
  }
  // A deferred verify is not report-bound: the settings matrix gates only the
  // own definition, so the documented rollback (defer + enabled row) loads.
  if (verifyIsBound && !verifySettingsMatrixValid(report.settings)) {
    refused.add('verify')
    issues.push(
      `workflow definition "verify": set ${legacySwitchFor('verification-gate', 'verification-gate')} or run pnpm workflows:parity; the report settings matrix must list at least two non-empty command lists and a positive safe maxBlocks above 128`,
    )
  }
  return { issues, refused }
}

/** The tracked settings matrix must mirror the validated verify settings. */
function verifySettingsMatrixValid(settings: ParityReport['settings']): boolean {
  const commands = settings['verify.commands']
  const caps = settings['verify.maxBlocks']
  const validCommands =
    commands?.type === 'non-empty string list' &&
    commands.cases.length >= 2 &&
    commands.cases.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length > 0 &&
        entry.every((command) => typeof command === 'string' && command.trim() !== ''),
    )
  const validCaps =
    caps?.type === 'positive safe integer' &&
    caps.cases.length >= 2 &&
    caps.cases.every(
      (entry) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0,
    ) &&
    caps.cases.some((entry) => typeof entry === 'number' && entry > 128)
  return validCommands && validCaps
}

/** The profile's verify settings: validated values outside the template hash. */
export interface VerifySettings {
  readonly commands: readonly string[]
  readonly maxBlocks: number
}

export const DEFAULT_VERIFY_SETTINGS: VerifySettings = Object.freeze({
  commands: Object.freeze([]),
  maxBlocks: 8,
})

/** Validate `workflows.verify` fail-loud with the field and its accepted shape. */
export function resolveVerifySettings(raw: unknown): VerifySettings {
  if (raw === undefined) return DEFAULT_VERIFY_SETTINGS
  if (!isRecord(raw)) {
    throw new Error(
      'workflows verify settings must be an object: { commands?: string[], maxBlocks?: number }',
    )
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'commands' && key !== 'maxBlocks') {
      throw new Error(`workflows verify has an unknown field "${key}"; use commands or maxBlocks`)
    }
  }
  let commands: readonly string[] = DEFAULT_VERIFY_SETTINGS.commands
  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands)) {
      throw new Error('workflows verify.commands must be a list of non-empty commands')
    }
    const values: string[] = []
    for (const entry of raw.commands) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error('workflows verify.commands must contain only non-empty strings')
      }
      values.push(entry.trim())
    }
    commands = Object.freeze(values)
  }
  let maxBlocks = DEFAULT_VERIFY_SETTINGS.maxBlocks
  if (raw.maxBlocks !== undefined) {
    if (
      typeof raw.maxBlocks !== 'number' ||
      !Number.isSafeInteger(raw.maxBlocks) ||
      raw.maxBlocks < 1
    ) {
      throw new Error('workflows verify.maxBlocks must be a positive safe integer')
    }
    maxBlocks = raw.maxBlocks
  }
  return { commands, maxBlocks }
}

/** Apply the validated profile values to the shipped verify definition. */
export function withVerifySettings(definition: Definition, settings: VerifySettings): Definition {
  if (definition.id !== 'verify') return definition
  return {
    ...definition,
    settings: { ...definition.settings, maxBlocks: settings.maxBlocks },
  }
}

/* ------------------------------------------------------------------ */
/* legacy decisions reproduced by the owned gates                      */
/* ------------------------------------------------------------------ */

export interface TaskLine {
  readonly id: string
  readonly number: string
  readonly text: string
}

/** Checked numbered tasks from a tasks.md body. */
export function checkedTaskLines(markdown: string): TaskLine[] {
  const tasks: TaskLine[] = []
  for (const match of markdown.matchAll(/^\s*-\s*\[[xX]\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu)) {
    const text = (match[2] ?? '').replace(/\s+/gu, ' ').trim()
    tasks.push({
      id: createHash('sha256').update(text).digest('hex').slice(0, 16),
      number: match[1] ?? '',
      text,
    })
  }
  return tasks
}

interface PortableApproval {
  readonly rule?: unknown
  readonly change?: unknown
  readonly taskId?: unknown
  readonly verdict?: unknown
  readonly target?: { readonly provider?: unknown; readonly model?: unknown }
}

const PORTABLE_KEYS = new Set([
  'rule',
  'change',
  'scope',
  'taskId',
  'digest',
  'worktreeDigest',
  'verdict',
  'findings',
  'target',
  'time',
])
const PORTABLE_TARGET_KEYS = new Set(['provider', 'model', 'reasoningEffort'])
function hasMachinePath(value: string): boolean {
  return (
    /[A-Za-z]:[\\/]/.test(value) ||
    /\\\\/.test(value) ||
    /file:\/\//i.test(value) ||
    /(?:^|[\s"'=([{<`])\/[^\s"'`)\]}>]+/.test(value) ||
    /(?:^|[\s"'=([{<`])~[/\\]/.test(value)
  )
}
/**
 * The committed portable schema; unknown fields (session, runId, phase) and an
 * invalid optional worktreeDigest can never approve a completion or archive.
 */
function strictPortableApprovalError(record: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(record)) {
    if (!PORTABLE_KEYS.has(key)) return `unsupported field "${key}"`
  }
  if (record.scope !== 'task') return 'scope must be "task"'
  if (typeof record.rule !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.rule)) {
    return 'rule must be a kebab-case rule id'
  }
  if (typeof record.change !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(record.change)) {
    return 'change must be a change directory name'
  }
  if (typeof record.taskId !== 'string' || !/^[0-9a-f]{16}$/u.test(record.taskId)) {
    return 'taskId must be 16 lowercase hex characters'
  }
  if (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(record.digest)) {
    return 'digest must be 64 hex characters'
  }
  if (
    record.worktreeDigest !== undefined &&
    (typeof record.worktreeDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(record.worktreeDigest))
  ) {
    return 'worktreeDigest must be 64 hex characters when present'
  }
  if (record.verdict !== 'PASS') return 'a portable approval must be a PASS'
  if (!Array.isArray(record.findings) || record.findings.length !== 0) {
    return 'a portable approval must have zero findings'
  }
  if (!isRecord(record.target)) return 'target must be an object'
  for (const key of Object.keys(record.target)) {
    if (!PORTABLE_TARGET_KEYS.has(key)) return `unsupported target field "${key}"`
  }
  for (const field of ['provider', 'model', 'reasoningEffort'] as const) {
    const value = record.target[field]
    if (value === undefined && field !== 'provider') continue
    if (typeof value !== 'string' || value.trim() === '' || hasMachinePath(value)) {
      return `target.${field} must be a clean non-empty string`
    }
  }
  if (typeof record.time !== 'string' || record.time.trim() === '' || hasMachinePath(record.time)) {
    return 'time must be a clean non-empty string'
  }
  return undefined
}

function readPortableApproval(
  workspace: string,
  change: string,
  taskId: string,
): PortableApproval | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(
        join(workspace, 'openspec', 'changes', change, 'reviews', `${taskId}.json`),
        'utf8',
      ),
    ) as unknown
    if (!isRecord(raw)) return undefined
    return strictPortableApprovalError(raw) === undefined ? (raw as PortableApproval) : undefined
  } catch {
    return undefined
  }
}

/** The marker's reviewer binding, its archive-gate settings, or its error. */
export interface ReviewApprovalBinding {
  readonly provider?: string
  readonly model?: string
  readonly invalid?: string
  /** Whether the marker turns portable task approvals on for its archive gate. */
  readonly archiveGate?: boolean
  /** The task-scoped review rule the marker binds. */
  readonly taskRule?: string
}

/** The marker-pinned reviewer and archive-gate settings, or an error when the marker is invalid. */
export function reviewerBinding(workspace: string): ReviewApprovalBinding | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(workspace, 'openspec', 'review-approval.json'), 'utf8'))
  } catch (error) {
    // An absent marker means no binding; an unreadable or malformed marker is
    // a configuration error that must not silently drop the binding.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? undefined
      : { invalid: 'openspec/review-approval.json is unreadable or not valid JSON' }
  }
  if (!isRecord(raw)) return { invalid: 'openspec/review-approval.json is not a JSON object' }
  const markerKeys = new Set([
    'version',
    'archiveGate',
    'taskRule',
    'reviewerProvider',
    'reviewerModel',
    'cutoff',
    'grandfathered',
  ])
  for (const key of Object.keys(raw)) {
    if (!markerKeys.has(key)) {
      return { invalid: `review-approval.json has an unknown field "${key}"` }
    }
  }
  if (raw.version !== 1) return { invalid: 'review-approval.json version must be 1' }
  if (typeof raw.archiveGate !== 'boolean') {
    return { invalid: 'review-approval.json archiveGate must be a boolean' }
  }
  if (typeof raw.taskRule !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(raw.taskRule)) {
    return { invalid: 'review-approval.json taskRule must be a kebab-case rule id' }
  }
  if (
    raw.cutoff !== undefined &&
    (typeof raw.cutoff !== 'string' || raw.cutoff.trim() === '' || hasMachinePath(raw.cutoff))
  ) {
    return { invalid: 'review-approval.json cutoff must be a clean string' }
  }
  if (raw.grandfathered !== undefined) {
    if (!isRecord(raw.grandfathered)) {
      return { invalid: 'review-approval.json grandfathered must be an object' }
    }
    for (const [key, value] of Object.entries(raw.grandfathered)) {
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(key) || key === 'archive') {
        return { invalid: 'review-approval.json grandfathered keys must be change names' }
      }
      if (typeof value !== 'string' || value.trim() === '' || hasMachinePath(value)) {
        return { invalid: 'review-approval.json grandfathered values must be clean strings' }
      }
    }
  }
  const provider = raw.reviewerProvider
  const model = raw.reviewerModel
  if (
    provider !== undefined &&
    (typeof provider !== 'string' || provider.trim() === '' || hasMachinePath(provider))
  ) {
    return { invalid: 'reviewerProvider must be a clean provider name' }
  }
  if (
    model !== undefined &&
    (typeof model !== 'string' || model.trim() === '' || hasMachinePath(model))
  ) {
    return { invalid: 'reviewerModel must be a clean model name' }
  }
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    archiveGate: raw.archiveGate as boolean,
    taskRule: raw.taskRule as string,
  }
}

/** One review unit: a level-2 section covering every checked task in it, or a single task. */
export interface ReviewUnit {
  /** The section key and title of a section unit; absent for a per-task unit. */
  readonly section?: { readonly key: string; readonly title: string }
  /** Every checked task the unit covers, in file order. */
  readonly covered: readonly NumberedTaskLine[]
  /** The covered checked tasks without a matching PASS/ERROR record, in file order. */
  readonly missing: readonly NumberedTaskLine[]
}

/** One open task-review run the review-unit text may point at. */
export interface ReviewUnitRun {
  readonly id: string
  readonly change: string
  readonly context: Readonly<Record<string, unknown>>
}

export interface ReviewUnitTextOptions {
  /** The rule the start action names; default the shipped `task-review`. */
  readonly rule?: string
  /** Open task-review runs; a run covering the unit is pointed at instead of a start. */
  readonly openRuns?: readonly ReviewUnitRun[]
}

/** One task number list bounded so the steer's action never falls off the end. */
const MAX_UNIT_NUMBERS = 20
/** The unit text bound: the completion prefix plus one unit must fit the steer note. */
const MAX_UNIT_TEXT = 470

function boundedNumbers(tasks: readonly NumberedTaskLine[]): string {
  const shown = tasks
    .slice(0, MAX_UNIT_NUMBERS)
    .map((task) => task.number)
    .join(', ')
  return tasks.length <= MAX_UNIT_NUMBERS
    ? shown
    : `${shown}, and ${String(tasks.length - MAX_UNIT_NUMBERS)} more`
}

/** Bound a free-text field (a section key or title) without losing its start. */
function clipped(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

/** Keep the action whole: the head may lose its tail, the remedy never does. */
function clampUnitText(head: string, action: string): string {
  const room = MAX_UNIT_TEXT - action.length
  return head.length <= room
    ? `${head}${action}`
    : `${head.slice(0, Math.max(0, room - 1))}…${action}`
}

/** The task ids one open run's recorded identity covers. */
function runCoveredIds(run: ReviewUnitRun): string[] {
  const context = run.context
  const covered = Array.isArray(context.taskIds)
    ? context.taskIds.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (typeof context.taskId === 'string' && !covered.includes(context.taskId)) {
    covered.push(context.taskId)
  }
  return covered
}

/** The open runs of this change that cover at least one missing task of the unit. */
function pendingRunsOf(
  change: string,
  unit: ReviewUnit,
  openRuns: readonly ReviewUnitRun[],
): ReviewUnitRun[] {
  return openRuns.filter(
    (run) =>
      run.change === change && unit.missing.some((task) => runCoveredIds(run).includes(task.id)),
  )
}

/**
 * The one-line review unit: the section key and the missing task numbers (or the
 * single task) and the start action that covers them — or the open runs that
 * already cover them (or part of them). Shared by the turn-close steer and the
 * status summary.
 */
export function reviewUnitText(
  change: string,
  unit: ReviewUnit,
  options: ReviewUnitTextOptions = {},
): string {
  const rule = options.rule ?? 'task-review'
  const pending = pendingRunsOf(change, unit, options.openRuns ?? [])
  const uncovered = unit.missing.filter(
    (task) => !pending.some((run) => runCoveredIds(run).includes(task.id)),
  )
  const names = pending.map((run) => `"${run.id}"`).join(', ')
  const action = (selector: string): string => {
    if (pending.length === 0) {
      return `; start it with workflows(action: "start", definitionId: "${rule}", change: "${change}", ${selector})`
    }
    const reference =
      pending.length === 1
        ? `the open review run ${names} covers ${uncovered.length === 0 ? 'it' : 'part of it'}`
        : `the open review runs ${names} cover ${uncovered.length === 0 ? 'it' : 'part of it'}`
    return uncovered.length === 0
      ? `; ${reference}, so continue ${pending.length === 1 ? 'that run' : 'those runs'} instead of a new start`
      : `; ${reference}, so start only the uncovered tasks with workflows(action: "start", definitionId: "${rule}", change: "${change}", task: "<task id>")`
  }
  const section = unit.section
  if (section === undefined) {
    const task = unit.missing[0]
    if (task === undefined) return `change "${change}" has no outstanding review unit`
    const head = `task "${task.number} ${task.text}" (${task.id}) has no ${rule} PASS/ERROR record`
    return clampUnitText(head, action(`task: "${task.id}"`))
  }
  const head = `section "${clipped(section.key, 40)}" (${clipped(section.title, 60)}) is one review unit; missing a ${rule} PASS/ERROR record: ${boundedNumbers(unit.missing)}`
  return clampUnitText(head, action(`section: "${section.key}"`))
}

export interface TaskReviewCoverage {
  readonly ok: boolean
  /** One line per missing review unit. */
  readonly gaps: readonly string[]
}

/**
 * The portable completion/archive coverage: every checked task needs a portable
 * PASS for the given task-scoped rule (default the shipped `task-review`) and
 * the marker's reviewer when one is declared. A section with two or more checked
 * tasks without a portable PASS is one section gap; a single missing task keeps
 * its own line.
 */
export function taskReviewCoverage(
  workspace: string,
  change: string,
  rule = 'task-review',
  options: ReviewUnitTextOptions = {},
): TaskReviewCoverage {
  let markdown: string
  try {
    markdown = readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8')
  } catch {
    return {
      ok: false,
      gaps: [`openspec/changes/${change}/tasks.md is missing or unreadable`],
    }
  }
  const reviewer = reviewerBinding(workspace)
  if (reviewer?.invalid !== undefined) {
    return {
      ok: false,
      gaps: [`${reviewer.invalid}; fix openspec/review-approval.json before completing`],
    }
  }
  const gaps: string[] = []
  // A checked line the task parser cannot read is an unapproved checked task,
  // not an absent one; refuse the completion instead of silently skipping it.
  for (const line of markdown.split('\n')) {
    if (
      /^\s*[-*+]\s*\[[xX]\]/u.test(line) &&
      !/^\s*-\s*\[[xX]\]\s+\d+(?:\.\d+)*\s+\S/u.test(line)
    ) {
      gaps.push(
        `checked task line "${line.trim()}" is not a numbered task; fix tasks.md so its review can be matched`,
      )
    }
  }
  const taskGap = (task: TaskLine): string | undefined => {
    const record = readPortableApproval(workspace, change, task.id)
    const mismatch: string[] = []
    if (record === undefined) mismatch.push('no portable PASS record')
    else {
      if (record.rule !== rule) mismatch.push(`rule "${String(record.rule)}"`)
      if (record.change !== change) mismatch.push(`change "${String(record.change)}"`)
      if (record.taskId !== task.id) mismatch.push(`task id "${String(record.taskId)}"`)
      if (record.verdict !== 'PASS') mismatch.push(`verdict ${String(record.verdict)}`)
      const target = record.target ?? {}
      if (reviewer?.provider !== undefined && target.provider !== reviewer.provider) {
        mismatch.push(`target provider "${String(target.provider)}"`)
      }
      if (reviewer?.model !== undefined && target.model !== reviewer.model) {
        mismatch.push(`target model "${String(target.model)}"`)
      }
    }
    if (mismatch.length === 0) return undefined
    const unitTask = { ...task, checked: true }
    const pending = pendingRunsOf(
      change,
      { covered: [unitTask], missing: [unitTask] },
      options.openRuns ?? [],
    )
    const action =
      pending.length === 0
        ? `run workflows(action: "start", definitionId: "${rule}", change: "${change}", task: "${task.id}")`
        : `the open review run${pending.length === 1 ? '' : 's'} ${pending.map((run) => `"${run.id}"`).join(', ')} cover${pending.length === 1 ? 's' : ''} it, so continue ${pending.length === 1 ? 'that run' : 'those runs'} instead of a new start`
    return `checked task "${task.number} ${task.text}" (${task.id}) has no portable ${rule} PASS (${mismatch.join(', ')}); ${action}`
  }
  const taskGaps = checkedTaskLines(markdown).map((task) => ({ task, gap: taskGap(task) }))
  const missing = new Set(taskGaps.filter((entry) => entry.gap !== undefined).map((e) => e.task.id))
  const grouped = new Set<string>()
  // The section parser is the one resolution and the start path use, so a
  // tab-separated heading groups here too.
  const sections = taskSections(markdown)
  for (const section of sections) {
    // Tasks before the first heading are outside every section.
    if (section.title === '') continue
    // Only a key the review start can resolve names a section gap line.
    if (!sectionSelectable(markdown, section.key)) continue
    const absent = section.covered.filter((task) => missing.has(task.id))
    if (absent.length < 2) continue
    gaps.push(
      reviewUnitText(
        change,
        {
          section: { key: section.key, title: section.title },
          covered: section.covered,
          missing: absent,
        },
        { rule, ...(options.openRuns === undefined ? {} : { openRuns: options.openRuns }) },
      ),
    )
    for (const task of absent) grouped.add(task.id)
  }
  for (const entry of taskGaps) {
    if (entry.gap === undefined || grouped.has(entry.task.id)) continue
    gaps.push(entry.gap)
  }
  return { ok: gaps.length === 0, gaps }
}

export interface CheckpointCloseRecord {
  readonly checkpoint?: unknown
  readonly outcome?: unknown
  readonly lanes?: unknown
  readonly bottleneck?: {
    readonly id?: unknown
    readonly owner?: unknown
    readonly action?: unknown
    readonly blockingLanes?: unknown
    readonly targets?: unknown
  }
  readonly bottleneckAge?: unknown
  readonly bottleneckChanged?: unknown
}

export interface CheckpointObservation {
  readonly toolName: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly ok: boolean
  readonly at?: number
  /** The tool result text; used to tell a started worker from a cached answer. */
  readonly detail?: string
  /** Observation order, so calls after the checkpoint are unambiguous. */
  readonly seq?: number
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function argumentStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(argumentStrings)
  if (isRecord(value)) return Object.values(value).flatMap(argumentStrings)
  return []
}

function mentions(value: Readonly<Record<string, unknown>>, wanted: string): boolean {
  return argumentStrings(value).some((text) => text.includes(wanted))
}

/** Resolve one path against the workspace, keeping its drive for root paths. */
function resolveWorkspacePath(value: string, workspace: string): string {
  if (process.platform === 'win32' && (value === '/' || value === '\\')) {
    const drive = /^([A-Za-z]):/u.exec(workspace)?.[1]
    if (drive !== undefined) return resolve(`${drive}:/`)
  }
  const normalized = value.replaceAll('\\', '/')
  if (process.platform === 'win32' && /^\/[^/]/u.test(normalized)) {
    const drive = /^([A-Za-z]):/u.exec(workspace)?.[1]
    if (drive !== undefined) return resolve(`${drive}:${normalized}`)
  }
  return isAbsolute(normalized) ? resolve(normalized) : resolve(workspace, normalized)
}

/** A destination matches a target when it is the target or lies beneath it. */
/** A destination matches a target when it is the target or lies beneath it. */
function targetMatches(
  targets: readonly string[],
  destination: string,
  workspace: string,
): boolean {
  // Remedy targets may deliberately live outside the workspace (a sibling
  // checkout); resolve both sides against the workspace and compare containment.
  const normalize = (value: string): string => {
    const absolute = resolveWorkspacePath(value, workspace).replaceAll('\\', '/')
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
  }
  const path = normalize(destination)
  return targets.some((target) => {
    const wanted = normalize(target)
    // A filesystem-root target already ends in '/', so its prefix is treated
    // as-is instead of producing a double separator.
    const prefix = wanted.endsWith('/') ? wanted : `${wanted}/`
    return wanted === '' || path === wanted || path.startsWith(prefix)
  })
}

const WORKER_TOOLS = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow'])

function isWorkerStart(entry: CheckpointObservation): boolean {
  return WORKER_TOOLS.has(entry.toolName)
}

function taggedWorkerStart(
  later: readonly CheckpointObservation[],
  checkpointId: string,
  bottleneckId?: string,
): boolean {
  return later.some((entry) => {
    if (!isWorkerStart(entry)) return false
    if (!mentions(entry.arguments, checkpointId)) return false
    return bottleneckId === undefined || mentions(entry.arguments, bottleneckId)
  })
}

interface LanePlan {
  readonly id: string
  readonly owner: string
  readonly scope: readonly string[]
  readonly state: string
  readonly blockedBy: readonly string[]
}

function lanesOf(record: CheckpointCloseRecord): LanePlan[] {
  if (!Array.isArray(record.lanes)) return []
  return record.lanes.filter(isRecord).map((lane) => ({
    id: typeof lane.id === 'string' ? lane.id.trim() : '',
    owner: typeof lane.owner === 'string' ? lane.owner.trim() : '',
    scope:
      typeof lane.scope === 'string'
        ? [lane.scope.trim()]
        : Array.isArray(lane.scope)
          ? stringList(lane.scope).map((entry) => entry.trim())
          : [],
    state: typeof lane.state === 'string' ? lane.state.trim() : 'running',
    blockedBy: stringList(lane.blockedBy).map((entry) => entry.trim()),
  }))
}

function runnableLanes(lanes: readonly LanePlan[]): LanePlan[] {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  return lanes.filter((lane) => {
    if (lane.state === 'done' || lane.state === 'blocked') return false
    return !lane.blockedBy.some((id) => byId.get(id)?.state !== 'done')
  })
}

function isResourceScope(value: string): boolean {
  return value.startsWith('resource:')
}

function scopeOverlaps(
  left: readonly string[],
  right: readonly string[],
  workspace: string,
): boolean {
  const parts = (value: string): string[] => {
    const absolute = resolveWorkspacePath(value, workspace)
    const folded = process.platform === 'win32' ? absolute.toLowerCase() : absolute
    return folded.replaceAll('\\', '/').split('/').filter(Boolean)
  }
  return left.some((a) =>
    right.some((b) => {
      // Resource scopes are exact identifiers, never paths.
      if (isResourceScope(a) || isResourceScope(b)) {
        return isResourceScope(a) && isResourceScope(b) && a === b
      }
      const x = parts(a)
      const y = parts(b)
      // The repository root contains every scope, including a '.' entry.
      if (x.length === 0 || y.length === 0) return true
      const min = Math.min(x.length, y.length)
      return x.slice(0, min).every((part, index) => part === y[index])
    }),
  )
}

function parallelPlan(record: CheckpointCloseRecord, workspace: string): boolean {
  const runnable = runnableLanes(lanesOf(record))
  for (let i = 0; i < runnable.length; i += 1) {
    for (let j = i + 1; j < runnable.length; j += 1) {
      const left = runnable[i] as LanePlan
      const right = runnable[j] as LanePlan
      if (left.owner !== right.owner && !scopeOverlaps(left.scope, right.scope, workspace)) {
        return true
      }
    }
  }
  return false
}

/**
 * The owned checkpoint rules beyond the tool's own validation: freshness, a
 * computed parallel plan needing a tagged worker, a `continue` remedy executed
 * after the checkpoint, and an aged bottleneck. Every call is judged against
 * the observations the host already recorded.
 */
export function checkpointCloseIssue(input: {
  readonly record: CheckpointCloseRecord | undefined
  readonly checkpointId: string
  readonly observations: readonly CheckpointObservation[]
  readonly bottleneckAge: number
  /** False when the latest checkpoint is at or beyond the step interval. */
  readonly fresh?: boolean
  /** The time of the successful checkpoint call; only later calls count. */
  readonly checkpointAt?: number
  /** Whether any worker-start tool is visible; absent means visible. */
  readonly workerVisible?: boolean
  /** Whether the parallel-action gate is enabled; absent means enabled. */
  readonly enforceParallel?: boolean
  /** The workspace absolute/relative paths resolve against. */
  readonly workspace?: string
  /** The validated tool arguments (unredacted), preferred over the record. */
  readonly checkpointArguments?: Readonly<Record<string, unknown>>
  /** Observation order of the successful checkpoint, for exact later-call ordering. */
  readonly checkpointSeq?: number
}): string | undefined {
  const workspace = input.workspace ?? process.cwd()
  const record = input.record
  const rawArguments = isRecord(input.checkpointArguments) ? input.checkpointArguments : undefined
  if (record === undefined) return undefined
  const lanesSource =
    rawArguments !== undefined && Array.isArray(rawArguments.lanes)
      ? { ...record, lanes: rawArguments.lanes }
      : record
  const rawBottleneck =
    rawArguments !== undefined && isRecord(rawArguments.bottleneck)
      ? {
          ...record.bottleneck,
          ...(rawArguments.bottleneck as CheckpointCloseRecord['bottleneck']),
        }
      : undefined
  const later = input.observations.filter((entry) => {
    if (!entry.ok) return false
    if (input.checkpointSeq !== undefined) {
      return entry.seq !== undefined && entry.seq > input.checkpointSeq
    }
    return (
      input.checkpointAt === undefined || (entry.at !== undefined && entry.at > input.checkpointAt)
    )
  })
  const stale = input.fresh === false
  // The producer can fail to overwrite an older done record; the latest
  // validated arguments are the authoritative attempted outcome.
  const outcome =
    typeof rawArguments?.outcome === 'string'
      ? rawArguments.outcome
      : typeof record.outcome === 'string'
        ? record.outcome
        : ''
  if (outcome !== 'continue') {
    return stale
      ? 'the checkpoint is older than the configured step interval; call work_checkpoint again before the close'
      : undefined
  }
  const workerVisible = input.workerVisible !== false
  if (
    !stale &&
    input.enforceParallel !== false &&
    workerVisible &&
    parallelPlan(lanesSource, workspace) &&
    !taggedWorkerStart(later, input.checkpointId)
  ) {
    return `the checkpoint has parallel runnable lanes; start one tagged worker whose arguments name "${input.checkpointId}", or amend the plan in a new work_checkpoint`
  }
  const bottleneck = rawBottleneck ?? record.bottleneck
  if (bottleneck === undefined) {
    return 'the checkpoint is a continue plan without a bottleneck; call work_checkpoint with lanes, a bottleneck, and its remedy before the close'
  }
  const id = typeof bottleneck.id === 'string' ? bottleneck.id.trim() : ''
  const owner = typeof bottleneck.owner === 'string' ? bottleneck.owner.trim() : ''
  const action = typeof bottleneck.action === 'string' ? bottleneck.action.trim() : ''
  if (id === '') {
    return 'the checkpoint bottleneck has no id; refresh work_checkpoint with a named bottleneck'
  }
  if (action === 'worker_start') {
    if (!taggedWorkerStart(later, input.checkpointId, id)) {
      return `execute the bottleneck remedy: start a tagged worker that names checkpoint "${input.checkpointId}" and bottleneck "${id}", or record a route change in a new work_checkpoint`
    }
  } else if (action === 'lead_action') {
    const workerOwned = owner !== 'lead' && workerVisible
    if (workerOwned) {
      return `bottleneck "${id}" is owned by "${owner}"; use worker_start with a call carrying "${input.checkpointId}" and "${id}", or user_decision with ask_user_question; lead_action is refused when the bottleneck owner is not "lead"`
    }
    const targets = stringList(bottleneck.targets).map((entry) => entry.trim())
    const matched = later.some(
      (entry) =>
        (entry.toolName === 'edit' || entry.toolName === 'write') &&
        [entry.arguments.path, entry.arguments.file_path].some(
          (value) => typeof value === 'string' && targetMatches(targets, value, workspace),
        ),
    )
    if (!matched) {
      return `execute the bottleneck remedy: write one of the declared targets of bottleneck "${id}" before the close`
    }
  } else if (action === 'user_decision') {
    if (!later.some((entry) => entry.toolName === 'ask_user_question')) {
      return `bottleneck "${id}" needs a user decision; ask the user before the close`
    }
  } else {
    return `bottleneck "${id}" has an unknown action "${action}"; use worker_start, lead_action, or user_decision`
  }
  // A changed bottleneck has not been watched for the recorded time; the
  // model restates the same object on a successful call, which keeps its age.
  // Compare normalized fields so equivalent spellings are not a change.
  const amendedBottleneck = rawArguments?.bottleneck
  const normalizeBottleneck = (value: Record<string, unknown>): string => {
    const normalizedPath = (entry: unknown): unknown =>
      typeof entry === 'string' ? entry.replaceAll('\\', '/').replace(/\/+$/u, '') : entry
    const sorted = (entry: unknown): unknown =>
      Array.isArray(entry) ? [...entry].map(normalizedPath).map(String).sort() : entry
    return JSON.stringify({
      id: typeof value.id === 'string' ? value.id.trim() : value.id,
      action: value.action,
      owner: value.owner,
      blockingLanes: sorted(value.blockingLanes),
      targets: sorted(value.targets),
    })
  }
  const changedBottleneck =
    isRecord(amendedBottleneck) && isRecord(record.bottleneck)
      ? normalizeBottleneck(amendedBottleneck) !==
        normalizeBottleneck(record.bottleneck as Record<string, unknown>)
      : false
  const age = changedBottleneck
    ? 0
    : typeof record.bottleneckAge === 'number'
      ? record.bottleneckAge
      : 0
  if (
    age >= input.bottleneckAge &&
    record.bottleneckChanged !== true &&
    action !== 'user_decision'
  ) {
    return `bottleneck "${id}" survived ${String(age)} consecutive checkpoints; change the owner, the blocking lane, or ask the user for a decision before the close`
  }
  if (stale) {
    return 'the checkpoint is older than the configured step interval; call work_checkpoint again before the close'
  }
  return undefined
}

/** The completion branch: applies only when the task list is fully checked. */
export function taskReviewCompletion(
  workspace: string,
  change: string,
  options: ReviewUnitTextOptions = {},
): { readonly ok: boolean; readonly text?: string } | undefined {
  let markdown: string
  try {
    markdown = readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8')
  } catch {
    return undefined
  }
  if (/^\s*-\s*\[ \]\s+\d+(?:\.\d+)*\s+\S/mu.test(markdown)) return undefined
  const coverage = taskReviewCoverage(workspace, change, 'task-review', options)
  return {
    ok: coverage.ok,
    ...(coverage.gaps.length === 0
      ? {}
      : {
          text: `completion of change "${change}" requires a portable task-review PASS for every checked task: ${coverage.gaps.join('; ')}`,
        }),
  }
}

/** Read the retro checkpoint record's own fields; a missing record defers to the step evidence. */
export function readCheckpointRecord(
  workspace: string,
  checkpointPath: string,
): CheckpointCloseRecord | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(workspace, checkpointPath), 'utf8')) as unknown
    return isRecord(raw) ? (raw as CheckpointCloseRecord) : undefined
  } catch {
    return undefined
  }
}

/** The owned checkpoint remedy/age issue for a close, when a record exists. */
export function checkpointGateIssue(
  workspace: string,
  checkpointPath: string,
  observations: readonly CheckpointObservation[],
  bottleneckAge: number,
  options: {
    readonly fresh?: boolean
    readonly checkpointAt?: number
    readonly workerVisible?: boolean
    readonly enforceParallel?: boolean
  } = {},
): { readonly text: string } | undefined {
  const record = readCheckpointRecord(workspace, checkpointPath)
  if (record === undefined) return undefined
  const checkpoint =
    typeof (record as { readonly checkpoint?: unknown }).checkpoint === 'string'
      ? (record as { readonly checkpoint: string }).checkpoint
      : ''
  const lastCheckpointCall = observations
    .filter((entry) => entry.ok && entry.toolName === 'work_checkpoint')
    .reduce<(typeof observations)[number] | undefined>(
      (last, entry) => (last === undefined || (entry.seq ?? 0) >= (last.seq ?? 0) ? entry : last),
      undefined,
    )
  const toolArguments = lastCheckpointCall?.arguments
  const issue = checkpointCloseIssue({
    record,
    checkpointId: checkpoint,
    observations,
    bottleneckAge,
    ...options,
    workspace,
    ...(toolArguments === undefined ? {} : { checkpointArguments: toolArguments }),
    ...(lastCheckpointCall?.seq === undefined ? {} : { checkpointSeq: lastCheckpointCall.seq }),
  })
  return issue === undefined ? undefined : { text: issue }
}
