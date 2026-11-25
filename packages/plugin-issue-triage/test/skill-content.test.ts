import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skill = readFileSync(join(packageDir, 'assets', 'issue-triage', 'SKILL.md'), 'utf8')
/** Prose is wrapped for readability; phrases are matched with whitespace collapsed. */
const prose = skill.split(/\s+/).filter(Boolean).join(' ')

/** Every verdict the delta spec allows, in one place. */
const VERDICTS = [
  'tracked',
  'shipped',
  'fixed',
  'duplicate',
  'invalid',
  'needs-info',
  'deferred',
  'needs-change',
]

describe('issue-triage skill content', () => {
  it('has a named section for every requirement of the delta spec', () => {
    for (const section of [
      'When to use it',
      'Preconditions',
      'The run',
      'Verdicts',
      'Evidence',
      'Closes',
      'Clustering and the cap',
      'Subagent brief',
      'Write-back',
      'Report',
      'Safety',
      'Failure modes',
    ]) {
      expect(skill, section).toContain(`## ${section}`)
    }
  })

  it('stops with one named remedy before inventory without gh or an OpenSpec root', () => {
    expect(prose).toContain('`gh auth status` succeeds')
    expect(prose).toContain('gh is not authenticated: run `gh auth login`, then rerun the triage.')
    expect(prose).toContain('`openspec list --json` returns a `root` object')
    expect(prose).toContain(
      'no OpenSpec root: run `openspec init --tools none` here, then rerun the triage.',
    )
    expect(prose).toContain(
      'Nothing is written to GitHub and nothing in the repository changes during preflight or inventory.',
    )
  })

  it('requires the complete inventory before any verdict with a supported command', () => {
    expect(prose).toContain(
      '`gh issue list --state open --limit 1000 --json number,title,labels,createdAt,updatedAt`',
    )
    expect(prose).toContain('when the read returns exactly that many, raise it and read')
    expect(prose).toContain('never assign a verdict from a truncated list')
    expect(prose).toContain('The inventory returns exactly the limit')
    // `gh issue list` has no `--paginate` flag; the installed CLI exits 1 on it.
    expect(skill).not.toContain('--paginate')
  })

  it('pins the full verdict vocabulary, one verdict per issue', () => {
    for (const verdict of VERDICTS) {
      const row = new RegExp(`^\\| \`${verdict}\` +\\|`, 'mu')
      expect(skill, verdict).toMatch(row)
    }
    expect(prose).toContain('Every issue gets exactly one of these')
  })

  it('requires evidence for each verdict and rejects a text claim', () => {
    expect(prose).toContain('A verdict MUST NOT rest on a text claim alone')
    expect(prose).toContain(
      "the command that reproduced the symptom and that command's passing output",
    )
    expect(prose).toContain("that change's name, from its `Fixes #<n>` line")
    expect(prose).toContain('the canonical issue number')
    expect(prose).toContain('the paths the fix will touch, and the cluster that carries it')
    expect(prose).toContain(
      'An issue that reads fixed but has no command and passing output is `needs-info`, not `fixed`',
    )
  })

  it('closes only duplicates and fixed or shipped issues, and asks the owner for invalid', () => {
    expect(prose).toContain('Only `duplicate`, `fixed`, and `shipped` are closeable in a run')
    expect(prose).toContain('Never close an `invalid` issue')
    expect(prose).toContain("without the owner's recorded answer")
    expect(prose).toContain('`gh issue close <n> --duplicate-of <canonical>`')
    expect(prose).toContain('`gh issue close <n> --reason completed`')
    expect(prose).toContain('Do not edit the body.')
  })

  it('clusters by touched paths and caps one run at three proposals', () => {
    expect(prose).toContain('Two issues belong to one cluster when the paths they touch overlap')
    expect(prose).toContain('Propose at most three changes per run')
    expect(prose).toContain(
      'Rank by severity: gate-breaking, data loss, or security first; then visible breakage; then a flake or polish',
    )
    expect(prose).toContain(
      'An issue beyond the cap gets the `deferred` verdict, a deferral comment, and stays open',
    )
  })

  it('writes drafts instead of changes and promotes through the Harness shell intake', () => {
    expect(prose).toContain('A proposal is a draft, not a change')
    for (const draft of ['requirements.md', 'architecture.md', 'interface.md']) {
      expect(prose, draft).toContain(draft)
    }
    expect(prose).toContain(
      'under `.dsh/workflows/drafts/<name>/`, and write nothing under `openspec/changes/`',
    )
    expect(prose).toContain('invokes `openspec new change <name>` through the Harness shell tool')
    expect(prose).toContain(
      'a direct CLI invocation outside the Harness session does not start the intake',
    )
    expect(prose).toContain("The intake's approval decides the spec before implementation")
  })

  it('makes every GitHub write lead-only, marked, and idempotent', () => {
    expect(prose).toContain('Only the lead writes to GitHub')
    expect(prose).toContain('a rerun must not post a second triage comment')
    expect(skill).toContain('<!-- dsh-setup:change=<change-name> -->')
    expect(prose).toContain('delete an issue, never edit a body, never close a pull request')
  })

  it('ships a subagent brief that forbids a GitHub write', () => {
    expect(prose).toContain('One worker per cluster, never one per issue')
    const start = skill.indexOf('## Subagent brief')
    const end = skill.indexOf('## Write-back')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const brief = skill.slice(start, end)
    expect(brief).toContain('```text')
    expect(brief).toContain('Forbidden: any `gh` command, any GitHub write')
    expect(brief).toContain('`.dsh/workflows/drafts/<name>/`')
    expect(brief).toContain('any file under `openspec/changes/`')
    for (const draft of ['requirements.md', 'architecture.md', 'interface.md']) {
      expect(brief, draft).toContain(draft)
    }
  })

  it('ships the four copy-ready comment templates', () => {
    for (const template of [
      'Template 1: change link',
      'Template 2: duplicate close',
      'Template 3: fixed or shipped close',
      'Template 4: deferral beyond the cap',
    ]) {
      expect(skill, template).toContain(`<!-- ${template}`)
    }
  })

  it('carries the marker on every template and defines the no-change value', () => {
    expect(prose).toContain('carries `<!-- dsh-setup:change=none -->`')
    const blocks = skill.split('<!-- Template ').slice(1)
    expect(blocks).toHaveLength(4)
    for (const block of blocks) {
      expect(block).toContain('<!-- dsh-setup:change=')
    }
  })

  it('pins the fixed, shipped, and deferred template branches', () => {
    expect(prose).toContain('no release contains it yet')
    expect(prose).toContain('Shipped in `<version>`')
    expect(prose).toContain('Verdict `deferred`')
  })

  it('ends with the two report tables and their exact columns', () => {
    expect(prose).toContain(
      'The main table has exactly the columns `Issue`, `Verdict`, `Evidence`, `Change or draft`, and `Next step`',
    )
    expect(prose).toContain(
      '`Items closed in this run`, has the columns `Issue`, `Verdict`, `Comment`, and `Close command`',
    )
    expect(prose).toContain('one row per issue, ordered by severity')
  })

  it('pins the worked example columns, the cap, and placeholders instead of a fixed mapping', () => {
    const start = skill.indexOf('## Worked example')
    expect(start).toBeGreaterThan(-1)
    const example = skill.slice(start).split(/\s+/).filter(Boolean).join(' ')
    expect(example).toMatch(
      /\| Issue +\| Verdict +\| Evidence +\| Change or draft +\| Next step +\|/,
    )
    expect(example).toContain('the observed count up to the cap of three')
    expect(example).toContain('nothing here preselects which issue goes to which draft')
    expect(example).toContain('#<n>')
    // A concrete number would turn the template into a stored verdict.
    expect(example).not.toMatch(/#\d+/)
  })
})
