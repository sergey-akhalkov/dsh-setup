import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Workflow definitions are closed-schema JSON data. Every field is validated
 * before a definition can be listed or started; an unknown field, a duplicate
 * step id, or an edge that names no step fails the load and names the
 * definition and the field, never a bare stack trace.
 */

export const DEFINITION_SCHEMA_VERSION = 1

/** A definition id is also its install file name, so it must be path-safe. */
export const DEFINITION_ID = /^[a-z0-9][a-z0-9-]*$/u

/** A credential-shaped value a definition must never carry. */
const CREDENTIAL_VALUE =
  /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u

/** The deterministic event kinds a definition trigger may observe. */
export const OBLIGATION_EVENT_KINDS = [
  'turn.stopping',
  'tool.pre-execute',
  'tool.result',
  'fs.change',
  'subagent.end',
  'review.record',
] as const

export type ObligationEventKind = (typeof OBLIGATION_EVENT_KINDS)[number]

/** The optional intent trigger is a separate kind, never a deterministic event. */
export const DEFINITION_TRIGGER_KINDS = [...OBLIGATION_EVENT_KINDS, 'intent'] as const
export type DefinitionTriggerKind = (typeof DEFINITION_TRIGGER_KINDS)[number]

export const TRIGGER_MODES = ['shadow', 'active'] as const
export type TriggerMode = (typeof TRIGGER_MODES)[number]

/** De-duplication identities: a trigger, a session, and the event subject. */
export const DEDUPE_POLICIES = ['none', 'turn', 'path+content-hash', 'callId', 'name'] as const
export type DedupePolicy = (typeof DEDUPE_POLICIES)[number]

/** Which dedupe identities each event kind can actually provide. */
export const DEDUPE_BY_TRIGGER: Record<DefinitionTriggerKind, readonly DedupePolicy[]> = {
  'turn.stopping': ['none', 'turn'],
  'tool.pre-execute': ['none', 'turn', 'callId', 'name'],
  'tool.result': ['none', 'turn', 'callId'],
  'fs.change': ['none', 'turn', 'path+content-hash'],
  'subagent.end': ['none', 'turn'],
  'review.record': ['none', 'turn', 'path+content-hash'],
  intent: ['none', 'turn'],
}

/** The one applicability decision a definition may declare for a trigger. */
export const APPLICABILITY_KINDS = ['checkpoint-required', 'code-write'] as const
export type ApplicabilityKind = (typeof APPLICABILITY_KINDS)[number]

/** The structured command match an intent trigger accepts. */
export type TriggerCommand = 'openspec new change <name>' | 'openspec archive <name>'
export const TRIGGER_COMMANDS: readonly TriggerCommand[] = [
  'openspec new change <name>',
  'openspec archive <name>',
]

/** Filters are exact strings except the two workspace/path globs. */
export interface TriggerMatch {
  readonly workspace?: string
  readonly session?: string
  readonly tool?: string
  readonly command?: TriggerCommand
  readonly path?: string
  readonly subject?: string
  readonly verdict?: string
  readonly classifier?: string
  /** The classified intent name, for the optional intent trigger. */
  readonly intent?: string
}

export interface DefinitionTrigger {
  readonly kind: DefinitionTriggerKind
  readonly match: TriggerMatch
  readonly mode: TriggerMode
  readonly dedupe: DedupePolicy
  readonly repeat?: boolean
  readonly applicability?: ApplicabilityKind
}

export const EXECUTORS = ['main', 'subagent', 'tool', 'branch', 'loop', 'human'] as const
export type Executor = (typeof EXECUTORS)[number]

export const RISKS = ['low', 'medium', 'high'] as const
export type Risk = (typeof RISKS)[number]

export const GATE_OWNERSHIP = ['own', 'defer'] as const
export type GateOwnership = (typeof GATE_OWNERSHIP)[number]

/** The legacy gate a deferred definition or step defers to. */
export interface LegacySource {
  readonly plugin: string
  readonly signal: string
}

export interface DefinitionSettings {
  readonly allowModelStart: boolean
  readonly risk: Risk
  readonly gateOwnership: GateOwnership
  readonly maxBlocks: number
  readonly allowIntent: boolean
  /** Tool names a `tool` step may call. */
  readonly allowTools?: readonly string[]
  readonly legacy?: LegacySource
}

