import type { GraphDefinition } from './graph.ts'
import type { Overlay } from './overlay.ts'

/**
 * Accessibility helpers for the canvas: the mode fallback, the screen-reader
 * summary, and the keyboard equivalents of drag and pointer actions. The
 * canvas is never the only surface; the same state feeds the list editor.
 */

export type Surface = 'canvas' | 'list'

/** Below this width the view defaults to the list editor. */
export const NARROW_WIDTH = 720

/** The tab order the view exposes: palette, canvas, then the property panel. */
export const TAB_ORDER = ['palette', 'canvas', 'properties'] as const

export const CLIENT_MODULE_FAILURE_NOTE =
  'A client-module evaluation failure is reported by the Harness loader; it happens before the view renders and is outside this in-view fallback.'

export function defaultMode(width: number): 'canvas' | 'list' {
  return width > 0 && width < NARROW_WIDTH ? 'list' : 'canvas'
}

/** A canvas render failure or an unavailable container falls back to the list. */
export function resolveSurface(
  requested: 'canvas' | 'list',
  canvasFailed: boolean,
  width: number,
): Surface {
  if (canvasFailed) return 'list'
  if (requested === 'list') return 'list'
  return defaultMode(width)
}

export function fallbackNotice(canvasFailed: boolean): string | undefined {
  return canvasFailed
    ? 'The canvas could not render; the list editor is showing and the definition stays editable.'
    : undefined
}

/** The bounded summary announced above the canvas; it follows the selection. */
export function summaryText(
  definition: GraphDefinition,
  selectedTitle?: string,
  overlay?: Overlay,
): string {
  const steps = definition.steps.length
  const trigger = String(definition.trigger.kind ?? 'unknown')
  const run = overlay?.run
  const runText =
    run === undefined
      ? 'no run selected'
      : `run ${run.status}${overlay?.versionsDiffer === true ? ' on another version' : ''}`
  const selected = selectedTitle === undefined ? '' : ` Selected: ${selectedTitle}.`
  return `Trigger ${trigger}. ${String(steps)} step${steps === 1 ? '' : 's'}. ${runText}.${selected}`
}

/** Enter and Space add the focused palette entry; native buttons click on both. */
export function isAddKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

/** `C` opens the labelled connect list for the selected node. */
export function isConnectKey(key: string): boolean {
  return key === 'c' || key === 'C'
}

/** The palette label the keyboard user hears for one step kind. */
export function paletteLabel(kind: string): string {
  return kind === 'step' ? 'Add step' : `Add ${kind}`
}

/** The canvas fallback must not touch the host: it is a client-only state. */
export function fallbackIsClientOnly(): true {
  return true
}
