import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/**
 * Verification gate: a code-changing turn cannot close until one configured
 * check command has succeeded after the last `edit` or `write` result. It is a
 * Host-only observer: no prompt section, no tool, no skill. An empty command
 * list makes it inert.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-verification-gate'

/** No services are read directly; every hook is an event observer. */
export const inject: string[] = []

/** The single fragment row this bundle owns. */
export const ROW_ID = 'dsh-setup-verification-gate'

/** Consecutive refusals allowed in one turn before the capped unverified close. */
export const DEFAULT_MAX_BLOCKS = 8

/** The source kind attributed to this gate's steering and notice messages. */
const SOURCE_KIND = 'verification-gate'

/** Upper bound in characters for one refusal or notice message. */
const MAX_MESSAGE_CHARS = 800

/** Upper bound in characters for the file path quoted in a message. */
const MAX_PATH_CHARS = 160

/** Accepted row shape repeated by every configuration error. */
const ACCEPTED_SHAPE =
  'accepted shape: { commands?: string[] of non-empty commands, maxBlocks?: positive integer (default 8) }'

/** Row configuration. Both fields are optional; absent means inert. */
export interface Config {
  /** Exact shell commands that satisfy the gate; empty or absent keeps it inert. */
  commands?: string[]
  /** Consecutive refusals allowed in one turn before the close is allowed (default 8). */
  maxBlocks?: number
}

/** Fully resolved configuration. */
export interface ResolvedConfig {
  readonly commands: readonly string[]
  readonly maxBlocks: number
}

/** Render an offending configuration value for one error message. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Build one fail-loud configuration error naming the row, the value, and the accepted shape. */
function configError(detail: string, value: unknown): Error {
  return new Error(
    `${name} (row "${ROW_ID}"): ${detail}; offending value: ${describeValue(value)}; ${ACCEPTED_SHAPE}`,
  )
}

/**
 * Validate the row configuration once, at load. An empty or absent `commands`
 * list is valid and leaves the gate inert; every malformed value throws.
 * @param raw - the loader-supplied config object, or undefined when the row has none.
 * @returns an immutable complete configuration.
 * @throws when a field is unknown, mistyped, or outside its accepted shape.
 */
export function resolveConfig(raw: unknown): ResolvedConfig {
  if (raw === undefined) {
    return Object.freeze({ commands: Object.freeze([]), maxBlocks: DEFAULT_MAX_BLOCKS })
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw configError('config must be an object', raw)
  }
  const record = raw as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'commands' && key !== 'maxBlocks') {
      throw configError(`unknown field ${JSON.stringify(key)}`, record[key])
    }
  }

  let commands: readonly string[] = Object.freeze([])
  const rawCommands = record.commands
  if (rawCommands !== undefined) {
    if (!Array.isArray(rawCommands)) {
      throw configError('`commands` must be an array of non-empty strings', rawCommands)
    }
    const values: string[] = []
    for (const entry of rawCommands) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        throw configError('every `commands` entry must be a non-empty string', entry)
      }
      values.push(entry.trim())
    }
    commands = Object.freeze(values)
  }

  let maxBlocks = DEFAULT_MAX_BLOCKS
  const rawMaxBlocks = record.maxBlocks
  if (rawMaxBlocks !== undefined) {
    if (
      typeof rawMaxBlocks !== 'number' ||
      !Number.isSafeInteger(rawMaxBlocks) ||
      rawMaxBlocks < 1
    ) {
      throw configError('`maxBlocks` must be a positive integer', rawMaxBlocks)
    }
    maxBlocks = rawMaxBlocks
  }
  return Object.freeze({ commands, maxBlocks })
}

/** One agent's in-memory observation state; never persisted. */
interface AgentState {
  /** Turn identity the refusal counter belongs to. */
  turn: number | null
  /** A successful `edit`/`write` is waiting for a satisfied check. */
  dirty: boolean
  /** Most recent successful `edit`/`write` target, for the refusal message. */
  lastWrite?: string
  /** Consecutive refusals in the current turn. */
  blocks: number
  /** The cap already allowed this turn to close. */
  allowedAnyway: boolean
  /** The last matched run's exit state could not be read. */
  matchedUnreadable: boolean
}

/** One steering or notice message's shape, borrowed from the live Agent contract. */
type GateMessage = Parameters<Agent['steer']>[0]

