import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
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
  const relative = DRAFTS_ROOT
  const directory = join(root, relative)
  await mkdir(directory, { recursive: true })
  const info = await lstat(join(root, '.dsh', 'workflows')).catch(() => undefined)
  if (info?.isSymbolicLink() === true) {
    throw new Error('the workflows directory is a link; drafts are refused')
  }
  const draftsInfo = await lstat(directory).catch(() => undefined)
  if (draftsInfo?.isSymbolicLink() === true) {
    throw new Error('the drafts directory is a link; drafts are refused')
  }
  const real = await realpath(directory)
  if (!isInside(root, real)) {
    throw new Error('the drafts directory escapes the workspace; drafts are refused')
  }
  return { root, directory: real }
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
  const target = join(directory, name, relative.slice(`${DRAFTS_ROOT}/${name}/`.length))
  await mkdir(dirname(target), { recursive: true })
  const realParent = await realpath(dirname(target))
  if (!isInside(root, realParent)) {
    throw new Error(`the draft path "${relative}" escapes the workspace`)
  }
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
  const target = await realpath(join(root, relative)).catch(() => undefined)
  if (target === undefined || !isInside(root, target)) return undefined
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
