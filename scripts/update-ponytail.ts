import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  assertLicenseText,
  assertRulesText,
  assertSkillText,
  assertUpstream,
  buildPonytailLock,
  PONYTAIL_ASSETS_DIRECTORY,
  PONYTAIL_LICENSE_FILE,
  PONYTAIL_LOCK_FILE,
  PONYTAIL_REPOSITORY,
  PONYTAIL_RULES_FILE,
  PONYTAIL_SKILL_FILE,
  PONYTAIL_SKILL_NAME,
  type PonytailAsset,
  type PonytailUpstream,
  serializePonytailLock,
} from './lib/ponytail.ts'
import { rootDir } from './lib/workspace.ts'

/**
 * Refresh the vendored Ponytail prompt from an immutable upstream commit.
 *
 * Usage: pnpm ponytail:update --version 5.3.2 [--repository <url>] [--commit <sha>]
 *
 * The script resolves the release tag to a commit, downloads the skill prompt,
 * the compact rules file, and the license from that commit, validates all three,
 * and only then writes the assets and the provenance lock. A fetch or validation
 * failure leaves the previous pin untouched; running the same version twice
 * produces byte-identical output.
 */

const PACKAGE_DIR = join(rootDir, 'packages', 'plugin-ponytail')
const REQUEST_TIMEOUT_MS = 30_000
const USER_AGENT = 'dsh-setup-ponytail-updater'
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/u
const PONYTAIL_NPM_PACKAGE = '@dietrichgebert/ponytail'

/** Upstream paths downloaded at the pinned commit. */
const UPSTREAM_PATHS = {
  skill: 'skills/ponytail/SKILL.md',
  rules: 'AGENTS.md',
  license: 'LICENSE',
} as const

interface CliOptions {
  version: string
  repository: string
  commit?: string
}

function printUsage(): void {
  console.log(`Usage: pnpm ponytail:update --version <x.y.z> [options]

Options:
  --version <x.y.z>     Upstream release version to pin (tag v<version>).
  --repository <url>    Upstream GitHub repository (default: ${PONYTAIL_REPOSITORY}).
  --commit <sha>        Use this 40-hex commit instead of resolving the tag.
  -h, --help            Print this help.

Writes packages/plugin-ponytail/${PONYTAIL_ASSETS_DIRECTORY}/ and
packages/plugin-ponytail/${PONYTAIL_LOCK_FILE}, then prints the next commands.`)
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
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('--version is required')
  }
  const repository =
    typeof values.repository === 'string' && values.repository.trim() !== ''
      ? values.repository.trim()
      : PONYTAIL_REPOSITORY
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
    throw new Error(`repository must look like ${PONYTAIL_REPOSITORY}, got "${repository}"`)
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
): Promise<string> {
  return await fetchText(
    `https://raw.githubusercontent.com/${owner}/${name}/${commit}/${path}`,
    'text/plain',
  )
}

/** Read the commit the upstream npm release was published from. */
async function resolveCommitFromRegistry(version: string): Promise<string> {
  const url = `https://registry.npmjs.org/${PONYTAIL_NPM_PACKAGE}/${version}`
  const metadata = parseJsonObject(await fetchText(url, 'application/json'), url)
  const gitHead = metadata.gitHead
  if (typeof gitHead !== 'string' || !COMMIT_PATTERN.test(gitHead)) {
    throw new Error(`${url}: release does not declare a 40-hex gitHead commit`)
  }
  return gitHead
}

/**
 * Resolve the release commit, preferring the GitHub tag API and falling back to
 * the npm release metadata when the unauthenticated GitHub rate limit answers 403.
 */
async function resolvePinnedCommit(
  owner: string,
  name: string,
  tag: string,
  version: string,
  repository: string,
): Promise<string> {
  try {
    return await resolveCommit(owner, name, tag)
  } catch (error) {
    if (repository !== PONYTAIL_REPOSITORY) throw error
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`ponytail:update: tag lookup failed (${reason}); using the npm registry gitHead`)
    return await resolveCommitFromRegistry(version)
  }
}

function writeFiles(
  packageDir: string,
  files: ReadonlyArray<{ path: string; content: string }>,
): {
  written: string[]
  unchanged: string[]
} {
  const staged = files.map((file) => {
    const absolute = join(packageDir, file.path)
    return { ...file, absolute, temporary: `${absolute}.tmp` }
  })
  const pending = staged.filter((file) => {
    if (!existsSync(file.absolute)) return true
    return readFileSync(file.absolute, 'utf8') !== file.content
  })
  for (const file of pending) {
    mkdirSync(dirname(file.absolute), { recursive: true })
    writeFileSync(file.temporary, file.content, 'utf8')
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
    console.error(`ponytail:update: ${error instanceof Error ? error.message : String(error)}`)
    printUsage()
    return 1
  }
  if (options === undefined) return 0

  const version = options.version
  const tag = `v${version}`
  const repository = options.repository
  const { owner, name } = splitRepository(repository)
  const commit =
    options.commit ?? (await resolvePinnedCommit(owner, name, tag, version, repository))
  const upstream: PonytailUpstream = { repository, version, tag, commit }
  assertUpstream(upstream)

  console.log(`ponytail:update: ${repository} ${tag} -> ${commit}`)
  const [skillText, rulesText, licenseText] = await Promise.all([
    fetchAsset(owner, name, commit, UPSTREAM_PATHS.skill),
    fetchAsset(owner, name, commit, UPSTREAM_PATHS.rules),
    fetchAsset(owner, name, commit, UPSTREAM_PATHS.license),
  ])
  const skill = assertSkillText(skillText, UPSTREAM_PATHS.skill)
  if (skill.name !== PONYTAIL_SKILL_NAME) {
    throw new Error(
      `${UPSTREAM_PATHS.skill}: expected skill name "${PONYTAIL_SKILL_NAME}", got "${skill.name}"`,
    )
  }
  assertRulesText(rulesText, UPSTREAM_PATHS.rules)
  assertLicenseText(licenseText, UPSTREAM_PATHS.license)

  const assets: PonytailAsset[] = [
    { path: `${PONYTAIL_ASSETS_DIRECTORY}/${PONYTAIL_SKILL_FILE}`, content: skillText },
    { path: `${PONYTAIL_ASSETS_DIRECTORY}/${PONYTAIL_RULES_FILE}`, content: rulesText },
    { path: `${PONYTAIL_ASSETS_DIRECTORY}/${PONYTAIL_LICENSE_FILE}`, content: licenseText },
  ]
  const lock = buildPonytailLock(upstream, skill, assets)
  const lockText = serializePonytailLock(lock)

  const result = writeFiles(PACKAGE_DIR, [
    ...assets.map((asset) => ({ path: asset.path, content: asset.content })),
    { path: PONYTAIL_LOCK_FILE, content: lockText },
  ])
  for (const file of lock.files) {
    console.log(`  ${file.path}: ${file.bytes} bytes sha256 ${file.sha256}`)
  }
  console.log(
    `  ${PONYTAIL_LOCK_FILE}${result.written.length === 0 ? ' (already up to date)' : ''}`,
  )
  if (result.written.length > 0) {
    console.log(`ponytail:update: wrote ${result.written.join(', ')}`)
  }
  console.log('next: pnpm gen && pnpm build && pnpm check')
  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`ponytail:update: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
