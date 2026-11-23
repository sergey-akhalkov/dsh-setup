import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { artifactSnapshot, changedArtifacts, runDev } from '../dev.ts'
import { quoteShellArgument } from '../lib/cli.ts'
import {
  ACCEPTED_FLAGS,
  classifyArtifacts,
  cliDisplay,
  devProfilePaths,
  findPlugin,
  hostArgs,
  initArgs,
  installArgs,
  linkSpec,
  managedNames,
  mirrorPlan,
  parseDevArgs,
  patchText,
  recompositionTrigger,
  reconcilePlan,
  removeArgs,
  resolveHome,
  workspaceDevPlugins,
} from '../lib/dev-loop.ts'
import { SETUP_PACKAGE_NAME, type WorkspacePackage } from '../lib/workspace.ts'

const PLUGINS = [
  {
    name: '@dsh-setup/plugin-alpha',
    dir: '/repo/packages/plugin-alpha',
    shortName: 'plugin-alpha',
  },
  { name: '@dsh-setup/plugin-beta', dir: '/repo/packages/plugin-beta', shortName: 'plugin-beta' },
]

function entries(text: string): Array<Record<string, unknown>> {
  return parse(text) as Array<Record<string, unknown>>
}

describe('parseDevArgs', () => {
  it('defaults to setup mode', () => {
    expect(parseDevArgs([])).toEqual({ mode: 'setup', refresh: false })
  })

  it('selects one plugin with either flag form', () => {
    expect(parseDevArgs(['--plugin', 'plugin-alpha'])).toEqual({
      mode: 'plugin',
      plugin: 'plugin-alpha',
      refresh: false,
    })
    expect(parseDevArgs(['--plugin=plugin-alpha', '--refresh'])).toEqual({
      mode: 'plugin',
      plugin: 'plugin-alpha',
      refresh: true,
    })
  })

  it('rejects an unsupported argument naming the accepted flags', () => {
    expect(() => parseDevArgs(['--bogus'])).toThrow(/unsupported argument "--bogus"/)
    expect(() => parseDevArgs(['--bogus'])).toThrow(ACCEPTED_FLAGS)
  })

  it('rejects a missing or flag-like plugin value', () => {
    expect(() => parseDevArgs(['--plugin'])).toThrow(/--plugin needs a plugin name/)
    expect(() => parseDevArgs(['--plugin', '--refresh'])).toThrow(/--plugin needs a plugin name/)
    expect(() => parseDevArgs(['--plugin='])).toThrow(/--plugin needs a plugin name/)
  })
})

describe('findPlugin', () => {
  it('matches the package name and the directory name', () => {
    expect(findPlugin(PLUGINS, '@dsh-setup/plugin-beta').shortName).toBe('plugin-beta')
    expect(findPlugin(PLUGINS, 'plugin-alpha').name).toBe('@dsh-setup/plugin-alpha')
  })

  it('names the requested package and the accepted ones when unknown', () => {
    expect(() => findPlugin(PLUGINS, 'plugin-omega')).toThrow(/unknown plugin "plugin-omega"/)
    expect(() => findPlugin(PLUGINS, 'plugin-omega')).toThrow(/plugin-alpha, plugin-beta/)
  })
})

describe('managedNames', () => {
  it('lists the setup bundle and every workspace plugin', () => {
    expect(managedNames(PLUGINS)).toEqual([
      SETUP_PACKAGE_NAME,
      '@dsh-setup/plugin-alpha',
      '@dsh-setup/plugin-beta',
    ])
  })
})

describe('linkSpec', () => {
  it('links a checkout with forward slashes', () => {
    expect(linkSpec('/repo\\packages\\plugin-alpha')).toBe('link:/repo/packages/plugin-alpha')
  })
})

describe('mirrorPlan', () => {
  const DESKTOP = {
    dependencies: {
      '@dsh-setup/setup': 'github:example/setup#abc&path:/packages/setup',
      'huashu-design': 'github:alchaincyf/huashu-design#937',
      '@dsh-setup/plugin-alpha': 'link:/repo/packages/plugin-alpha',
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          '@deepseek-ai/dsh-experimental-session-search',
          'huashu-design',
          '@dsh-setup/plugin-alpha',
          '@dsh-setup/setup',
        ],
      },
    },
  }

  it('mirrors the desktop selection for setup mode', () => {
    const plan = mirrorPlan(DESKTOP, SETUP_PACKAGE_NAME, managedNames(PLUGINS))
    expect(plan?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-experimental-session-search',
      'huashu-design',
      SETUP_PACKAGE_NAME,
    ])
    expect(plan?.installs).toEqual([
      { name: 'huashu-design', spec: 'github:alchaincyf/huashu-design#937' },
    ])
  })

  it('mirrors the desktop selection for plugin mode without the setup', () => {
    const plan = mirrorPlan(DESKTOP, '@dsh-setup/plugin-beta', managedNames(PLUGINS))
    expect(plan?.bundles).not.toContain(SETUP_PACKAGE_NAME)
    expect(plan?.bundles).not.toContain('@dsh-setup/plugin-alpha')
    expect(plan?.bundles.at(-1)).toBe('@dsh-setup/plugin-beta')
    expect(plan?.installs.map((entry) => entry.name)).toEqual(['huashu-design'])
  })

  it('returns undefined without a desktop profile', () => {
    expect(mirrorPlan(undefined, SETUP_PACKAGE_NAME, managedNames(PLUGINS))).toBeUndefined()
  })
})

