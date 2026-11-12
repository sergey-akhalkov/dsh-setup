/**
 * The building-block catalog shared by the palette, the canvas drop target, and
 * the inspector header. Values are engine vocabulary; labels and hints are
 * locale keys, so every surface speaks the same language.
 */

/** The drag payload a palette brick writes and the canvas reads. */
export const BRICK_MIME = 'application/x-dsh-wf-brick'

export type BrickKind = 'trigger' | 'step'

/** The icon family a brick and its canvas node share. */
export type BrickIcon = 'trigger' | 'agent' | 'tool' | 'subagent' | 'human' | 'branch' | 'loop'

export interface Brick {
  /** The engine value: a trigger kind or an executor. */
  readonly value: string
  readonly icon: BrickIcon
  /** Visible label; absent uses the engine value, as a trigger kind must. */
  readonly labelKey?: string
  /** One-line description, shown as the brick's tooltip. */
  readonly hintKey?: string
}

/** The deterministic trigger kinds a block can set, in engine order. */
export const TRIGGER_BRICKS: readonly Brick[] = [
  { value: 'turn.stopping', icon: 'trigger', hintKey: 'design.brick.trigger.turnStopping' },
  { value: 'tool.pre-execute', icon: 'trigger', hintKey: 'design.brick.trigger.toolPreExecute' },
  { value: 'tool.result', icon: 'trigger', hintKey: 'design.brick.trigger.toolResult' },
  { value: 'fs.change', icon: 'trigger', hintKey: 'design.brick.trigger.fsChange' },
  { value: 'subagent.end', icon: 'trigger', hintKey: 'design.brick.trigger.subagentEnd' },
  { value: 'review.record', icon: 'trigger', hintKey: 'design.brick.trigger.reviewRecord' },
]

/** The step executors a block can add, in engine order. */
export const STEP_BRICKS: readonly Brick[] = [
  {
    value: 'main',
    icon: 'agent',
    labelKey: 'design.brick.agent',
    hintKey: 'design.brick.agent.hint',
  },
  {
    value: 'tool',
    icon: 'tool',
    labelKey: 'design.brick.tool',
    hintKey: 'design.brick.tool.hint',
  },
  {
    value: 'subagent',
    icon: 'subagent',
    labelKey: 'design.brick.subagent',
    hintKey: 'design.brick.subagent.hint',
  },
  {
    value: 'human',
    icon: 'human',
    labelKey: 'design.brick.human',
    hintKey: 'design.brick.human.hint',
  },
  {
    value: 'branch',
    icon: 'branch',
    labelKey: 'design.brick.branch',
    hintKey: 'design.brick.branch.hint',
  },
  {
    value: 'loop',
    icon: 'loop',
    labelKey: 'design.brick.loop',
    hintKey: 'design.brick.loop.hint',
  },
]

/** The drag payload for one brick. */
export function brickPayload(kind: BrickKind, value: string): string {
  return `${kind}:${value}`
}

export interface ParsedBrick {
  readonly kind: BrickKind
  readonly value: string
}

/**
 * Parse a drop payload. An unknown kind, an unknown engine value, or a
 * malformed string is ignored instead of guessed.
 */
export function parseBrickPayload(payload: string): ParsedBrick | undefined {
  const separator = payload.indexOf(':')
  if (separator <= 0 || separator === payload.length - 1) return undefined
  const kind = payload.slice(0, separator)
  if (kind !== 'trigger' && kind !== 'step') return undefined
  const value = payload.slice(separator + 1)
  const catalog: readonly Brick[] = kind === 'trigger' ? TRIGGER_BRICKS : STEP_BRICKS
  return catalog.some((brick) => brick.value === value) ? { kind, value } : undefined
}
