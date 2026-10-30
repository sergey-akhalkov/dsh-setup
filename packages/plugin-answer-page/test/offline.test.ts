import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const cli = join(packageDir, 'assets', 'answer-me-with-html', 'scripts', 'am.mjs')

const draftText = [
  '---',
  'title: Offline check',
  '---',
  '## One panel',
  'A short factual sentence.',
  '',
].join('\n')

const fetchProbe = [
  "import { appendFileSync } from 'node:fs'",
  'const log = process.env.ANSWER_PAGE_FETCH_LOG',
  'globalThis.fetch = (input) => {',
  '  if (log) appendFileSync(log, String(input) + "\\n")',
  "  throw new Error('network disabled in the offline test')",
  '}',
  '',
].join('\n')

const workspaces: string[] = []

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'answer-page-offline-'))
  workspaces.push(workspace)
  return workspace
}

interface AdapterEnvironment {
  workspace: string
  answers: string
  draft: string
  page: string
  answerHome: string
  fakeHome: string
  fakeTemp: string
  env: NodeJS.ProcessEnv
}

/**
 * Build the adapter environment explicitly: no CI (which would itself disable
 * the update check and hide a missing AM_NO_UPDATE_CHECK), no inherited
 * AM_HOME, and fake home/temp directories so a write outside the workspace is
 * observable.
 */
function adapterEnvironment(
  workspace: string,
  answerHome = join(workspace, '.tmp', 'answers', '.am'),
): AdapterEnvironment {
  const answers = join(workspace, '.tmp', 'answers')
  mkdirSync(answers, { recursive: true })
  const draft = join(answers, 'offline-check.md')
  writeFileSync(draft, draftText)
  const page = join(answers, 'offline-check.html')
  const fakeHome = join(workspace, 'fake-home')
  mkdirSync(fakeHome, { recursive: true })
  const fakeTemp = join(workspace, 'fake-temp')
  mkdirSync(fakeTemp, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.CI
  delete env.AM_NO_UPDATE_CHECK
  delete env.AM_NO_OPEN
  env.AM_HOME = answerHome
  env.AM_NO_UPDATE_CHECK = '1'
  env.HOME = fakeHome
  env.USERPROFILE = fakeHome
  env.TMP = fakeTemp
  env.TEMP = fakeTemp
  env.TMPDIR = fakeTemp
  delete env.NODE_OPTIONS
  return { workspace, answers, draft, page, answerHome, fakeHome, fakeTemp, env }
}

afterAll(() => {
  for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true })
})

describe('answer-page offline rendering', () => {
  it('starts no update process and makes no request under the adapter environment', async () => {
    const prepared = adapterEnvironment(createWorkspace())
    const probeFile = join(prepared.workspace, 'fetch-probe.mjs')
    const probeLog = join(prepared.workspace, 'fetch.log')
    writeFileSync(probeFile, fetchProbe)
    prepared.env.NODE_OPTIONS = `--import=${pathToFileURL(probeFile).href}`
    prepared.env.ANSWER_PAGE_FETCH_LOG = probeLog

    const result = spawnSync(
      process.execPath,
      [cli, 'render', prepared.draft, '-o', prepared.page, '--no-open'],
      { cwd: prepared.workspace, env: prepared.env, encoding: 'utf8', timeout: 60_000 },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(prepared.page)
    expect(existsSync(prepared.page)).toBe(true)
    expect(readFileSync(prepared.page, 'utf8')).toMatch(/<!doctype html>/iu)
    expect(existsSync(prepared.draft)).toBe(true)
    expect(prepared.page.startsWith(prepared.answers)).toBe(true)

    // spawnUpdateCheck writes lastUpdateCheck synchronously and the detached
    // child inherits NODE_OPTIONS, so either an update process or a request
    // would be visible here.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const stateFile = join(prepared.answerHome, 'state.json')
    expect(existsSync(stateFile)).toBe(true)
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>
    expect(state.lastUpdateCheck).toBeUndefined()
    expect(typeof state.firstSeen).toBe('number')
    expect(existsSync(probeLog)).toBe(false)
    expect(existsSync(join(prepared.fakeHome, '.answer-me-with-html'))).toBe(false)
    expect(existsSync(join(prepared.fakeTemp, 'answer-me-with-html'))).toBe(false)
  })

  it('keeps the page and draft inside the workspace when AM_HOME is unwritable', () => {
    const prepared = adapterEnvironment(createWorkspace())
    const blocked = join(prepared.answers, 'blocked')
    writeFileSync(blocked, '')
    const answerHome = join(blocked, '.am')
    prepared.env.AM_HOME = answerHome

    const result = spawnSync(
      process.execPath,
      [cli, 'render', prepared.draft, '-o', prepared.page, '--no-open'],
      { cwd: prepared.workspace, env: prepared.env, encoding: 'utf8', timeout: 60_000 },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(prepared.page)
    expect(existsSync(prepared.page)).toBe(true)
    expect(existsSync(prepared.draft)).toBe(true)
    expect(existsSync(answerHome)).toBe(false)
    expect(existsSync(join(prepared.fakeTemp, 'answer-me-with-html'))).toBe(false)
    expect(existsSync(join(prepared.fakeHome, '.answer-me-with-html'))).toBe(false)
    expect(readdirSync(prepared.answers).sort()).toEqual([
      'blocked',
      'offline-check.html',
      'offline-check.md',
    ])
  })
})
