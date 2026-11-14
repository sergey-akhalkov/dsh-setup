import { isAbsolute, relative, resolve } from 'node:path'
import type { ToolCallObservation } from './evidence.js'

/**
 * Attribute this turn's successful OpenSpec writes before the debounced filesystem
 * watcher delivers its event. Paths are resolved against the workspace and
 * normalized so an absolute or `./` form cannot bypass the change attribution.
 */

/** A workspace-relative slash path for one observed write path, or undefined. */
export function normalizedWorkspacePath(workspace: string, raw: string): string | undefined {
  const root = resolve(workspace)
  const absolute = isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw)
  const candidate = absolute ? resolve(raw) : resolve(root, raw)
  const rel = relative(root, candidate).replaceAll('\\', '/')
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return undefined
  return rel
}

/**
 * The latest successful change-artifact write this turn, as a normalized
 * workspace-relative path. A failed, review, or out-of-workspace write is not
 * an attribution.
 */
export function attributedSpecWrite(
  workspace: string,
  calls: readonly ToolCallObservation[],
  turn: number | undefined,
): string | undefined {
  for (const call of [...calls].reverse()) {
    if (turn !== undefined && call.turn !== undefined && call.turn !== turn) continue
    if (call.name !== 'write' && call.name !== 'edit') continue
    if (call.ok === false) continue
    const raw = call.arguments.file_path ?? call.arguments.path
    if (typeof raw !== 'string') continue
    const rel = normalizedWorkspacePath(workspace, raw)
    if (rel === undefined) continue
    if (!/^openspec\/changes\/[^/]+\//u.test(rel)) continue
    if (/\/reviews\//u.test(rel)) continue
    return rel
  }
  return undefined
}
