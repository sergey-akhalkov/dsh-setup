import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'

/**
 * The `change-intake` definition contributed by the OpenSpec plugin. The engine
 * no longer ships it, so tests that exercise the intake read the plugin asset
 * exactly as the registry contribution does.
 */
export function contributedIntake(): Definition {
  return validateDefinition(
    JSON.parse(
      readFileSync(
        join(
          fileURLToPath(new URL('.', import.meta.url)),
          '..',
          '..',
          'plugin-openspec',
          'assets',
          'workflows',
          'change-intake.json',
        ),
        'utf8',
      ),
    ) as unknown,
  )
}

/** The absolute path of the plugin's workflow assets directory. */
export function openspecWorkflowAssets(): string {
  return join(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    '..',
    'plugin-openspec',
    'assets',
    'workflows',
  )
}
