import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { rootDir } from './lib/workspace.ts'

/**
 * Refresh the vendored answer-me-with-html skill, its renderer, and the license
 * from an immutable upstream commit.
 *
 * Usage: pnpm answer-page:update --version 0.5.10 [--commit <sha>] [--repository <url>]
 *
 * Every file is downloaded from raw.githubusercontent.com at the pinned commit,
 * validated, and only then written together with the provenance lock. A fetch
 * or validation failure leaves the previous pin untouched; running the same pin
 * twice produces byte-identical output.
 */

const PACKAGE_DIR = join(rootDir, 'packages', 'plugin-answer-page')
const REQUEST_TIMEOUT_MS = 60_000
const USER_AGENT = 'dsh-setup-answer-page-updater'
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/u
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/

/** Upstream repository the vendored content is pinned from. */
const DEFAULT_REPOSITORY = 'https://github.com/QingYunA/answer-me-with-html'

/** Package-relative directory holding the vendored upstream files. */
const ASSETS_DIRECTORY = 'assets/answer-me-with-html'

/** Package-relative provenance document written next to the vendored files. */
const LOCK_FILE = 'answer-page.lock.json'

/** Skill name the plugin registers; the vendored frontmatter must declare it. */
const SKILL_NAME = 'answer-me-with-html'

const VENDORED_SKILL = `${ASSETS_DIRECTORY}/SKILL.md`
const VENDORED_CLI = `${ASSETS_DIRECTORY}/scripts/am.mjs`
const VENDORED_FONT_LICENSE = `${ASSETS_DIRECTORY}/licenses/OFL-Bangers.txt`
const VENDORED_LICENSE = `${ASSETS_DIRECTORY}/LICENSE`

/**
 * Upstream paths downloaded at the pinned commit and the flattened package path
 * each one is vendored to, so the skill directory itself holds `SKILL.md`,
 * `references/`, and `scripts/` as upstream documents.
 */
const UPSTREAM_FILES = [
  { upstream: 'LICENSE', vendored: VENDORED_LICENSE },
  { upstream: `skills/${SKILL_NAME}/SKILL.md`, vendored: VENDORED_SKILL },
  {
    upstream: `skills/${SKILL_NAME}/licenses/OFL-Bangers.txt`,
    vendored: VENDORED_FONT_LICENSE,
  },
  {
    upstream: `skills/${SKILL_NAME}/references/settings.md`,
    vendored: `${ASSETS_DIRECTORY}/references/settings.md`,
  },
  {
    upstream: `skills/${SKILL_NAME}/references/video.md`,
    vendored: `${ASSETS_DIRECTORY}/references/video.md`,
  },
  { upstream: `skills/${SKILL_NAME}/scripts/am.mjs`, vendored: VENDORED_CLI },
] as const

/** Size ceiling that keeps a runaway upstream file from silently bloating the package. */
const MAX_VENDORED_BYTES = 8 * 1024 * 1024

/** CLI flags and environment variables the DeepSeek Harness adapter text relies on. */
const CLI_MARKERS = ['AM_HOME', 'AM_NO_UPDATE_CHECK', 'no-open'] as const

interface CliOptions {
  version: string
  repository: string
  commit?: string
}

interface UpstreamIdentity {
  repository: string
  version: string
  tag: string
  commit: string
}

interface FileRecord {
  path: string
  bytes: number
  sha256: string
}

interface AnswerPageLock {
  upstream: UpstreamIdentity
  skill: { name: string }
  files: FileRecord[]
}

interface VendoredFile {
  path: string
  content: Buffer
}

function printUsage(): void {
  console.log(`Usage: pnpm answer-page:update --version <x.y.z> [options]

Options:
  --version <x.y.z>     Upstream release version to pin (tag v<version>).
  --repository <url>    Upstream GitHub repository (default: ${DEFAULT_REPOSITORY}).
  --commit <sha>        Use this 40-hex commit instead of resolving the tag.
  -h, --help            Print this help.

Writes packages/plugin-answer-page/${ASSETS_DIRECTORY}/ and
packages/plugin-answer-page/${LOCK_FILE}, then prints the next commands.`)
}

