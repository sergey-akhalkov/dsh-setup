import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

/**
 * RTK token-workflow plugin: registers a short always-on routing rule and one
 * on-demand skill. Both read the assets that ship inside the package, so
 * installation, catalog listing, and prompt assembly never touch the network.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-rtk'

/** Services both registrations depend on. */
export const inject = ['skills', 'systemPrompt']

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-rtk'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Namespaced prompt-section name, unique inside the system-prompt registry. */
const SECTION_NAME = 'dsh-setup:rtk'

/** After the working contract (`110`), before the first-party plan policy (`500`). */
const SECTION_ORDER = 120

const assetsDirectory = fileURLToPath(new URL('../assets', import.meta.url))
const skillDirectory = join(assetsDirectory, 'rtk')
const rulesFile = join(skillDirectory, 'rules.md')
const skillFile = join(skillDirectory, 'SKILL.md')

/** Row configuration; only an explicit false disables the always-on rule. */
interface BundleConfig {
  alwaysOn?: boolean
}

/** Catalog description; the skill frontmatter carries the same folded text. */
const SKILL_DESCRIPTION =
  'Use before running a shell command whose output may be bulky: git status/diff/log, test suites, build or lint logs, or a repo-wide search. Routes supported commands through the installed rtk CLI and keeps errors and exit codes.'

/** Build the provider that lists one candidate and reads its body on demand. */
function createSkillProvider(): SkillProvider {
  const invocation = { modelInvocable: true, userInvocable: true }
  const resourceBase = { kind: 'directory' as const, path: skillDirectory.replaceAll('\\', '/') }
  const candidate: SkillCandidate = {
    name: 'rtk',
    description: SKILL_DESCRIPTION,
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
      if (loaded.name !== 'rtk') return undefined
      const content = await readFile(skillFile, { encoding: 'utf8', signal: options.signal })
      return {
        name: candidate.name,
        description: candidate.description,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase,
        content,
      }
    },
  }
}

/** Register the routing rule as a literal system-prompt section. */
function registerRules(ctx: Context): void {
  const text = readFileSync(rulesFile, 'utf8')
  const section: PromptSection = {
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text,
    interpolate: false,
  }
  ctx.systemPrompt.section(section)
}

/**
 * Register the skill and, unless the row configures `alwaysOn: false`, the
 * always-on routing rule.
 */
export function apply(ctx: Context, config: BundleConfig = {}): void {
  ctx.skills.registerProvider(() => createSkillProvider())
  if (config.alwaysOn !== false) registerRules(ctx)
}
