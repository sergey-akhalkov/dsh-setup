/** Configurable question foreground wait: derive the timed ask-user row of every preset. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'

/** Row configuration shipped by the setup bundle; the settings file overrides it. */
export interface Config {
  /** Ask with the timed definition, whose pending result releases the turn. */
  timed?: boolean
  /** Foreground wait in seconds before the timed question returns pending. */
  timeout?: number
}

export const name = '@dsh-setup/plugin-question-timeout'

/** Resolved options. */
export interface Options {
  readonly timed: boolean
  readonly timeout: number
}

/** One editable preset entry as the Host config editor reports it. */
export interface PresetConfiguration {
  readonly entry: { readonly options: { readonly id: string } }
  readonly inherited: Record<string, unknown>
  readonly override: Record<string, unknown>
}

/** The part of the Host config editor this plugin uses. */
export interface ConfigEditorLike {
  configuration(): readonly PresetConfiguration[]
  edit(
    entry: PresetConfiguration['entry'],
    change: (
      current: Record<string, unknown>,
      inherited: Record<string, unknown>,
    ) => Record<string, unknown>,
  ): Promise<void>
}

/** What the plugin wrote for one preset: the config it wrote and the one it replaced. */
export interface Owned {
  readonly wrote: string
  readonly from?: string
}

/** The watched settings file: user knobs plus the ownership record the plugin maintains. */
export interface SettingsFile {
  timed?: boolean
  timeout?: number
  managed?: Record<string, Owned>
}

/** The optional reload service, used only to leave an enclosing HMR transaction. */
interface HmrLike {
  readonly executing?: { exit?<T>(callback: () => T): T }
}

const ASK_TOOL = 'tool-ask-user'
const PRESET_PREFIX = 'preset-'
const DEFAULT_TIMEOUT = 300
const FILE = '.dsh-setup-question-timeout.json'
const LOGGER = 'dsh-setup-question-timeout'

/** Resolve options with their documented defaults. */
export function resolveOptions(config: Config = {}): Options {
  const timeout = config.timeout
  return {
    timed: config.timed ?? true,
    timeout:
      Number.isInteger(timeout) && (timeout as number) > 0 ? (timeout as number) : DEFAULT_TIMEOUT,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stable content hash of one preset config. */
export function configHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Read the settings file; a missing or unreadable file yields the shipped defaults. */
export function readSettings(directory: string): SettingsFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(directory, FILE), 'utf8'))
    return isRecord(parsed) ? (parsed as SettingsFile) : {}
  } catch {
    return {}
  }
}

/** The exact file content a settings value serializes to. */
export function serializeSettings(value: SettingsFile): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Replace the settings file atomically; a failed write leaves the previous record intact. */
export function writeSettings(directory: string, value: SettingsFile): boolean {
  const target = join(directory, FILE)
  const temporary = `${target}.tmp`
  try {
    writeFileSync(temporary, serializeSettings(value))
    renameSync(temporary, target)
    return true
  } catch {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Nothing left to clean up.
    }
    // The caller decides whether an edit may proceed without a durable record.
    return false
  }
}

/** The child list with the ask-user row set for the options, or undefined when it has no such row. */
export function timedPlugins(plugins: unknown, options: Options): unknown[] | undefined {
  if (!Array.isArray(plugins)) return undefined
  const found = plugins.some((row) => isRecord(row) && row.id === ASK_TOOL)
  if (!found) return undefined
  if (!options.timed) return plugins
  return plugins.map((row) => {
    if (!isRecord(row) || row.id !== ASK_TOOL) return row
    return { ...row, config: { mode: 'timed', timeout: options.timeout } }
  })
}

/**
 * The declaration the plugin wants: the installed one with the ask row timed, or the installed one
 * unchanged when timed is off. Returns undefined when the declaration carries no question row.
 */
export function derivedConfig(
  inherited: Record<string, unknown>,
  options: Options,
): Record<string, unknown> | undefined {
  const plugins = timedPlugins(inherited.plugins, options)
  return plugins === undefined ? undefined : { ...inherited, plugins }
}

/** Whether the plugin may rewrite the config a preset currently shows. */
export function owned(
  current: Record<string, unknown>,
  inherited: Record<string, unknown>,
  managed: Record<string, Owned>,
  id: string,
): boolean {
  if (Object.keys(current).length === 0) return true
  if (isDeepStrictEqual(current, inherited)) return true
  const hash = configHash(current)
  const record = managed[id]
  return record?.wrote === hash || record?.from === hash
}

/** Whether the settings already reached the state the options ask for. */
function settled(
  snapshot: Record<string, unknown>,
  inherited: Record<string, unknown>,
  options: Options,
): boolean {
  const derived = derivedConfig(inherited, options)
  if (derived === undefined) return Object.keys(snapshot).length === 0
  return (
    isDeepStrictEqual(derived, snapshot) ||
    (Object.keys(snapshot).length === 0 && isDeepStrictEqual(derived, inherited))
  )
}

