import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/**
 * Row configuration for the durable memory export. Every field is optional and
 * documented in `docs/hindsight.md`; omission selects the documented default.
 */
export interface ExportConfig {
  /** Export at all (default true). Disabling stops every write and Git command. */
  enabled?: boolean
  /** Repository directory; the machine-local file wins over this value. */
  dir?: string
  /** Minutes between automatic exports (default 5). */
  intervalMinutes?: number
  /** Commit a changed snapshot (default true). */
  autoCommit?: boolean
  /** Push after a commit when a remote is configured (default true). */
  autoPush?: boolean
  /** Carry the operational history section (default false). */
  includeHistory?: boolean
  /** Carry attachment rows and bytes (default false). */
  includeAttachments?: boolean
  /**
   * Report an empty memory server so the manual restore path stays discoverable
   * (default false). Informational only: it never imports; `restore-hindsight.ps1` does.
   */
  importOnEmpty?: boolean
}

/** Machine-local overrides: the target directory and remote never enter a tracked file. */
export interface MachineExportConfig extends ExportConfig {
  /** Private Git remote; the only place a remote is configured. */
  remote?: string
}

/** Fully resolved export settings; the exporter never runs on partial values. */
export interface ResolvedExportConfig {
  readonly enabled: boolean
  readonly dir: string
  readonly remote?: string
  readonly intervalMinutes: number
  readonly autoCommit: boolean
  readonly autoPush: boolean
  readonly includeHistory: boolean
  readonly includeAttachments: boolean
  readonly importOnEmpty: boolean
}

/** Documented defaults: on, every five minutes, no history, no attachments. */
export const DEFAULT_EXPORT_CONFIG = Object.freeze({
  enabled: true,
  intervalMinutes: 5,
  autoCommit: true,
  autoPush: true,
  includeHistory: false,
  includeAttachments: false,
  importOnEmpty: false,
})

/** Name of the machine-local export file inside the Harness home. */
export const EXPORT_CONFIG_FILE = 'hindsight-export.json'

/** The Harness home; a throwaway `DSH_HOME` keeps tests off the live profile. */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Path of the machine-local file; `HINDSIGHT_EXPORT_CONFIG` overrides it like the upstream config. */
export function machineExportConfigPath(): string {
  return process.env.HINDSIGHT_EXPORT_CONFIG ?? join(dshHome(), EXPORT_CONFIG_FILE)
}

/** Read the machine-local file; invalid or missing content means no overrides. */
export function readMachineExportConfig(
  path: string = machineExportConfigPath(),
): MachineExportConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as MachineExportConfig
  } catch {
    return {}
  }
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_EXPORT_CONFIG.intervalMinutes
}

function pickText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** The machine-local file outranks the row, which outranks the defaults. */
export function resolveExportConfig(
  config: ExportConfig = {},
  machine: MachineExportConfig = readMachineExportConfig(),
  home: string = homedir(),
): ResolvedExportConfig {
  const dir = pickText(machine.dir) ?? pickText(config.dir) ?? join(home, 'hindsight-export')
  return {
    enabled: pickBoolean(
      machine.enabled,
      pickBoolean(config.enabled, DEFAULT_EXPORT_CONFIG.enabled),
    ),
    dir: resolve(dir),
    remote: pickText(machine.remote),
    intervalMinutes: pickMinutes(machine.intervalMinutes ?? config.intervalMinutes),
    autoCommit: pickBoolean(
      machine.autoCommit,
      pickBoolean(config.autoCommit, DEFAULT_EXPORT_CONFIG.autoCommit),
    ),
    autoPush: pickBoolean(
      machine.autoPush,
      pickBoolean(config.autoPush, DEFAULT_EXPORT_CONFIG.autoPush),
    ),
    includeHistory: pickBoolean(
      machine.includeHistory,
      pickBoolean(config.includeHistory, DEFAULT_EXPORT_CONFIG.includeHistory),
    ),
    includeAttachments: pickBoolean(
      machine.includeAttachments,
      pickBoolean(config.includeAttachments, DEFAULT_EXPORT_CONFIG.includeAttachments),
    ),
    importOnEmpty: pickBoolean(
      machine.importOnEmpty,
      pickBoolean(config.importOnEmpty, DEFAULT_EXPORT_CONFIG.importOnEmpty),
    ),
  }
}

function normalized(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Whether a directory sits inside the Harness home or the Hindsight database
 * root. Both were wiped together once, so an export there proves nothing.
 */
export function isForbiddenExportDir(dir: string, home: string = homedir()): boolean {
  const target = normalized(dir)
  const roots = [process.env.DSH_HOME ?? join(home, '.dsh'), join(home, '.pg0')]
  return roots.some((root) => {
    const prefix = normalized(root)
    return target === prefix || target.startsWith(prefix + sep)
  })
}
