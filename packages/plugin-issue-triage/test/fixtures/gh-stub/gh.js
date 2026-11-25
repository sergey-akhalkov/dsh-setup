#!/usr/bin/env node
// Offline `gh` stub for the issue-triage acceptance. It never reaches the network:
// it logs every argument, serves fixture payloads, and persists comments/closes.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const logFile = process.env.GH_STUB_LOG
if (logFile === undefined || logFile === '') {
  console.error('gh-stub: GH_STUB_LOG is required')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const issuesFile = process.env.GH_STUB_ISSUES ?? join(here, 'issues.json')
const stateFile = process.env.GH_STUB_STATE

/** Append one line per invocation; the log is the acceptance evidence. */
function record(code) {
  appendFileSync(logFile, `${JSON.stringify({ args, exit: code })}\n`)
}

function finish(code, text) {
  record(code)
  if (text !== undefined) {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  }
  process.exit(code)
}

function fail(text) {
  record(1)
  console.error(text)
  process.exit(1)
}

function readState() {
  if (stateFile === undefined || !existsSync(stateFile)) return { comments: {}, closed: {} }
  return JSON.parse(readFileSync(stateFile, 'utf8'))
}

function writeState(state) {
  if (stateFile !== undefined) writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)
}

function withState(issue, state) {
  const posted = (state.comments[issue.number] ?? []).map((body) => ({
    author: { login: 'stub' },
    body,
  }))
  const closed = state.closed[issue.number]
  return {
    ...issue,
    state: closed === undefined ? 'open' : 'closed',
    comments: [...(issue.comments ?? []), ...posted],
  }
}

function option(name, from = args) {
  const index = from.indexOf(name)
  return index === -1 ? undefined : from[index + 1]
}

// A configured failure simulates a missing or unauthenticated gh.
const forcedExit = process.env.GH_STUB_EXIT
if (forcedExit !== undefined) {
  record(Number(forcedExit))
  console.error(`gh-stub: configured failure (exit ${forcedExit})`)
  process.exit(Number(forcedExit))
}

const [group, action, ...rest] = args

if (group === 'auth' && action === 'status') {
  finish(
    0,
    'github.com\n  ✓ Logged in to github.com account stub (GH_TOKEN)\n  - Active account: true',
  )
}

if (group === 'repo' && action === 'view') {
  finish(0, JSON.stringify({ nameWithOwner: process.env.GH_STUB_REPO ?? 'stub/stub' }))
}

const state = readState()

if (group === 'issue' && action === 'list') {
  const wanted = option('--state', rest) ?? 'open'
  const issues = JSON.parse(readFileSync(issuesFile, 'utf8')).map((issue) =>
    withState(issue, state),
  )
  finish(
    0,
    JSON.stringify(wanted === 'all' ? issues : issues.filter((issue) => issue.state === wanted)),
  )
}

if (group === 'issue' && action === 'view') {
  const number = Number(rest[0])
  const issue = JSON.parse(readFileSync(issuesFile, 'utf8')).find(
    (entry) => entry.number === number,
  )
  if (issue === undefined) fail(`gh-stub: no fixture issue #${number}`)
  finish(0, JSON.stringify(withState(issue, state)))
}

if (group === 'issue' && action === 'comment') {
  const number = Number(rest[0])
  const body = option('--body', rest) ?? ''
  state.comments[number] = [...(state.comments[number] ?? []), body]
  writeState(state)
  finish(0, `https://example.invalid/issues/${number}#issuecomment-stub`)
}

if (group === 'issue' && action === 'close') {
  const number = Number(rest[0])
  state.closed[number] = option('--reason', rest) ?? 'completed'
  writeState(state)
  finish(0, `✓ Closed issue #${number}`)
}

if (group === 'issue' && action === 'edit') {
  finish(0, `✓ Edited issue #${Number(rest[0])}`)
}

fail(`gh-stub: unsupported command: ${args.join(' ')}`)