export const EVIDENCE_KINDS = [
  'file',
  'record',
  'tool',
  'check',
  'human',
  'all',
  'declaration',
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export interface FileEvidence {
  readonly kind: 'file'
  /** Workspace-relative path; `glob` enables `*`/`**` segments. */
  readonly path: string
  readonly minBytes?: number
  readonly glob?: boolean
}

export interface AllEvidence {
  readonly kind: 'all'
  readonly items: readonly Evidence[]
}

export interface RecordEvidence {
  readonly kind: 'record'
  readonly rule: string
  /** Matched when declared; a checkpoint record carries no change. */
  readonly change?: string
  /** The single accepted verdict; exactly one of verdict/verdicts is required. */
  readonly verdict?: string
  /** Every accepted verdict; for a task review that is PASS or ERROR. */
  readonly verdicts?: readonly string[]
  /** Workspace-relative record path; derived from rule/change/phase when absent. */
  readonly path?: string
  readonly phase?: string
  readonly scope?: string
  readonly task?: string
  /** `current` compares the record's digest with the change's current digest. */
  readonly digest?: 'current' | string
  /** `review` (default) or the goal-continuity checkpoint record. */
  readonly source?: 'review' | 'checkpoint'
}

export interface ToolCallEvidence {
  readonly kind: 'tool'
  readonly name: string
  readonly command?: string
  readonly args?: Readonly<Record<string, unknown>>
}

export interface CheckEvidence {
  readonly kind: 'check'
  readonly command?: string
  /** erify-settings reads the validated profile command list. */
  readonly source?: 'verify-settings' | 'task-review-coverage'
}

export interface HumanEvidence {
  readonly kind: 'human'
  /** Every declared accepted answer; only a match completes the step. */
  readonly answer: string | readonly string[]
}

export interface DeclarationEvidence {
  readonly kind: 'declaration'
}

export type Evidence =
  | FileEvidence
  | AllEvidence
  | RecordEvidence
  | ToolCallEvidence
  | CheckEvidence
  | HumanEvidence
  | DeclarationEvidence

/** A fixed tool call; `{name}` is the only interpolation and is validated. */
export interface ToolSpec {
  readonly name: string
  readonly command?: string
  readonly args?: Readonly<Record<string, unknown>>
}

export interface SubagentSpec {
  readonly provider: string
  readonly model?: string
  readonly reasoningEffort?: string
  /** Required closed result schema; a child result that does not match fails the step. */
  readonly schema: Readonly<Record<string, unknown>>
}

export interface HumanSpec {
  readonly timeoutAction?: 'block' | 'cancel'
}

export interface BranchSpec {
  readonly predicate: Readonly<Record<string, unknown>>
  readonly then: string
  readonly else: string
}

export interface LoopSpec {
  readonly maxIterations: number
  readonly stop: Readonly<Record<string, unknown>>
  readonly next: string
  readonly cap?: 'blocked' | 'failed'
  /** An optional context key holding the list to iterate over. */
  readonly list?: string
}

export const MAX_LOOP_ITERATIONS = 50

export interface Step {
  readonly id: string
  readonly title: string
  readonly executor: Executor
  readonly prompt?: string
  readonly evidence?: Evidence
  readonly next?: string
  readonly blockTurnClose?: boolean
  readonly nonCritical?: boolean
  readonly ownership?: GateOwnership
  readonly legacy?: LegacySource
  readonly tool?: ToolSpec
  readonly subagent?: SubagentSpec
  readonly human?: HumanSpec
  readonly branch?: BranchSpec
  readonly loop?: LoopSpec
}

/** The longest human-readable description a definition may carry. */
export const MAX_DEFINITION_DESCRIPTION = 500

export interface Definition {
  readonly v: typeof DEFINITION_SCHEMA_VERSION
  readonly id: string
  readonly name: string
  /** Optional human-readable summary; never used by the engine. */
  readonly description?: string
  readonly version: number
  readonly trigger: DefinitionTrigger
  readonly settings: DefinitionSettings
  readonly steps: readonly Step[]
}

const DEFINITION_KEYS = new Set([
  'v',
  'id',
  'name',
  'description',
  'version',
  'trigger',
  'settings',
  'steps',
])
const SETTINGS_KEYS = new Set([
  'allowModelStart',
  'risk',
  'gateOwnership',
  'maxBlocks',
  'allowIntent',
  'allowTools',
  'legacy',
])
const TRIGGER_KEYS = new Set(['kind', 'match', 'mode', 'dedupe', 'repeat', 'applicability'])
const MATCH_KEYS = new Set([
  'workspace',
  'session',
  'tool',
  'command',
  'path',
  'subject',
  'verdict',
  'classifier',
  'intent',
])
const STEP_KEYS = new Set([
  'id',
  'title',
  'executor',
  'prompt',
  'evidence',
  'next',
  'blockTurnClose',
  'nonCritical',
  'ownership',
  'legacy',
  'tool',
  'subagent',
  'human',
  'branch',
  'loop',
])
const FILE_KEYS = new Set(['kind', 'path', 'minBytes', 'glob'])
const ALL_KEYS = new Set(['kind', 'items'])
const RECORD_KEYS = new Set([
  'kind',
  'rule',
  'change',
  'verdict',
  'verdicts',
  'path',
  'phase',
  'scope',
  'task',
  'digest',
  'source',
])
const TOOL_EVIDENCE_KEYS = new Set(['kind', 'name', 'command', 'args'])
const CHECK_KEYS = new Set(['kind', 'command', 'source'])
const HUMAN_EVIDENCE_KEYS = new Set(['kind', 'answer'])
const DECLARATION_KEYS = new Set(['kind'])
const TOOL_SPEC_KEYS = new Set(['name', 'command', 'args'])
const SUBAGENT_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'schema'])
const HUMAN_KEYS = new Set(['timeoutAction'])
const BRANCH_KEYS = new Set(['predicate', 'then', 'else'])
const LOOP_KEYS = new Set(['maxIterations', 'stop', 'next', 'cap', 'list'])
const LEGACY_KEYS = new Set(['plugin', 'signal'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(definition: string, field: string, message: string): never {
  throw new Error(`workflow definition "${definition}" field "${field}" ${message}`)
}

function assertKnown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  definition: string,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      fail(definition, field === '' ? key : `${field}.${key}`, 'is not a known field')
  }
}

function nonEmptyString(value: unknown, definition: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(definition, field, 'must be a non-empty string')
  }
  return value
}

/** The optional description: display text, validated but never interpreted. */
function optionalDescription(value: unknown, definition: string): string | undefined {
  if (value === undefined) return undefined
  const text = nonEmptyString(value, definition, 'description')
  if (text.length > MAX_DEFINITION_DESCRIPTION) {
    fail(
      definition,
      'description',
      `must be at most ${String(MAX_DEFINITION_DESCRIPTION)} characters`,
    )
  }
  return text
}

