import { randomUUID } from 'node:crypto'
import {
  type Definition,
  resultSchemaShapeError,
  type Step,
  type SubagentSpec,
} from './definitions.js'
import { type EvidenceCheck, type EvidenceContext, resolveEvidenceText } from './evidence.js'
import { requestStep, setRunStatus, settleStep, type WorkflowRun } from './runs.js'
import { renderMainSteer, type SteerTarget } from './steer.js'

/**
 * The `main` executor. It steers the root agent and never completes a step
 * itself: only a passing evidence check settles the step, so a model's text
 * claim cannot close it. A re-request happens only on a later turn stop and is
 * bounded by the step's attempt cap.
 */

export const DEFAULT_MAIN_ATTEMPTS = 3

export interface MainStepRequest {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly agent: SteerTarget
  readonly evidenceContext: EvidenceContext
  readonly turn: number
  readonly maxAttempts?: number
  readonly now?: number
}

export type MainStepResult =
  | { readonly steered: true; readonly run: WorkflowRun; readonly text: string }
  | { readonly steered: false; readonly run: WorkflowRun; readonly reason: string }

/**
 * Request one main step for this turn stop. The same turn never steers twice;
 * the attempt cap ends the re-requests with a visible reason.
 */
export function requestMainStep(input: MainStepRequest): MainStepResult {
  const current = input.run.steps.find((step) => step.id === input.step.id)
  if (current === undefined) {
    return { steered: false, run: input.run, reason: `the run has no step "${input.step.id}"` }
  }
  if (current.state !== 'open' && current.state !== 'blocked') {
    return { steered: false, run: input.run, reason: `the step is already ${current.state}` }
  }
  if (current.lastTurn === input.turn) {
    return {
      steered: false,
      run: input.run,
      reason: `step "${input.step.id}" was already steered in turn ${String(input.turn)}`,
    }
  }
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAIN_ATTEMPTS
  if ((current.attempts ?? 0) >= maxAttempts) {
    return {
      steered: false,
      run: input.run,
      reason: `step "${input.step.id}" reached its ${String(maxAttempts)}-request bound`,
    }
  }
  // A contract that cannot fit the bounded steer is refused before the step is
  // requested, so the run never holds an open step no steer can describe.
  let text: string
  try {
    text = renderMainSteer({
      run: input.run,
      definition: input.definition,
      step: input.step,
      evidenceContext: input.evidenceContext,
    })
  } catch (error) {
    return {
      steered: false,
      run: input.run,
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }
  }
  const requested = requestStep(input.run, input.step.id, input.now)
  const run: WorkflowRun = {
    ...requested,
    steps: requested.steps.map((step) =>
      step.id === input.step.id ? { ...step, lastTurn: input.turn } : step,
    ),
  }
  input.agent.steer(text)
  return { steered: true, run, text }
}

/**
 * Apply the verifier's result to a main step. A failed check leaves the step
 * exactly as it was; only a passing check settles it as done.
 */
export function settleMainStep(
  run: WorkflowRun,
  stepId: string,
  check: EvidenceCheck,
  now = Date.now(),
): WorkflowRun {
  if (!check.ok) return run
  return settleStep(run, stepId, 'done', { at: now, evidence: check.evidence })
}

/* ------------------------------------------------------------------ */
/* branch, loop, and human executors                                   */
/* ------------------------------------------------------------------ */

export interface JsonLogicData {
  readonly context: Readonly<Record<string, unknown>>
  readonly steps: WorkflowRun['steps']
  readonly evidence: unknown
  readonly trigger: Readonly<Record<string, unknown>>
  readonly iteration?: number
  readonly item?: unknown
}

/** Resolve a dotted `var` path against the plain JSONLogic data. */
function lookup(data: unknown, path: string): unknown {
  let current = data
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && value !== false && value !== 0 && value !== ''
}

function operands(args: unknown): unknown[] {
  return Array.isArray(args) ? args : [args]
}

/**
 * A bounded JSONLogic evaluator over plain data. It is data, not code: only a
 * small operator set is accepted, an unknown operator or malformed rule throws,
 * and the recursion depth is capped.
 */