function parseCliOptions(): CliOptions | undefined {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      version: { type: 'string' },
      repository: { type: 'string' },
      commit: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help === true) {
    printUsage()
    return undefined
  }
  const version = values.version
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version.trim())) {
    throw new Error('--version is required and must look like x.y.z')
  }
  const repository =
    typeof values.repository === 'string' && values.repository.trim() !== ''
      ? values.repository.trim()
      : DEFAULT_REPOSITORY
  const commit = typeof values.commit === 'string' ? values.commit.trim() : undefined
  if (commit !== undefined && !COMMIT_PATTERN.test(commit)) {
    throw new Error(`--commit must be a 40-hex-digit commit, got "${commit}"`)
  }
  return { version: version.trim(), repository, ...(commit === undefined ? {} : { commit }) }
}

function splitRepository(repository: string): { owner: string; name: string } {
  const match = REPOSITORY_PATTERN.exec(repository)
  const owner = match?.[1]
  const name = match?.[2]
  if (owner === undefined || name === undefined) {
    throw new Error(`repository must look like ${DEFAULT_REPOSITORY}, got "${repository}"`)
  }
  return { owner, name }
}

async function fetchText(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept, 'user-agent': USER_AGENT },
  })
  if (response.status !== 200) {
    throw new Error(`${url} answered HTTP ${response.status}`)
  }
  return await response.text()
}

function parseJsonObject(text: string, source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${source}: expected a JSON object`)
  }
  return value as Record<string, unknown>
}

function objectField(
  value: Record<string, unknown>,
  key: string,
  source: string,
): Record<string, unknown> {
  const field = value[key]
  if (typeof field !== 'object' || field === null || Array.isArray(field)) {
    throw new Error(`${source}: field "${key}" must be an object`)
  }
  return field as Record<string, unknown>
}

/** Resolve a release tag to the commit it points at, unwrapping annotated tags. */
async function resolveCommit(owner: string, name: string, tag: string): Promise<string> {
  const refUrl = `https://api.github.com/repos/${owner}/${name}/git/ref/tags/${tag}`
  const ref = parseJsonObject(await fetchText(refUrl, 'application/vnd.github+json'), refUrl)
  const target = objectField(ref, 'object', refUrl)
  const sha = target.sha
  const type = target.type
  if (typeof sha !== 'string' || !COMMIT_PATTERN.test(sha)) {
    throw new Error(`${refUrl}: tag does not carry a 40-hex commit`)
  }
  if (type === 'commit') return sha
  if (type !== 'tag') {
    throw new Error(`${refUrl}: tag points at unsupported object type "${String(type)}"`)
  }
  const tagUrl = `https://api.github.com/repos/${owner}/${name}/git/tags/${sha}`
  const tagObject = parseJsonObject(await fetchText(tagUrl, 'application/vnd.github+json'), tagUrl)
  const commit = objectField(tagObject, 'object', tagUrl)
  if (typeof commit.sha !== 'string' || !COMMIT_PATTERN.test(commit.sha)) {
    throw new Error(`${tagUrl}: annotated tag does not point at a 40-hex commit`)
  }
  return commit.sha
}

