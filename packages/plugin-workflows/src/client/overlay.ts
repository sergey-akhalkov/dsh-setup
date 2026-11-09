import type { DiagramNode, GraphDefinition } from './graph.ts'
import type { RunStepView, RunView } from './panel.tsx'

/**
 * The run overlay: a read-only projection of one run record onto the graph.
 * It never writes the run, starts a step, or invents a node for an orphan.
 */

export interface OverlayEvidence {
  readonly kind: string
  readonly ref?: string
  readonly at?: number
}

export interface OverlayStep {
  readonly id: string
  readonly state: string
  readonly failureClass?: string
  readonly evidence?: OverlayEvidence
  readonly reason?: string
  readonly violations: readonly string[]
}

export interface OverlayOrphan {
  readonly id: string
  readonly state: string
  readonly failureClass?: string
  readonly evidence?: OverlayEvidence
}

export interface Overlay {
  readonly run?: RunView
  readonly recordedName?: string
  readonly recordedVersion?: number
  readonly versionsDiffer: boolean
  readonly steps: Readonly<Record<string, OverlayStep>>
  readonly orphans: readonly OverlayOrphan[]
  readonly notices: readonly string[]
  readonly summary: string
}

function evidenceOf(step: RunStepView): OverlayEvidence | undefined {
  if (step.evidenceRef !== undefined) {
    return {
      kind: step.evidenceRef.kind,
      ...(step.evidenceRef.ref === undefined ? {} : { ref: step.evidenceRef.ref }),
      ...(step.evidenceRef.at === undefined ? {} : { at: step.evidenceRef.at }),
    }
  }
  if (step.evidence === undefined) return undefined
  return { kind: 'evidence', ref: step.evidence }
}

/** A run step id the projection synthesized for a violation row is not a step. */
function isViolationRow(id: string): boolean {
  return id.startsWith('violation:')
}

export function overlayFor(run: RunView | undefined, definition: GraphDefinition): Overlay {
  const known = new Set(definition.steps.map((step) => step.id))
  const steps: Record<string, OverlayStep> = {}
  const orphans: OverlayOrphan[] = []
  const notices: string[] = []
  const runSteps = new Map<string, RunStepView>()
  for (const step of run?.steps ?? []) {
    if (isViolationRow(step.id)) continue
    runSteps.set(step.id, step)
    if (!known.has(step.id)) {
      orphans.push({
        id: step.id,
        state: step.state,
        ...(step.failureClass === undefined ? {} : { failureClass: step.failureClass }),
        ...(evidenceOf(step) === undefined ? {} : { evidence: evidenceOf(step) }),
      })
      continue
    }
    steps[step.id] = {
      id: step.id,
      state: step.state,
      ...(step.failureClass === undefined ? {} : { failureClass: step.failureClass }),
      ...(evidenceOf(step) === undefined ? {} : { evidence: evidenceOf(step) }),
      ...(step.reason === undefined ? {} : { reason: step.reason }),
      violations: [],
    }
  }
  for (const violation of run?.violations ?? []) {
    const id = violation.stepId
    if (id === undefined) {
      notices.push(violation.reason)
      continue
    }
    const target = steps[id]
    if (target === undefined) {
      notices.push(`step "${id}": ${violation.reason}`)
      continue
    }
    steps[id] = { ...target, violations: [...target.violations, violation.reason] }
  }
  const definitionId = run?.definition?.id ?? ''
  const recordedName = run?.definition?.name
  const recordedVersion = run?.definition?.version
  const versionsDiffer =
    run?.definition !== undefined &&
    (run.definition.id !== definition.id ||
      run.definition.version !== definition.version ||
      run.definition.name !== definition.name)
  const state = run?.status ?? 'no run'
  const summary =
    run === undefined
      ? 'No run selected.'
      : `Run ${run.id.slice(0, 24)}: ${state}; recorded definition ${definitionId} version ${String(recordedVersion ?? '?')}${versionsDiffer ? ' (differs from the open definition)' : ''}.`
  return {
    ...(run === undefined ? {} : { run }),
    ...(recordedName === undefined ? {} : { recordedName }),
    ...(recordedVersion === undefined ? {} : { recordedVersion }),
    versionsDiffer,
    steps,
    orphans,
    notices,
    summary,
  }
}

/** Merge the overlay into node display data without touching the definition. */
export function withOverlay(nodes: readonly DiagramNode[], overlay: Overlay): DiagramNode[] {
  return nodes.map((node) => {
    if (node.kind === 'trigger' || node.kind === 'end' || node.step === undefined) return node
    const step = overlay.steps[node.step.id]
    if (step === undefined) return node
    return {
      ...node,
      runState: step.state,
      ...(step.failureClass === undefined ? {} : { failureClass: step.failureClass }),
      ...(step.evidence === undefined ? {} : { evidence: step.evidence }),
      ...(step.violations.length === 0 ? {} : { violations: step.violations }),
    }
  })
}