export function evaluateJsonLogic(rule: unknown, data: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('invalid JSONLogic: nesting is too deep')
  if (rule === null || typeof rule !== 'object') return rule
  if (Array.isArray(rule)) return rule.map((entry) => evaluateJsonLogic(entry, data, depth + 1))
  const keys = Object.keys(rule)
  if (keys.length !== 1) throw new Error('invalid JSONLogic: an operator object has one key')
  const operator = keys[0] ?? ''
  const raw = (rule as Record<string, unknown>)[operator]
  const args = operands(raw)
  const value = (entry: unknown): unknown => evaluateJsonLogic(entry, data, depth + 1)
  switch (operator) {
    case 'var': {
      const path = typeof args[0] === 'string' ? args[0] : ''
      if (path === '') throw new Error('invalid JSONLogic: var needs a path')
      const found = lookup(data, path)
      return found === undefined && args.length > 1 ? value(args[1]) : found
    }
    case '==':
      // biome-ignore lint/suspicious/noDoubleEquals: JSONLogic equality is loose
      return value(args[0]) == value(args[1])
    case '!=':
      // biome-ignore lint/suspicious/noDoubleEquals: JSONLogic equality is loose
      return value(args[0]) != value(args[1])
    case '===':
      return value(args[0]) === value(args[1])
    case '!==':
      return value(args[0]) !== value(args[1])
    case '>':
      return Number(value(args[0])) > Number(value(args[1]))
    case '>=':
      return Number(value(args[0])) >= Number(value(args[1]))
    case '<':
      return Number(value(args[0])) < Number(value(args[1]))
    case '<=':
      return Number(value(args[0])) <= Number(value(args[1]))
    case 'and': {
      let last: unknown = true
      for (const entry of args) {
        last = value(entry)
        if (!truthy(last)) return last
      }
      return last
    }
    case 'or': {
      for (const entry of args) {
        const result = value(entry)
        if (truthy(result)) return result
      }
      return false
    }
    case '!':
      return !truthy(value(args[0]))
    case 'in':
      return Array.isArray(value(args[1]))
        ? (value(args[1]) as unknown[]).includes(value(args[0]))
        : String(value(args[1]) ?? '').includes(String(value(args[0]) ?? ''))
    case 'if':
      return truthy(value(args[0])) ? value(args[1]) : value(args[2])
    default:
      throw new Error(`invalid JSONLogic: unknown operator "${operator}"`)
  }
}

export interface BranchStepInput {
  readonly run: WorkflowRun
  readonly step: Step
  readonly values: Readonly<Record<string, unknown>>
  readonly now?: number
}

export interface BranchStepResult {
  readonly run: WorkflowRun
  readonly next?: string
}

/** Evaluate a branch predicate and settle the step with the chosen edge. */
export function runBranchStep(input: BranchStepInput): BranchStepResult {
  const spec = input.step.branch
  if (spec === undefined) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason: 'the branch step declares no branch',
        }),
        'failed',
        input.now,
      ),
    }
  }
  try {
    const chosen = truthy(
      evaluateJsonLogic(spec.predicate, {
        context: input.values,
        steps: input.run.steps,
        evidence: input.run.steps.map((step) => step.evidence ?? null),
        trigger: { definition: input.run.definition, run: input.run.id },
      } satisfies JsonLogicData),
    )
      ? spec.then
      : spec.else
    return {
      run: settleStep(input.run, input.step.id, 'done', { at: input.now }),
      next: chosen,
    }
  } catch (error) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason:
            error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        }),
        'failed',
        input.now,
      ),
    }
  }
}

export interface LoopStepInput {
  readonly run: WorkflowRun
  readonly step: Step
  readonly values: Readonly<Record<string, unknown>>
  readonly now?: number
}

export interface LoopStepResult {
  readonly run: WorkflowRun
  readonly next?: string
}

