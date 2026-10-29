import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'

/**
 * OpenSpec plugin: registers the six generated core skills from a pinned
 * upstream release as on-demand catalog entries in the profile's global skill
 * layer. The skill bodies load from the vendored assets only when invoked.
 *
 * The OpenSpec CLI is a machine prerequisite, not a bundle dependency: this
 * module never spawns it, downloads it, or adds it to PATH. The adapter note
 * carried by every loaded skill states the prerequisite and the project-local
 * root/cleanup rules at the point of use; the task-lifecycle skills also carry
 * the plugin-owned task-lane guidance.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-openspec'

/** Service the registration depends on. */
export const inject = ['skills']

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-openspec'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Exact number of skills the pinned core profile generates. */
const SKILL_COUNT = 6

const OPENSPEC_REPOSITORY = 'https://github.com/Fission-AI/OpenSpec'
const OPENSPEC_PACKAGE = '@fission-ai/openspec'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const assetsDirectory = join(packageDirectory, 'assets', 'openspec')
const guidanceFile = join(packageDirectory, 'assets', 'guidance', 'task-lanes.md')
const lockFile = join(packageDirectory, 'openspec.lock.json')

/** Skills whose loaded body carries the plugin-owned task-lane guidance. */
const GUIDANCE_SKILLS: ReadonlySet<string> = new Set([
  'openspec-apply-change',
  'openspec-propose',
  'openspec-update-change',
])

/** One skill entry the lock records. */
interface LockSkill {
  name: string
  description: string
  path: string
}

/** Subset of the provenance lock the runtime needs. */
interface OpenSpecLock {
  version: string
  skills: LockSkill[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name}: ${field} must be a non-empty string`)
  }
  return value
}

/** Read and validate the vendored provenance lock that describes the pin. */
function readLock(): OpenSpecLock {
  const parsed: unknown = JSON.parse(readFileSync(lockFile, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${name}: openspec.lock.json must be a JSON object`)
  if (!isRecord(parsed.upstream)) throw new Error(`${name}: openspec.lock.json is missing upstream`)
  if (!Array.isArray(parsed.skills))
    throw new Error(`${name}: openspec.lock.json is missing skills`)

  const version = requireString(parsed.upstream.version, 'upstream.version')
  const skills = parsed.skills.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) throw new Error(`${name}: skills[${index}] must be a JSON object`)
    return {
      name: requireString(entry.name, `skills[${index}].name`),
      description: requireString(entry.description, `skills[${index}].description`),
      path: requireString(entry.path, `skills[${index}].path`),
    }
  })
  if (skills.length !== SKILL_COUNT) {
    throw new Error(`${name}: expected ${SKILL_COUNT} skills, found ${skills.length}`)
  }
  const seen = new Set<string>()
  for (const skill of skills) {
    if (seen.has(skill.name)) throw new Error(`${name}: duplicate skill "${skill.name}"`)
    seen.add(skill.name)
  }
  return { version, skills }
}

/** Read the plugin-owned guidance appended to the task-lifecycle skill bodies. */
function readGuidance(): string {
  const text = readFileSync(guidanceFile, 'utf8')
  if (text.trim() === '') throw new Error(`${name}: guidance asset ${guidanceFile} is empty`)
  return text
}

/** Refuse a lock that no longer contains every skill the guidance targets. */
export function assertGuidanceTargets(skills: ReadonlyArray<{ name: string }>): void {
  for (const skillName of GUIDANCE_SKILLS) {
    if (!skills.some((skill) => skill.name === skillName)) {
      throw new Error(`${name}: task-lane guidance targets missing skill "${skillName}"`)
    }
  }
}

/** Resolve one recorded skill path, refusing anything outside the vendored assets directory. */
function skillFile(record: LockSkill): string {
  const file = resolve(packageDirectory, record.path)
  if (!file.startsWith(`${assetsDirectory}${sep}`)) {
    throw new Error(`${name}: skill "${record.name}" resolves outside ${assetsDirectory}`)
  }
  return file
}

function resourceBase(file: string): { kind: 'directory'; path: string } {
  return { kind: 'directory', path: dirname(file).replaceAll('\\', '/') }
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '')
}

function adapterNote(version: string): string {
  return [
    '',
    '',
    '---',
    '',
    `DeepSeek Harness adapter: this skill is packaged from OpenSpec ${version} (${OPENSPEC_REPOSITORY}, MIT) and is available in every workspace of this profile.`,
    "Specs live in the workspace's own `openspec/` root. When none exists, run `openspec init --tools none` at the workspace root; do not install skills into the project, because these skills are already global.",
    'Delete any project-local `.dsh/skills/openspec-*` copies left by an earlier `openspec init --tools dsh`; they shadow this packaged set and drift on every OpenSpec update.',
    `The OpenSpec CLI is a machine prerequisite. If \`openspec\` is not found, ask the user to run \`npm install -g ${OPENSPEC_PACKAGE}@${version}\`; the setup does not install runtime prerequisites.`,
  ].join('\n')
}

/** Build the provider that lists the pinned candidates and reads their bodies on demand. */
function createSkillProvider(lock: OpenSpecLock, guidance: string): SkillProvider {
  const invocation = { modelInvocable: true, userInvocable: true }
  const candidates = new Map<string, SkillCandidate>()
  for (const record of lock.skills) {
    const file = skillFile(record)
    candidates.set(record.name, {
      name: record.name,
      description: record.description,
      invocation,
      provider: PROVIDER_NAME,
      source: 'bundled',
      resourceBase: resourceBase(file),
      rank: BUNDLED_SKILL_RANK,
      locator: file,
    })
  }
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([...candidates.values()]),
    async get(loaded, options) {
      const candidate = candidates.get(loaded.name)
      if (candidate === undefined) return undefined
      const file = String(candidate.locator)
      const raw = await readFile(file, { encoding: 'utf8', signal: options.signal })
      return {
        name: candidate.name,
        description: candidate.description,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: resourceBase(file),
        content: `${stripFrontmatter(raw)}${
          GUIDANCE_SKILLS.has(candidate.name) ? `\n\n${guidance}` : ''
        }${adapterNote(lock.version)}`,
      }
    },
  }
}

/** Register the pinned skill set from the committed lock. */
export function apply(ctx: Context): void {
  const lock = readLock()
  assertGuidanceTargets(lock.skills)
  const guidance = readGuidance()
  ctx.skills.registerProvider(() => createSkillProvider(lock, guidance))
}
