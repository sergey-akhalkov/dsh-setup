import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import { isInside } from './fs-change.js'

/**
 * Intake drafts. A draft lives under `.dsh/workflows/drafts/<name>/` until the
 * `create-change` step runs; no `openspec/changes/<name>/` directory may appear
 * before it. Names and artifact paths are validated, writes are atomic, and a
 * link cannot move the target outside the workspace.
 */

export const DRAFTS_ROOT = '.dsh/workflows/drafts'

/** The workspace-relative draft directory for one change name. */
export function draftDirectory(name: string): string {
  if (!CHANGE_NAME.test(name)) {
    throw new Error(`the draft name "${name}" is not a validated change name`)
  }
  return `${DRAFTS_ROOT}/${name}`
}

/** The workspace-relative draft file path; the artifact must stay beneath it. */
export function draftPath(name: string, artifact: string): string {
  const directory = draftDirectory(name)
  const normalized = artifact.replaceAll('\\', '/')
  if (normalized.trim() === '' || isAbsolute(normalized) || /^[A-Za-z]:\//u.test(normalized)) {
    throw new Error(`the draft artifact "${artifact}" must be workspace-relative`)
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`the draft artifact "${artifact}" is not a safe relative path`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(parts.at(-1) ?? '')) {
    throw new Error(`the draft artifact "${artifact}" has an unsafe file name`)
  }
  return `${directory}/${parts.join('/')}`
}

/** Resolve the drafts root, refusing a link that leaves the workspace. */
async function draftsRoot(workspace: string): Promise<{ root: string; directory: string }> {
  const root = await realpath(workspace)
  let current = root
  for (const segment of DRAFTS_ROOT.split('/')) {
    const candidate = join(current, segment)
    const info = await lstat(candidate).catch(() => undefined)
    if (info === undefined) {
      // Create only beneath an already verified parent, one segment at a time.
      await mkdir(candidate)
    } else if (info.isSymbolicLink()) {
      throw new Error(
        segment === 'drafts'
          ? 'the drafts directory is a link; drafts are refused'
          : `the drafts ${segment} directory is a link; drafts are refused`,
      )
    }
    const real = await realpath(candidate).catch(() => undefined)
    if (real === undefined || !isInside(root, real)) {
      throw new Error('the drafts directory escapes the workspace; drafts are refused')
    }
    current = real
  }
  return { root, directory: current }
}

export interface DraftWrite {
  readonly path: string
  readonly bytes: number
}

/** Write one draft artifact atomically and never create the change directory. */
export async function writeDraft(
  workspace: string,
  name: string,
  artifact: string,
  content: string,
): Promise<DraftWrite> {
  const relative = draftPath(name, artifact)
  const { root, directory } = await draftsRoot(workspace)
  const artifactPath = relative.slice(`${DRAFTS_ROOT}/${name}/`.length)
  const segments = [name, ...dirname(artifactPath).split('/')]
  // Walk and create only beneath verified, canonical non-link parents, then
  // prove the parent stays inside the intended draft directory (a link back
  // into the workspace must not let a draft create openspec/changes).
  let current = directory
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    const candidate = join(current, segment)
    const info = await lstat(candidate).catch(() => undefined)
    if (info === undefined) {
      await mkdir(candidate)
    } else if (info.isSymbolicLink()) {
      throw new Error(`the draft path "${relative}" uses a link; drafts are refused`)
    }
    const real = await realpath(candidate).catch(() => undefined)
    if (real === undefined || !isInside(root, real) || !isInside(directory, real)) {
      throw new Error(`the draft path "${relative}" escapes the workspace`)
    }
    current = real
  }
  const target = join(current, basename(artifactPath))
  const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, content, 'utf8')
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return { path: relative, bytes: Buffer.byteLength(content, 'utf8') }
}

/** Read one draft artifact; undefined when it is missing or escapes the workspace. */
export async function readDraft(
  workspace: string,
  name: string,
  artifact: string,
): Promise<string | undefined> {
  const relative = draftPath(name, artifact)
  const root = await realpath(workspace)
  const directory = await realpath(join(root, draftDirectory(name))).catch(() => undefined)
  if (directory === undefined) return undefined
  const target = await realpath(join(root, relative)).catch(() => undefined)
  if (target === undefined || !isInside(root, target) || !isInside(directory, target)) {
    return undefined
  }
  return readFile(target, 'utf8')
}

/** The draft existence probe used by the intake steer and tests. */
export async function draftExists(
  workspace: string,
  name: string,
  artifact: string,
): Promise<boolean> {
  return (await readDraft(workspace, name, artifact)) !== undefined
}