/** Iterate until the stop predicate holds or the declared cap is reached. */
export function runLoopStep(input: LoopStepInput): LoopStepResult {
  const spec = input.step.loop
  if (spec === undefined) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason: 'the loop step declares no loop',
        }),
        'failed',
        input.now,
      ),
    }
  }
  const source = spec.list === undefined ? undefined : input.values[spec.list]
  const iterations = Math.min(
    spec.maxIterations,
    Array.isArray(source) ? Math.max(1, source.length) : spec.maxIterations,
  )
  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const stop = truthy(
        evaluateJsonLogic(spec.stop, {
          context: input.values,
          steps: input.run.steps,
          evidence: input.run.steps.map((step) => step.evidence ?? null),
          trigger: { definition: input.run.definition, run: input.run.id },
          iteration,
          item: Array.isArray(source) ? source[iteration] : undefined,
        } satisfies JsonLogicData),
      )
      if (stop) {
        return {
          run: settleStep(input.run, input.step.id, 'done', { at: input.now }),
          next: spec.next,
        }
      }
    }
  } catch (error) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason:
            error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        }),
        'failed',
        input.now,
      ),
    }
  }
  const cap = spec.cap ?? 'blocked'
  return {
    run: setRunStatus(
      settleStep(input.run, input.step.id, cap, {
        at: input.now,
        reason: `the loop reached its ${String(spec.maxIterations)}-iteration cap`,
      }),
      cap,
      input.now,
    ),
  }
}

export interface HumanAskResult {
  readonly answer?: string
  readonly timedOut?: boolean
}

export interface HumanQuestionService {
  ask(request: {
    readonly question: string
    readonly accepted: readonly string[]
    readonly timeoutAction: 'block' | 'cancel'
  }): Promise<HumanAskResult>
}

export interface HumanStepInput {
  readonly run: WorkflowRun
  readonly step: Step
  readonly questions: HumanQuestionService
  readonly evidenceContext: EvidenceContext
  readonly now?: number
}

/** Ask the user; only the declared answer completes the step. */
export async function runHumanStep(input: HumanStepInput): Promise<WorkflowRun> {
  const evidence = input.step.evidence
  if (evidence === undefined || evidence.kind !== 'human') {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: 'the human step declares no accepted answer',
      }),
      'failed',
      input.now,
    )
  }
  const accepted = (Array.isArray(evidence.answer) ? evidence.answer : [evidence.answer]).map(
    (answer) => answer.trim().toLowerCase(),
  )
  const prompt = resolveEvidenceText(input.step.prompt ?? '', input.evidenceContext)
  if (!prompt.ok) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: `the question could not be resolved: ${prompt.failure.detail}`,
      }),
      'failed',
      input.now,
    )
  }
  const timeoutAction = input.step.human?.timeoutAction ?? 'block'
  let asked: HumanAskResult
  try {
    asked = await input.questions.ask({
      question: prompt.text,
      accepted,
      timeoutAction,
    })
  } catch (error) {
    const reason = `the question could not be asked: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', { at: input.now, reason }),
      'failed',
      input.now,
    )
  }
  if (asked.timedOut === true) {
    const state = timeoutAction === 'cancel' ? 'cancelled' : 'blocked'
    return setRunStatus(
      settleStep(input.run, input.step.id, state, {
        at: input.now,
        reason: 'the user question timed out',
      }),
      timeoutAction === 'cancel' ? 'cancelled' : 'blocked',
      input.now,
    )
  }
  const answer = asked.answer?.trim() ?? ''
  if (accepted.includes(answer.toLowerCase())) {
    return settleStep(input.run, input.step.id, 'done', {
      at: input.now,
      evidence: { kind: 'human', answer },
    })
  }
  const state = timeoutAction === 'cancel' ? 'cancelled' : 'blocked'
  return setRunStatus(
    settleStep(input.run, input.step.id, state, {
      at: input.now,
      reason: `the user answer "${answer.slice(0, 200)}" is not one of: ${accepted.join(', ')}`,
    }),
    timeoutAction === 'cancel' ? 'cancelled' : 'blocked',
    input.now,
  )
}

/** The host-owned call ids one run may dispatch; a model call is never owned. */
export class OwnedCalls {
  private readonly ids = new Set<string>()

  add(callId: string): void {
    this.ids.add(callId)
  }

  has(callId: string): boolean {
    return this.ids.has(callId)
  }

  list(): string[] {
    return [...this.ids]
  }
}

export interface ToolDispatchRequest {
  readonly callId: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

export interface ToolDispatchResult {
  readonly ok: boolean
  readonly error?: string
}

export interface ToolRunner {
  call(request: ToolDispatchRequest, signal?: AbortSignal): Promise<ToolDispatchResult>
}

export interface ToolStepInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly runner: ToolRunner
  readonly owned: OwnedCalls
  readonly evidenceContext: EvidenceContext
  readonly now?: number
  readonly signal?: AbortSignal
}

function interpolateArguments(
  value: Readonly<Record<string, unknown>>,
  context: EvidenceContext,
):
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly detail: string } {
  const args: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      args[key] = entry
      continue
    }
    const resolved = resolveEvidenceText(entry, context)
    if (!resolved.ok) return { ok: false, detail: resolved.failure.detail }
    args[key] = resolved.text
  }
  return { ok: true, args }
}

/** The bounded host-generated call id; the owned set is registered before dispatch. */
export function newOwnedCallId(run: WorkflowRun, step: Step): string {
  return `owned-${run.id}-${step.id}-${randomUUID()}`
}

/**
 * Run one tool step: allowlist, validated interpolation, an owned call id
 * registered before dispatch, and a step settled only by the dispatch result.
 */
export async function runToolStep(input: ToolStepInput): Promise<WorkflowRun> {
  const spec = input.step.tool
  if (spec === undefined) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: 'the tool step declares no tool',
      }),
      'failed',
      input.now,
    )
  }
  const allowTools = input.definition.settings.allowTools ?? []
  if (!allowTools.includes(spec.name)) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: `tool "${spec.name}" is not on the definition allowlist`,
      }),
      'failed',
      input.now,
    )
  }
  const rawArguments: Record<string, unknown> = {}
  if (spec.command !== undefined) {
    const resolved = resolveEvidenceText(spec.command, input.evidenceContext)
    if (!resolved.ok) {
      return setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason: `the fixed command could not be resolved: ${resolved.failure.detail}`,
        }),
        'failed',
        input.now,
      )
    }
    rawArguments.command = resolved.text
  }
  if (spec.args !== undefined) {
    const resolved = interpolateArguments(spec.args, input.evidenceContext)
    if (!resolved.ok) {
      return setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason: `the tool arguments could not be resolved: ${resolved.detail}`,
        }),
        'failed',
        input.now,
      )
    }
    Object.assign(rawArguments, resolved.args)
  }
  const callId = newOwnedCallId(input.run, input.step)
  input.owned.add(callId)
  let outcome: ToolDispatchResult
  try {
    outcome = await input.runner.call(
      { callId, name: spec.name, arguments: rawArguments },
      input.signal,
    )
  } catch (error) {
    const reason = `the tool call failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', { at: input.now, reason }),
      'failed',
      input.now,
    )
  }
  if (!outcome.ok) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: `the tool call failed${outcome.error === undefined ? '' : `: ${outcome.error.slice(0, 200)}`}`,
      }),
      'failed',
      input.now,
    )
  }
  return settleStep(input.run, input.step.id, 'done', {
    at: input.now,
    evidence: { kind: 'tool', callId, detail: `${spec.name} ok` },
  })
}

