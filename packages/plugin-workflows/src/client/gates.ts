/**
 * The engine-owned gates, as the closed descriptor list the Workflows overview
 * renders. They are obligations of the gate listener, not definitions: they
 * never enter the definition registry, the canvas, or the ordered step table.
 */

export interface EngineGateContract {
  readonly gate: string
  readonly titleKey: string
  readonly triggerKey: string
  readonly evidenceKey: string
  readonly recordKey: string
  readonly steerKey: string
}

export const ENGINE_GATES: readonly EngineGateContract[] = [
  {
    gate: 'task-progress',
    titleKey: 'gates.taskProgress.title',
    triggerKey: 'gates.taskProgress.trigger',
    evidenceKey: 'gates.taskProgress.evidence',
    recordKey: 'gates.taskProgress.record',
    steerKey: 'gates.taskProgress.steer',
  },
  {
    gate: 'lane-assignment',
    titleKey: 'gates.laneAssignment.title',
    triggerKey: 'gates.laneAssignment.trigger',
    evidenceKey: 'gates.laneAssignment.evidence',
    recordKey: 'gates.laneAssignment.record',
    steerKey: 'gates.laneAssignment.steer',
  },
  {
    gate: 'goal-complete',
    titleKey: 'gates.goalComplete.title',
    triggerKey: 'gates.goalComplete.trigger',
    evidenceKey: 'gates.goalComplete.evidence',
    recordKey: 'gates.goalComplete.record',
    steerKey: 'gates.goalComplete.steer',
  },
  {
    gate: 'archive',
    titleKey: 'gates.archive.title',
    triggerKey: 'gates.archive.trigger',
    evidenceKey: 'gates.archive.evidence',
    recordKey: 'gates.archive.record',
    steerKey: 'gates.archive.steer',
  },
]
