import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'

/**
 * Rust plugin: registers the packaged `rust` skill in the catalog. The body and
 * its references ship beside the built module, so listing and loading never
 * touch the network.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-rust'

/** Service the registration depends on. */
export const inject = ['skills']

/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'rust'

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-rust'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Catalog text; a test keeps it identical to the asset's frontmatter. */
const SKILL_DESCRIPTION =
  "Rust and Cargo work: use a newer standard-library feature only when the project's MSRV covers it, pick the narrowest check, test or clippy command for the job, and diagnose slow builds, slow tests and a growing target directory. Use for any Rust edit or review, and only then."

const assetsDirectory = fileURLToPath(new URL('../assets/rust', import.meta.url))
const skillFile = join(assetsDirectory, 'SKILL.md')

const invocation = { modelInvocable: true, userInvocable: true }

function skillAdapterNote(): string {
  return [
    '',
    '',
    '---',
    '',
    'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-rust as first-party guidance adapted for this Harness; it is not pinned upstream text. Its detailed references are `references/cargo-workflows.md` and `references/std-replacements.md` in the same package.',
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

/** Register the on-demand skill. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()))
}
