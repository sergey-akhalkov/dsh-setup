import { describe, expect, it } from 'vitest'
import {
  checkBundleSelection,
  checkOwnerRowsPreserved,
  checkSetupDefaults,
  checkSetupRows,
  dumpEntryBlock,
  patchRowIds,
  readBundles,
  scalarPairs,
} from '../lib/dogfood.ts'

const DUMP = `# == @deepseek-ai/dsh-base
- id: ui-theme
  name: '@deepseek-ai/dsh-client-ui-theme'
  config:
    preference: dark
- id: ui-chat
  name: '@deepseek-ai/dsh-client-ui-chat'
  config:
    transcriptView: compact
    performanceUsage: compact
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    models:
      - id: deepseek-flash
        name: DeepSeek-V4.1-Flash
`

describe('patchRowIds', () => {
  it('reads only top-level row targets', () => {
    const patch = [
      '- id: ui-theme',
      '  config:',
      '    preference: dark',
      '- id: llm-deepseek',
      '  config:',
      '    models:',
      '      - id: deepseek-flash',
    ].join('\n')
    expect(patchRowIds(patch)).toEqual(['ui-theme', 'llm-deepseek'])
  })

  it('accepts quoted ids and removes duplicates', () => {
    const patch = ["- id: 'ui-theme'", '- id: "ui-chat"', "- id: 'ui-theme'"].join('\n')
    expect(patchRowIds(patch)).toEqual(['ui-theme', 'ui-chat'])
  })

  it('ignores a line that only looks like a row target', () => {
    expect(patchRowIds('  - id: ui-theme\n- insert:\n    - id: nested\n')).toEqual([])
  })
})

describe('dumpEntryBlock', () => {
  it('captures the row config and stops at the next entry or layer comment', () => {
    expect(dumpEntryBlock(DUMP, 'ui-chat')).toBe(
      [
        '- id: ui-chat',
        "  name: '@deepseek-ai/dsh-client-ui-chat'",
        '  config:',
        '    transcriptView: compact',
        '    performanceUsage: compact',
      ].join('\n'),
    )
  })

  it('does not match a nested id inside another row', () => {
    expect(dumpEntryBlock(DUMP, 'deepseek-flash')).toBeUndefined()
  })

  it('returns undefined for a missing row', () => {
    expect(dumpEntryBlock(DUMP, 'agent-default-model')).toBeUndefined()
  })
})

describe('checkOwnerRowsPreserved', () => {
  it('accepts identical owner rows', () => {
    expect(checkOwnerRowsPreserved(['ui-theme', 'ui-chat'], DUMP, DUMP)).toEqual([])
  })

  it('reports a changed owner row', () => {
    const installed = DUMP.replace('preference: dark', 'preference: light')
    expect(checkOwnerRowsPreserved(['ui-theme'], DUMP, installed)).toEqual([
      'owner row "ui-theme" changed after installation',
    ])
  })

  it('reports a disappeared owner row', () => {
    const installed = DUMP.replace(
      /# == @deepseek-ai\/dsh-base\n- id: ui-theme[\s\S]*?(?=- id:)/,
      '',
    )
    expect(checkOwnerRowsPreserved(['ui-theme'], DUMP, installed)).toContain(
      'owner row "ui-theme" disappeared after installation',
    )
  })

  it('requires only presence when the baseline did not compose the row', () => {
    const baseline = DUMP.replace(
      /# == @deepseek-ai\/dsh-base\n- id: ui-theme[\s\S]*?(?=- id:)/,
      '',
    )
    expect(checkOwnerRowsPreserved(['ui-theme'], baseline, DUMP)).toEqual([])
    expect(checkOwnerRowsPreserved(['ui-theme'], baseline, baseline)).toEqual([
      'owner row "ui-theme" is missing from both dumps',
    ])
  })
})

describe('scalarPairs', () => {
  it('flattens nested mappings and skips arrays', () => {
    expect(
      scalarPairs({
        preference: 'dark',
        count: 2,
        enabled: true,
        nothing: null,
        nested: { model: 'deepseek-flash' },
        list: ['text', 'image'],
      }),
    ).toEqual([
      'preference: dark',
      'count: 2',
      'enabled: true',
      'nothing: null',
      'model: deepseek-flash',
    ])
  })

  it('ignores non-object config values', () => {
    expect(scalarPairs('text')).toEqual([])
    expect(scalarPairs(undefined)).toEqual([])
  })
})

describe('checkSetupDefaults', () => {
  const themeDefault = { id: 'ui-theme', config: { preference: 'dark' } }
  const modelDefault = {
    id: 'agent-default-model',
    config: { provider: 'deepseek-account', reasoningEffort: 'high' },
  }
  const defaults = [themeDefault, modelDefault]

  it('accepts a default present in the composed profile', () => {
    expect(checkSetupDefaults([themeDefault], [], DUMP)).toEqual([])
  })

  it('reports a missing default row', () => {
    expect(checkSetupDefaults(defaults, [], DUMP)).toContain(
      'setup default row "agent-default-model" is missing from the composed profile',
    )
  })

  it('reports a default value that did not become effective', () => {
    const installed = DUMP.replace('preference: dark', 'preference: light')
    expect(checkSetupDefaults([themeDefault], [], installed)).toContain(
      'setup default "ui-theme" lacks effective value "preference: dark"',
    )
  })

  it('skips rows the owner patch overrides because the owner value wins', () => {
    expect(checkSetupDefaults(defaults, ['ui-theme'], DUMP)).toEqual([
      'setup default row "agent-default-model" is missing from the composed profile',
    ])
  })
})

describe('checkSetupRows', () => {
  it('accepts composed setup rows', () => {
    expect(checkSetupRows(['ui-theme'], DUMP)).toEqual([])
  })

  it('reports a missing setup row', () => {
    expect(checkSetupRows(['dsh-setup-composer-clock'], DUMP)).toEqual([
      'setup row "dsh-setup-composer-clock" is missing from the composed profile',
    ])
  })
})

describe('checkBundleSelection', () => {
  const before = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  const installBundles = ['@deepseek-ai/dsh-experimental-terminal-bundle']
  const after = [...before, '@deepseek-ai/dsh-experimental-terminal-bundle', '@dsh-setup/setup']

  it('accepts the installer append-only selection', () => {
    expect(checkBundleSelection(before, after, installBundles)).toEqual([])
  })

  it('reports removed or reordered bundles', () => {
    expect(
      checkBundleSelection(before, ['@deepseek-ai/dsh-web-app', '@dsh-setup/setup'], []),
    ).toContain('bundle "@deepseek-ai/dsh-base" was removed or reordered')
  })

  it('reports a setup bundle that is not last', () => {
    const selection = [
      ...before,
      '@dsh-setup/setup',
      '@deepseek-ai/dsh-experimental-terminal-bundle',
    ]
    expect(checkBundleSelection(before, selection, installBundles)).toContain(
      'the setup bundle is not the last selected bundle',
    )
  })

  it('reports duplicate and missing installer bundles', () => {
    const problems = checkBundleSelection(
      before,
      [...before, '@dsh-setup/setup', '@dsh-setup/setup'],
      installBundles,
    )
    expect(problems).toContain('the setup bundle is selected 2 time(s)')
    expect(problems).toContain(
      'installer bundle "@deepseek-ai/dsh-experimental-terminal-bundle" is not selected',
    )
  })
})

describe('readBundles', () => {
  it('reads the recorded selection and tolerates an empty profile', () => {
    expect(readBundles({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } })).toEqual([
      '@deepseek-ai/dsh-base',
    ])
    expect(readBundles({})).toEqual([])
  })
})
