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

/**
 * The destination a write command acts on, never a value argument or a printed
 * example. Quoted spans are masked first, so `-Path` text inside a quoted
 * `-Value` is invisible while a quoted destination is still resolved.
 */
/** Whether this character starts an escape in the active shell and quote. */
function isEscape(
  text: string,
  index: number,
  quote: string | undefined,
  powershell: boolean,
): boolean {
  const char = text[index] ?? ''
  if (quote === "'") return false
  if (char === '`') return powershell
  if (char !== '\\') return false
  // PowerShell keeps backslashes literal outside and inside double quotes.
  if (powershell) return false
  if (quote === '"') {
    const next = text[index + 1]
    return next === '"' || next === '\\' || next === '`' || next === '$'
  }
  return true
}

function maskQuoted(
  text: string,
  powershell: boolean,
): { masked: string; values: readonly string[] } {
  const values: string[] = []
  let masked = ''
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (isEscape(text, index, undefined, powershell)) {
      // An escaped operator is literal text; an escaped letter stays a letter.
      const next = text[index + 1] ?? ''
      masked += /[<>&|;`]/u.test(next) ? '\u0002' : next
      index += 2
      continue
    }
    if (char === "'") {
      // PowerShell single quotes are literal; only '' escapes a quote.
      let content = ''
      index += 1
      while (index < text.length) {
        const inner = text[index] ?? ''
        if (inner === "'" && text[index + 1] === "'") {
          content += "'"
          index += 2
          continue
        }
        if (inner === "'") {
          index += 1
          break
        }
        content += inner
        index += 1
      }
      masked += `\u0000${String(values.length)}\u0000`
      values.push(content)
      continue
    }
    if (char === '"') {
      // A backtick escapes here; a backslash only escapes a few characters,
      // so Windows path separators survive in a double-quoted destination.
      let content = ''
      index += 1
      while (index < text.length) {
        const inner = text[index] ?? ''
        if (inner === '`' && powershell) {
          content += text[index + 1] ?? ''
          index += 2
          continue
        }
        if (inner === '\\' && !powershell) {
          const next = text[index + 1] ?? ''
          if (next === '"' || next === '\\' || next === '`' || next === '$') {
            content += next
            index += 2
            continue
          }
          content += '\\'
          index += 1
          continue
        }
        if (inner === '"') {
          index += 1
          break
        }
        content += inner
        index += 1
      }
      masked += `\u0000${String(values.length)}\u0000`
      values.push(content)
      continue
    }
    masked += char
    index += 1
  }
  return { masked, values }
}

function resolveMasked(token: string, values: readonly string[]): string {
  const match = /^\u0000(\d+)\u0000$/u.exec(token)
  return match === null ? token : (values[Number(match[1])] ?? '')
}