/** A bounded subset of JSON Schema used to validate a child's result. */
export type ResultSchema = Readonly<Record<string, unknown>>

export interface SubagentRunResult {
  readonly childId: string
  readonly completed: boolean
  readonly result?: unknown
  readonly error?: string
}

export interface SubagentRunner {
  run(
    request: {
      readonly provider: string
      readonly prompt: string
      readonly schema?: ResultSchema
      readonly model?: string
      readonly reasoningEffort?: string
    },
    signal?: AbortSignal,
  ): Promise<SubagentRunResult>
}

export interface SubagentStepInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly runner: SubagentRunner
  readonly evidenceContext: EvidenceContext
  readonly now?: number
  readonly signal?: AbortSignal
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Validate one value against the supported schema subset; returns an error. */
function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((entry, index) => jsonEqual(entry, right[index]))
    )
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const keys = Object.keys(leftRecord)
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every(
        (key) => Object.hasOwn(rightRecord, key) && jsonEqual(leftRecord[key], rightRecord[key]),
      )
    )
  }
  return false
}

export function validateResultSchema(
  schema: ResultSchema,
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 8) return 'the result schema nests too deeply'
  const expected = schema.type
  if (expected !== undefined) {
    const allowed = Array.isArray(expected) ? expected.map(String) : [String(expected)]
    const actual = typeOf(value)
    const match = allowed.some(
      (entry) =>
        entry === actual || (entry === 'integer' && actual === 'number' && Number.isInteger(value)),
    )
    if (!match) return `expected ${allowed.join(' or ')}, got ${actual}`
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(entry, value))) {
    return `the value is not one of: ${schema.enum.map(String).join(', ')}`
  }
  if (Object.hasOwn(schema, 'const') && !jsonEqual(schema.const, value)) {
    return 'the value does not match the declared const'
  }
  if (Array.isArray(schema.required) && typeOf(value) === 'object') {
    const record = value as Record<string, unknown>
    for (const key of schema.required) {
      if (typeof key !== 'string' || !Object.hasOwn(record, key))
        return `missing required field "${String(key)}"`
    }
  }
  if (typeOf(value) === 'object') {
    const record = value as Record<string, unknown>
    const properties =
      schema.properties !== undefined &&
      typeof schema.properties === 'object' &&
      schema.properties !== null
        ? (schema.properties as Record<string, unknown>)
        : {}
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(record, key) || typeof child !== 'object' || child === null) continue
      const error = validateResultSchema(child as ResultSchema, record[key], depth + 1)
      if (error !== undefined) return `${key}: ${error}`
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(properties, key)) return `unexpected field "${key}"`
      }
    }
  }
  if (schema.items !== undefined && Array.isArray(value)) {
    if (typeof schema.items !== 'object' || schema.items === null) {
      return 'the schema items are not an object'
    }
    for (const [index, entry] of value.entries()) {
      const error = validateResultSchema(schema.items as ResultSchema, entry, depth + 1)
      if (error !== undefined) return `[${String(index)}]: ${error}`
    }
  }
  return undefined
}

