import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

/**
 * Ponytail plugin: registers the pinned upstream prompt as an on-demand skill
 * and, by default, as an always-on system-prompt section.
 *
 * Both contributions read the vendored files that ship beside the built module,
 * so installation, catalog listing, and prompt assembly never touch the network.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-ponytail'

/** Services both registrations depend on. */
export const inject = ['skills', 'systemPrompt']

/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'ponytail'

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-ponytail'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Namespaced prompt-section name, unique inside the system-prompt registry. */
const ALWAYS_ON_SECTION_NAME = 'dsh-setup:ponytail'

/**
 * Fixed section order: after the deployment persona prefix (`0`) and before the
 * first-party plan policy (`500`). DSH allocates central positions only for its
 * own sections, so a packaged contribution documents its chosen gap instead.
 */
const ALWAYS_ON_SECTION_ORDER = 100

const assetsDirectory = fileURLToPath(new URL('../assets/ponytail', import.meta.url))
const skillFile = join(assetsDirectory, 'SKILL.md')
const rulesFile = join(assetsDirectory, 'AGENTS.md')
const lockFile = fileURLToPath(new URL('../ponytail.lock.json', import.meta.url))

/** Row configuration accepted by the plugin; only an explicit false disables always-on. */
interface PonytailConfig {
  alwaysOn?: boolean
}

interface PonytailUpstreamIdentity {
  repository: string
  version: string
  tag: string
  commit: string
}

/** Subset of the provenance lock the runtime needs. */
interface PonytailLock {
  upstream: PonytailUpstreamIdentity
  skill: { name: string; description: string; argumentHint?: string }
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
function readPonytailLock(): PonytailLock {
  const parsed: unknown = JSON.parse(readFileSync(lockFile, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${name}: ponytail.lock.json must be a JSON object`)
  if (!isRecord(parsed.upstream)) throw new Error(`${name}: ponytail.lock.json is missing upstream`)
  if (!isRecord(parsed.skill)) throw new Error(`${name}: ponytail.lock.json is missing skill`)
  const skillName = requireString(parsed.skill.name, 'skill.name')
  if (skillName !== SKILL_NAME) {
    throw new Error(`${name}: expected skill name "${SKILL_NAME}", got "${skillName}"`)
  }
  const rawHint = parsed.skill.argumentHint
  if (rawHint !== undefined && typeof rawHint !== 'string') {
    throw new Error(`${name}: skill.argumentHint must be a string when present`)
  }
  return {
    upstream: {
      repository: requireString(parsed.upstream.repository, 'upstream.repository'),
      version: requireString(parsed.upstream.version, 'upstream.version'),
      tag: requireString(parsed.upstream.tag, 'upstream.tag'),
      commit: requireString(parsed.upstream.commit, 'upstream.commit'),
    },
    skill: {
      name: skillName,
      description: requireString(parsed.skill.description, 'skill.description'),
      ...(rawHint === undefined ? {} : { argumentHint: rawHint }),
    },
  }
}

function skillAdapterNote(lock: PonytailLock): string {
  return [
    '',
    '',
    '---',
    '',
    `DeepSeek Harness adapter: this skill was loaded from the packaged Ponytail prompt pinned at ${lock.upstream.tag} (${lock.upstream.repository}, MIT). Request a level in words ("ponytail lite", "ponytail ultra"); there is no /ponytail command in DeepSeek Harness.`,
  ].join('\n')
}

function alwaysOnFooter(lock: PonytailLock): string {
  return [
    '',
    '',
    '---',
    '',
    `Always-on note: this ruleset is packaged from Ponytail ${lock.upstream.version} (${lock.upstream.repository}, MIT) and applies by default in this deployment. Say "stop ponytail" or "normal mode" to suspend it for the rest of the session. Levels (lite, full, ultra) are requested in words; there is no /ponytail command in DeepSeek Harness.`,
  ].join('\n')
}

/** Build the provider that lists one candidate and reads its body on demand. */
function createSkillProvider(lock: PonytailLock, adapterNote: string): SkillProvider {
  const invocation = { modelInvocable: true, userInvocable: true }
  const resourceBase = {
    kind: 'directory' as const,
    path: assetsDirectory.replaceAll('\\', '/'),
  }
  const candidate: SkillCandidate = {
    name: SKILL_NAME,
    description: lock.skill.description,
    invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase,
    rank: BUNDLED_SKILL_RANK,
    locator: skillFile,
  }
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([candidate]),
    async get(loaded, options) {
      if (loaded.name !== SKILL_NAME) return undefined
      const body = await readFile(skillFile, { encoding: 'utf8', signal: options.signal })
      return {
        name: candidate.name,
        description: candidate.description,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase,
        content: `${body}${adapterNote}`,
      }
    },
  }
}

/** Register the always-on ruleset as a literal system-prompt section. */
function registerAlwaysOnRuleset(ctx: Context, lock: PonytailLock): void {
  const rules = readFileSync(rulesFile, 'utf8')
  const section: PromptSection = {
    name: ALWAYS_ON_SECTION_NAME,
    order: ALWAYS_ON_SECTION_ORDER,
    text: `${rules}${alwaysOnFooter(lock)}`,
    interpolate: false,
  }
  ctx.systemPrompt.section(section)
}

/**
 * Register the on-demand skill and, unless the row configures
 * `alwaysOn: false`, the always-on system-prompt section.
 */
export function apply(ctx: Context, config: PonytailConfig = {}): void {
  const lock = readPonytailLock()
  ctx.skills.registerProvider(() => createSkillProvider(lock, skillAdapterNote(lock)))
  if (config.alwaysOn !== false) registerAlwaysOnRuleset(ctx, lock)
}
