import { pendingStep } from './resume.js'
import type { WorkflowRun } from './runs.js'

/**
 * The `workflows-active-runs` system-prompt context: at most five bounded lines
 * in total, one per active run; no section at all when none is active, so a
 * prompt without workflows stays byte-identical.
 */

export const ACTIVE_RUNS_CONTEXT = 'workflows-active-runs'
export const MAX_ACTIVE_RUN_LINES = 5

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
    return `- ${run.definition}: step ${pending ?? 'end'} (${run.status}) run ${run.id}`
  })
  if (active.length > MAX_ACTIVE_RUN_LINES) {
    lines.push(`- ${String(active.length - (MAX_ACTIVE_RUN_LINES - 1))} more active run(s)`)
  }
  return lines.join('\n')
}

export interface ActiveRunsPromptTarget {
  readonly systemPrompt?: {
    context?(contribution: {
      readonly name: string
      readonly order: number
      readonly required: boolean
      readonly text: () => string
    }): () => void
  }
  effect?(callback: () => () => void): () => void
}

/** Register the dynamic context when the host's system-prompt service exists. */
export function registerActiveRunsContext(
  ctx: ActiveRunsPromptTarget,
  activeRuns: () => readonly WorkflowRun[],
): boolean {
  const register = ctx.systemPrompt?.context
  if (typeof register !== 'function') return false
  const contribution = {
    name: ACTIVE_RUNS_CONTEXT,
    order: 500,
    required: false,
    text: () => renderActiveRunsContext(activeRuns()),
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => register(contribution))
  else register(contribution)
  return true
}
