import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Definition, validateDefinition, withSource } from '../src/host/definitions.ts'

/**
 * The `change-intake` definition contributed by the OpenSpec plugin. The engine
 * no longer ships it, so tests that exercise the intake read the plugin asset
 * exactly as the registry contribution does.
 */
export function contributedIntake(): Definition {
  return validateDefinition(readIntakeAsset())
}

/**
 * The same intake as the registry installs it: a plugin-sourced definition, so
 * its effective ownership follows the profile's per-signal legacy switch. The
 * source-less `contributedIntake()` has no switch and resolves its own step.
 */
export function registeredIntake(): Definition {
  return withSource(contributedIntake(), 'plugin')
}

/**
 * The same intake with its `spec-review` step returned to the retired deferred
 * shape: tests that need a deferred step beside owned steps use this synthetic
 * copy instead of the shipped definition, which is owned by the review executor.
 */
export function deferredIntake(): Definition {
  const raw = readIntakeAsset() as { steps: Array<Record<string, unknown>> }
  const review = raw.steps.find((step) => step.id === 'spec-review')
  if (review === undefined) throw new Error('the contributed intake has no spec-review step')
  Object.assign(review, {
    executor: 'tool',
    ownership: 'defer',
    legacy: { plugin: 'delegation-rules', signal: 'spec-review' },
    tool: { name: 'delegate', args: { rule: 'spec-review', change: '{name}' } },
    evidence: {
      kind: 'record',
      path: '.dsh/delegation/spec-review/{name}/spec.json',
      rule: 'spec-review',
      change: '{name}',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'current',
    },
  })
  delete review.review
  return validateDefinition(raw)
}

function readIntakeAsset(): unknown {
  return JSON.parse(
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
