import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { rootDir, setupDir } from './workspace.ts'

/** Text extensions this repository reviews; binaries and generated market files stay out of scans. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.svg',
  '.toml',
  '.ps1',
])

/** Directories with no reviewed source: VCS, dependencies, transient state, generated publication. */
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.tmp',
  '.dsh',
  'market',
  'coverage',
  '.vitest',
])

const FORBIDDEN_FILENAMES = new Set([
  '.credentials.yaml',
  '.credentials.yml',
  'id_rsa',
  'id_ed25519',
])

const PRIVATE_KEY_MARKER = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/

/** Package-relative directory of the vendored answer-page assets. */
const ANSWER_PAGE_PACKAGE_DIR = 'packages/plugin-answer-page'

/** Directory of the generated setup copy of the answer-page assets. */
const ANSWER_PAGE_VENDORED_DIR = 'packages/setup/node_modules/@dsh-setup/plugin-answer-page'

const ANSWER_PAGE_LOCK_FILE = join(rootDir, ANSWER_PAGE_PACKAGE_DIR, 'answer-page.lock.json')

/**
 * Paths whose machine-path text is upstream-owned and pinned by the answer-page
 * provenance lock (the vendored prompt carries one Windows example path).
 * Only the exact lock-listed files, in the source package and in the generated
 * setup copy, are exempt from the machine-path check; secret scanning still
 * runs on them, and a machine path anywhere else still fails.
 */
function answerPageVendoredPaths(): ReadonlySet<string> {
  const lockStat = statSync(ANSWER_PAGE_LOCK_FILE, { throwIfNoEntry: false })
  if (lockStat === undefined) return new Set()
  const lock = JSON.parse(readFileSync(ANSWER_PAGE_LOCK_FILE, 'utf8')) as {
    files?: Array<{ path?: unknown }>
  }
  const paths = new Set<string>()
  for (const file of lock.files ?? []) {
    if (typeof file.path !== 'string' || file.path.trim() === '') continue
    paths.add(`${ANSWER_PAGE_PACKAGE_DIR}/${file.path}`)
    paths.add(`${ANSWER_PAGE_VENDORED_DIR}/${file.path}`)
  }
  return paths
}

/** Windows drive, UNC, and POSIX home paths that name one machine. */
const MACHINE_PATH_PATTERNS = [
  { label: 'windows drive path', pattern: /(?:^|[^A-Za-z0-9+.-])[A-Za-z]:\\(?:[^\\\s"'`]*\\)?/ },
  { label: 'windows drive path', pattern: /(?:^|[^A-Za-z0-9+.-])[A-Za-z]:\/(?![\\/])/ },
  { label: 'UNC path', pattern: /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+/ },
  { label: 'user home path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: 'user home path', pattern: /\/home\/[A-Za-z0-9._-]+\// },
]

export interface RepositoryFile {
  path: string
  content: string
}

export interface ScanProblem {
  path: string
  message: string
}

function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

function walk(directory: string, files: string[]): void {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      // The setup bundle's vendored packages are reviewed source: keep scanning them.
      if (SKIP_DIRECTORIES.has(entry.name) && absolute !== join(setupDir, 'node_modules')) continue
      walk(absolute, files)
    } else if (entry.isFile() && isTextFile(absolute)) {
      files.push(absolute)
    }
  }
}

/** Load every reviewed text file in the repository, excluding transient and VCS state. */
export function readRepositoryFiles(): RepositoryFile[] {
  const files: string[] = []
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'openspec') continue
    if (SKIP_DIRECTORIES.has(entry.name)) continue
    const absolute = join(rootDir, entry.name)
    if (entry.isDirectory()) walk(absolute, files)
    else if (entry.isFile() && isTextFile(absolute)) files.push(absolute)
  }
  return files.map((path) => ({
    path: relative(rootDir, path).replaceAll('\\', '/'),
    content: readFileSync(path, 'utf8'),
  }))
}

/** Report absolute machine paths embedded in reviewed files. */
export function scanMachinePaths(files: RepositoryFile[]): ScanProblem[] {
  const exempt = answerPageVendoredPaths()
  const problems: ScanProblem[] = []
  for (const file of files) {
    if (exempt.has(file.path)) continue
    for (const { label, pattern } of MACHINE_PATH_PATTERNS) {
      const match = pattern.exec(file.content)
      if (match !== null) {
        problems.push({ path: file.path, message: `${label}: ${match[0].trim()}` })
        break
      }
    }
  }
  return problems
}

/** Report credential-looking files and private key material. */
export function scanSecrets(files: RepositoryFile[]): ScanProblem[] {
  const problems: ScanProblem[] = []
  for (const file of files) {
    const name = file.path.slice(file.path.lastIndexOf('/') + 1)
    if (FORBIDDEN_FILENAMES.has(name)) {
      problems.push({ path: file.path, message: 'credential file must not be committed' })
    } else if (PRIVATE_KEY_MARKER.test(file.content)) {
      problems.push({ path: file.path, message: 'private key material must not be committed' })
    }
  }
  return problems
}
