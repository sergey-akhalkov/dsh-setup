import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'

/**
 * Exploratory testing plugin: registers the opt-in `exploratory-testing` skill
 * in the catalog. The method body and its templates ship beside the built
 * module, so listing and loading never touch the network. Nothing is always-on.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-exploratory-testing'

/** Service the registration depends on. */
export const inject = ['skills']

/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'exploratory-testing'

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-exploratory-testing'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Catalog text; a test keeps it identical to the asset's frontmatter. */
const SKILL_DESCRIPTION =
  'State-driven exploratory testing: rank the next area from project evidence, run timeboxed sessions inside a read-only cycle change, then turn classified findings into a reviewable outcome change with regression tests, spec corrections, and knowledge capture. Opt-in; use when asked to explore a project, hunt defects, or harden an area.'

const assetsDirectory = fileURLToPath(new URL('../assets/exploratory-testing', import.meta.url))
const skillFile = join(assetsDirectory, 'SKILL.md')

const invocation = { modelInvocable: true, userInvocable: true }

function skillAdapterNote(): string {
  return [
    '',
    '',
    '---',
    '',
    'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-exploratory-testing as first-party guidance for this Harness; it is not pinned upstream text. Its copy-ready artifacts are in `templates.md` in the same package.',
  ].join('\n')
}

/** Build the provider that lists one candidate and reads its body on demand. */
function createSkillProvider(note: string): SkillProvider {
  const candidate: SkillCandidate = {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: assetsDirectory.replaceAll('\\', '/') },
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
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: candidate.resourceBase,
        content: `${body}${note}`,
      }
    },
  }
}

/** Register the on-demand skill; no system-prompt or tool contribution. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()))
}
