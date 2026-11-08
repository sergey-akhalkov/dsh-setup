/**
 * The deterministic shell command parser for the two OpenSpec actions the
 * workflow gates enforce. It accepts only the three documented invocation
 * forms and a single validated change name; a compound command, extra token,
 * shell control character, or unparseable name is not matched. The archive gate
 * and the file watcher are the backstop for a bypass, not this parser.
 */

export type OpenspecIntent =
  | { readonly kind: 'create-change'; readonly name: string }
  | { readonly kind: 'archive'; readonly change: string }

/** A change name as the interpolation and draft path rules require it. */
export const CHANGE_NAME = /^[a-z0-9][a-z0-9-]*$/u

/** Shell control characters that make a compound or redirected command. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: a newline or control byte is a compound command
const CONTROL = /[\u0000-\u001f`;&|><]/u

/** Whether the command carries a shell control, quote escape, or substitution. */
function isCompound(trimmed: string): boolean {
  return (
    trimmed === '' ||
    CONTROL.test(trimmed) ||
    trimmed.includes(String.fromCharCode(92)) ||
    trimmed.includes('$')
  )
}

/** Strip one allowed invocation prefix. */
function stripPrefix(command: string): string | undefined {
  const match = /^(?:(?:rtk\s+)|(?:pnpm\s+exec\s+))?(openspec\s+.*)$/u.exec(command)
  if (match === null) return undefined
  return match[1]
}

/** Remove one symmetric quote pair, or fail when the token is not quoted. */
function unquote(token: string): string | undefined {
  if (token.length < 2) return undefined
  const first = token[0]
  if (first !== '"' && first !== "'") return undefined
  if (token.at(-1) !== first) return undefined
  const inner = token.slice(1, -1)
  if (inner.includes(first) || /["']/u.test(inner)) return undefined
  return inner
}

/** A non-empty validated change name token. */
function nameOf(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  const unquoted = unquote(token)
  const name = unquoted ?? token
  return CHANGE_NAME.test(name) ? name : undefined
}

/**
 * Parse one shell command. Returns undefined for anything that is not exactly
 * one documented, unquoted-name `openspec new change` or `openspec archive`.
 */
export function parseOpenspecCommand(command: string): OpenspecIntent | undefined {
  const trimmed = command.trim()
  if (isCompound(trimmed)) return undefined
  const rest = stripPrefix(trimmed)
  if (rest === undefined) return undefined
  const tokens = rest.split(/\s+/u)
  if (tokens[0] !== 'openspec') return undefined
  if (tokens[1] === 'new' && tokens[2] === 'change' && tokens.length === 4) {
    const name = nameOf(tokens[3])
    return name === undefined ? undefined : { kind: 'create-change', name }
  }
  if (tokens[1] === 'archive' && tokens.length >= 3) {
    const change = nameOf(tokens[2])
    if (change === undefined) return undefined
    if (tokens.slice(3).some((token) => !token.startsWith('-'))) return undefined
    return { kind: 'archive', change }
  }
  return undefined
}

export interface ArchiveIntent {
  readonly kind: 'archive'
  readonly change: string
  readonly form: 'openspec' | 'mv' | 'Move-Item' | 'git'
}

/** The archive directory a move must target. */
export const ARCHIVE_DIR = 'openspec/changes/archive'

function unquotedPath(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  const withoutQuotes = token.replace(/^['"]|['"]$/gu, '').replaceAll('\\', '/')
  const absolute = withoutQuotes.startsWith('/')
  const parts = withoutQuotes.split('/').filter((part) => part !== '' && part !== '.')
  return `${absolute ? '/' : ''}${parts.join('/')}`
}

function changeUnderChanges(path: string): string | undefined {
  const match = /^openspec\/changes\/([^/]+)$/u.exec(path)
  const name = match?.[1]
  return name !== undefined && CHANGE_NAME.test(name) ? name : undefined
}

function targetsArchive(destination: string): boolean {
  if (destination === ARCHIVE_DIR) return true
  return new RegExp(`^${ARCHIVE_DIR}/[^/]+$`, 'u').test(destination)
}

function workspaceRelative(path: string, workspace: string | undefined): string | undefined {
  if (workspace === undefined) return path
  const normalized = path.replaceAll('\\', '/')
  const root = workspace.replaceAll('\\', '/').replace(/\/+$/u, '')
  const fold = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value
  if (fold(normalized) === fold(root)) return ''
  if (fold(normalized).startsWith(`${fold(root)}/`)) return normalized.slice(root.length + 1)
  if (/^[A-Za-z]:\//u.test(normalized) || normalized.startsWith('/')) return undefined
  return normalized
}

function archiveMove(
  source: string | undefined,
  destination: string | undefined,
  form: ArchiveIntent['form'],
  workspace?: string,
): ArchiveIntent | undefined {
  const relativeSource = source === undefined ? undefined : workspaceRelative(source, workspace)
  const relativeDestination =
    destination === undefined ? undefined : workspaceRelative(destination, workspace)
  const name = relativeSource === undefined ? undefined : changeUnderChanges(relativeSource)
  if (
    name === undefined ||
    relativeDestination === undefined ||
    !targetsArchive(relativeDestination)
  ) {
    return undefined
  }
  return { kind: 'archive', change: name, form }
}

/**
 * Parse an archive action: the documented `openspec archive <name>` form, or a
 * move of `openspec/changes/<name>` into `openspec/changes/archive/` through
 * `mv`, PowerShell `Move-Item`, or `git mv`. A compound command, another
 * destination, or an unparseable name is not an archive.
 */
export function parseArchiveCommand(
  command: string,
  workspace?: string,
): ArchiveIntent | undefined {
  const trimmed = command.trim()
  // Moves carry Windows paths, so a backslash is data here; control characters are not.
  if (trimmed === '' || CONTROL.test(trimmed)) return undefined
  const openspec = parseOpenspecCommand(trimmed)
  if (openspec?.kind === 'archive') {
    return { kind: 'archive', change: openspec.change, form: 'openspec' }
  }
  const tokens = trimmed.split(/\s+/u)
  const mvIndex = tokens[0] === 'git' && tokens[1] === 'mv' ? 2 : tokens[0] === 'mv' ? 1 : 0
  if (mvIndex > 0) {
    const positional = tokens
      .slice(mvIndex)
      .filter((token) => token !== '--' && !token.startsWith('-'))
    if (positional.length !== 2) return undefined
    return archiveMove(
      unquotedPath(positional[0]),
      unquotedPath(positional[1]),
      mvIndex === 2 ? 'git' : 'mv',
      workspace,
    )
  }
  if (/^move-item$/iu.test(tokens[0] ?? '')) {
    const positional: string[] = []
    const flags = new Map<string, string>()
    const switches = new Set(['-force', '-verbose', '-whatif', '-confirm'])
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index] ?? ''
      if (token === '--') continue
      if (token.startsWith('-')) {
        const name = token.toLowerCase()
        if (switches.has(name)) continue
        const value = tokens[index + 1]
        if (value === undefined || value.startsWith('-')) return undefined
        flags.set(name, value)
        index += 1
      } else {
        positional.push(token)
      }
    }
    let source = flags.get('-literalpath') ?? flags.get('-path')
    let destination = flags.get('-destination') ?? flags.get('-dest')
    if (source === undefined) source = positional.shift()
    if (destination === undefined) destination = positional.shift()
    if (positional.length > 0) return undefined
    return archiveMove(unquotedPath(source), unquotedPath(destination), 'Move-Item', workspace)
  }
  return undefined
}
