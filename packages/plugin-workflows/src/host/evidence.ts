import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import type { AllEvidence, Evidence, FileEvidence } from './definitions.js'
import { globMatches } from './evaluate.js'
import { isInside } from './fs-change.js'
import type { RunEvidence } from './runs.js'

/**
 * The evidence verifier. It is a pure-ish function over the workspace and the
 * DSH observations: it never calls a model, and a step completes only when the
 * declared contract actually passes. A file path is resolved by path components
 * and refused when it leaves the workspace through `..` or a link.
 */

export type EvidenceFailureReason =
  | 'missing-file'
  | 'empty-file'
  | 'too-small'
  | 'path-escape'
  | 'invalid-context'
  | 'no-match'
  | 'invalid-evidence'
  | 'unsupported'

export interface EvidenceFailure {
  readonly reason: EvidenceFailureReason
  readonly path?: string
  /** The failing contract's position inside a nested `all`, e.g. items[1].items[0]. */
  readonly item?: string
  readonly detail: string
}

export type EvidenceCheck =
  | { readonly ok: true; readonly evidence: RunEvidence }
  | { readonly ok: false; readonly failure: EvidenceFailure }

export interface EvidenceContext {
  /** The session workspace root. */
  readonly workspace: string
  /** The run context; only validated identifiers are interpolated. */
  readonly values: Readonly<Record<string, unknown>>
}

/** An evidence-path interpolation value: a validated identifier. */
function interpolate(value: string, context: EvidenceContext, item?: string): EvidenceCheck {
  const replaced = value.replaceAll(/\{([a-z][a-z0-9-]*)\}/gu, (_match, key: string) => {
    const entry = context.values[key]
    return typeof entry === 'string' ? entry : '\u0000'
  })
  if (replaced.includes('\u0000')) {
    return {
      ok: false,
      failure: {
        reason: 'invalid-context',
        ...(item === undefined ? {} : { item }),
        detail: `evidence path "${value}" names a context value the run does not carry`,
      },
    }
  }
  for (const match of value.matchAll(/\{([a-z][a-z0-9-]*)\}/gu)) {
    const key = match[1] ?? ''
    const entry = context.values[key]
    if (typeof entry !== 'string' || !CHANGE_NAME.test(entry)) {
      return {
        ok: false,
        failure: {
          reason: 'invalid-context',
          ...(item === undefined ? {} : { item }),
          detail: `evidence context "${key}" is not a validated identifier`,
        },
      }
    }
  }
  return { ok: true, evidence: { kind: 'file', path: replaced } }
}

function failure(
  reason: EvidenceFailureReason,
  detail: string,
  path?: string,
  item?: string,
): EvidenceCheck {
  return {
    ok: false,
    failure: {
      reason,
      detail,
      ...(path === undefined ? {} : { path }),
      ...(item === undefined ? {} : { item }),
    },
  }
}

/** Whether a workspace-relative path is safe by components before resolution. */
function safeRelativePath(path: string, item?: string): EvidenceCheck | undefined {
  if (path.trim() === '') {
    return failure('invalid-evidence', 'the file path is empty', path, item)
  }
  if (isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
    return failure('path-escape', `file path "${path}" is absolute`, path, item)
  }
  const segments = path.replaceAll('\\', '/').split('/')
  if (segments.some((segment) => segment === '..')) {
    return failure('path-escape', `file path "${path}" escapes the workspace`, path, item)
  }
  return undefined
}

/** Canonical containment: the target and every existing ancestor stay inside. */
async function canonicalContained(root: string, target: string): Promise<boolean> {
  let current = target
  for (;;) {
    try {
      const real = await realpath(current)
      return isInside(root, real)
    } catch {
      const parent = join(current, '..')
      if (parent === current) return false
      current = parent
    }
  }
}