describe('resolveHome', () => {
  it('prefers a non-empty DSH_HOME', () => {
    expect(resolveHome({ DSH_HOME: '/harness' }, '/default')).toBe('/harness')
  })

  it('falls back when DSH_HOME is unset or blank', () => {
    expect(resolveHome({}, '/default')).toBe('/default')
    expect(resolveHome({ DSH_HOME: '  ' }, '/default')).toBe('/default')
  })
})

describe('devProfilePaths', () => {
  it('points at the development profile under the home', () => {
    expect(devProfilePaths('/harness')).toEqual({
      profileDir: join('/harness', 'profiles', 'dev'),
      manifestPath: join('/harness', 'profiles', 'dev', 'package.json'),
      patchPath: join('/harness', 'profiles', 'dev', 'cordis.patch.yml'),
    })
  })

  it('refuses the desktop profile', () => {
    expect(() => devProfilePaths('/harness', 'desktop')).toThrow(
      /profile "desktop" is managed exclusively by the Desktop application/,
    )
  })
})

describe('reconcilePlan', () => {
  const managed = managedNames(PLUGINS)

  it('switches setup mode to a plugin without leaving the setup selection', () => {
    const plan = reconcilePlan(
      { [SETUP_PACKAGE_NAME]: 'link:/repo/packages/setup' },
      [SETUP_PACKAGE_NAME],
      '@dsh-setup/plugin-alpha',
      managed,
    )
    expect(plan).toEqual({
      removals: [SETUP_PACKAGE_NAME],
      addition: '@dsh-setup/plugin-alpha',
    })
  })

  it('switches a plugin back to setup mode', () => {
    const plan = reconcilePlan(
      { '@dsh-setup/plugin-alpha': 'link:/repo/packages/plugin-alpha' },
      ['@dsh-setup/plugin-alpha'],
      SETUP_PACKAGE_NAME,
      managed,
    )
    expect(plan).toEqual({
      removals: ['@dsh-setup/plugin-alpha'],
      addition: SETUP_PACKAGE_NAME,
    })
  })

  it('switches one plugin to another and leaves unrelated dependencies alone', () => {
    const plan = reconcilePlan(
      {
        '@dsh-setup/plugin-alpha': 'link:/repo/packages/plugin-alpha',
        'huashu-design': 'github:alchaincyf/huashu-design#abc',
      },
      ['@dsh-setup/plugin-alpha', 'huashu-design'],
      '@dsh-setup/plugin-beta',
      managed,
    )
    expect(plan.removals).toEqual(['@dsh-setup/plugin-alpha'])
    expect(plan.removals).not.toContain('huashu-design')
  })

  it('reuses the same mode without a removal', () => {
    const plan = reconcilePlan(
      { '@dsh-setup/plugin-alpha': 'link:/repo/packages/plugin-alpha' },
      ['@dsh-setup/plugin-alpha'],
      '@dsh-setup/plugin-alpha',
      managed,
    )
    expect(plan.removals).toEqual([])
  })
})

