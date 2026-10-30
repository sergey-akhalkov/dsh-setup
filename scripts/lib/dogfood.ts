/**
 * Pure helpers for the owner-profile dogfood check.
 *
 * The dogfood command installs the setup into a throwaway copy of the running
 * machine's Desktop profile, then proves three things from the composed
 * `--dump-config` output:
 *
 * 1. the installer appended only the bundles it owns and kept the setup last;
 * 2. every row the owner patched still resolves to the same effective config;
 * 3. the setup's defaults apply wherever the owner patch does not override them.
 *
 * Nothing here reads or writes the live profile; the caller owns snapshotting
 * and all process work. Keeping the comparisons pure makes the exact failure
 * messages unit-testable without a Harness install.
 */

import { parse } from 'yaml'

/** The setup bundle name appended last by the installer. */
export const SETUP_BUNDLE = '@dsh-setup/setup'

/**
 * Adapter rows the setup retired: a profile that still targets one may compose
 * without the row, and the owner-row check reports that retirement instead of
 * failing on the disappearance.
 */
export const RETIRED_ADAPTER_ROWS: ReadonlySet<string> = new Set([
  'dsh-setup-nuphus-mcp',
  'dsh-setup-serena',
])

/** Profile directory name used for the throwaway copy. Never `desktop`. */
export const DOGFOOD_PROFILE = 'owner-copy'

/** Minimal shape of a profile manifest the checks need. */
export interface DogfoodProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** Bundle selection recorded in a profile manifest. */
export function readBundles(manifest: DogfoodProfileManifest): string[] {
  return [...(manifest.dsh?.profile?.bundles ?? [])]
}

/** Host directories the owner profile copy needs to install and compose like the real one. */
export const PROFILE_COPY_FILES = [
  'package.json',
  'cordis.patch.yml',
  'cordis.yml',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.npmrc',
] as const

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Top-level row ids a patch file documents.
 *
 * The patch format is a top-level YAML array; a row target starts at column 0
 * with `- id:`. Nested `id:` keys (for example model entries inside a row's
 * config) are indented and deliberately ignored.
 */
export function patchRowIds(patchText: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const line of patchText.split(/\r?\n/)) {
    const match = /^-[ \t]+id:[ \t]*(?:'((?:[^']|'')+)'|"([^"]+)"|([^\s#'"]+))[ \t]*$/.exec(line)
    if (match === null) continue
    const id = (match[1]?.replaceAll("''", "'") ?? match[2] ?? match[3] ?? '').trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Row ids whose owner patch entry sets the row-level `disabled` flag explicitly. */
export function patchExplicitDisabled(patchText: string): Set<string> {
  const ids = new Set<string>()
  let current: string | undefined
  for (const line of patchText.split(/\r?\n/)) {
    const match = /^-[ \t]+id:[ \t]*(?:'((?:[^']|'')+)'|"([^"]+)"|([^\s#'"]+))[ \t]*$/.exec(line)
    if (match !== null) {
      current = (match[1]?.replaceAll("''", "'") ?? match[2] ?? match[3] ?? '').trim()
      continue
    }
    if (current !== undefined && /^ {2}disabled:/.test(line)) ids.add(current)
  }
  return ids
}

/**
 * Extract the composed dump block for one top-level row id.
 *
 * The block starts at the `- id: <id>` line and covers its `name:`/`config:`/
 * `disabled:` lines, stopping at the next top-level entry or layer comment.
 * Baseline and post-install blocks compare byte-for-byte, so a changed
 * effective value for a row the owner patched is reported even when the dump
 * itself reorders layers.
 */
export function dumpEntryBlock(dump: string, id: string): string | undefined {
  const start = new RegExp(`^- id:[ \\t]*${quoteOrBare(id)}[ \\t]*$`)
  const lines = dump.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => start.test(line))
  if (startIndex === -1) return undefined
  const block = [lines[startIndex] ?? '']
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^(?:- |# )/.test(line)) break
    block.push(line)
  }
  while (block.length > 1 && (block[block.length - 1] ?? '').trim() === '') block.pop()
  return block.join('\n')
}

/** Parse one composed row block; an unreadable dump is reported as a mismatch. */
function parseDumpBlock(block: string): unknown {
  try {
    return parse(block)
  } catch {
    return undefined
  }
}

function quoteOrBare(value: string): string {
  return `(?:'${escapeRegExp(value.replaceAll("'", "''"))}'|"${escapeRegExp(value)}"|${escapeRegExp(value)})`
}

/**
 * Compare the effective composition of every row the owner patched.
 *
 * A row the baseline dump does not contain (for example a row supplied by a
 * shipped bundle the profile had not selected yet) cannot be compared to a
 * baseline; it only has to survive the installation.
 *
 * A setup migration may add a row-level `disabled: true` that the owner patch
 * did not set; that inherited state change alone is allowed. An explicit
 * owner `disabled` value, and every other field, must still survive unchanged.
 * A retired adapter row may disappear (or be absent from both dumps): the
 * caller reports the retirement instead of treating it as a lost owner row.
 */
