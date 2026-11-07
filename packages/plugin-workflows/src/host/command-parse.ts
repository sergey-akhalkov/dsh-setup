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
const CONTROL = /[;&|><`\\\n\r]/u

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
  if (trimmed === '' || CONTROL.test(trimmed) || trimmed.includes('$')) return undefined
  const rest = stripPrefix(trimmed)
  if (rest === undefined) return undefined
  const tokens = rest.split(/\s+/u)
  if (tokens[0] !== 'openspec') return undefined
  if (tokens[1] === 'new' && tokens[2] === 'change' && tokens.length === 4) {
    const name = nameOf(tokens[3])
    return name === undefined ? undefined : { kind: 'create-change', name }
  }
  if (tokens[1] === 'archive' && tokens.length === 3) {
    const change = nameOf(tokens[2])
    return change === undefined ? undefined : { kind: 'archive', change }
  }
  return undefined
}