describe('patchText', () => {
  const LIB = '/repo\\packages\\plugin-alpha\\lib'
  const MIXED = [
    '- id: ui-theme',
    "  name: '@deepseek-ai/dsh-client-ui-theme'",
    '  config:',
    '    preference: dark',
    '    disabled: !!js false',
    '- id: hmr',
    "  name: '@deepseek-ai/dsh-hmr'",
    '  config:',
    "    root: ['/old/lib']",
    '# sessions follow',
    '- id: sessions',
    '  name: "@deepseek-ai/dsh-session-persistence"',
    '  config:',
    '    path: !!js dshHomePath("sessions")',
    '',
  ].join('\n')

  it('removes only the owned entry in setup mode and keeps unrelated !!js values', () => {
    const output = patchText(MIXED, 'setup')
    expect(output).not.toContain('@deepseek-ai/dsh-hmr')
    expect(output).toContain('disabled: !!js false')
    expect(output).toContain('path: !!js dshHomePath("sessions")')
    expect(output).toContain('# sessions follow')
  })

  it('appends the owned entry in plugin mode and keeps unrelated !!js values', () => {
    const output = patchText(MIXED, 'plugin', { libDir: LIB })
    expect(output).toContain('disabled: !!js false')
    expect(output).toContain('path: !!js dshHomePath("sessions")')
    expect(output.match(/id: hmr/gu)).toHaveLength(1)
    expect(output).toContain('root: ["/repo/packages/plugin-alpha/lib"]')
  })

  it('leaves a nested array inside an unrelated tagged value alone', () => {
    const nested = [
      '- id: weird',
      '  name: "@deepseek-ai/dsh-weird"',
      '  config:',
      '    value: !!js |',
      '      []',
      '',
    ].join('\n')
    const output = patchText(nested, 'plugin', { libDir: LIB })
    expect(output).toContain('value: !!js |')
    expect(output).toContain('      []')
    expect(output.match(/id: hmr/gu)).toHaveLength(1)
  })

  it('handles an empty root array that carries an inline comment', () => {
    const output = patchText('[] # local overrides', 'plugin', { libDir: LIB })
    expect(output).toContain('local overrides')
    expect(entries(output)).toHaveLength(1)
  })

  it('finds an owned entry whose id carries an inline comment', () => {
    const commented = [
      '- id: hmr # module watcher',
      '  name: "@deepseek-ai/dsh-hmr"',
      '  config:',
      "    root: ['/old/lib']",
      '',
    ].join('\n')
    expect(patchText(commented, 'setup')).not.toContain('id: hmr')
    const output = patchText(commented, 'plugin', { libDir: LIB })
    expect(output.match(/id: hmr/gu)).toHaveLength(1)
    expect(output).toContain('root: ["/repo/packages/plugin-alpha/lib"]')
    expect(output).not.toContain('/old/lib')
  })

  it('replaces the shipped empty-array marker and keeps the template comments', () => {
    const template = '# Your patch layer for this dsh profile\n# keep me\n[]\n'
    const output = patchText(template, 'plugin', { libDir: LIB })
    expect(output).toContain('# Your patch layer for this dsh profile')
    expect(output).toContain('# keep me')
    expect(output).not.toContain('[]')
    expect(entries(output)).toHaveLength(1)
  })

  it('is idempotent in plugin mode', () => {
    const once = patchText('[]', 'plugin', { libDir: LIB })
    const twice = patchText(once, 'plugin', { libDir: LIB })
    expect(twice.match(/id: hmr/gu)).toHaveLength(1)
    expect(entries(twice)).toEqual([
      {
        id: 'hmr',
        name: '@deepseek-ai/dsh-hmr',
        config: { root: ['/repo/packages/plugin-alpha/lib'] },
      },
    ])
  })

  it('removes the entry when plugin mode switches back to setup mode', () => {
    const withEntry = patchText('[]', 'plugin', { libDir: LIB })
    expect(patchText(withEntry, 'setup')).not.toContain('id: hmr')
  })

  it('keeps an empty patch a valid YAML array for setup mode', () => {
    const onlyEntry = patchText('[]', 'plugin', { libDir: LIB })
    expect(patchText(onlyEntry, 'setup')).toBe('[]\n')
    expect(patchText('', 'setup')).toBe('[]\n')
    expect(entries(patchText('', 'setup'))).toEqual([])
  })

  it('requires the build directory in plugin mode', () => {
    expect(() => patchText('[]', 'plugin')).toThrow(/needs the linked package build directory/)
  })

  it('rejects a patch whose first content is not an array', () => {
    expect(() => patchText('id: hmr', 'setup')).toThrow(/not a YAML array/)
  })

  it('removes an entry whose indicator is on its own line', () => {
    const text = [
      '-',
      '  id: hmr',
      '  name: "@deepseek-ai/dsh-hmr"',
      '  config:',
      '    root: ["/old/lib"]',
      '-',
      '  id: x',
      '  name: y',
      '',
    ].join('\n')
    const removed = patchText(text, 'setup')
    expect(removed).not.toContain('@deepseek-ai/dsh-hmr')
    expect(entries(removed)).toEqual([{ id: 'x', name: 'y' }])
    const replaced = patchText(text, 'plugin', { libDir: LIB })
    expect(entries(replaced)).toHaveLength(2)
    expect(entries(replaced)[1]).toMatchObject({ id: 'x' })
  })

  it('keeps an unrelated trailing block scalar identical when appending', () => {
    const text =
      '- id: prompt\n  name: "@deepseek-ai/dsh-prompt"\n  config:\n    prompt: |+\n      Keep this ending\n\n\n'
    const before = entries(text)[0]
    const output = patchText(text, 'plugin', { libDir: LIB })
    expect(entries(output)).toHaveLength(2)
    expect(entries(output)[0]).toEqual(before)
  })

  it('appends to a non-empty flow sequence', () => {
    const flow =
      '[{id: ui-theme, name: "@deepseek-ai/dsh-client-ui-theme", config: {preference: dark}}]'
    const output = patchText(flow, 'plugin', { libDir: LIB })
    const parsed = entries(output)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ id: 'ui-theme' })
    expect(parsed[1]).toMatchObject({
      id: 'hmr',
      config: { root: ['/repo/packages/plugin-alpha/lib'] },
    })
  })

  it('replaces and removes an owned item inside a flow sequence', () => {
    const flow =
      '[{id: hmr, name: "@deepseek-ai/dsh-hmr", config: {root: ["/old/lib"]}}, {id: x, name: y}]'
    const replaced = patchText(flow, 'plugin', { libDir: LIB })
    expect(replaced).not.toContain('/old/lib')
    expect(entries(replaced)).toHaveLength(2)
    const removed = patchText(flow, 'setup')
    expect(removed).not.toContain('@deepseek-ai/dsh-hmr')
    expect(entries(removed)).toEqual([{ id: 'x', name: 'y' }])
  })

  it('edits an indented block sequence without corrupting the indicator', () => {
    const indented = [
      '  - id: hmr',
      '    name: "@deepseek-ai/dsh-hmr"',
      '    config:',
      '      root: ["/old/lib"]',
      '  - id: x',
      '    name: y',
      '',
    ].join('\n')
    const removed = patchText(indented, 'setup')
    expect(removed).not.toContain('@deepseek-ai/dsh-hmr')
    expect(entries(removed)).toEqual([{ id: 'x', name: 'y' }])
    const replaced = patchText(indented, 'plugin', { libDir: LIB })
    expect(replaced).not.toContain('  - - id: hmr')
    expect(entries(replaced)).toHaveLength(2)
  })

  it('handles an indicator that carries a comment', () => {
    const commented = [
      '- # module watcher',
      '  id: hmr',
      '  name: "@deepseek-ai/dsh-hmr"',
      '  config:',
      '    root: ["/old/lib"]',
      '- id: x',
      '  name: y',
      '',
    ].join('\n')
    const removed = patchText(commented, 'setup')
    expect(removed).not.toContain('@deepseek-ai/dsh-hmr')
    expect(entries(removed)).toEqual([{ id: 'x', name: 'y' }])
    const replaced = patchText(commented, 'plugin', { libDir: LIB })
    expect(entries(replaced)).toHaveLength(2)
    expect(entries(replaced)[1]).toEqual({ id: 'x', name: 'y' })
  })

  it('handles an anchored indicator', () => {
    const anchored = [
      '- &watcher',
      '  id: hmr',
      '  name: "@deepseek-ai/dsh-hmr"',
      '  config:',
      '    root: ["/old/lib"]',
      '- id: x',
      '  name: y',
      '',
    ].join('\n')
    const removed = patchText(anchored, 'setup')
    expect(removed).not.toContain('@deepseek-ai/dsh-hmr')
    expect(entries(removed)).toEqual([{ id: 'x', name: 'y' }])
    const replaced = patchText(anchored, 'plugin', { libDir: LIB })
    expect(entries(replaced)).toHaveLength(2)
  })

  it('appends to a flow sequence that already ends with a comma', () => {
    const flow = '[{id: x, name: y},]'
    const output = patchText(flow, 'plugin', { libDir: LIB })
    expect(output).not.toContain(',,')
    expect(entries(output)).toHaveLength(2)
  })

  it('does not treat a comma inside a trailing comment as a separator', () => {
    const flow = '[{id: x, name: y} # keep x,\n]'
    const output = patchText(flow, 'plugin', { libDir: LIB })
    expect(output).toContain('# keep x,')
    expect(entries(output)).toHaveLength(2)
  })

  it('appends before a document terminator', () => {
    const terminated = '- id: x\n  name: y\n...\n'
    const output = patchText(terminated, 'plugin', { libDir: LIB })
    const parsed = entries(output)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ id: 'x', name: 'y' })
  })
})

