import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { type RepositoryFile, scanMachinePaths } from './lib/scan.ts'
import { readDshVersions, readJson, rootDir, setupDir } from './lib/workspace.ts'

/**
 * Compose a throwaway profile with the published DSH CLI and prove the setup
 * bundle installs and composes through the same path a user takes.
 *
 * DSH_CLI overrides the CLI command prefix exactly as written (quote a path that
 * contains spaces), DSH_KEEP=1 keeps the temporary Harness home for inspection.
 */

interface RunResult {
  command: string
  status: number | null
  stdout: string
  stderr: string
}

interface ProfileManifest {
  dsh?: { profile?: { bundles?: string[] } }
}

const SETUP_BUNDLE = '@dsh-setup/setup'
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.yml', '.yaml', '.svg'])

function quote(arg: string): string {
  return `"${arg.replaceAll('"', '\\"')}"`
}

function run(base: string, args: string[], env: NodeJS.ProcessEnv): RunResult {
  const command = [base, ...args.map(quote)].join(' ')
  const result = spawnSync(command, {
    shell: true,
    cwd: rootDir,
    env,
    encoding: 'utf8',
    timeout: 600_000,
  })
  return {
    command,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function tail(text: string, lines = 6): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}

/** One top-level row block from a `--dump-config` document, for targeted assertions. */
function rowBlock(dump: string, id: string): string {
  const lines = dump.split('\n')
  const start = lines.findIndex((line) => line.trim() === `- id: ${id}`)
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('- id: '))
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n')
}

/** Whether a dumped row contains one exact trimmed YAML line (not a prefix). */
function rowHasLine(row: string, expected: string): boolean {
  return row.split('\n').some((line) => line.trim() === expected)
}

function failure(result: RunResult): Error {
  return new Error(
    `exit ${String(result.status)}\n${tail(result.stdout)}\n${tail(result.stderr)}`.trim(),
  )
}

function readBundles(profileDir: string): string[] {
  const manifest = readJson<ProfileManifest>(join(profileDir, 'package.json'))
  return manifest.dsh?.profile?.bundles ?? []
}

function walkTextFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walkTextFiles(absolute))
    else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.')
      if (dot !== -1 && TEXT_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) {
        found.push(absolute)
      }
    }
  }
  return found
}

function setupPackageFiles(): RepositoryFile[] {
  return walkTextFiles(setupDir).map((path) => ({
    path: relative(rootDir, path).replaceAll('\\', '/'),
    content: readFileSync(path, 'utf8'),
  }))
}