export function checkOwnerRowsPreserved(
  ownerRows: readonly string[],
  baselineDump: string,
  installedDump: string,
  explicitDisabled: ReadonlySet<string> = new Set(),
  retiredRows: ReadonlySet<string> = new Set(),
): string[] {
  const problems: string[] = []
  for (const row of ownerRows) {
    const before = dumpEntryBlock(baselineDump, row)
    const after = dumpEntryBlock(installedDump, row)
    if (before === undefined) {
      if (after === undefined && !retiredRows.has(row)) {
        problems.push(`owner row "${row}" is missing from both dumps`)
      }
      continue
    }
    if (after === undefined) {
      if (!retiredRows.has(row)) problems.push(`owner row "${row}" disappeared after installation`)
    } else if (before !== after) {
      const inheritedDisable =
        !explicitDisabled.has(row) && withoutRowDisabled(before) === withoutRowDisabled(after)
      if (!inheritedDisable) problems.push(`owner row "${row}" changed after installation`)
    }
  }
  return problems
}

/** The block without its row-level `disabled` line, for migration-only comparisons. */
function withoutRowDisabled(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => !/^ {2}disabled:/.test(line))
    .join('\n')
    .trimEnd()
}

/** Read the row-level `disabled` property, ignoring nested configuration values. */
function rowDisabled(block: string): boolean | undefined {
  const match = /^ {2}disabled:\s*(true|false)\s*$/m.exec(block)
  if (match === null) return undefined
  return match[1] === 'true'
}

/** Structural JSON equality; key order is irrelevant. */
function sameConfig(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => sameConfig(item, right[index]))
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false
  }
  const keys = (value: object): string[] =>
    Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined)
  const leftKeys = keys(left)
  const rightKeys = keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      sameConfig((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  )
}

/**
 * Check that setup defaults still take effect where the owner patch does not
 * override the row. The composed config is parsed and compared structurally to
 * the shipped config, so a changed tool name or a predicate moved to another
 * row fails. An owner patched row replaces the whole setup config, so it is the
 * owner's block, not this check, that proves precedence there.
 */
export function checkSetupDefaults(
  defaults: ReadonlyArray<{
    id: string
    config?: Record<string, unknown>
    disabled?: boolean
  }>,
  ownerRows: readonly string[],
  installedDump: string,
): string[] {
  const ownerRowSet = new Set(ownerRows)
  const problems: string[] = []
  for (const entry of defaults) {
    if (ownerRowSet.has(entry.id)) continue
    const block = dumpEntryBlock(installedDump, entry.id)
    if (block === undefined) {
      problems.push(`setup default row "${entry.id}" is missing from the composed profile`)
      continue
    }
    if (entry.config !== undefined) {
      const parsed: unknown = parseDumpBlock(block)
      const composed = Array.isArray(parsed) ? parsed[0] : parsed
      const config =
        typeof composed === 'object' && composed !== null
          ? (composed as { config?: unknown }).config
          : undefined
      if (!sameConfig(config, entry.config)) {
        problems.push(`setup default "${entry.id}" does not match the shipped config`)
      }
    }
    if (entry.disabled === true && rowDisabled(block) !== true) {
      problems.push(`setup default "${entry.id}" is not disabled in the composed profile`)
    }
    if (entry.disabled === false && rowDisabled(block) === true) {
      problems.push(`setup default "${entry.id}" is disabled in the composed profile`)
    }
  }
  return problems
}

/** Check that every row the setup patch inserts resolves in the composed profile. */
export function checkSetupRows(setupRows: readonly string[], installedDump: string): string[] {
  const problems: string[] = []
  for (const row of setupRows) {
    if (dumpEntryBlock(installedDump, row) === undefined) {
      problems.push(`setup row "${row}" is missing from the composed profile`)
    }
  }
  return problems
}

/**
 * Check the installer's selection change: the setup bundle is appended once as
 * the last entry, every bundle the profile selected before is still selected in
 * the same relative order (except the setup bundle, which the installer owns and
 * moves last), and every installer-owned bundle is selected.
 */
export function checkBundleSelection(
  before: readonly string[],
  after: readonly string[],
  installBundles: readonly string[],
): string[] {
  const problems: string[] = []

  let cursor = 0
  for (const name of before) {
    // The installer owns the setup bundle's position and moves it last; every
    // other owner bundle must keep its relative order.
    if (name === SETUP_BUNDLE) continue
    const index = after.indexOf(name, cursor)
    if (index === -1) {
      problems.push(`bundle "${name}" was removed or reordered`)
    } else {
      cursor = index + 1
    }
  }

  const setupPositions = after
    .map((name, index) => (name === SETUP_BUNDLE ? index : -1))
    .filter((index) => index !== -1)
  if (setupPositions.length !== 1) {
    problems.push(`the setup bundle is selected ${setupPositions.length} time(s)`)
  } else if (setupPositions[0] !== after.length - 1) {
    problems.push('the setup bundle is not the last selected bundle')
  }

  for (const name of installBundles) {
    if (!after.includes(name)) problems.push(`installer bundle "${name}" is not selected`)
  }
  return problems
}