describe('command arguments', () => {
  it('boots the host without opening a browser', () => {
    expect(hostArgs()).toEqual(['--profile', 'dev', '--no-open'])
  })

  it('creates the profile from the web template and exits', () => {
    expect(initArgs()).toEqual([
      '--profile',
      'dev',
      '--from-default-profile',
      'web',
      '--dump-config',
    ])
  })

  it('installs and removes through the CLI plugin command', () => {
    expect(installArgs('dev', 'link:/repo/packages/plugin-alpha')).toEqual([
      'plugin',
      '--profile',
      'dev',
      'add',
      'link:/repo/packages/plugin-alpha',
    ])
    expect(removeArgs('dev', SETUP_PACKAGE_NAME)).toEqual([
      'plugin',
      '--profile',
      'dev',
      'remove',
      SETUP_PACKAGE_NAME,
    ])
  })
})

describe('cliDisplay', () => {
  it('names the source, the resolved line and the reported version', () => {
    expect(
      cliDisplay({
        commandLine: 'pnpm dlx @deepseek-ai/dsh@0.2.2-rc.2',
        executable: 'x',
        source: 'dlx',
      }),
    ).toBe('Harness CLI (dlx): pnpm dlx @deepseek-ai/dsh@0.2.2-rc.2')
    expect(
      cliDisplay(
        { commandLine: 'dsh.cmd', executable: 'dsh.cmd', source: 'installed' },
        '0.2.2-rc.5',
      ),
    ).toBe('Harness CLI (installed): dsh.cmd (version 0.2.2-rc.5)')
  })
})

describe('recompositionTrigger', () => {
  it('adds a standalone comment line without touching the last value', () => {
    expect(recompositionTrigger('- id: x\n  config:\n    preference: dark', 1)).toBe(
      '\n# dev rebuild 1\n',
    )
    expect(recompositionTrigger('[]\n', 2)).toBe('# dev rebuild 2\n')
    expect(recompositionTrigger('', 3)).toBe('# dev rebuild 3\n')
  })
})

