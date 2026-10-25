import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BuildOptions, build as esbuild, context as esbuildContext } from 'esbuild'
import {
  listPluginPackages,
  readDshVersions,
  rootDir,
  type WorkspacePackage,
} from './lib/workspace.ts'

/** Imports the browser module table always provides; never bundled into a client half. */
const BASELINE_CLIENT_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]

/** Client entry candidates, in preference order. */
const CLIENT_ENTRY_CANDIDATES = [
  'src/client/index.tsx',
  'src/client/index.ts',
  'src/client/index.jsx',
  'src/client/index.js',
]

const CLIENT_OUTPUT = join('lib', 'client.js')

const WATCH = process.argv.includes('--watch')

function findClientEntry(pkg: WorkspacePackage): string | undefined {
  for (const candidate of CLIENT_ENTRY_CANDIDATES) {
    const file = join(pkg.dir, candidate)
    if (existsSync(file)) return file
  }
  return undefined
}

/** Emit the browser module-loader registration the Harness client expects. */
function wrapClientModule(id: string, code: string): string {
  const indented = code
    .trimEnd()
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `    ${line}`))
    .join('\n')
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${indented}
    return module.exports;
  },
});
`
}

function writeClientOutput(pkg: WorkspacePackage, code: string): void {
  const target = join(pkg.dir, CLIENT_OUTPUT)
  mkdirSync(join(pkg.dir, 'lib'), { recursive: true })
  writeFileSync(target, wrapClientModule(pkg.manifest.name, code), 'utf8')
}

function clientBuildOptions(pkg: WorkspacePackage): BuildOptions {
  const client = pkg.manifest.dsh?.client
  if (client === undefined) throw new Error(`${pkg.relativeDir}: no dsh.client manifest`)
  const entry = findClientEntry(pkg)
  if (entry === undefined) {
    throw new Error(
      `${pkg.relativeDir}: declares dsh.client but has no client entry (looked for ${CLIENT_ENTRY_CANDIDATES.join(', ')})`,
    )
  }
  return {
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    write: false,
    sourcemap: false,
    logLevel: 'silent',
    external: [...new Set([...BASELINE_CLIENT_EXTERNALS, ...(client.external ?? [])])],
  }
}

function tscBinary(): string {
  const tscBin = join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tscBin)) throw new Error('typescript is not installed; run pnpm install first')
  return tscBin
}

async function buildOnce(packages: WorkspacePackage[]): Promise<void> {
  if (packages.length > 0) {
    execFileSync(process.execPath, [tscBinary(), '-b'], { cwd: rootDir, stdio: 'inherit' })
  }
  let clients = 0
  for (const pkg of packages) {
    if (pkg.manifest.dsh?.client === undefined) continue
    const result = await esbuild(clientBuildOptions(pkg))
    const output = result.outputFiles?.[0]
    if (output === undefined) throw new Error(`${pkg.relativeDir}: client build produced no output`)
    writeClientOutput(pkg, output.text)
    clients += 1
  }
  console.log(`build: ${clients} client bundle(s) written`)
}

async function watch(packages: WorkspacePackage[]): Promise<void> {
  const tsc = spawn(process.execPath, [tscBinary(), '-b', '--watch', '--preserveWatchOutput'], {
    cwd: rootDir,
    stdio: 'inherit',
  })
  const clients = packages.filter((pkg) => pkg.manifest.dsh?.client !== undefined)
  const contexts = await Promise.all(
    clients.map((pkg) =>
      esbuildContext({
        ...clientBuildOptions(pkg),
        plugins: [
          {
            name: 'dsh-client-output',
            setup(build) {
              build.onEnd((result) => {
                if (result.errors.length > 0) return
                const output = result.outputFiles?.[0]
                if (output === undefined) return
                writeClientOutput(pkg, output.text)
                console.log(
                  `build: rewrote ${pkg.relativeDir}/${CLIENT_OUTPUT.replaceAll('\\', '/')}`,
                )
              })
            },
          },
        ],
      }),
    ),
  )
  await Promise.all(contexts.map(async (ctx) => ctx.watch()))
  console.log(`build: watching ${clients.length} client bundle(s); Ctrl+C to stop`)

  const shutdown = async (): Promise<void> => {
    tsc.kill()
    await Promise.all(contexts.map(async (ctx) => ctx.dispose()))
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

const packages = listPluginPackages()
const versions = readDshVersions()
console.log(`build: ${packages.length} workspace package(s), DSH ${versions.runtime}`)
if (WATCH) await watch(packages)
else await buildOnce(packages)