async function fetchAsset(
  owner: string,
  name: string,
  commit: string,
  path: string,
): Promise<Buffer> {
  const url = `https://raw.githubusercontent.com/${owner}/${name}/${commit}/${path}`
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/octet-stream', 'user-agent': USER_AGENT },
  })
  if (response.status !== 200) {
    throw new Error(`${url} answered HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function sha256Hex(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function assertVendoredFile(path: string, content: Buffer): void {
  const text = content.toString('utf8')
  if (content.length === 0) throw new Error(`${path}: upstream file is empty`)
  if (content.length > MAX_VENDORED_BYTES) {
    throw new Error(
      `${path}: ${content.length} bytes is above the ${MAX_VENDORED_BYTES}-byte ceiling`,
    )
  }
  if (text.includes('\r')) {
    throw new Error(`${path}: must use LF line endings; found a carriage return`)
  }
  if (path === VENDORED_SKILL) {
    const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)
    const body = frontmatter?.[1]
    if (body === undefined) throw new Error(`${path}: missing YAML frontmatter`)
    const declared = /^name:\s*(\S+)\s*$/mu.exec(body)?.[1]
    if (declared !== SKILL_NAME) {
      throw new Error(`${path}: expected skill name "${SKILL_NAME}", got "${String(declared)}"`)
    }
    if (!/^description:\s*\S/mu.test(body)) {
      throw new Error(`${path}: frontmatter is missing a description`)
    }
  }
  if (path === VENDORED_LICENSE && !text.includes('MIT License')) {
    throw new Error(`${path}: license text must contain "MIT License"`)
  }
  if (path === VENDORED_FONT_LICENSE && !text.includes('SIL OPEN FONT LICENSE')) {
    throw new Error(`${path}: font license text must contain "SIL OPEN FONT LICENSE"`)
  }
  if (path === VENDORED_CLI) {
    for (const marker of CLI_MARKERS) {
      if (!text.includes(marker)) {
        throw new Error(`${path}: expected CLI marker "${marker}" is missing`)
      }
    }
  }
}

/** Build the deterministic provenance document from the vendored bytes. */
function buildLock(upstream: UpstreamIdentity, files: readonly VendoredFile[]): AnswerPageLock {
  const entries = files
    .map((file) => ({
      path: file.path,
      bytes: file.content.length,
      sha256: sha256Hex(file.content),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return { upstream, skill: { name: SKILL_NAME }, files: entries }
}

function writeFiles(
  packageDir: string,
  files: ReadonlyArray<{ path: string; content: Buffer }>,
): { written: string[]; unchanged: string[] } {
  const staged = files.map((file) => {
    const absolute = join(packageDir, file.path)
    return { ...file, absolute, temporary: `${absolute}.tmp` }
  })
  const same = (file: (typeof staged)[number]): boolean =>
    existsSync(file.absolute) && readFileSync(file.absolute).equals(file.content)
  const pending = staged.filter((file) => !same(file))
  for (const file of pending) {
    mkdirSync(dirname(file.absolute), { recursive: true })
    writeFileSync(file.temporary, file.content)
  }
  try {
    for (const file of pending) renameSync(file.temporary, file.absolute)
  } catch (error) {
    for (const file of pending) rmSync(file.temporary, { force: true })
    throw error
  }
  return {
    written: pending.map((file) => file.path),
    unchanged: staged.filter((file) => !pending.includes(file)).map((file) => file.path),
  }
}

async function main(): Promise<number> {
  let options: CliOptions | undefined
  try {
    options = parseCliOptions()
  } catch (error) {
    console.error(`answer-page:update: ${error instanceof Error ? error.message : String(error)}`)
    printUsage()
    return 1
  }
  if (options === undefined) return 0

  const version = options.version
  const tag = `v${version}`
  const repository = options.repository
  const { owner, name } = splitRepository(repository)
  const commit = options.commit ?? (await resolveCommit(owner, name, tag))
  const upstream: UpstreamIdentity = { repository, version, tag, commit }

  console.log(`answer-page:update: ${repository} ${tag} -> ${commit}`)
  const fetched = await Promise.all(
    UPSTREAM_FILES.map(async ({ upstream: path, vendored }) => ({
      path: vendored,
      content: await fetchAsset(owner, name, commit, path),
    })),
  )
  for (const file of fetched) assertVendoredFile(file.path, file.content)

  const lock = buildLock(upstream, fetched)
  const result = writeFiles(PACKAGE_DIR, [
    ...fetched,
    { path: LOCK_FILE, content: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8') },
  ])
  for (const file of lock.files) {
    console.log(`  ${file.path}: ${file.bytes} bytes sha256 ${file.sha256}`)
  }
  console.log(`  ${LOCK_FILE}${result.written.length === 0 ? ' (already up to date)' : ''}`)
  if (result.written.length > 0) {
    console.log(`answer-page:update: wrote ${result.written.join(', ')}`)
  }
  console.log('next: pnpm gen && pnpm build && pnpm check')
  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`answer-page:update: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