/**
 * Derive the timed row of every preset through the Host config editor. Ownership for the exact
 * configuration is persisted before that configuration leaves the callback, so an interrupted or
 * rejected profile write re-derives instead of adopting a stale row or treating the plugin's own
 * override as foreign.
 */
export async function derive(
  editor: ConfigEditorLike,
  options: Options,
  settings: SettingsFile,
  persist: (managed: Record<string, Owned>, applied: Options) => boolean,
  logger?: { info?(message: string): void; warn?(message: string): void },
): Promise<void> {
  const managed: Record<string, Owned> = { ...settings.managed }
  for (const configuration of editor.configuration()) {
    const id = configuration.entry.options.id
    if (!id.startsWith(PRESET_PREFIX)) continue
    const derived = derivedConfig(configuration.inherited, options)
    if (derived === undefined && managed[id] === undefined) continue
    const snapshot = configuration.override
    if (!owned(snapshot, configuration.inherited, managed, id)) {
      logger?.info?.(`preset ${id} keeps its own profile override`)
      continue
    }
    if (settled(snapshot, configuration.inherited, options)) continue
    const previous = managed[id]
    let wrote: Record<string, unknown> | undefined
    let aborted = false
    const revert = (): void => {
      if (previous === undefined) delete managed[id]
      else managed[id] = previous
    }
    try {
      await editor.edit(configuration.entry, (current, inherited) => {
        if (!owned(current, inherited, managed, id)) {
          aborted = true
          return current
        }
        const next = derivedConfig(inherited, options) ?? inherited
        managed[id] = { wrote: configHash(next), from: configHash(current) }
        if (!persist(managed, options)) {
          revert()
          aborted = true
          return current
        }
        wrote = next
        return next
      })
    } catch (error) {
      revert()
      persist(managed, options)
      logger?.warn?.(`preset ${id}: ${(error as Error).message}`)
      continue
    }
    if (aborted) {
      logger?.info?.(`preset ${id} keeps its own profile override`)
      continue
    }
    if (wrote === undefined) {
      revert()
      persist(managed, options)
      logger?.info?.(`preset ${id} keeps its own profile override`)
      continue
    }
    if (derived === undefined || isDeepStrictEqual(wrote, configuration.inherited)) {
      delete managed[id]
      persist(managed, options)
    }
  }
}
/** Read options from the row config overlaid by the settings file. */
export function optionsFrom(settings: SettingsFile, config: Config = {}): Options {
  return resolveOptions({
    timed: settings.timed ?? config.timed,
    timeout: settings.timeout ?? config.timeout,
  })
}

/** Derive the timed row of every preset and follow the settings file for later changes. */
export function apply(ctx: Context, config: Config = {}): void {
  const logger = ctx.logger?.(LOGGER)
  const editor = ctx.get('configEditor') as ConfigEditorLike | undefined
  if (editor === undefined) {
    logger?.warn('configEditor is unavailable; preset rows are left untouched')
    return
  }
  const directory = (ctx.get('profileContext') as { dir?: string } | undefined)?.dir
  if (directory === undefined) {
    logger?.warn('the profile directory is unavailable; preset rows are left untouched')
    return
  }
  const hmr = ctx.get('hmr') as HmrLike | undefined
  // Outside the HMR transaction that may have activated this row: its async context sticks to
  // timers and made the editor refuse a nested transaction during a dev reload.
  const outside = <T>(callback: () => T): T =>
    hmr?.executing?.exit === undefined ? callback() : hmr.executing.exit(callback)
  const file = join(directory, FILE)
  if (!existsSync(file)) {
    writeSettings(directory, optionsFrom(readSettings(directory), config))
  }
  let lastWritten: string | undefined
  const persist = (managed: Record<string, Owned>, applied: Options): boolean => {
    const current = readSettings(directory)
    const resolved = optionsFrom(current, config)
    const value = {
      timed: current.timed ?? resolved.timed,
      timeout: current.timeout ?? resolved.timeout,
      managed,
    }
    const written = serializeSettings(value)
    const ok = writeSettings(directory, value)
    if (ok) {
      lastWritten = written
      // A save that landed while this run was in flight is not applied yet.
      if (resolved.timed !== applied.timed || resolved.timeout !== applied.timeout) stale = true
    }
    return ok
  }
  let running = false
  let again = false
  let stale = false
  const run = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      const settings = readSettings(directory)
      await derive(editor, optionsFrom(settings, config), settings, persist, logger)
    } catch (error) {
      logger?.warn(`preset rows were not updated: ${(error as Error).message}`)
    } finally {
      running = false
      if (again || stale) {
        again = false
        stale = false
        void run()
      }
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      outside(() => void run())
    }, 0)
  }
  ctx.effect(() => {
    schedule()
    const watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (filename !== FILE) return
      // Our own ownership write is not a user save: re-running on it would loop a failed edit.
      if (lastWritten !== undefined) {
        try {
          if (readFileSync(join(directory, FILE), 'utf8') === lastWritten) return
        } catch {
          // A vanished file still deserves a run.
        }
      }
      schedule()
    })
    return () => {
      watcher.close()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, 'question-timeout: settings file')
}