function shellDestinations(command: string, powershell: boolean): string[] {
  const { masked, values } = maskQuoted(command, powershell)
  const destinations: string[] = []
  // Only a writer that starts the stage executes; a printed writer name does not.
  const atStart = masked.trimStart()
  const writer = /^(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b([\s\S]*)/iu.exec(atStart)
  const writerName =
    /^(Set-Content|Add-Content|Out-File|New-Item|tee)/iu.exec(atStart)?.[1]?.toLowerCase() ?? ''
  if (writer !== null) {
    const rest = writer[1] ?? ''
    const named = /-(?:Path|LiteralPath)\s+(\u0000\d+\u0000|\S+)/iu.exec(rest)
    if (named !== null) {
      destinations.push(resolveMasked(named[1] ?? '', values))
    } else {
      const tokens = rest.match(/\u0000\d+\u0000|[<>]+|[^><\s]+/gu) ?? []
      let skipValue = false
      let skipInput = false
      let positionals = 0
      for (const token of tokens) {
        if (/^\d*[<>]/u.test(token)) {
          skipInput = /^\d*</u.test(token)
          continue
        }
        if (skipInput) {
          skipInput = false
          continue
        }
        if (skipValue) {
          skipValue = false
          continue
        }
        if (
          /^-(?:Value|Credential|Encoding|Force|NoNewline|Stream|AsByteStream|ItemType)\b/iu.test(
            token,
          )
        ) {
          skipValue = /^-(?:Value|Credential|Encoding|Stream|ItemType)\b/iu.test(token)
          continue
        }
        if (token.startsWith('-')) continue
        // tee accepts several positional outputs; other writers take one path
        // and treat the remaining positionals as content or property values.
        if (writerName === 'tee' || positionals === 0) {
          destinations.push(resolveMasked(token, values))
        }
        positionals += 1
      }
    }
  }
  // Every real output target counts; duplication and null devices do not.
  for (const match of masked.matchAll(/>+\s*(\u0000\d+\u0000|[^><\s]+)/gu)) {
    const target = resolveMasked(match[1] ?? '', values)
    if (
      /^&\d+$/u.test(target) ||
      target === 'NUL' ||
      target === '/dev/null' ||
      /^\$null$/iu.test(target)
    ) {
      continue
    }
    destinations.push(target)
  }
  return destinations
}

interface ShellSegment {
  readonly text: string
  /** True for the right side of `||`, which a successful call did not run. */
  readonly skipped: boolean
}

/** Split shell text on separators that are outside quotes. */
function splitSegments(text: string, powershell: boolean): ShellSegment[] {
  const segments: ShellSegment[] = []
  let current = ''
  let quote: string | undefined
  let skipNext = false
  const push = (): boolean => {
    const skipped = skipNext
    segments.push({ text: current, skipped })
    current = ''
    skipNext = false
    return skipped
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (isEscape(text, index, quote, powershell)) {
      current += char + (text[index + 1] ?? '')
      index += 1
      continue
    }
    if (quote === "'" && char === "'" && text[index + 1] === "'") {
      current += "''"
      index += 1
      continue
    }
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (
      char === ';' ||
      char === '\n' ||
      char === '\r' ||
      (char === '&' && text[index + 1] === '&') ||
      char === '|'
    ) {
      const skippedBranch = push()
      if (char === '&' && text[index + 1] === '&') {
        index += 1
      } else if (char === '|') {
        if (text[index + 1] === '|') {
          skipNext = true
          index += 1
        } else {
          // A pipeline stage belongs to the branch it continues.
          skipNext = skippedBranch
        }
      }
      if (char === '\r' && text[index + 1] === '\n') index += 1
      continue
    }
    current += char
  }
  segments.push({ text: current, skipped: skipNext })
  return segments
}

/** Remove unquoted comments while keeping quoted text and its destinations. */
function stripComments(text: string, powershell: boolean): string {
  let output = ''
  let quote: string | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (isEscape(text, index, quote, powershell)) {
      output += char + (text[index + 1] ?? '')
      index += 1
      continue
    }
    if (quote === "'" && char === "'" && text[index + 1] === "'") {
      output += "''"
      index += 1
      continue
    }
    if (quote !== undefined) {
      output += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      output += char
      continue
    }
    if (char === '#' && (index === 0 || /[\s;&|]/u.test(text[index - 1] ?? ''))) {
      const newline = text.indexOf('\n', index)
      if (newline === -1) break
      output += '\n'
      index = newline
      continue
    }
    output += char
  }
  return output
}
/** Drop quotes and unquoted comments so only executed text is inspected. */
function executedText(text: string, powershell: boolean): string {
  let output = ''
  let quote: string | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (isEscape(text, index, quote, powershell)) {
      if (quote === undefined) output += char + (text[index + 1] ?? '')
      index += 1
      continue
    }
    if (quote === "'" && char === "'" && text[index + 1] === "'") {
      index += 1
      continue
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /[\s;&|]/u.test(text[index - 1] ?? ''))) {
      // A comment runs to the end of its line; later lines still execute.
      const newline = text.indexOf('\n', index)
      if (newline === -1) break
      index = newline
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
/** The changes one successful observation touched. */
function changesOfCall(workspace: string, call: ToolCallObservation): string[] {
  const changes = new Set<string>()
  const addChange = (name: string | undefined): void => {
    if (name !== undefined) changes.add(name)
  }
  const powershell = call.name === 'pwsh'
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
  const executable = stripComments(normalized, powershell)
  const executed = executedText(executable, powershell).trim()
  if (executed === '') return [...changes]
  // One shell call may execute several writes; each segment counts, and a
  // creation command can follow a read or a comment on an earlier line.
  for (const segment of splitSegments(executable, powershell)) {
    if (segment.skipped) continue
    const executedSegment = executedText(segment.text, powershell).trim()
    if (executedSegment === '') continue
    const creation = CHANGE_CREATION.exec(executedSegment)
    if (creation !== null) {
      addChange(creation[1])
      continue
    }
    // A writer must start the stage or follow a redirect; a printed writer name
    // in an argument does not execute anything.
    const writerAtStart = /^(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b/iu.test(
      executedSegment,
    )
    const hasRedirect = />/u.test(executedSegment)
    if (!writerAtStart && !hasRedirect) continue
    // The destination is parsed from the original text so a quoted path is kept.
    for (const raw of shellDestinations(segment.text, powershell)) {
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
