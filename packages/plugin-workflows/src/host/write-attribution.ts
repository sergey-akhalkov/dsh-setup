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
const SHELL_REDIRECT =
  /(?:^|[\s;&|])>{1,2}\s*(['"]?)([^'"\s;&|]*openspec[\\/]changes[\\/][a-z0-9-]+[\\/][^'"\s;&|]*)\1/iu

/**
 * The destination a write command acts on, never a value argument or a printed
 * example. `-Path`/`-LiteralPath` wins; otherwise the first positional token
 * that is not an option or a `-Value` argument.
 */
function shellDestination(command: string): string | undefined {
  const redirect = SHELL_REDIRECT.exec(command)
  if (redirect !== null) return redirect[2]
  const write = /(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b([\s\S]*)/iu.exec(command)
  if (write === null) return undefined
  const rest = write[1] ?? ''
  const named = /-(?:Path|LiteralPath)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/iu.exec(rest)
  if (named !== null) return named[1] ?? named[2] ?? named[3]
  const tokens = rest.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []
  let skipValue = false
  for (const token of tokens) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (
      /^-(?:Value|Credential|Encoding|Force|NoNewline|Stream|AsByteStream|ItemType)\b/iu.test(token)
    ) {
      skipValue = /^-(?:Value|Credential)\b/iu.test(token)
      continue
    }
    if (token.startsWith('-')) continue
    return token.replace(/^["']|["']$/gu, '')
  }
  return undefined
}

/** Drop quotes and unquoted comments so only executed text is inspected. */
function executedText(text: string): string {
  let output = ''
  let quote: string | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /[\s;&|]/u.test(text[index - 1] ?? ''))) {
      break
    }
    output += char
  }
  return output
}

const WRITE_COMMAND = /(?:^|[;&|]|\|)\s*(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b/iu
const REDIRECT = /(?:^|[\s;&|])>{1,2}/u

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
/** The changes one successful observation touched. */
function changesOfCall(workspace: string, call: ToolCallObservation): string[] {
  const changes = new Set<string>()
  const addChange = (name: string | undefined): void => {
    if (name !== undefined) changes.add(name)
  }
  const rawPath = call.arguments.file_path ?? call.arguments.path
  if ((call.name === 'write' || call.name === 'edit') && typeof rawPath === 'string') {
    const rel = normalizedWorkspacePath(workspace, rawPath)
    if (
      rel !== undefined &&
      /^openspec\/changes\/[^/]+\//u.test(rel) &&
      !/\/reviews\//u.test(rel)
    ) {
      addChange(/^openspec\/changes\/([^/]+)\//u.exec(rel)?.[1])
    }
  }
  const command = call.arguments.command
  if (typeof command !== 'string') return [...changes]
  const normalized = command.replace(/\b(?:rtk|pnpm exec)\s+/gu, '').trim()
  const workdir =
    typeof call.arguments.workdir === 'string'
      ? call.arguments.workdir
      : typeof call.arguments.cwd === 'string'
        ? call.arguments.cwd
        : undefined
  if (workdir !== undefined && !isWorkspaceDirectory(workspace, workdir)) {
    return [...changes]
  }
  const executed = executedText(normalized).trim()
  if (executed === '') return [...changes]
  const creationPattern = new RegExp(CHANGE_CREATION.source, 'gu')
  for (const match of executed.matchAll(creationPattern)) addChange(match[1])
  // One shell call may execute several writes; each destination counts.
  for (const segment of normalized.split(/(?:;|&&|\|\|)/u)) {
    const executedSegment = executedText(segment).trim()
    if (executedSegment === '') continue
    if (!WRITE_COMMAND.test(executedSegment) && !REDIRECT.test(executedSegment)) continue
    // The destination is parsed from the original text so a quoted path is kept.
    const raw = shellDestination(segment)
    if (raw === undefined) continue
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
      addChange(/^openspec\/changes\/([^/]+)\//u.exec(rel)?.[1])
    }
  }
  return [...changes]
}

/**
 * Every change this turn made, from successful write/edit observations and the
 * documented creation and shell-write commands. A turn may touch more than one.
 */
export function attributedChangeNames(
  workspace: string,
  calls: readonly ToolCallObservation[],
  turn: number | undefined,
): string[] {
  const changes = new Set<string>()
  for (const call of calls) {
    if (turn !== undefined && call.turn !== undefined && call.turn !== turn) continue
    if (call.ok === false) continue
    for (const change of changesOfCall(workspace, call)) changes.add(change)
  }
  return [...changes]
}

/** The latest change this turn made, for callers that need one. */
export function attributedChangeName(
  workspace: string,
  calls: readonly ToolCallObservation[],
  turn: number | undefined,
): string | undefined {
  return attributedChangeNames(workspace, calls, turn).at(-1)
}