function main(): number {
  const versions = readDshVersions()
  const cli = process.env.DSH_CLI
  const base = cli === undefined ? `pnpm dlx @deepseek-ai/dsh@${versions.runtime}` : cli
  const keep = process.env.DSH_KEEP === '1'
  const tmpRoot = join(rootDir, '.tmp')
  mkdirSync(tmpRoot, { recursive: true })
  const home = mkdtempSync(join(tmpRoot, 'home-'))
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  for (const key of [
    'DSH_PROFILE',
    'DSH_PROFILE_DIR',
    'DSH_SESSION_ID',
    'DSH_SHELL',
    'DSH_WEB_URL',
  ]) {
    delete env[key]
  }

  const failures: string[] = []
  const step = (name: string, body: () => void): void => {
    try {
      body()
      console.log(`  ok   ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`  FAIL ${name}`)
    }
  }

  const profileDir = join(home, 'profiles', 'ci')

  try {
    const init = run(
      base,
      ['--profile', 'ci', '--from-default-profile', 'web', '--dump-config'],
      env,
    )
    step('initialize a ci profile from the web template', () => {
      if (init.status !== 0) throw failure(init)
      if (!init.stdout.includes('webserver'))
        throw new Error('composed dump lacks the web composition')
    })
    if (failures.length === 0 && existsSync(join(profileDir, 'package.json'))) {
      const bundlesBefore = readBundles(profileDir)

      const install = run(base, ['plugin', '--profile', 'ci', 'add', setupDir], env)
      step('install the setup bundle by absolute path', () => {
        if (install.status !== 0) throw failure(install)
      })

      step('append only the setup bundle to the profile bundle selection', () => {
        const bundlesAfter = readBundles(profileDir)
        const expected = [...bundlesBefore, SETUP_BUNDLE]
        if (JSON.stringify(bundlesAfter) !== JSON.stringify(expected)) {
          throw new Error(
            `before: ${JSON.stringify(bundlesBefore)}, after: ${JSON.stringify(bundlesAfter)}`,
          )
        }
      })

      const dump = run(base, ['--profile', 'ci', '--dump-config'], env)
      step('compose the setup rows and owner defaults', () => {
        if (dump.status !== 0) throw failure(dump)
        for (const marker of [
          'dsh-setup-serena',
          'dsh-setup-nuphus-mcp',
          'dsh-setup-goal-continuity',
          '@deepseek-ai/dsh-mcp-client',
          'reasoningEffort: high',
          'preference: dark',
          'selectedDefault: cordis',
        ]) {
          if (!dump.stdout.includes(marker)) throw new Error(`composed dump lacks "${marker}"`)
        }
      })

      const goalContinuityDefaults = [
        'enabled: true',
        'resumeAfterRestart: false',
        'resumeAfterUserStop: non-goal',
        'maxSessionResumes: 20',
        'roundExtension: 1000',
        'maxRoundExtensions: 2',
        'hardMaxGoalRounds: 5000',
      ]

      step('compose the goal-continuity row enabled with its defaults', () => {
        const row = rowBlock(dump.stdout, 'dsh-setup-goal-continuity')
        if (row === '') throw new Error('goal-continuity row is missing')
        if (rowHasLine(row, 'disabled: true')) throw new Error('goal-continuity row is disabled')
        for (const expected of goalContinuityDefaults) {
          if (!rowHasLine(row, expected)) {
            throw new Error(`goal-continuity row lacks "${expected}"`)
          }
        }
      })

      step('ship Nuphus dormant in the lazy row and disable its static adapter', () => {
        const lazy = rowBlock(dump.stdout, 'dsh-setup-mcp-lazy')
        for (const expected of [
          'serverName: nuphus-mcp',
          'command: nuphus-mcp',
          '--confirm-write',
          'toolCallTimeoutMs: 120000',
        ]) {
          if (!lazy.includes(expected)) throw new Error(`lazy row lacks "${expected}"`)
        }
        if (!rowBlock(dump.stdout, 'dsh-setup-nuphus-mcp').includes('disabled: true')) {
          throw new Error('static Nuphus adapter row is not disabled')
        }
      })

      const overlay = (name: string, text: string): string => {
        const path = join(home, name)
        writeFileSync(path, text, 'utf8')
        return path
      }
      const explicitEnable = run(
        base,
        [
          '--profile',
          'ci',
          '--patch',
          overlay('upgrade-enable.yml', '- id: dsh-setup-nuphus-mcp\n  disabled: false\n'),
          '--dump-config',
        ],
        env,
      )
      step('compose an explicit static enable alongside the lazy default', () => {
        if (explicitEnable.status !== 0) throw failure(explicitEnable)
        if (rowBlock(explicitEnable.stdout, 'dsh-setup-nuphus-mcp').includes('disabled: true')) {
          throw new Error('profile disabled:false did not enable the static row')
        }
        if (
          !rowBlock(explicitEnable.stdout, 'dsh-setup-mcp-lazy').includes('serverName: nuphus-mcp')
        ) {
          throw new Error('lazy Nuphus entry was lost')
        }
      })

      const optOut = run(
        base,
        [
          '--profile',
          'ci',
          '--patch',
          overlay('upgrade-optout.yml', '- id: dsh-setup-mcp-lazy\n  config:\n    servers: []\n'),
          '--dump-config',
        ],
        env,
      )
      step('compose the documented opt-out with an empty lazy list', () => {
        if (optOut.status !== 0) throw failure(optOut)
        const lazy = rowBlock(optOut.stdout, 'dsh-setup-mcp-lazy')
        if (!lazy.includes('servers: []')) throw new Error('lazy servers list is not empty')
        if (lazy.includes('serverName: nuphus-mcp'))
          throw new Error('Nuphus stayed in the lazy list')
      })

      const goalContinuityDisabled = run(
        base,
        [
          '--profile',
          'ci',
          '--patch',
          overlay(
            'goal-continuity-disabled.yml',
            '- id: dsh-setup-goal-continuity\n  disabled: true\n',
          ),
          '--dump-config',
        ],
        env,
      )
      step('compose the goal-continuity row disabled with its defaults', () => {
        if (goalContinuityDisabled.status !== 0) throw failure(goalContinuityDisabled)
        const row = rowBlock(goalContinuityDisabled.stdout, 'dsh-setup-goal-continuity')
        if (!rowHasLine(row, 'disabled: true')) {
          throw new Error('profile disabled:true did not disable the goal-continuity row')
        }
        for (const expected of goalContinuityDefaults) {
          if (!rowHasLine(row, expected)) {
            throw new Error(`disabled goal-continuity row lacks "${expected}"`)
          }
        }
      })

      step('ship no absolute machine path in the setup package', () => {
        const problems = scanMachinePaths(setupPackageFiles())
        if (problems.length > 0) {
          throw new Error(
            problems.map((problem) => `${problem.path}: ${problem.message}`).join('; '),
          )
        }
      })
    } else if (failures.length === 0) {
      failures.push('initialize a ci profile: profile package.json was not created')
      console.error('  FAIL initialize a ci profile: profile package.json was not created')
    }
  } finally {
    if (keep) {
      console.log(`validate-composition: kept temporary Harness home at ${relative(rootDir, home)}`)
    } else {
      rmSync(home, { recursive: true, force: true })
    }
    if (existsSync(tmpRoot) && readdirSync(tmpRoot).length === 0)
      rmSync(tmpRoot, { recursive: true })
  }

  if (failures.length > 0) {
    console.error(`validate-composition: ${failures.length} failing check(s)`)
    for (const problem of failures) console.error(`  ${problem}`)
    return 1
  }
  console.log(`validate-composition: setup bundle composes on DSH ${versions.runtime}`)
  return 0
}

process.exitCode = main()