/**
 * Run one subagent step: build the prompt, start exactly one child, validate
 * its result, and settle the step. A non-completion or schema mismatch marks
 * the step failed; there is no fallback to the main executor.
 */
export async function runSubagentStep(input: SubagentStepInput): Promise<WorkflowRun> {
  const spec: SubagentSpec | undefined = input.step.subagent
  if (spec === undefined || spec.schema === undefined) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: 'the subagent step has no provider or result schema',
      }),
      'failed',
      input.now,
    )
  }
  const shapeError = resultSchemaShapeError(spec.schema)
  if (shapeError !== undefined) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: `the result schema is unsupported: ${shapeError}`,
      }),
      'failed',
      input.now,
    )
  }
  const promptText = resolveEvidenceText(input.step.prompt ?? '', input.evidenceContext)
  if (!promptText.ok) {
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason: `the prompt could not be resolved: ${promptText.failure.detail}`,
      }),
      'failed',
      input.now,
    )
  }
  let result: SubagentRunResult
  try {
    result = await input.runner.run(
      {
        provider: spec.provider,
        prompt: promptText.text,
        ...(spec.schema === undefined ? {} : { schema: spec.schema }),
        ...(spec.model === undefined ? {} : { model: spec.model }),
        ...(spec.reasoningEffort === undefined ? {} : { reasoningEffort: spec.reasoningEffort }),
      },
      input.signal,
    )
  } catch (error) {
    const reason = `the child could not run: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', { at: input.now, reason }),
      'failed',
      input.now,
    )
  }
  if (!result.completed) {
    const reason = `the child did not complete${result.error === undefined ? '' : `: ${result.error.slice(0, 200)}`}`
    return setRunStatus(
      settleStep(input.run, input.step.id, 'failed', {
        at: input.now,
        reason,
        evidence: {
          kind: 'subagent',
          callId: result.childId,
          detail: 'the child did not complete',
        },
      }),
      'failed',
      input.now,
    )
  }
  if (spec.schema !== undefined) {
    const mismatch = validateResultSchema(spec.schema, result.result)
    if (mismatch !== undefined) {
      return setRunStatus(
        settleStep(input.run, input.step.id, 'failed', {
          at: input.now,
          reason: `the child result does not match the schema: ${mismatch.slice(0, 200)}`,
          evidence: {
            kind: 'subagent',
            callId: result.childId,
            detail: 'the child result did not match the schema',
          },
        }),
        'failed',
        input.now,
      )
    }
  }
  const settled = settleStep(input.run, input.step.id, 'done', {
    at: input.now,
    evidence: {
      kind: 'subagent',
      callId: result.childId,
      detail: 'schema-validated child result',
      result: result.result,
    },
  })
  return settled
}
