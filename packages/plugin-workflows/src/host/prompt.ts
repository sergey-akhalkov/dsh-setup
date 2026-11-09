import { pendingStep } from './resume.js'
import type { WorkflowRun } from './runs.js'

/**
 * The `workflows-active-runs` system-prompt context: at most five bounded lines
 * in total, one per active run; no section at all when none is active, so a
 * prompt without workflows stays byte-identical.
 */

export const ACTIVE_RUNS_CONTEXT = 'workflows-active-runs'
export const MAX_ACTIVE_RUN_LINES = 5
/** One rendered line never exceeds this bound, whatever the identifiers hold. */
export const MAX_ACTIVE_RUN_LINE_CHARS = 240
/** One identifier's bound, so a long definition leaves room for the step. */
const MAX_IDENTIFIER_CHARS = 80

/** Collapse control and Unicode line separators in one data-derived value. */
function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
}

/** Sanitize and bound one identifier before composing the prompt line. */
function bounded(value: string): string {
  return oneLine(value).slice(0, MAX_IDENTIFIER_CHARS)
}

/** One bounded line for an active run, or '' when there is none. */
export function renderActiveRunsContext(runs: readonly WorkflowRun[]): string {
  const active = runs.filter(
    (run) => run.status === 'running' || run.status === 'blocked' || run.status === 'interrupted',
  )
  if (active.length === 0) return ''
  // The overflow summary shares the five-line budget with the run lines.
  const listed =
    active.length > MAX_ACTIVE_RUN_LINES ? active.slice(0, MAX_ACTIVE_RUN_LINES - 1) : active
  const lines = listed.map((run) => {
    const pending = pendingStep(run)
    const line = `- ${bounded(run.definition)}: step ${bounded(pending ?? 'end')} (${run.status}) run ${bounded(run.id)}`
    return oneLine(line).slice(0, MAX_ACTIVE_RUN_LINE_CHARS)
  })
  if (active.length > MAX_ACTIVE_RUN_LINES) {
    lines.push(
      oneLine(`- ${String(active.length - (MAX_ACTIVE_RUN_LINES - 1))} more active run(s)`),
    )
  }
  return lines.join('\n')
}

export interface ActiveRunsPromptTarget {
  readonly systemPrompt?: {
    context?(contribution: {
      readonly name: string
      readonly order: number
      readonly required: boolean
      /** Data-derived text: never interpolate model-controlled identifiers. */
      readonly interpolate?: boolean
      readonly text: (context?: { readonly scope?: unknown }) => string
    }): () => void
  }
  effect?(callback: () => () => void): () => void
}

/** Register the dynamic context when the host's system-prompt service exists. */
export function registerActiveRunsContext(
  ctx: ActiveRunsPromptTarget,
  activeRuns: (context?: { readonly scope?: unknown }) => readonly WorkflowRun[],
): boolean {
  const target = ctx.systemPrompt
  const register = target?.context
  if (target === undefined || typeof register !== 'function') return false
  const contribution = {
    name: ACTIVE_RUNS_CONTEXT,
    order: 500,
    required: false,
    interpolate: false,
    text: (context?: { readonly scope?: unknown }) => renderActiveRunsContext(activeRuns(context)),
  }
  // Keep the service receiver: the real method reads its private layer state.
  const add = (): (() => void) => register.call(target, contribution)
  if (typeof ctx.effect === 'function') ctx.effect(add)
  else add()
  return true
}
