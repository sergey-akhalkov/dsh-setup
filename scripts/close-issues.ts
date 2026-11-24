/**
 * Release closeout: close the GitHub issues an archived change names with `Fixes #<n>`.
 *
 * The plan is offline by default: it reads, at the selected revision, the proposal of every
 * change the window adds to the archive, and prints the issues those proposals fix. The
 * window is the previous tag .. `--version` (HEAD when no tag is given), so a run for an
 * older tag neither reads nor closes anything from a later release. `--apply --version <tag>`
 * posts one comment naming the tag, the Release URL and the archived change, then closes the
 * issue as completed; a closed issue, `wontfix` and `invalid` are skipped, and a rerun posts
 * nothing.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const USAGE =
  'usage: close-issues [--change <name>] [--from <tag>] [--version <tag>] [--apply] [--json]'

/** A standalone `Fixes` line closes its issue; a `Refs` line is deliberately not parsed. */
const FIXES = /^Fixes #(\d+)$/u
const ARCHIVE_DIRECTORY = /^(\d{4}-\d{2}-\d{2})-(.+)$/u
const ARCHIVED_PROPOSAL = /^openspec\/changes\/archive\/([^/]+)\/proposal\.md$/u
const ISSUE_URL = /\/issues\/\d+$/u
const VALUE_FLAGS = { '--change': 'change', '--from': 'from', '--version': 'version' } as const

export interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export type Command = (command: string, args: readonly string[]) => CommandResult

/** A change whose proposal names the issues it fixes. */
export interface ChangeIssues {
  name: string
  date: string
  changePath: string
  fixes: number[]
}

export interface PlannedIssue {
  issue: number
  change: string
  date: string
  changePath: string
  alsoNamedBy: string[]
}

export interface MainOptions {
  root?: string
  command?: Command
  out?: (line: string) => void
}

interface Options {
  change?: string
  from?: string
  version?: string
  apply: boolean
  json: boolean
}

interface IssueSnapshot {
  state: string
  labels: string[]
  url: string
  comments: string[]
}

const spawn: Command = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function detailOf(result: CommandResult): string {
  const detail = result.stderr.trim()
  return detail === ''
    ? `exit ${result.status ?? 'none'}`
    : detail.replace(/\s+/gu, ' ').slice(0, 300)
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw new Error(`git could not run: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().replace(/\s+/gu, ' ').slice(0, 300)
    throw new Error(`git ${args[0] ?? 'command'} failed${detail === '' ? '' : `: ${detail}`}`)
  }
  return result.stdout
}

/** The nearest tag before `revision`: the default lower bound of its release window. */
function previousTag(root: string, revision: string): string {
  try {
    return git(root, ['describe', '--tags', '--abbrev=0', `${revision}^`]).trim()
  } catch {
    throw new Error(`no tag precedes ${revision}; pass --from <tag>`)
  }
}

/** Every issue a proposal fixes, in file order; `Refs` and an indented example never close. */
export function parseFixes(text: string): number[] {
  const issues = new Set<number>()
  for (const line of text.split(/\r?\n/u)) {
    const issue = FIXES.exec(line)?.[1]
    if (issue !== undefined) issues.add(Number(issue))
  }
  return [...issues]
}

/** The archived changes the window `from..to` adds, read from `to` rather than the worktree. */
export function archivedChanges(root: string, from: string, to: string): ChangeIssues[] {
  const output = git(root, [
    'log',
    '--diff-filter=A',
    '--name-only',
    '--format=',
    `${from}..${to}`,
    '--',
    'openspec/changes/archive/',
  ])
  const directories = new Set<string>()
  for (const line of output.split('\n')) {
    const directory = ARCHIVED_PROPOSAL.exec(line.trim())?.[1]
    if (directory !== undefined) directories.add(directory)
  }
  return [...directories].sort().map((directory) => {
    const match = ARCHIVE_DIRECTORY.exec(directory)
    const path = `openspec/changes/archive/${directory}/proposal.md`
    return {
      name: match?.[2] ?? directory,
      date: match?.[1] ?? '',
      changePath: `openspec/changes/archive/${directory}`,
      fixes: parseFixes(git(root, ['show', `${to}:${path}`])),
    }
  })
}

/** The earliest change wins an issue; every later change that names it is recorded. */
export function planFromChanges(changes: readonly ChangeIssues[]): PlannedIssue[] {
  const ordered = [...changes].sort((left, right) =>
    left.date === right.date
      ? left.name.localeCompare(right.name)
      : left.date.localeCompare(right.date),
  )
  const planned = new Map<number, PlannedIssue>()
  for (const change of ordered) {
    for (const issue of change.fixes) {
      const existing = planned.get(issue)
      if (existing === undefined) {
        planned.set(issue, {
          issue,
          change: change.name,
          date: change.date,
          changePath: change.changePath,
          alsoNamedBy: [],
        })
      } else {
        existing.alsoNamedBy.push(change.name)
      }
    }
  }
  return [...planned.values()].sort((left, right) => left.issue - right.issue)
}

/** The plan for one active change, read from its proposal before the archive. */
export function previewActiveChange(root: string, name: string): PlannedIssue[] {
  const proposal = join(root, 'openspec', 'changes', name, 'proposal.md')
  return planFromChanges([
    {
      name,
      date: '',
      changePath: `openspec/changes/${name}`,
      fixes: parseFixes(readFileSync(proposal, 'utf8')),
    },
  ])
}

export function describePlan(plan: readonly PlannedIssue[]): string[] {
  if (plan.length === 0) return ['no issues to close']
  return plan.map((entry) => {
    const also =
      entry.alsoNamedBy.length === 0 ? '' : ` (also named by ${entry.alsoNamedBy.join(', ')})`
    return `#${entry.issue} ${entry.change}${also}`
  })
}

