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

const CHANGE_CREATION =
  /(?:^|[;&|]\s*)openspec(?:\.cmd|\.exe)?\s+new\s+change\s+([a-z0-9][a-z0-9-]*)/u
const SHELL_WRITE =
  /(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b[^;&|]*?(['"]?)([^'"\s;&|]*openspec[\\/]changes[\\/][a-z0-9-]+[\\/][^'"\s;&|]*)\1/iu
const SHELL_REDIRECT =
  /(?:^|[\s;&|])>{1,2}\s*(['"]?)([^'"\s;&|]*openspec[\\/]changes[\\/][a-z0-9-]+[\\/][^'"\s;&|]*)\1/iu
const PRINT_ONLY = /^\s*(?:Write-Output|Write-Host|Write-Debug|Write-Verbose|echo)\b/iu

/** Drop quoted spans so a printed example is not read as an executed command. */
function unquoted(text: string): string {
  let output = ''
  let quote: string | undefined
  for (const char of text) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    output += char
  }
  return output
}

/** Whether a directory is the workspace root or one of its descendants. */
export function isWorkspaceDirectory(workspace: string, directory: string): boolean {
  const root = resolve(workspace)
  const rel = relative(root, resolve(directory)).replaceAll('\\', '/')
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

/**
 * The change this turn made, from a successful write/edit of its artifacts or
 * the documented successful `openspec new change <name>` creation command. A
 * session that creates a change through the shell is involved too.
 */
export function attributedChangeName(
  workspace: string,
  calls: readonly ToolCallObservation[],
  turn: number | undefined,
): string | undefined {
  const written = attributedSpecWrite(workspace, calls, turn)
  if (written !== undefined) {
    return /^openspec\/changes\/([^/]+)\//u.exec(written)?.[1]
  }
  for (const call of [...calls].reverse()) {
    if (turn !== undefined && call.turn !== undefined && call.turn !== turn) continue
    if (call.ok === false) continue
    const command = call.arguments.command
    if (typeof command !== 'string') continue
    const normalized = command.replace(/\b(?:rtk|pnpm exec)\s+/gu, '').trim()
    const workdir =
      typeof call.arguments.workdir === 'string'
        ? call.arguments.workdir
        : typeof call.arguments.cwd === 'string'
          ? call.arguments.cwd
          : undefined
    if (workdir !== undefined && !isWorkspaceDirectory(workspace, workdir)) {
      continue
    }
    const creation = CHANGE_CREATION.exec(normalized)
    if (creation !== null) return creation[1]
    const bare = unquoted(normalized)
    // A print-only command is not a write unless it redirects into a file. The
    // destination is matched on the original text so a quoted path is kept.
    if (PRINT_ONLY.test(bare) && !/(?:^|[\s;&|])>{1,2}/u.test(bare)) continue
    const shellWrite = SHELL_WRITE.exec(normalized) ?? SHELL_REDIRECT.exec(normalized)
    if (shellWrite !== null) {
      const raw = shellWrite[2] ?? ''
      const candidate =
        isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw)
          ? raw
          : workdir === undefined
            ? raw
            : resolve(workdir, raw)
      const rel = normalizedWorkspacePath(workspace, candidate)
      if (
        rel !== undefined &&
        /^openspec\/changes\/[^/]+\//u.test(rel) &&
        !/\/reviews\//u.test(rel)
      ) {
        return /^openspec\/changes\/([^/]+)\//u.exec(rel)?.[1]
      }
    }
  }
  return undefined
}