describe('classifyArtifacts', () => {
  it('classifies client, host, both and nothing', () => {
    expect(classifyArtifacts(['packages/a/lib/client.js'])).toBe('client')
    expect(classifyArtifacts(['packages/a/lib/index.js'])).toBe('host')
    expect(classifyArtifacts(['packages/a/lib/index.js', 'packages/a/lib/client.js'])).toBe('both')
    expect(classifyArtifacts([])).toBe('none')
  })

  it('ignores declarations, maps and files outside lib', () => {
    expect(classifyArtifacts(['packages/a/lib/index.d.ts', 'packages/a/lib/index.js.map'])).toBe(
      'none',
    )
    expect(classifyArtifacts(['packages/a/src/index.ts'])).toBe('none')
  })

  it('accepts Windows separators', () => {
    expect(classifyArtifacts(['packages\\a\\lib\\index.js'])).toBe('host')
  })

  it('treats a nested module named client.js as host code', () => {
    expect(classifyArtifacts(['packages/a/lib/host/client.js'])).toBe('host')
    expect(classifyArtifacts(['packages/a/lib/client.js'])).toBe('client')
  })
})

const FAKE_CLI = [
  "import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'",
  "import { spawn } from 'node:child_process'",
  "import { join } from 'node:path'",
  '',
  'const args = process.argv.slice(2)',
  'const home = process.env.DSH_HOME',
  "const profileDir = join(home, 'profiles', 'dev')",
  "const manifestPath = join(profileDir, 'package.json')",
  "const patchPath = join(profileDir, 'cordis.patch.yml')",
  '',
  'function readManifest() {',
  '  if (!existsSync(manifestPath)) {',
  "    return { name: 'dsh-profile-dev', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }",
  '  }',
  "  return JSON.parse(readFileSync(manifestPath, 'utf8'))",
  '}',
  'function writeManifest(m) {',
  '  mkdirSync(profileDir, { recursive: true })',
  "  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\\n')",
  '}',
  '',
  "if (args.includes('--version')) {",
  "  console.log('0.0.0-test')",
  '  process.exit(0)',
  '}',
  "if (args[0] === '--profile' && args.includes('--dump-config')) {",
  '  const m = readManifest()',
  '  m.dsh = m.dsh || {}',
  '  m.dsh.profile = m.dsh.profile || {}',
  "  m.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']",
  '  writeManifest(m)',
  '  if (!existsSync(patchPath)) {',
  '    mkdirSync(profileDir, { recursive: true })',
  "    writeFileSync(patchPath, '# template\\n[]\\n')",
  '  }',
  '  process.exit(0)',
  '}',
  "if (args[0] === 'plugin') {",
  '  const action = args[3]',
  '  const spec = args[4]',
  '  const m = readManifest()',
  '  m.dependencies = m.dependencies || {}',
  '  m.dsh = m.dsh || {}',
  '  m.dsh.profile = m.dsh.profile || {}',
  '  m.dsh.profile.bundles = m.dsh.profile.bundles || []',
  "  if (action === 'add') {",
  "    if (!spec.startsWith('link:')) {",
  "      const log = join(process.env.FAKE_STATE_DIR, 'installs.txt')",
  "      const existing = existsSync(log) ? readFileSync(log, 'utf8') : ''",
  "      writeFileSync(log, existing + spec + '\\n')",
  '      process.exit(0)',
  '    }',
  '    const dir = spec.slice(5)',
  "    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))",
  '    m.dependencies[pkg.name] = spec',
  '    if (!m.dsh.profile.bundles.includes(pkg.name)) m.dsh.profile.bundles.push(pkg.name)',
  "  } else if (action === 'remove') {",
  '    delete m.dependencies[spec]',
  '    m.dsh.profile.bundles = m.dsh.profile.bundles.filter(function (name) { return name !== spec })',
  '  }',
  '  writeManifest(m)',
  '  process.exit(0)',
  '}',
  '',
  "const port = process.env.FAKE_PORT || '31999'",
  "const grandchild = spawn(process.execPath, [join(process.env.FAKE_STATE_DIR, 'fake-grandchild.mjs')], { stdio: 'ignore', detached: process.platform === 'win32' })",
  "writeFileSync(join(process.env.FAKE_STATE_DIR, 'host.pid'), String(process.pid))",
  "writeFileSync(join(process.env.FAKE_STATE_DIR, 'grandchild.pid'), String(grandchild.pid))",
  "console.log('dsh web: http://127.0.0.1:' + port + '/')",
  "if (process.env.FAKE_HOST_MODE === 'exit-now') process.exit(0)",
  "const stopFile = join(process.env.FAKE_STATE_DIR, 'stop')",
  'setInterval(function () { if (existsSync(stopFile)) process.exit(0) }, 50)',
  '',
].join('\n')