function commentMarker(tag: string): string {
  return `<!-- dsh-setup:closed-by=${tag} -->`
}

/** The one comment a closed issue receives: the tag, its Release and the archived change. */
export function closeComment(entry: PlannedIssue, tag: string, repoUrl: string): string {
  return [
    `Shipped in ${tag}.`,
    '',
    `- Release: ${repoUrl}/releases/tag/${tag}`,
    `- Change: \`${entry.changePath}\``,
    '',
    'If this is still present, please reopen this issue.',
    '',
    commentMarker(tag),
  ].join('\n')
}

function readIssue(issue: number, command: Command): IssueSnapshot {
  const result = command('gh', [
    'issue',
    'view',
    String(issue),
    '--json',
    'state,labels,comments,url',
  ])
  if (result.status !== 0) {
    throw new Error(`gh issue view ${issue} failed: ${detailOf(result)}`)
  }
  const parsed = JSON.parse(result.stdout) as {
    state?: string
    labels?: Array<{ name?: string }>
    comments?: Array<{ body?: string }>
    url?: string
  }
  return {
    state: parsed.state ?? '',
    labels: (parsed.labels ?? []).map((label) => label.name ?? ''),
    url: parsed.url ?? '',
    comments: (parsed.comments ?? []).map((comment) => comment.body ?? ''),
  }
}

/** Comment once, then close as completed; state, labels and the marker make a rerun a no-op. */
export function applyPlan(
  plan: readonly PlannedIssue[],
  tag: string,
  command: Command,
  out: (line: string) => void,
): void {
  const marker = commentMarker(tag)
  for (const entry of plan) {
    const snapshot = readIssue(entry.issue, command)
    if (snapshot.state !== 'OPEN') {
      out(`#${entry.issue}: skipped, already ${snapshot.state.toLowerCase()}`)
      continue
    }
    const decision = snapshot.labels.find((label) => label === 'wontfix' || label === 'invalid')
    if (decision !== undefined) {
      out(`#${entry.issue}: skipped, labelled ${decision}`)
      continue
    }
    const repoUrl = snapshot.url.replace(ISSUE_URL, '')
    if (!snapshot.comments.some((comment) => comment.includes(marker))) {
      const posted = command('gh', [
        'issue',
        'comment',
        String(entry.issue),
        '--body',
        closeComment(entry, tag, repoUrl),
      ])
      if (posted.status !== 0) {
        throw new Error(`commenting on issue ${entry.issue} failed: ${detailOf(posted)}`)
      }
      out(`#${entry.issue}: commented`)
    }
    const closed = command('gh', ['issue', 'close', String(entry.issue), '--reason', 'completed'])
    if (closed.status !== 0) {
      throw new Error(`closing issue ${entry.issue} failed: ${detailOf(closed)}`)
    }
    out(`#${entry.issue}: closed as completed`)
  }
}

function parseOptions(argv: readonly string[]): Options | { error: string } {
  const options: Options = { apply: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === undefined) break
    if (flag === '--apply') {
      options.apply = true
      continue
    }
    if (flag === '--json') {
      options.json = true
      continue
    }
    const key = flag in VALUE_FLAGS ? VALUE_FLAGS[flag as keyof typeof VALUE_FLAGS] : undefined
    if (key === undefined) return { error: `unknown argument: ${flag}\n${USAGE}` }
    const value = argv[index + 1]
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      return { error: `${flag} needs a value\n${USAGE}` }
    }
    options[key] = value
    index += 1
  }
  return options
}

export function main(argv: readonly string[], options: MainOptions = {}): number {
  const out = options.out ?? console.log
  const command = options.command ?? spawn
  const root = options.root ?? process.cwd()
  const parsed = parseOptions(argv)
  if ('error' in parsed) {
    console.error(parsed.error)
    return 1
  }
  if (parsed.apply && parsed.version === undefined) {
    console.error(`--apply needs --version <tag>\n${USAGE}`)
    return 1
  }
  if (parsed.apply && parsed.change !== undefined) {
    console.error(`--apply cannot be combined with --change\n${USAGE}`)
    return 1
  }
  if (parsed.apply && command('gh', ['--version']).status !== 0) {
    console.error('--apply needs a working `gh` CLI')
    return 2
  }
  let plan: PlannedIssue[]
  try {
    // The plan is read at the release tag, never at the worktree: replaying an older release
    // from a newer checkout must not close an issue that release did not fix.
    const revision = parsed.version ?? 'HEAD'
    plan =
      parsed.change === undefined
        ? planFromChanges(
            archivedChanges(root, parsed.from ?? previousTag(root, revision), revision),
          )
        : previewActiveChange(root, parsed.change)
  } catch (error) {
    console.error(message(error))
    return 1
  }
  if (parsed.json) out(JSON.stringify(plan, null, 2))
  else for (const line of describePlan(plan)) out(line)
  if (!parsed.apply || parsed.version === undefined) return 0
  try {
    applyPlan(plan, parsed.version, command, out)
  } catch (error) {
    console.error(message(error))
    return 1
  }
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
