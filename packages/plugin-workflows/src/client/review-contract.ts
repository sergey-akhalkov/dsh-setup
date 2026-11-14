import type { Translate } from './locale.ts'

/**
 * The read-only contract of one `review` step: what the reviewer is asked to
 * read, how its verdict is reused, and where the record lives. Display only:
 * the host owns execution and validation, so nothing here writes or decides.
 */

export interface ReviewContractView {
  readonly instruction: string
  /** The locale key of the bundled instruction's summary, when it is known. */
  readonly promptKey?: string
  /** The step's own prompt, shown when the instruction has no summary copy. */
  readonly prompt?: string
  readonly scope: 'whole' | 'task'
  readonly phase: string
  readonly recordPath: string
}

/** The bundled instruction ids the shipped review definitions name. */
const PROMPT_KEYS: Readonly<Record<string, string>> = {
  'review-spec': 'review.prompt.reviewSpec',
  'review-task': 'review.prompt.reviewTask',
  'review-integration': 'review.prompt.reviewIntegration',
}

const DASH = '—'

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

/**
 * The record path the step's declared evidence reads, else the store template.
 * The template keeps the runtime placeholders the store resolves.
 */
function recordPathOf(
  definitionId: string,
  scope: 'whole' | 'task',
  phase: string | undefined,
  evidence: unknown,
): string {
  const declared = record(evidence)
  const path = declared?.kind === 'record' ? text(declared.path) : undefined
  if (path !== undefined) return path
  return scope === 'task'
    ? `.dsh/workflows/records/${definitionId}/{name}/tasks/{taskId}.json`
    : `.dsh/workflows/records/${definitionId}/{name}/${phase ?? '{phase}'}.json`
}

/** The bundled instruction's summary key, guarded against prototype keys. */
function reviewPromptKey(instruction: string): string | undefined {
  if (!Object.hasOwn(PROMPT_KEYS, instruction)) return undefined
  return PROMPT_KEYS[instruction]
}

/** The prompt summary as the bundled instruction's copy, else the step's own prompt. */
export function promptSummary(contract: ReviewContractView, t: Translate): string {
  return contract.promptKey === undefined ? (contract.prompt ?? DASH) : t(contract.promptKey)
}

export interface ReviewStepLike {
  readonly executor?: unknown
  readonly prompt?: unknown
  readonly review?: unknown
  readonly evidence?: unknown
}

/** One review step's display contract; undefined for every other executor. */
export function reviewContract(
  definitionId: string,
  step: ReviewStepLike,
): ReviewContractView | undefined {
  if (step.executor !== 'review') return undefined
  const config = record(step.review) ?? {}
  const instruction = text(config.instruction) ?? DASH
  const scope = config.scope === 'task' ? 'task' : 'whole'
  // The engine's reviewPhase: a task review is always phase "task"; a whole
  // review defaults to "spec" when the definition omits an explicit phase.
  const phase = scope === 'task' ? 'task' : (text(config.phase) ?? 'spec')
  const prompt = text(step.prompt)
  const promptKey = reviewPromptKey(instruction)
  return {
    instruction,
    ...(promptKey === undefined ? {} : { promptKey }),
    ...(prompt === undefined ? {} : { prompt }),
    scope,
    phase,
    recordPath: recordPathOf(definitionId, scope, phase, step.evidence),
  }
}
