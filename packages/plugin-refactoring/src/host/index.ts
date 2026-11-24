import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'

/**
 * Refactoring plugin: registers the opt-in `refactoring` skill in the catalog.
 * The method body and its templates ship beside the built module, so listing
 * and loading never touch the network. Nothing is always-on.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-refactoring'

/** Service the registration depends on. */
export const inject = ['skills']

/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'refactoring'

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-refactoring'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Catalog text; a test keeps it identical to the asset's frontmatter. */
const SKILL_DESCRIPTION =
  'State-driven, behavior-preserving refactoring: a read-only audit change ranks candidate paths by evidence and ROI, the user approves one path, four proofs build a test safety net before the first production edit, and small green steps restructure the code and leave an enforceable ratchet. Opt-in; use when asked to refactor, deduplicate, or pay down architecture debt.'

const assetsDirectory = fileURLToPath(new URL('../assets/refactoring', import.meta.url))
const skillFile = join(assetsDirectory, 'SKILL.md')

const invocation = { modelInvocable: true, userInvocable: true }

function skillAdapterNote(): string {
  return [
    '',
    '',
    '---',
    '',
    'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-refactoring as first-party guidance for this Harness; it is not pinned upstream text. Its copy-ready artifacts are in `templates.md` in the same package.',
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
