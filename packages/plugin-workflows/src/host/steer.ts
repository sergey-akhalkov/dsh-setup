import type { Definition, Step } from './definitions.js'
import { describeEvidence, type EvidenceContext } from './evidence.js'
import { redactText } from './redact.js'
import type { WorkflowRun } from './runs.js'

/**
 * The main-step steer. It names the step, the exact evidence contract, and the
 * workspace-relative path the verifier will check, using the same resolver, so
 * the model never has to guess where an artifact belongs.
 */

export const MAX_STEER_CHARS = 2000

export interface MainSteerInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly evidenceContext: EvidenceContext
}

/** Render the bounded steer for one open main step. */
export function renderMainSteer(input: MainSteerInput): string {
  const { run, definition, step, evidenceContext } = input
  const lines = [
    `Workflow step "${step.title}" (${definition.id} / ${step.id}) is open.`,
    `Run: ${run.id}; step: ${step.id}.`,
    ...(step.prompt === undefined ? [] : [step.prompt]),
    `Evidence required: ${
      step.evidence === undefined ? 'none' : describeEvidence(step.evidence, evidenceContext)
    }.`,
    step.blockTurnClose === true
      ? 'The turn cannot close until the evidence verifies.'
      : 'Complete the evidence before the next step.',
    'A text claim is not evidence; the verifier reads the workspace.',
  ]
  return redactText(lines.join('\n')).slice(0, MAX_STEER_CHARS)
}

export interface SteerTarget {
  steer(message: string): void
}

/** Steer the root agent with the rendered text and return exactly what it saw. */
export function steerMain(target: SteerTarget, input: MainSteerInput): string {
  const text = renderMainSteer(input)
  target.steer(text)
  return text
}