interface Harness {
  root: string
  home: string
  stateDir: string
  pluginDir: string
  setupPackageDir: string
  env: NodeJS.ProcessEnv
  logs: string[]
  genLog: string
  cliLine: string
  watcherCommand: string
  genCommand: string
  packages: WorkspacePackage[]
  cleanup: () => void
}

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dev-loop-'))
  const home = join(root, 'home')
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(
    join(stateDir, 'fake-grandchild.mjs'),
    "import { existsSync } from 'node:fs'\nconst stop = process.env.FAKE_STATE_DIR + '/stop'\nsetInterval(function () { if (existsSync(stop)) process.exit(0) }, 50)\n",
    'utf8',
  )
  const pluginDir = join(root, 'packages', 'plugin-alpha')
  mkdirSync(join(pluginDir, 'lib'), { recursive: true })
  writeFileSync(
    join(pluginDir, 'package.json'),
    JSON.stringify({ name: '@dsh-setup/plugin-alpha', version: '0.54.0' }),
    'utf8',
  )
  writeFileSync(join(pluginDir, 'lib', 'index.js'), '// host\n', 'utf8')
  writeFileSync(join(pluginDir, 'lib', 'client.js'), '// client\n', 'utf8')
  const setupPackageDir = join(root, 'packages', 'setup')
  mkdirSync(setupPackageDir, { recursive: true })
  writeFileSync(
    join(setupPackageDir, 'package.json'),
    JSON.stringify({ name: '@dsh-setup/setup', version: '0.54.0' }),
    'utf8',
  )
  const desktopDir = join(home, 'profiles', 'desktop')
  mkdirSync(desktopDir, { recursive: true })
  writeFileSync(
    join(desktopDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-desktop',
        private: true,
        dependencies: {
          '@dsh-setup/setup': 'github:example/setup#abc&path:/packages/setup',
          'huashu-design': 'github:example/huashu#937',
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              '@deepseek-ai/dsh-experimental-session-search',
              'huashu-design',
              '@dsh-setup/setup',
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(
    join(desktopDir, 'cordis.patch.yml'),
    '- id: ui-chat\n  name: "@deepseek-ai/dsh-client-ui-chat"\n  config:\n    transcriptView: standard\n',
    'utf8',
  )
  const fakeCli = join(root, 'fake-cli.mjs')
  writeFileSync(fakeCli, FAKE_CLI, 'utf8')
  const fakeWatcher = join(root, 'fake-watcher.mjs')
  writeFileSync(fakeWatcher, 'setInterval(function () {}, 1000)\n', 'utf8')
  const fakeGen = join(root, 'fake-gen.mjs')
  writeFileSync(
    fakeGen,
    "import { appendFileSync } from 'node:fs'\nappendFileSync(process.env.FAKE_STATE_DIR + '/gen.log', 'gen\\n')\n",
    'utf8',
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_CLI: `${quoteShellArgument(process.execPath)} ${quoteShellArgument(fakeCli)}`,
    FAKE_STATE_DIR: stateDir,
  }
  return {
    root,
    home,
    stateDir,
    pluginDir,
    setupPackageDir,
    env,
    logs: [],
    genLog: join(stateDir, 'gen.log'),
    cliLine: env.DSH_CLI ?? '',
    watcherCommand: `${quoteShellArgument(process.execPath)} ${quoteShellArgument(fakeWatcher)}`,
    genCommand: `${quoteShellArgument(process.execPath)} ${quoteShellArgument(fakeGen)}`,
    packages: [
      {
        dir: pluginDir,
        relativeDir: 'packages/plugin-alpha',
        manifest: { name: '@dsh-setup/plugin-alpha', version: '0.54.0' },
      },
    ],
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      } catch {
        // A temp directory one surviving process still holds is left to the OS.
      }
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs)
      throw new Error('timed out waiting for the development host')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now()
  while (alive(pid)) {
    if (Date.now() - started > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}

function readPid(harness: Harness, name: string): number {
  return Number(readFileSync(join(harness.stateDir, name), 'utf8'))
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Ask every fixture process to exit through a shared stop file, never by a stored numeric pid. */
async function stopFixtures(harness: Harness): Promise<void> {
  writeFileSync(join(harness.stateDir, 'stop'), 'stop\n', 'utf8')
  for (const name of ['host.pid', 'grandchild.pid']) {
    const file = join(harness.stateDir, name)
    if (!existsSync(file)) continue
    const pid = Number(readFileSync(file, 'utf8'))
    if (Number.isInteger(pid) && pid > 0) await waitDead(pid, 3000)
    rmSync(file, { force: true })
  }
}

/** Forget a fixture pid once its death is confirmed, so no later teardown can signal a reused pid. */
function retirePid(harness: Harness, name: string): void {
  const file = join(harness.stateDir, name)
  if (existsSync(file)) rmSync(file, { force: true })
}

interface ActiveRun {
  controller?: AbortController
  run?: Promise<number>
}

/** Abort and await every run, stop fixture processes by stop file, then remove the temp tree. */
async function teardown(harness: Harness, running: readonly ActiveRun[]): Promise<void> {
  for (const entry of running) entry.controller?.abort()
  for (const entry of running) {
    if (entry.run !== undefined) {
      try {
        await entry.run
      } catch {
        // A failed expectation must not skip the process cleanup.
      }
    }
  }
  await stopFixtures(harness)
  harness.cleanup()
}

describe('runDev (fake CLI, no Harness installation)', () => {
  it('links a plugin, prints the exact CLI line and URL, and runs no gen in plugin mode', async () => {
    const harness = createHarness()
    const port = await freePort()
    harness.env.FAKE_PORT = String(port)
    const entry: ActiveRun = { controller: new AbortController() }
    const running: ActiveRun[] = [entry]
    try {
      entry.run = runDev({
        argv: ['--plugin', 'plugin-alpha'],
        env: harness.env,
        cwd: harness.root,
        home: harness.home,
        packages: harness.packages,
        runtimeVersion: '0.0.0',
        genCommand: harness.genCommand,
        watcherCommand: harness.watcherCommand,
        log: (line) => harness.logs.push(line),
        signal: entry.controller?.signal,
      })
      await waitFor(() => harness.logs.includes(`development page: http://127.0.0.1:${port}/`))
      const manifest = JSON.parse(
        readFileSync(join(harness.home, 'profiles', 'dev', 'package.json'), 'utf8'),
      ) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
      expect(manifest.dependencies['@dsh-setup/plugin-alpha']).toBe(
        `link:${harness.pluginDir.replaceAll('\\', '/')}`,
      )
      expect(manifest.dsh.profile.bundles).toEqual([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        '@deepseek-ai/dsh-experimental-session-search',
        'huashu-design',
        '@dsh-setup/plugin-alpha',
      ])
      const patch = readFileSync(join(harness.home, 'profiles', 'dev', 'cordis.patch.yml'), 'utf8')
      expect(patch).toContain('- id: ui-chat')
      expect(patch).toContain('- id: hmr')
      expect(patch).toContain('lib')
      expect(readFileSync(join(harness.stateDir, 'installs.txt'), 'utf8')).toContain(
        'github:example/huashu#937',
      )
      expect(harness.logs).toContain(
        `Harness CLI (override): ${harness.cliLine} (version 0.0.0-test)`,
      )
      expect(() => readFileSync(harness.genLog, 'utf8')).toThrow()
      entry.controller?.abort()
      expect(await entry.run).toBe(130)
      const hostPid = readPid(harness, 'host.pid')
      expect(await waitDead(hostPid)).toBe(true)
      retirePid(harness, 'host.pid')
      const grandchildPid = readPid(harness, 'grandchild.pid')
      expect(await waitDead(grandchildPid)).toBe(true)
      retirePid(harness, 'grandchild.pid')
    } finally {
      await teardown(harness, running)
    }
  }, 30_000)

  it('switches a reused profile to setup mode without duplicating selections', async () => {
    const harness = createHarness()
    const port = await freePort()
    harness.env.FAKE_PORT = String(port)
    const first: ActiveRun = { controller: new AbortController() }
    const second: ActiveRun = { controller: new AbortController() }
    const running: ActiveRun[] = [first, second]
    try {
      first.run = runDev({
        argv: ['--plugin', 'plugin-alpha'],
        env: harness.env,
        cwd: harness.root,
        home: harness.home,
        packages: harness.packages,
        runtimeVersion: '0.0.0',
        genCommand: harness.genCommand,
        watcherCommand: harness.watcherCommand,
        log: (line) => harness.logs.push(line),
        signal: first.controller?.signal,
      })
      await waitFor(() => harness.logs.includes(`development page: http://127.0.0.1:${port}/`))
      first.controller?.abort()
      expect(await first.run).toBe(130)

      const patchPath = join(harness.home, 'profiles', 'dev', 'cordis.patch.yml')
      const desktopPatchPath = join(harness.home, 'profiles', 'desktop', 'cordis.patch.yml')
      writeFileSync(
        desktopPatchPath,
        `${readFileSync(desktopPatchPath, 'utf8')}- id: keep\n  name: "@deepseek-ai/dsh-keep"\n`,
        'utf8',
      )

      harness.logs.length = 0
      second.run = runDev({
        argv: [],
        env: harness.env,
        cwd: harness.root,
        home: harness.home,
        packages: harness.packages,
        setupPackageDir: harness.setupPackageDir,
        runtimeVersion: '0.0.0',
        genCommand: harness.genCommand,
        watcherCommand: harness.watcherCommand,
        log: (line) => harness.logs.push(line),
        signal: second.controller?.signal,
      })
      await waitFor(() => harness.logs.includes(`development page: http://127.0.0.1:${port}/`))
      const manifest = JSON.parse(
        readFileSync(join(harness.home, 'profiles', 'dev', 'package.json'), 'utf8'),
      ) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
      expect(Object.keys(manifest.dependencies)).toEqual(['@dsh-setup/setup'])
      expect(manifest.dsh.profile.bundles).not.toContain('@dsh-setup/plugin-alpha')
      expect(manifest.dsh.profile.bundles).toContain('@dsh-setup/setup')
      const patch = readFileSync(patchPath, 'utf8')
      expect(patch).toContain('- id: keep')
      expect(patch).not.toContain('@deepseek-ai/dsh-hmr')
      expect(readFileSync(harness.genLog, 'utf8')).toContain('gen')

      // A reused setup patch without a final newline must survive the trigger write.
      writeFileSync(patchPath, patch.trimEnd(), 'utf8')
      const nested = join(harness.pluginDir, 'lib', 'index.js')
      const later = new Date(Date.now() + 5000)
      utimesSync(nested, later, later)
      await waitFor(() => harness.logs.some((line) => line.includes('host rebuild detected')))
      const triggered = readFileSync(patchPath, 'utf8')
      expect(triggered).toContain('- id: keep\n  name: "@deepseek-ai/dsh-keep"\n# dev rebuild')
      const parsed = parse(triggered) as Array<Record<string, unknown>>
      expect(parsed.find((entry) => entry.id === 'keep')).toEqual({
        id: 'keep',
        name: '@deepseek-ai/dsh-keep',
      })

      second.controller?.abort()
      expect(await second.run).toBe(130)
    } finally {
      await teardown(harness, running)
    }
  }, 40_000)

  it('reports an unconfirmed host tree with its pid and leaves the orphan untouched', async () => {
    const harness = createHarness()
    const running: ActiveRun[] = []
    try {
      harness.env.FAKE_HOST_MODE = 'exit-now'
      const code = await runDev({
        argv: ['--plugin', 'plugin-alpha'],
        env: harness.env,
        cwd: harness.root,
        home: harness.home,
        packages: harness.packages,
        runtimeVersion: '0.0.0',
        genCommand: harness.genCommand,
        watcherCommand: harness.watcherCommand,
        log: (line) => harness.logs.push(line),
      })
      expect(code).toBe(1)
      const unconfirmed = harness.logs.find((line) => line.includes('had already exited'))
      expect(unconfirmed).toMatch(
        /^host \(pid \d+\) had already exited; its process tree could not be confirmed terminated$/u,
      )
      const hostPid = readPid(harness, 'host.pid')
      expect(await waitDead(hostPid)).toBe(true)
      retirePid(harness, 'host.pid')
      const grandchild = readPid(harness, 'grandchild.pid')
      expect(alive(grandchild)).toBe(true)
      writeFileSync(join(harness.stateDir, 'stop'), 'stop\n', 'utf8')
      expect(await waitDead(grandchild)).toBe(true)
      retirePid(harness, 'grandchild.pid')
    } finally {
      await teardown(harness, running)
    }
  }, 30_000)

  it('never terminates a foreign listener and reports only its own trees', async () => {
    const harness = createHarness()
    const port = await freePort()
    const foreign = createServer()
    await new Promise<void>((resolve) => foreign.listen(port, '127.0.0.1', resolve))
    const entry: ActiveRun = { controller: new AbortController() }
    const running: ActiveRun[] = [entry]
    try {
      harness.env.FAKE_PORT = String(port)
      entry.run = runDev({
        argv: ['--plugin', 'plugin-alpha'],
        env: harness.env,
        cwd: harness.root,
        home: harness.home,
        packages: harness.packages,
        runtimeVersion: '0.0.0',
        genCommand: harness.genCommand,
        watcherCommand: harness.watcherCommand,
        log: (line) => harness.logs.push(line),
        signal: entry.controller?.signal,
      })
      await waitFor(() => harness.logs.includes(`development page: http://127.0.0.1:${port}/`))
      const marker = harness.logs.length
      entry.controller?.abort()
      expect(await entry.run).toBe(130)
      const cleanup = harness.logs
        .slice(marker)
        .filter((line) => /stopped|terminated|exited|could not terminate/u.test(line))
      expect(cleanup).toEqual(['development host stopped'])
      expect(foreign.listening).toBe(true)
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()))
      await teardown(harness, running)
    }
  }, 30_000)
})

describe('artifactSnapshot', () => {
  it('captures nested host artifacts and reports their change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-dev-snapshot-'))
    const pkgDir = join(dir, 'packages', 'plugin-alpha')
    mkdirSync(join(pkgDir, 'lib', 'host'), { recursive: true })
    writeFileSync(join(pkgDir, 'lib', 'client.js'), '// client', 'utf8')
    const nested = join(pkgDir, 'lib', 'host', 'nested.js')
    writeFileSync(nested, '// nested', 'utf8')
    const packages: WorkspacePackage[] = [
      {
        dir: pkgDir,
        relativeDir: 'packages/plugin-alpha',
        manifest: { name: '@dsh-setup/plugin-alpha', version: '0.54.0' },
      },
    ]
    try {
      const before = artifactSnapshot(packages)
      expect(before.has(nested)).toBe(true)
      const later = new Date(Date.now() + 5000)
      utimesSync(nested, later, later)
      expect(changedArtifacts(before, artifactSnapshot(packages))).toContain(nested)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('workspaceDevPlugins', () => {
  it('maps package names and directory names', () => {
    const packages: WorkspacePackage[] = [
      {
        dir: '/repo/packages/plugin-alpha',
        relativeDir: 'packages/plugin-alpha',
        manifest: { name: '@dsh-setup/plugin-alpha', version: '0.54.0' },
      },
    ]
    expect(workspaceDevPlugins(packages)).toEqual([
      {
        name: '@dsh-setup/plugin-alpha',
        dir: '/repo/packages/plugin-alpha',
        shortName: 'plugin-alpha',
      },
    ])
  })
})