async function fileCheck(
  evidence: FileEvidence,
  context: EvidenceContext,
  item: string | undefined,
): Promise<EvidenceCheck> {
  const interpolated = interpolate(evidence.path, context, item)
  if (!interpolated.ok) return interpolated
  const path = interpolated.evidence.path ?? evidence.path
  const structural = safeRelativePath(path, item)
  if (structural !== undefined) return structural
  let root: string
  try {
    root = await realpath(context.workspace)
  } catch {
    return failure('path-escape', 'the workspace is not readable', path, item)
  }
  if (evidence.glob === true) {
    const matches = await expandGlob(root, path)
    if (matches.length === 0) {
      return failure('no-match', `no file matches "${path}"`, path, item)
    }
    let total = 0
    for (const match of matches) {
      const target = join(root, match)
      if (!(await canonicalContained(root, target))) {
        return failure('path-escape', `"${match}" resolves outside the workspace`, match, item)
      }
      const info = await stat(target).catch(() => undefined)
      if (info === undefined || !info.isFile()) {
        return failure('missing-file', `"${match}" is not a readable file`, match, item)
      }
      if (info.size === 0) return failure('empty-file', `"${match}" is empty`, match, item)
      total += info.size
    }
    return {
      ok: true,
      evidence: { kind: 'file', path, bytes: total, detail: `${String(matches.length)} file(s)` },
    }
  }
  const target = join(root, path)
  if (!(await canonicalContained(root, target))) {
    return failure('path-escape', `"${path}" resolves outside the workspace`, path, item)
  }
  let info
  try {
    info = await stat(target)
  } catch {
    return failure('missing-file', `"${path}" does not exist`, path, item)
  }
  if (!info.isFile()) return failure('missing-file', `"${path}" is not a file`, path, item)
  if (info.size === 0) return failure('empty-file', `"${path}" is empty`, path, item)
  if (evidence.minBytes !== undefined && info.size < evidence.minBytes) {
    return failure(
      'too-small',
      `"${path}" is ${String(info.size)} bytes; at least ${String(evidence.minBytes)} are required`,
      path,
      item,
    )
  }
  return { ok: true, evidence: { kind: 'file', path, bytes: info.size } }
}

/** Expand a segment glob under the workspace; bounded depth and entry count. */
export async function expandGlob(root: string, pattern: string): Promise<string[]> {
  const segments = pattern.replaceAll('\\', '/').split('/')
  const found: string[] = []
  const walk = async (directory: string, index: number, depth: number): Promise<void> => {
    if (found.length >= 200 || depth > 12) return
    const segment = segments[index]
    if (segment === undefined) return
    if (segment === '**') {
      // `**` matches zero or more segments; try each deeper directory and the tail.
      await walk(directory, index + 1, depth + 1)
      let entries
      try {
        entries = await readdir(join(root, directory), { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        await walk(directory === '' ? entry.name : `${directory}/${entry.name}`, index, depth + 1)
      }
      return
    }
    const last = index === segments.length - 1
    let entries
    try {
      entries = await readdir(join(root, directory), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const candidate = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (!globMatches(segment, entry.name)) continue
      if (last) {
        if (entry.isFile()) found.push(candidate)
      } else if (entry.isDirectory()) {
        await walk(candidate, index + 1, depth + 1)
      }
    }
  }
  const literal = segments.every((segment) => !/[*?]/u.test(segment))
  if (literal) {
    const info = await stat(join(root, pattern)).catch(() => undefined)
    if (info?.isFile() === true) return [pattern]
    return []
  }
  await walk('', 0, 0)
  return found.sort()
}

/** Verify one evidence contract; an `all` returns the first failing item. */
export async function verifyEvidence(
  value: Evidence,
  context: EvidenceContext,
  item?: string,
): Promise<EvidenceCheck> {
  switch (value.kind) {
    case 'file':
      return fileCheck(value, context, item)
    case 'all': {
      const items = (value as AllEvidence).items
      if (items.length === 0) {
        return failure(
          'invalid-evidence',
          'an all contract needs at least one item',
          undefined,
          item,
        )
      }
      for (const [index, child] of items.entries()) {
        const childItem =
          item === undefined ? `items[${String(index)}]` : `${item}.items[${String(index)}]`
        const checked = await verifyEvidence(child, context, childItem)
        if (!checked.ok) return checked
      }
      return {
        ok: true,
        evidence: { kind: 'all', detail: `${String(items.length)} item(s) verified` },
      }
    }
    default:
      return failure(
        'unsupported',
        `evidence kind "${value.kind}" is not verified yet`,
        undefined,
        item,
      )
  }
}

/** Read a file only when it stays inside the workspace; undefined otherwise. */
export async function readWorkspaceFile(
  workspace: string,
  path: string,
): Promise<{ text: string; bytes: number } | undefined> {
  const structural = safeRelativePath(path, undefined)
  if (structural !== undefined) return undefined
  try {
    const root = await realpath(workspace)
    const target = await realpath(join(root, path))
    if (!isInside(root, target)) return undefined
    const info = await stat(target)
    if (!info.isFile() || info.size > 256 * 1024) return undefined
    const text = await readFile(target, 'utf8')
    return { text, bytes: info.size }
  } catch {
    return undefined
  }
}

/** The workspace-relative display path; never an absolute machine path. */
export function workspaceRelative(workspace: string, path: string): string {
  return relative(workspace, path).replaceAll('\\', '/')
}
