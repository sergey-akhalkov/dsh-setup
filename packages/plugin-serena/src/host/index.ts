import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

/**
 * Serena plugin: this module contributes the always-on code-surface trigger and
 * the guidance skill that describes how to use the `serena` server well. The
 * server itself is configured by the setup's lazy MCP row, so a session reaches
 * it through `mcp_tools`/`mcp_call` rather than static `mcp__serena__*` tools; a
 * profile may still add its own static adapter row.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-serena'

/** Services both registrations depend on. */
export const inject = ['skills', 'systemPrompt']

/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'serena-discipline'

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-serena'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

/** Namespaced prompt-section name, unique inside the system-prompt registry. */
const SECTION_NAME = 'dsh-setup:serena'

/** After the working contract (110) and the RTK rule (120). */
const SECTION_ORDER = 130

/** Catalog text; a test keeps it identical to the asset's frontmatter. */
const SKILL_DESCRIPTION =
  "Serena code work through the setup's lazy serena server: project activation, symbol-level retrieval and editing with exact callers, bounded calls, and the repository's checks after every symbol edit. Use only for large-file or cross-file refactors where exact callers matter."

const assetsDirectory = fileURLToPath(new URL('../assets/serena-discipline', import.meta.url))
const skillFile = join(assetsDirectory, 'SKILL.md')
const rulesFile = join(assetsDirectory, 'rules.md')

const invocation = { modelInvocable: true, userInvocable: true }

/** Row configuration; only an explicit false disables the always-on rule. */
interface BundleConfig {
  alwaysOn?: boolean
}

function skillAdapterNote(): string {
  return [
    '',
    '',
    '---',
    '',
    "DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-serena as first-party guidance adapted for this Harness; it is not pinned upstream text. The Serena MCP server itself is configured by the setup's lazy MCP row as `serena` (or by a profile's own static adapter row) and keeps working when this guidance row is disabled.",
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

/** Register the code-surface rule as a literal system-prompt section. */
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
 * always-on code-surface rule.
 */
export function apply(ctx: Context, config: BundleConfig = {}): void {
  ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()))
  if (config.alwaysOn !== false) registerRules(ctx)
}
