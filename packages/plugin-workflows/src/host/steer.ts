import type { Definition, Step } from './definitions.js'
import { describeEvidence, type EvidenceContext, resolveEvidenceText } from './evidence.js'
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
  const header = `Workflow step "${step.title}" (${definition.id} / ${step.id}) is open.\nRun: ${run.id}; step: ${step.id}.`
  const evidence = `Evidence required: ${
    step.evidence === undefined ? 'none' : describeEvidence(step.evidence, evidenceContext)
  }.`
  const footer = [
    step.blockTurnClose === true
      ? 'The turn cannot close until the evidence verifies.'
      : 'Complete the evidence before the next step.',
    'A text claim is not evidence; the verifier reads the workspace.',
  ].join('\n')
  const fixed = header.length + evidence.length + footer.length + 2
  const budget = MAX_STEER_CHARS - fixed - 1
  if (budget < 0) {
    throw new Error(
      `the step "${step.id}" evidence contract is too long for a ${String(MAX_STEER_CHARS)}-character steer`,
    )
  }
  const rawPrompt = step.prompt ?? ''
  const resolvedPrompt = resolveEvidenceText(rawPrompt, evidenceContext, undefined)
  const promptText = resolvedPrompt.ok ? resolvedPrompt.text : rawPrompt
  const prompt = promptText.slice(0, budget)
  // Only the free-text prompt is redacted: the validated structural paths in
  // the evidence contract must survive unchanged for the verifier to match them.
  const text = [header, ...(prompt === '' ? [] : [redactText(prompt)]), evidence, footer].join('\n')
  return text.length <= MAX_STEER_CHARS ? text : text.slice(0, MAX_STEER_CHARS)
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
