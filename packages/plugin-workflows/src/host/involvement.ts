import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'

/**
 * Durable session involvement: the change a session edited or created, kept
 * outside the run store so a restarted host can still evaluate an involvement
 * condition for the same session.
 */

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/u

export function involvementPath(workspace: string, session: string): string {
  return join(workspace, '.dsh', 'workflows', 'involvement', `${session}.json`)
}

export async function readInvolvement(
  workspace: string,
  session: string,
): Promise<string | undefined> {
  if (!SESSION_ID.test(session)) return undefined
  try {
    const value = JSON.parse(await readFile(involvementPath(workspace, session), 'utf8')) as {
      change?: unknown
    }
    return typeof value.change === 'string' && CHANGE_NAME.test(value.change)
      ? value.change
      : undefined
  } catch {
    return undefined
  }
}

export async function writeInvolvement(
  workspace: string,
  session: string,
  change: string,
): Promise<void> {
  if (!SESSION_ID.test(session) || !CHANGE_NAME.test(change)) return
  const path = involvementPath(workspace, session)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify({ change, at: Date.now() }, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