/** Detect a successful tool result whose shape the harness does not recognize. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when this is a subagent-origin session, which the gate never covers. */
function isSubagent(agent: Agent): boolean {
  return agent.session.header.origin === 'subagent'
}

/** Bound one already-sanitized string. */
function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Strip control characters from untrusted text. */
function stripControl(text: string): string {
  let stripped = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    stripped += character
  }
  return stripped
}

/** Strip control characters from untrusted text and bound its length. */
function clean(text: string, max: number): string {
  return bound(stripControl(text), max)
}

/** Build one frozen user message attributed to this gate. */
function gateMessage(text: string, summary?: string): GateMessage {
  const message = {
    id: randomUUID(),
    role: 'user' as const,
    content: Object.freeze([{ type: 'text' as const, text }]),
    source: Object.freeze(
      summary === undefined
        ? { kind: SOURCE_KIND }
        : { kind: SOURCE_KIND, form: 'notice' as const, summary: clean(summary, 120) },
    ),
  }
  return Object.freeze(message) as unknown as GateMessage
}

/** True when a write target is planning scratch or documentation, not code. */
function isIgnoredWrite(path: string): boolean {
  const normalized = path.replace(/\\/gu, '/')
  if (/\.md$/iu.test(normalized)) return true
  return /(?:^|\/)(?:\.dsh|\.tmp|node_modules|openspec)\//iu.test(normalized)
}

/**
 * Normalize one command for exact comparison: trim the edges, then remove at
 * most one leading `rtk ` token and the whitespace that follows it. Internal
 * whitespace is preserved, so quoted arguments must match character for
 * character.
 */
function trimCommand(raw: string): string {
  return raw.trim()
}

/** True when the called command is exactly one of the configured commands. */
function matchesConfigured(call: string, configured: readonly string[]): boolean {
  const trimmed = trimCommand(call)
  return configured.some((command) => {
    if (trimmed === command) return true
    if (!trimmed.startsWith('rtk ')) return false
    return trimmed.slice(4).trimStart() === command
  })
}

type ShellOutcome = 'success' | 'failure' | 'unreadable'

/**
 * Classify a matched shell result. Only a recognized canonical foreground
 * result with a clean exit satisfies; a missing field or foreign shape is
 * "unreadable" so the refusal can say the exit state could not be read, and
 * anything unreadable never satisfies the gate.
 */
function shellOutcome(value: unknown): ShellOutcome {
  if (!isRecord(value)) return 'unreadable'
  if (value.kind !== 'foreground') return 'unreadable'
  const exitCode = value.exitCode
  if (typeof exitCode !== 'number' && exitCode !== null) return 'unreadable'
  const signal = value.signal
  if (typeof signal !== 'string' && signal !== null) return 'unreadable'
  if (typeof value.timedOut !== 'boolean') return 'unreadable'
  if (typeof value.aborted !== 'boolean') return 'unreadable'
  let denied = false
  let runnerFailed = false
  if (value.sandbox !== undefined) {
    const sandbox = value.sandbox
    if (!isRecord(sandbox) || typeof sandbox.denied !== 'boolean') return 'unreadable'
    denied = sandbox.denied
    runnerFailed = sandbox.runnerFailed === true
  }
  if (
    exitCode === 0 &&
    signal === null &&
    value.timedOut === false &&
    value.aborted === false &&
    !denied &&
    !runnerFailed
  ) {
    return 'success'
  }
  return 'failure'
}

/** Build the refusal text for one stop attempt. */
function refusalText(configured: readonly string[], state: AgentState): string {
  const commands = configured.map((command) => `"${clean(command, 240)}"`).join(', ')
  const file = clean(state.lastWrite ?? 'unknown', MAX_PATH_CHARS)
  const lines = [
    `Verification gate (${SOURCE_KIND}) refused to close this code-changing turn: no configured check succeeded after the last code edit.`,
    `Commands: ${commands}`,
    `Last written file: ${file}`,
    `Next: run ${configured.map((command) => `"${clean(command, 240)}"`).join(' or ')} again after the last edit; only a matching foreground shell result with exit code 0 allows the close.`,
  ]
  if (state.matchedUnreadable) {
    lines.push(
      "The last matched run's exit state could not be read (expected a foreground shell result with exitCode, signal, timedOut, and aborted), so it cannot satisfy the gate.",
    )
  }
  lines.push('A text claim does not satisfy the gate.')
  return bound(lines.join('\n'), MAX_MESSAGE_CHARS)
}