function positiveInteger(value: unknown, definition: string, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(definition, field, 'must be a positive integer')
  }
  return value
}

function optionalBoolean(value: unknown, definition: string, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(definition, field, 'must be a boolean')
  return value
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  definition: string,
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(definition, field, `must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function legacySource(raw: unknown, definition: string, field: string): LegacySource {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, LEGACY_KEYS, definition, field)
  return {
    plugin: nonEmptyString(raw.plugin, definition, `${field}.plugin`),
    signal: nonEmptyString(raw.signal, definition, `${field}.signal`),
  }
}

function triggerMatch(raw: unknown, definition: string): TriggerMatch {
  if (!isRecord(raw)) fail(definition, 'trigger.match', 'must be an object')
  assertKnown(raw, MATCH_KEYS, definition, 'trigger.match')
  const match: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    match[key] = nonEmptyString(value, definition, `trigger.match.${key}`)
  }
  if (match.command !== undefined) {
    if (!TRIGGER_COMMANDS.includes(match.command as TriggerCommand)) {
      fail(definition, 'trigger.match.command', `must be one of: ${TRIGGER_COMMANDS.join(', ')}`)
    }
  }
  return match
}

function trigger(raw: unknown, definition: string): DefinitionTrigger {
  if (!isRecord(raw)) fail(definition, 'trigger', 'must be an object')
  assertKnown(raw, TRIGGER_KEYS, definition, 'trigger')
  const kind = isOneOf(raw.kind, DEFINITION_TRIGGER_KINDS, definition, 'trigger.kind')
  const mode = isOneOf(raw.mode, TRIGGER_MODES, definition, 'trigger.mode')
  const dedupe = isOneOf(raw.dedupe, DEDUPE_POLICIES, definition, 'trigger.dedupe')
  if (!DEDUPE_BY_TRIGGER[kind].includes(dedupe)) {
    throw new Error(
      `definition "${definition}": trigger.dedupe "${dedupe}" is not available for trigger kind "${kind}"`,
    )
  }
  const repeat = optionalBoolean(raw.repeat, definition, 'trigger.repeat')
  const applicability =
    raw.applicability === undefined
      ? undefined
      : isOneOf(raw.applicability, APPLICABILITY_KINDS, definition, 'trigger.applicability')
  const match = triggerMatch(raw.match ?? {}, definition)
  if (kind === 'intent' && match.command !== undefined) {
    fail(definition, 'trigger.match.command', 'is only valid for a deterministic trigger')
  }
  if (kind !== 'intent' && match.classifier !== undefined) {
    fail(definition, 'trigger.match.classifier', 'is only valid for the intent trigger')
  }
  if (kind !== 'intent' && match.intent !== undefined) {
    fail(definition, 'trigger.match.intent', 'is only valid for the intent trigger')
  }
  return {
    kind,
    match,
    mode,
    dedupe,
    ...(repeat === undefined ? {} : { repeat }),
    ...(applicability === undefined ? {} : { applicability }),
  }
}

function settings(raw: unknown, definition: string): DefinitionSettings {
  if (!isRecord(raw)) fail(definition, 'settings', 'must be an object')
  assertKnown(raw, SETTINGS_KEYS, definition, 'settings')
  if (typeof raw.allowModelStart !== 'boolean') {
    fail(definition, 'settings.allowModelStart', 'must be a boolean')
  }
  const risk = isOneOf(raw.risk, RISKS, definition, 'settings.risk')
  const gateOwnership =
    raw.gateOwnership === undefined
      ? 'own'
      : isOneOf(raw.gateOwnership, GATE_OWNERSHIP, definition, 'settings.gateOwnership')
  const maxBlocks = positiveInteger(raw.maxBlocks, definition, 'settings.maxBlocks')
  if (typeof raw.allowIntent !== 'boolean') {
    fail(definition, 'settings.allowIntent', 'must be a boolean')
  }
  const legacy =
    raw.legacy === undefined ? undefined : legacySource(raw.legacy, definition, 'settings.legacy')
  if (gateOwnership === 'defer' && legacy === undefined) {
    fail(definition, 'settings.legacy', 'is required when settings.gateOwnership is "defer"')
  }
  let allowTools: readonly string[] | undefined
  if (raw.allowTools !== undefined) {
    if (!Array.isArray(raw.allowTools) || raw.allowTools.length === 0) {
      fail(definition, 'settings.allowTools', 'must be a non-empty list of tool names')
    }
    allowTools = raw.allowTools.map((name, index) =>
      nonEmptyString(name, definition, `settings.allowTools[${String(index)}]`),
    )
    if (new Set(allowTools).size !== allowTools.length) {
      fail(definition, 'settings.allowTools', 'must not contain a duplicate tool name')
    }
  }
  return {
    allowModelStart: raw.allowModelStart,
    risk,
    gateOwnership,
    maxBlocks,
    allowIntent: raw.allowIntent,
    ...(allowTools === undefined ? {} : { allowTools }),
    ...(legacy === undefined ? {} : { legacy }),
  }
}

function evidence(raw: unknown, definition: string, field: string): Evidence {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  const kind = raw.kind
  if (typeof kind !== 'string' || !EVIDENCE_KINDS.includes(kind as EvidenceKind)) {
    fail(definition, `${field}.kind`, `must be one of: ${EVIDENCE_KINDS.join(', ')}`)
  }
  switch (kind as EvidenceKind) {
    case 'file': {
      assertKnown(raw, FILE_KEYS, definition, field)
      const minBytes =
        raw.minBytes === undefined
          ? undefined
          : positiveInteger(raw.minBytes, definition, `${field}.minBytes`)
      const glob = optionalBoolean(raw.glob, definition, `${field}.glob`)
      const path = nonEmptyString(raw.path, definition, `${field}.path`)
      if (glob !== true && /[*?]/u.test(path)) {
        fail(definition, `${field}.path`, 'must set glob: true when it contains a wildcard')
      }
      return {
        kind: 'file',
        path,
        ...(minBytes === undefined ? {} : { minBytes }),
        ...(glob === undefined ? {} : { glob }),
      }
    }
    case 'all': {
      assertKnown(raw, ALL_KEYS, definition, field)
      if (!Array.isArray(raw.items) || raw.items.length === 0) {
        fail(definition, `${field}.items`, 'must be a non-empty list')
      }
      return {
        kind: 'all',
        items: raw.items.map((item, index) =>
          evidence(item, definition, `${field}.items[${String(index)}]`),
        ),
      }
    }
    case 'record': {
      assertKnown(raw, RECORD_KEYS, definition, field)
      const verdict =
        raw.verdict === undefined
          ? undefined
          : nonEmptyString(raw.verdict, definition, `${field}.verdict`)
      let verdicts: readonly string[] | undefined
      if (raw.verdicts !== undefined) {
        if (!Array.isArray(raw.verdicts) || raw.verdicts.length === 0) {
          fail(definition, `${field}.verdicts`, 'must be a non-empty list of verdicts')
        }
        verdicts = raw.verdicts.map((entry, index) =>
          nonEmptyString(entry, definition, `${field}.verdicts[${String(index)}]`),
        )
      }
      if ((verdict === undefined) === (verdicts === undefined)) {
        fail(definition, field, 'must declare exactly one of verdict or verdicts')
      }
      const record: RecordEvidence = {
        kind: 'record',
        rule: nonEmptyString(raw.rule, definition, `${field}.rule`),
        ...(verdict === undefined ? {} : { verdict }),
        ...(verdicts === undefined ? {} : { verdicts }),
        ...(raw.change === undefined
          ? {}
          : { change: nonEmptyString(raw.change, definition, `${field}.change`) }),
        ...(raw.path === undefined
          ? {}
          : { path: nonEmptyString(raw.path, definition, `${field}.path`) }),
        ...(raw.phase === undefined
          ? {}
          : { phase: nonEmptyString(raw.phase, definition, `${field}.phase`) }),
        ...(raw.scope === undefined
          ? {}
          : { scope: nonEmptyString(raw.scope, definition, `${field}.scope`) }),
        ...(raw.task === undefined
          ? {}
          : { task: nonEmptyString(raw.task, definition, `${field}.task`) }),
        ...(raw.source === undefined
          ? {}
          : {
              source: isOneOf(
                raw.source,
                ['review', 'checkpoint'] as const,
                definition,
                `${field}.source`,
              ),
            }),
      }
      if (raw.digest !== undefined) {
        if (
          typeof raw.digest !== 'string' ||
          (raw.digest !== 'current' && !/^[a-f0-9]{64}$/u.test(raw.digest))
        ) {
          fail(definition, `${field}.digest`, 'must be "current" or a 64-hex digest string')
        }
        return { ...record, digest: raw.digest }
      }
      return record
    }
    case 'tool': {
      assertKnown(raw, TOOL_EVIDENCE_KEYS, definition, field)
      const name = nonEmptyString(raw.name, definition, `${field}.name`)
      if (raw.args !== undefined && !isRecord(raw.args)) {
        fail(definition, `${field}.args`, 'must be an object')
      }
      return {
        kind: 'tool',
        name,
        ...(raw.command === undefined
          ? {}
          : { command: nonEmptyString(raw.command, definition, `${field}.command`) }),
        ...(raw.args === undefined ? {} : { args: raw.args }),
      }
    }
    case 'check': {
      assertKnown(raw, CHECK_KEYS, definition, field)
      const source =
        raw.source === undefined
          ? undefined
          : isOneOf(
              raw.source,
              ['verify-settings', 'task-review-coverage'] as const,
              definition,
              `${field}.source`,
            )
      const command =
        raw.command === undefined
          ? undefined
          : nonEmptyString(raw.command, definition, `${field}.command`)
      if ((command === undefined) === (source === undefined)) {
        fail(definition, field, 'must declare exactly one of command or source')
      }
      return {
        kind: 'check',
        ...(command === undefined ? {} : { command }),
        ...(source === undefined ? {} : { source }),
      }
    }
    case 'human': {
      assertKnown(raw, HUMAN_EVIDENCE_KEYS, definition, field)
      const rawAnswer = raw.answer
      if (Array.isArray(rawAnswer)) {
        if (rawAnswer.length === 0)
          fail(definition, `${field}.answer`, 'must be a non-empty answer list')
        const answers = rawAnswer.map((answer, index) =>
          nonEmptyString(answer, definition, `${field}.answer[${String(index)}]`),
        )
        return { kind: 'human', answer: answers }
      }
      return { kind: 'human', answer: nonEmptyString(rawAnswer, definition, `${field}.answer`) }
    }
    case 'declaration':
      assertKnown(raw, DECLARATION_KEYS, definition, field)
      return { kind: 'declaration' }
  }
}

function toolSpec(raw: unknown, definition: string, field: string): ToolSpec {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, TOOL_SPEC_KEYS, definition, field)
  const name = nonEmptyString(raw.name, definition, `${field}.name`)
  if (raw.command !== undefined) nonEmptyString(raw.command, definition, `${field}.command`)
  if (raw.args !== undefined && !isRecord(raw.args))
    fail(definition, `${field}.args`, 'must be an object')
  if (raw.command === undefined && raw.args === undefined) {
    fail(definition, field, 'must declare a command or args')
  }
  return {
    name,
    ...(raw.command === undefined ? {} : { command: raw.command as string }),
    ...(raw.args === undefined ? {} : { args: raw.args }),
  }
}

const RESULT_SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])
const RESULT_SCHEMA_TYPES = new Set([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'integer',
  'string',
])

/** The closed JSON Schema subset a subagent result may use; unsupported keywords fail the load. */
export function resultSchemaShapeError(
  schema: Readonly<Record<string, unknown>>,
  depth = 0,
): string | undefined {
  if (depth > 8) return 'the result schema nests too deeply'
  for (const key of Object.keys(schema)) {
    if (!RESULT_SCHEMA_KEYS.has(key)) return `unsupported constraint "${key}"`
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (
      types.length === 0 ||
      types.some((entry) => typeof entry !== 'string' || !RESULT_SCHEMA_TYPES.has(entry))
    ) {
      return 'field "type" must name a supported JSON type'
    }
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    return 'field "enum" must be a non-empty list'
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || schema.required.some((entry) => typeof entry !== 'string'))
  ) {
    return 'field "required" must be a list of field names'
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean'
  ) {
    return 'field "additionalProperties" must be a boolean'
  }
  if (schema.properties !== undefined) {
    if (!isRecord(schema.properties)) return 'field "properties" must be an object'
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!isRecord(child)) return `properties.${key} must be a schema object`
      const error = resultSchemaShapeError(child, depth + 1)
      if (error !== undefined) return `properties.${key}: ${error}`
    }
  }
  if (schema.items !== undefined) {
    if (!isRecord(schema.items)) return 'field "items" must be a schema object'
    const error = resultSchemaShapeError(schema.items, depth + 1)
    if (error !== undefined) return `items: ${error}`
  }
  return undefined
}

function subagentSpec(raw: unknown, definition: string, field: string): SubagentSpec {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, SUBAGENT_KEYS, definition, field)
  const schema = raw.schema
  if (!isRecord(schema)) {
    fail(definition, `${field}.schema`, 'is required and must be a JSON schema object')
  }
  const shapeError = resultSchemaShapeError(schema)
  if (shapeError !== undefined) fail(definition, `${field}.schema`, shapeError)
  return {
    provider: nonEmptyString(raw.provider, definition, `${field}.provider`),
    ...(raw.model === undefined
      ? {}
      : { model: nonEmptyString(raw.model, definition, `${field}.model`) }),
    ...(raw.reasoningEffort === undefined
      ? {}
      : {
          reasoningEffort: nonEmptyString(
            raw.reasoningEffort,
            definition,
            `${field}.reasoningEffort`,
          ),
        }),
    schema,
  }
}

function humanSpec(raw: unknown, definition: string, field: string): HumanSpec {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, HUMAN_KEYS, definition, field)
  if (raw.timeoutAction === undefined) return {}
  return {
    timeoutAction: isOneOf(
      raw.timeoutAction,
      ['block', 'cancel'] as const,
      definition,
      `${field}.timeoutAction`,
    ),
  }
}

function jsonLogic(
  raw: unknown,
  definition: string,
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(raw)) fail(definition, field, 'must be a JSONLogic object')
  return raw
}

function branchSpec(raw: unknown, definition: string, field: string): BranchSpec {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, BRANCH_KEYS, definition, field)
  return {
    predicate: jsonLogic(raw.predicate, definition, `${field}.predicate`),
    // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
    then: nonEmptyString(raw.then, definition, `${field}.then`),
    else: nonEmptyString(raw.else, definition, `${field}.else`),
  }
}

function loopSpec(raw: unknown, definition: string, field: string): LoopSpec {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, LOOP_KEYS, definition, field)
  const maxIterations = positiveInteger(raw.maxIterations, definition, `${field}.maxIterations`)
  if (maxIterations > MAX_LOOP_ITERATIONS) {
    fail(definition, `${field}.maxIterations`, `must not exceed ${String(MAX_LOOP_ITERATIONS)}`)
  }
  const cap =
    raw.cap === undefined
      ? undefined
      : isOneOf(raw.cap, ['blocked', 'failed'] as const, definition, `${field}.cap`)
  return {
    maxIterations,
    stop: jsonLogic(raw.stop, definition, `${field}.stop`),
    next: nonEmptyString(raw.next, definition, `${field}.next`),
    ...(cap === undefined ? {} : { cap }),
    ...(raw.list === undefined
      ? {}
      : { list: nonEmptyString(raw.list, definition, `${field}.list`) }),
  }
}

function hasDeclaration(value: Evidence): boolean {
  if (value.kind === 'declaration') return true
  return value.kind === 'all' && value.items.some(hasDeclaration)
}

function assertTarget(
  target: unknown,
  definition: string,
  field: string,
  stepIds: ReadonlySet<string>,
): string {
  const id = nonEmptyString(target, definition, field)
  if (id !== 'end' && !stepIds.has(id)) {
    fail(definition, field, `names unknown step "${id}"`)
  }
  return id
}

function step(
  raw: unknown,
  definition: string,
  field: string,
  stepIds: ReadonlySet<string>,
  allowTools: ReadonlySet<string> | undefined,
): Step {
  if (!isRecord(raw)) fail(definition, field, 'must be an object')
  assertKnown(raw, STEP_KEYS, definition, field)
  const id = nonEmptyString(raw.id, definition, `${field}.id`)
  const title = nonEmptyString(raw.title, definition, `${field}.title`)
  const executor = isOneOf(raw.executor, EXECUTORS, definition, `${field}.executor`)
  if (raw.ownership !== undefined) {
    isOneOf(raw.ownership, GATE_OWNERSHIP, definition, `${field}.ownership`)
  }
  const legacy =
    raw.legacy === undefined ? undefined : legacySource(raw.legacy, definition, `${field}.legacy`)
  if (raw.ownership === 'defer' && legacy === undefined) {
    fail(definition, `${field}.legacy`, 'is required when ownership is "defer"')
  }
  const nonCritical = optionalBoolean(raw.nonCritical, definition, `${field}.nonCritical`)
  const blockTurnClose = optionalBoolean(raw.blockTurnClose, definition, `${field}.blockTurnClose`)
  const prompt =
    raw.prompt === undefined ? undefined : nonEmptyString(raw.prompt, definition, `${field}.prompt`)

  const built: {
    -readonly [K in keyof Step]: Step[K]
  } = { id, title, executor }
  if (prompt !== undefined) built.prompt = prompt
  if (blockTurnClose !== undefined) built.blockTurnClose = blockTurnClose
  if (nonCritical !== undefined) built.nonCritical = nonCritical
  if (raw.ownership !== undefined) built.ownership = raw.ownership as GateOwnership
  if (legacy !== undefined) built.legacy = legacy

  if (raw.evidence !== undefined) {
    const checked = evidence(raw.evidence, definition, `${field}.evidence`)
    if (checked.kind === 'declaration' && nonCritical !== true) {
      fail(
        definition,
        `${field}.evidence.kind`,
        'a declaration requires the step to be nonCritical',
      )
    }
    if (hasDeclaration(checked) && nonCritical !== true) {
      fail(
        definition,
        `${field}.evidence`,
        'a declaration item requires the step to be nonCritical',
      )
    }
    if (executor === 'main' && JSON.stringify(checked).length > 1_200) {
      fail(
        definition,
        `${field}.evidence`,
        'is too long to fit the bounded main-step steer; shorten or split the contract',
      )
    }
    built.evidence = checked
  }

  switch (executor) {
    case 'main':
      if (prompt === undefined) fail(definition, `${field}.prompt`, 'is required for a main step')
      if (built.evidence === undefined)
        fail(definition, `${field}.evidence`, 'is required for a main step')
      break
    case 'subagent':
      if (raw.subagent === undefined)
        fail(definition, `${field}.subagent`, 'is required for a subagent step')
      built.subagent = subagentSpec(raw.subagent, definition, `${field}.subagent`)
      if (prompt === undefined)
        fail(definition, `${field}.prompt`, 'is required for a subagent step')
      if (built.evidence === undefined)
        fail(definition, `${field}.evidence`, 'is required for a subagent step')
      break
    case 'tool': {
      if (raw.tool === undefined) fail(definition, `${field}.tool`, 'is required for a tool step')
      const spec = toolSpec(raw.tool, definition, `${field}.tool`)
      if (allowTools === undefined || !allowTools.has(spec.name)) {
        fail(definition, `settings.allowTools`, `must list "${spec.name}" for the tool step`)
      }
      built.tool = spec
      if (built.evidence === undefined)
        fail(definition, `${field}.evidence`, 'is required for a tool step')
      break
    }
    case 'human':
      if (raw.human !== undefined) built.human = humanSpec(raw.human, definition, `${field}.human`)
      if (prompt === undefined) fail(definition, `${field}.prompt`, 'is required for a human step')
      if (built.evidence === undefined)
        fail(definition, `${field}.evidence`, 'is required for a human step')
      if (built.evidence.kind !== 'human') {
        fail(definition, `${field}.evidence.kind`, 'must be "human" for a human step')
      }
      break
    case 'branch':
      if (raw.branch === undefined)
        fail(definition, `${field}.branch`, 'is required for a branch step')
      built.branch = branchSpec(raw.branch, definition, `${field}.branch`)
      assertTarget(built.branch.then, definition, `${field}.branch.then`, stepIds)
      assertTarget(built.branch.else, definition, `${field}.branch.else`, stepIds)
      break
    case 'loop': {
      if (raw.loop === undefined) fail(definition, `${field}.loop`, 'is required for a loop step')
      const spec = loopSpec(raw.loop, definition, `${field}.loop`)
      assertTarget(spec.next, definition, `${field}.loop.next`, stepIds)
      built.loop = spec
      break
    }
  }

  // An object for a different executor is an unknown field for this step, not
  // a silently ignored extra.
  const executorFields = ['tool', 'subagent', 'human', 'branch', 'loop'] as const
  for (const key of executorFields) {
    if (raw[key] !== undefined && key !== executor) {
      fail(definition, `${field}.${key}`, `is not valid on a ${executor} step`)
    }
  }

  if (raw.next !== undefined) {
    built.next = assertTarget(raw.next, definition, `${field}.next`, stepIds)
  }
  if (executor === 'branch') {
    if (built.next !== undefined)
      fail(definition, `${field}.next`, 'is not allowed on a branch step')
  } else if (executor === 'loop') {
    if (built.next !== undefined) fail(definition, `${field}.next`, 'is not allowed on a loop step')
  } else if (built.next === undefined) {
    fail(definition, `${field}.next`, 'is required for every step except branch and loop')
  }
  if (built.next === id) {
    fail(definition, `${field}.next`, 'must not name its own step; use a loop step')
  }
  return built
}

/**
 * Reject a cycle formed by ordinary or branch edges: only the explicit `loop`
 * executor may iterate, and it must declare a bound and an exit. A loop's own
 * `next` is its exit, so it cannot close a cycle.
 */
function assertAcyclic(definition: string, steps: readonly Step[]): void {
  const edges = new Map<string, Array<{ to: string; field: string }>>()
  steps.forEach((entry, index) => {
    const field = `steps[${String(index)}]`
    const outgoing: Array<{ to: string; field: string }> = []
    if (entry.branch !== undefined) {
      if (entry.branch.then !== 'end') {
        outgoing.push({ to: entry.branch.then, field: `${field}.branch.then` })
      }
      if (entry.branch.else !== 'end') {
        outgoing.push({ to: entry.branch.else, field: `${field}.branch.else` })
      }
    } else if (entry.loop !== undefined) {
      if (entry.loop.next !== 'end') {
        outgoing.push({ to: entry.loop.next, field: `${field}.loop.next` })
      }
    } else if (entry.next !== undefined && entry.next !== 'end') {
      outgoing.push({ to: entry.next, field: `${field}.next` })
    }
    edges.set(entry.id, outgoing)
  })
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (id: string): void => {
    state.set(id, 'visiting')
    stack.push(id)
    for (const edge of edges.get(id) ?? []) {
      if (state.get(edge.to) === 'visiting') {
        const cycle = stack.slice(stack.indexOf(edge.to))
        fail(
          definition,
          edge.field,
          `forms a cycle (${[...cycle, edge.to].join(' -> ')}); use an explicit loop step with a bound`,
        )
      }
      if (state.get(edge.to) === undefined) visit(edge.to)
    }
    stack.pop()
    state.set(id, 'done')
  }
  for (const entry of steps) {
    if (state.get(entry.id) === undefined) visit(entry.id)
  }
}

/** The first credential-shaped string in a definition, with its field path. */
function credentialField(value: unknown, path: string): string | undefined {
  if (typeof value === 'string') {
    return CREDENTIAL_VALUE.test(value) ? path : undefined
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = credentialField(entry, `${path}[${String(index)}]`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      const found = credentialField(entry, path === '' ? key : `${path}.${key}`)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Validate one raw definition; every failure names the definition and field. */
export function validateDefinition(raw: unknown, source = 'definition'): Definition {
  if (!isRecord(raw)) throw new Error(`workflow definition "${source}" must be an object`)
  const definition = nonEmptyString(raw.id, source, 'id')
  if (!DEFINITION_ID.test(definition)) {
    fail(definition, 'id', 'must match ^[a-z0-9][a-z0-9-]*$')
  }
  assertKnown(raw, DEFINITION_KEYS, definition, '')
  const credential = credentialField(raw, '')
  if (credential !== undefined) {
    fail(definition, credential, 'must not carry a credential-shaped value')
  }
  if (raw.v !== DEFINITION_SCHEMA_VERSION) {
    fail(definition, 'v', `must be ${String(DEFINITION_SCHEMA_VERSION)}`)
  }
  const name = nonEmptyString(raw.name, definition, 'name')
  const description = optionalDescription(raw.description, definition)
  const version = positiveInteger(raw.version, definition, 'version')
  const triggerValue = trigger(raw.trigger, definition)
  const settingsValue = settings(raw.settings, definition)
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    fail(definition, 'steps', 'must be a non-empty list')
  }
  const ids = new Set<string>()
  const stepIds = new Set<string>()
  for (const [index, entry] of raw.steps.entries()) {
    if (!isRecord(entry)) fail(definition, `steps[${String(index)}]`, 'must be an object')
    const id = nonEmptyString(entry.id, definition, `steps[${String(index)}].id`)
    if (id === 'end') {
      fail(
        definition,
        `steps[${String(index)}].id`,
        'must not use the reserved terminal value "end"',
      )
    }
    if (ids.has(id)) fail(definition, `steps[${String(index)}].id`, `is duplicated ("${id}")`)
    ids.add(id)
    stepIds.add(id)
  }
  const allowTools =
    settingsValue.allowTools === undefined ? undefined : new Set(settingsValue.allowTools)
  const steps = raw.steps.map((entry, index) =>
    step(entry, definition, `steps[${String(index)}]`, stepIds, allowTools),
  )
  assertAcyclic(definition, steps)
  return {
    v: DEFINITION_SCHEMA_VERSION,
    id: definition,
    name,
    ...(description === undefined ? {} : { description }),
    version,
    trigger: triggerValue,
    settings: settingsValue,
    steps,
  }
}

/** The host approval store; signed with the host key. */
export function workspaceDefinitionsDirectory(workspace: string): string {
  return join(workspace, '.dsh', 'workflows', 'definitions')
}

/** Model-writable drafts; the loader never reads this directory. */
export function workspaceDraftsDirectory(workspace: string): string {
  return join(workspace, '.dsh', 'workflows', 'drafts')
}

/** One step's effective ownership after the definition and profile resolve. */
export interface ResolvedStepOwnership {
  readonly id: string
  readonly ownership: GateOwnership
  readonly legacy?: LegacySource
}

export interface OwnershipResolution {
  readonly steps: readonly ResolvedStepOwnership[]
  /** One load-refusing line per illegal combination. */
  readonly issues: readonly string[]
}

/** The legacy plugins this engine knows how to defer to. */
export const KNOWN_LEGACY_SOURCES = ['delegation-rules', 'goal-continuity'] as const

/** Whether one legacy signal would actually steer right now. */
function signalEnabled(
  plugin: string,
  signal: string,
  installed: ReadonlySet<string>,
  enabled: ReadonlySet<string> | undefined,
): boolean {
  if (enabled === undefined) return installed.has(plugin)
  return enabled.has(`${plugin}/${signal}`)
}

/** The legacy signal state a load or gate decision resolves against. */
export interface LegacySignalState {
  readonly installed: ReadonlySet<string>
  /** `${plugin}/${signal}` entries that would actually steer. */
  readonly enabled: ReadonlySet<string>
}

function retirementRemedy(
  plugin: string,
  signal: string,
  state: 'not-installed' | 'disabled' | 'enabled',
): string {
  const key = `"${plugin}/${signal}"`
  if (state === 'enabled') {
    return `${key} is still enabled in the profile; flip its gate-only switch (checkpoint.automation, delegation.gates.workflowOwned, or the verification row) in the same retire-legacy-gates config change`
  }
  if (state === 'disabled') {
    return `${key} is installed but its gate-only switch is off; a deferred definition would have no enforcing legacy gate — enable the switch or move ownership in the "retire-legacy-gates" change`
  }
  return `${key} is not installed; install it or move ownership in the "retire-legacy-gates" change`
}

/** One issue line that names the definition, optional step, and remedy. */
function issue(
  definition: string,
  step: string | undefined,
  plugin: string,
  signal: string,
  state: 'not-installed' | 'disabled' | 'enabled',
): string {
  const subject = step === undefined ? '' : `step "${step}" `
  return `workflow definition "${definition}": ${subject}${retirementRemedy(plugin, signal, state)}`
}

/**
 * Resolve ownership per definition and step against the installed and enabled
 * legacy sources. A `defer` needs an enabled source; an `own` step may not
 * declare an enabled source for the same behavior. A deferred definition
 * defers every step, so only a definition-level `own` can carry a deferred
 * step such as `spec-review`.
 */
export function resolveOwnership(
  definition: Definition,
  installed: ReadonlySet<string>,
  enabledSignals?: ReadonlySet<string>,
): OwnershipResolution {
  const issues: string[] = []
  const settings = definition.settings
  const definitionDeferred = settings.gateOwnership === 'defer'
  const stateOf = (plugin: string, signal: string): 'not-installed' | 'disabled' | 'enabled' => {
    if (!installed.has(plugin)) return 'not-installed'
    return signalEnabled(plugin, signal, installed, enabledSignals) ? 'enabled' : 'disabled'
  }
  if (definitionDeferred) {
    const legacy = settings.legacy
    if (legacy !== undefined && stateOf(legacy.plugin, legacy.signal) !== 'enabled') {
      issues.push(
        issue(
          definition.id,
          undefined,
          legacy.plugin,
          legacy.signal,
          stateOf(legacy.plugin, legacy.signal),
        ),
      )
    }
  } else if (
    settings.legacy !== undefined &&
    stateOf(settings.legacy.plugin, settings.legacy.signal) === 'enabled'
  ) {
    issues.push(
      issue(definition.id, undefined, settings.legacy.plugin, settings.legacy.signal, 'enabled'),
    )
  }
  const steps = definition.steps.map((step): ResolvedStepOwnership => {
    const ownership = definitionDeferred ? 'defer' : (step.ownership ?? 'own')
    const legacy = definitionDeferred ? (step.legacy ?? settings.legacy) : step.legacy
    if (definitionDeferred) {
      if (step.ownership === 'own') {
        issues.push(
          `workflow definition "${definition.id}": step "${step.id}" claims ownership inside a deferred definition; a deferred definition defers every step`,
        )
      }
      if (
        step.legacy !== undefined &&
        stateOf(step.legacy.plugin, step.legacy.signal) !== 'enabled'
      ) {
        issues.push(
          issue(
            definition.id,
            step.id,
            step.legacy.plugin,
            step.legacy.signal,
            stateOf(step.legacy.plugin, step.legacy.signal),
          ),
        )
      }
    } else if (ownership === 'defer') {
      if (legacy === undefined) {
        issues.push(
          `workflow definition "${definition.id}": step "${step.id}" declares a defer without a legacy source`,
        )
      } else if (stateOf(legacy.plugin, legacy.signal) !== 'enabled') {
        issues.push(
          issue(
            definition.id,
            step.id,
            legacy.plugin,
            legacy.signal,
            stateOf(legacy.plugin, legacy.signal),
          ),
        )
      }
    } else if (legacy !== undefined && stateOf(legacy.plugin, legacy.signal) === 'enabled') {
      issues.push(issue(definition.id, step.id, legacy.plugin, legacy.signal, 'enabled'))
    }
    return { id: step.id, ownership, ...(legacy === undefined ? {} : { legacy }) }
  })
  return { steps, issues }
}

/** Read and validate one definition file. */
export function readDefinitionFile(file: string): Definition {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `workflow definition ${file} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return validateDefinition(raw, file)
}

/**
 * The shipped definition directory. Like the trigger catalog it resolves from
 * both `src/host` during a source test and `lib` after compilation.
 */
export function shippedDefinitionsDirectory(): string {
  const candidates = [
    fileURLToPath(new URL('../../assets/definitions', import.meta.url)),
    fileURLToPath(new URL('../assets/definitions', import.meta.url)),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    throw new Error(`workflow definitions were not found at ${candidates.join(' or ')}`)
  }
  return found
}

/** Load every shipped definition; a duplicate id or invalid file fails the load. */
export function loadShippedDefinitions(): Definition[] {
  const directory = shippedDefinitionsDirectory()
  const definitions: Definition[] = []
  const ids = new Set<string>()
  for (const name of readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    const definition = readDefinitionFile(join(directory, name))
    if (ids.has(definition.id)) {
      throw new Error(`workflow definition "${definition.id}" is shipped twice`)
    }
    ids.add(definition.id)
    definitions.push(definition)
  }
  return definitions
}