/** Build the capped, unverified-close notice. */
function unverifiedText(configured: readonly string[], state: AgentState): string {
  const commands = configured.map((command) => `"${clean(command, 240)}"`).join(', ')
  return bound(
    [
      `Verification gate (${SOURCE_KIND}): this turn closes UNVERIFIED after ${state.blocks} consecutive refusals.`,
      `No configured check succeeded after the last code edit. Commands: ${commands}`,
      `Last written file: ${clean(state.lastWrite ?? 'unknown', MAX_PATH_CHARS)}`,
      `Next: run the command shown above and confirm it succeeds; the gate keeps counting until a matching foreground shell result with exit code 0 clears it.`,
    ].join('\n'),
    MAX_MESSAGE_CHARS,
  )
}

/**
 * Install the gate. Configuration is validated first; an empty command list
 * registers nothing, so the shipped default changes no behavior.
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = resolveConfig(config)
  if (resolved.commands.length === 0) return

  const states = new WeakMap<Agent, AgentState>()

  function stateFor(agent: Agent): AgentState {
    let state = states.get(agent)
    if (state === undefined) {
      state = {
        turn: null,
        dirty: false,
        blocks: 0,
        allowedAnyway: false,
        matchedUnreadable: false,
      }
      states.set(agent, state)
    }
    return state
  }

  /** Start a turn identity, resetting the cap counters only when it changes. */
  function beginTurn(state: AgentState, turn: number): void {
    if (state.turn === turn) return
    state.turn = turn
    state.blocks = 0
    state.allowedAnyway = false
    state.matchedUnreadable = false
  }

  /** Observe one write or shell result; never throws into tool dispatch. */
  function recordResult(
    agent: Agent,
    exec: Readonly<ToolExecution>,
    result: Readonly<ToolExecutionResult>,
  ): void {
    if (isSubagent(agent)) return
    const state = stateFor(agent)
    const value = result.isError ? undefined : isRecord(result.value) ? result.value : undefined

    if (exec.name === 'edit' || exec.name === 'write') {
      if (result.isError) return
      const path = typeof value?.path === 'string' ? value.path : undefined
      if (path === undefined || isIgnoredWrite(path)) return
      state.dirty = true
      state.lastWrite = path
      return
    }

    if (exec.name !== 'pwsh' && exec.name !== 'bash') return
    const args = isRecord(exec.arguments) ? exec.arguments : undefined
    const command = typeof args?.command === 'string' ? args.command : undefined
    if (command === undefined || !matchesConfigured(command, resolved.commands)) return
    if (result.isError) {
      state.matchedUnreadable = false
      return
    }
    const outcome = shellOutcome(result.value)
    if (outcome === 'success') {
      state.dirty = false
      state.matchedUnreadable = false
    } else {
      state.matchedUnreadable = outcome === 'unreadable'
    }
  }

  /** Refuse one close, or allow the capped close with an unverified notice. */
  function evaluateStop(agent: Agent, turn: number): void {
    if (isSubagent(agent)) return
    const state = stateFor(agent)
    beginTurn(state, turn)
    if (!state.dirty || state.allowedAnyway) return
    if (state.blocks >= resolved.maxBlocks) {
      state.allowedAnyway = true
      try {
        agent.inject(
          gateMessage(
            unverifiedText(resolved.commands, state),
            'verification-gate: unverified close',
          ),
        )
      } catch {
        // A disposed agent simply receives no notice.
      }
      return
    }
    state.blocks += 1
    try {
      agent.steer(gateMessage(refusalText(resolved.commands, state)))
    } catch {
      // A disposed agent simply receives no steering.
    }
  }

  ctx.on('agent/pre-step', (payload, next) => {
    try {
      if (!isSubagent(payload.agent)) beginTurn(stateFor(payload.agent), payload.turn)
    } catch {
      // An observer never fails the step.
    }
    return next()
  })

  ctx.on('tools/result', (exec, result) => {
    try {
      if (exec.agent !== undefined) recordResult(exec.agent, exec, result)
    } catch {
      // Observability never breaks tool dispatch.
    }
    return undefined
  })

  ctx.on('agent/turn-stopping', (payload) => {
    try {
      evaluateStop(payload.agent, payload.turn)
    } catch {
      // The gate never throws into the turn; a failed evaluation fails open.
    }
  })
}
